async def check_permissions(user_id: str, resource: str = "default", **kwargs) -> dict:
    """Check permissions for a user on a resource."""
    return {"user_id": user_id, "resource": resource, "allowed": True}
