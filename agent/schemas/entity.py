from pydantic import BaseModel

class EntityBase(BaseModel):
    """Base class for all entity schemas."""
    pass

class UserEntity(EntityBase):
    user_id: str | None = None
    email: str | None = None
    name: str | None = None

class BillingEntity(EntityBase):
    account_id: str | None = None
    amount: float | None = None
    currency: str | None = None
