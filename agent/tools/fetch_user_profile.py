async def fetch_user_profile(user_id: str, **kwargs) -> dict:
    """Fetch a user profile by user_id."""
    return {"user_id": user_id, "name": "Test User", "email": "test@example.com"}
