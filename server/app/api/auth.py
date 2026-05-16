import uuid

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.rate_limit import (
    check_login_rate_limit,
    record_login_failure,
    record_login_success,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.models.audit import AuditAction
from app.models.user import User
from app.schemas.auth import LoginRequest, RefreshRequest, TokenPair, UserOut
from app.services.audit import audit

router = APIRouter(prefix="/auth", tags=["auth"])


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=255)
    new_password: str = Field(min_length=8, max_length=255)


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: DbSession, request: Request) -> TokenPair:
    ip = request.client.host if request.client else None
    await check_login_rate_limit(ip, payload.username)

    result = await db.execute(select(User).where(User.username == payload.username))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        await record_login_failure(ip, payload.username)
        await audit(
            db,
            action=AuditAction.LOGIN_FAILED.value,
            username=payload.username,
            request=request,
        )
        raise HTTPException(status_code=401, detail="invalid credentials")

    await record_login_success(ip, payload.username)
    await audit(db, user=user, action=AuditAction.LOGIN.value, request=request)
    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    try:
        claims = decode_token(payload.refresh_token)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="refresh token expired") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid refresh token") from exc

    if claims.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="wrong token type")

    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid token payload") from exc

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="user not found")

    return TokenPair(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserOut)
async def me(current: CurrentUser) -> UserOut:
    return UserOut.model_validate(current)


@router.post("/change-password", status_code=204)
async def change_password(
    payload: ChangePasswordRequest, user: CurrentUser, db: DbSession, request: Request,
) -> None:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    await audit(
        db,
        user=user,
        action=AuditAction.PASSWORD_CHANGE.value,
        resource_type="user",
        resource_id=str(user.id),
        request=request,
    )
