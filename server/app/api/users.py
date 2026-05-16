"""Admin-only user management."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.rbac import ROLE_LEVELS, CurrentAdmin
from app.core.security import hash_password
from app.models.audit import AuditAction
from app.models.user import User
from app.schemas.auth import UserOut
from app.services.audit import audit

router = APIRouter(prefix="/users", tags=["users"])


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=255)
    role: str = Field(default="readonly")


class UserUpdateRequest(BaseModel):
    role: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=255)


def _validate_role(role: str) -> None:
    if role not in ROLE_LEVELS:
        raise HTTPException(
            status_code=400,
            detail=f"role must be one of {list(ROLE_LEVELS)}",
        )


@router.get("", response_model=list[UserOut])
async def list_users(_: CurrentAdmin, db: DbSession) -> list[UserOut]:
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return [UserOut.model_validate(u) for u in result.scalars()]


@router.post("", response_model=UserOut, status_code=201)
async def create_user(
    payload: UserCreateRequest, admin: CurrentAdmin, db: DbSession, request: Request,
) -> UserOut:
    _validate_role(payload.role)
    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="username already exists")
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await audit(
        db, user=admin, action=AuditAction.USER_CREATE.value,
        resource_type="user", resource_id=str(user.id),
        request=request, details={"username": user.username, "role": user.role},
    )
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateRequest,
    admin: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> UserOut:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    changed: dict[str, object] = {}
    if payload.role is not None:
        _validate_role(payload.role)
        # Prevent admin from demoting themselves and locking the system out
        # when they're the only admin.
        if user.id == admin.id and payload.role != "admin":
            raise HTTPException(
                status_code=400,
                detail="cannot demote yourself — ask another admin",
            )
        user.role = payload.role
        changed["role"] = payload.role
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        changed["password"] = "***"
    await db.commit()
    await db.refresh(user)
    await audit(
        db, user=admin, action=AuditAction.USER_UPDATE.value,
        resource_type="user", resource_id=str(user.id),
        request=request, details={"username": user.username, "changed": changed},
    )
    return UserOut.model_validate(user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: uuid.UUID, admin: CurrentAdmin, db: DbSession, request: Request,
) -> None:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="cannot delete yourself")
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    username = user.username
    await db.delete(user)
    await db.commit()
    await audit(
        db, user=admin, action=AuditAction.USER_DELETE.value,
        resource_type="user", resource_id=str(user_id),
        request=request, details={"username": username},
    )
