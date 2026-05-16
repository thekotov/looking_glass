import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.user import User

log = logging.getLogger(__name__)


async def seed_admin_user() -> None:
    """Idempotently ensure an admin user exists.

    Creates one with `settings.admin_username` / `settings.admin_password`
    if no user with that username is present.
    """
    async with SessionLocal() as session:
        existing = await session.execute(
            select(User).where(User.username == settings.admin_username)
        )
        if existing.scalar_one_or_none() is not None:
            return
        user = User(
            username=settings.admin_username,
            password_hash=hash_password(settings.admin_password),
            role="admin",
        )
        session.add(user)
        await session.commit()
        log.warning(
            "seeded admin user %r (CHANGE THE PASSWORD IN PRODUCTION via ADMIN_PASSWORD env)",
            settings.admin_username,
        )
