"""Credential resolver — parses secret_ref URIs and dispatches to the right backend.

URI schemes:
  env:VAR_NAME          — read from os.environ
  vault:mount/path      — Vault KV v2 GET /v1/{mount}/data/{path}, returns first string field
  vault:mount/path#key  — Vault KV v2, returns named key from secret data
  aws:secret-id         — AWS Secrets Manager GetSecretValue
  <bare string>         — treated as env:VAR_NAME (backward compat)
"""
from __future__ import annotations

import os
from functools import lru_cache


class CredentialResolveError(RuntimeError):
    """Raised when a secret_ref cannot be resolved."""


class CredentialResolver:
    def __init__(
        self,
        vault_addr: str | None = None,
        vault_token: str | None = None,
        vault_k8s_role: str | None = None,
    ):
        self._vault_addr = vault_addr
        self._vault_token = vault_token
        self._vault_k8s_role = vault_k8s_role

    @classmethod
    def from_env(cls) -> "CredentialResolver":
        return cls(
            vault_addr=os.environ.get("VAULT_ADDR"),
            vault_token=os.environ.get("PLATFORM_VAULT_TOKEN"),
            vault_k8s_role=os.environ.get("VAULT_K8S_ROLE"),
        )

    async def aresolve(self, secret_ref: str) -> str:
        """Resolve a secret_ref URI to a plaintext secret string."""
        if not secret_ref:
            raise CredentialResolveError("secret_ref is empty")

        if secret_ref.startswith("env:"):
            return self._resolve_env(secret_ref[4:])
        if secret_ref.startswith("vault:"):
            return await self._resolve_vault(secret_ref[6:])
        if secret_ref.startswith("aws:"):
            return await self._resolve_aws(secret_ref[4:])

        # Plain string — backward-compat env lookup
        return self._resolve_env(secret_ref)

    # ── Backends ──────────────────────────────────────────────────────────────

    @staticmethod
    def _resolve_env(var_name: str) -> str:
        value = os.environ.get(var_name)
        if not value:
            raise CredentialResolveError(f"env var '{var_name}' is not set")
        return value

    async def _resolve_vault(self, path_with_key: str) -> str:
        """Read a Vault KV v2 secret.

        path_with_key: "mount/path/to/secret" or "mount/path/to/secret#field"
        The first path segment is the mount name; the rest is the secret path.
        If a #field fragment is present, that key is returned from secret.data;
        otherwise the first string value in secret.data is used.
        """
        import httpx

        if not self._vault_addr:
            raise CredentialResolveError("VAULT_ADDR is not configured")

        # Split optional field fragment
        if "#" in path_with_key:
            path_part, field = path_with_key.split("#", 1)
        else:
            path_part, field = path_with_key, None

        # First segment is mount; remainder is secret path
        segments = path_part.split("/", 1)
        if len(segments) != 2:
            raise CredentialResolveError(
                f"vault secret_ref must be 'mount/path[#field]', got: '{path_with_key}'"
            )
        mount, secret_path = segments

        token = await self._vault_token_resolved()
        url = f"{self._vault_addr.rstrip('/')}/v1/{mount}/data/{secret_path}"

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers={"X-Vault-Token": token})

        if resp.status_code == 404:
            raise CredentialResolveError(f"Vault secret not found: {path_with_key}")
        if resp.status_code != 200:
            raise CredentialResolveError(
                f"Vault returned {resp.status_code} for secret '{path_with_key}'"
            )

        try:
            data: dict = resp.json()["data"]["data"]
        except (KeyError, TypeError) as exc:
            raise CredentialResolveError(
                f"Unexpected Vault response shape for '{path_with_key}'"
            ) from exc

        if field:
            if field not in data:
                raise CredentialResolveError(
                    f"Field '{field}' not found in Vault secret '{path_with_key}'"
                )
            return str(data[field])

        # No field specified — return first string value
        for v in data.values():
            if isinstance(v, str):
                return v
        raise CredentialResolveError(
            f"No string value found in Vault secret '{path_with_key}'"
        )

    async def _vault_token_resolved(self) -> str:
        """Return a Vault token, performing K8s auth if necessary."""
        if self._vault_token:
            return self._vault_token
        if self._vault_k8s_role:
            return await self._vault_k8s_login(self._vault_k8s_role)
        raise CredentialResolveError(
            "No Vault token available — set PLATFORM_VAULT_TOKEN or VAULT_K8S_ROLE"
        )

    async def _vault_k8s_login(self, role: str) -> str:
        import httpx

        try:
            with open("/var/run/secrets/kubernetes.io/serviceaccount/token") as f:
                sa_token = f.read().strip()
        except OSError as exc:
            raise CredentialResolveError(
                "Vault K8s login failed: service account token not found"
            ) from exc

        url = f"{self._vault_addr.rstrip('/')}/v1/auth/kubernetes/login"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={"role": role, "jwt": sa_token})

        if resp.status_code != 200:
            raise CredentialResolveError(
                f"Vault K8s login returned {resp.status_code}"
            )
        try:
            return resp.json()["auth"]["client_token"]
        except (KeyError, TypeError) as exc:
            raise CredentialResolveError("Vault K8s login: unexpected response shape") from exc

    @staticmethod
    async def _resolve_aws(secret_id: str) -> str:
        """Fetch a secret from AWS Secrets Manager."""
        import asyncio
        from functools import partial

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(_get_aws_secret, secret_id))


def _get_aws_secret(secret_id: str) -> str:
    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError as exc:
        raise CredentialResolveError(
            "boto3 is not installed — cannot resolve aws: secret refs"
        ) from exc

    client = boto3.client("secretsmanager")
    try:
        resp = client.get_secret_value(SecretId=secret_id)
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        raise CredentialResolveError(
            f"AWS Secrets Manager error for '{secret_id}': {code}"
        ) from exc

    value = resp.get("SecretString") or resp.get("SecretBinary")
    if not value:
        raise CredentialResolveError(
            f"AWS secret '{secret_id}' returned no SecretString or SecretBinary"
        )
    return value if isinstance(value, str) else value.decode()
