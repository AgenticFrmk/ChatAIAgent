from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter

logger = logging.getLogger(__name__)

DEFAULT_OTLP_ENDPOINT = "http://jaeger:4318/v1/traces"


def _resolve_endpoint() -> str | None:
    raw = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT).strip()
    if raw.lower() in ("", "none", "off", "disabled"):
        return None
    if raw.endswith("/v1/traces"):
        return raw
    return raw.rstrip("/") + "/v1/traces"


def configure_tracing(service_name: str, app: FastAPI | None = None) -> None:
    if getattr(configure_tracing, "_installed", False):
        return
    endpoint = _resolve_endpoint()
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    if endpoint is not None:
        try:
            provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint)))
            logger.info("OTel tracing enabled — exporting to %s", endpoint)
        except Exception as exc:
            logger.warning("OTel exporter init failed (%s); falling back to console", exc)
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    else:
        logger.info("OTel tracing disabled (OTEL_EXPORTER_OTLP_ENDPOINT)")
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()
    if app is not None:
        FastAPIInstrumentor.instrument_app(app, excluded_urls="health")
    configure_tracing._installed = True
