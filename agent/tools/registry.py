from collections.abc import Callable
from agent.tools.fetch_user_profile import fetch_user_profile
from agent.tools.check_permissions import check_permissions
from agent.tools.create_report import create_report

TOOL_REGISTRY: dict[str, Callable] = {
    "fetch_user_profile": fetch_user_profile,
    "check_permissions": check_permissions,
    "create_report": create_report,
}

class UnknownToolError(Exception):
    pass
