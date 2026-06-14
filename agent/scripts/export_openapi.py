"""Export the AgentBE OpenAPI spec to openapi.yaml in the service root.

Run from the AgentBE directory:
    python scripts/export_openapi.py
"""
import os
import sys
import yaml
from pathlib import Path

os.environ.setdefault("CHECKPOINTER_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ANTHROPIC_API_KEY", "x")
os.environ.setdefault("REGISTRY_URL", "http://localhost:8001")
os.environ.setdefault("REGISTRY_AUTH_URL", "http://localhost:9000")
os.environ.setdefault("SLM_PLATFORM_URL", "http://localhost:8080")

sys.path.insert(0, str(Path(__file__).parent.parent))
from main import app

spec = app.openapi()
out = Path(__file__).parent.parent / "openapi.yaml"
out.write_text(yaml.dump(spec, default_flow_style=False, sort_keys=False, allow_unicode=True))
print(f"Written: {out}")
