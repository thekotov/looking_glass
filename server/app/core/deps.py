import uuid
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.security import decode_token, hash_agent_token
from app.models.agent import Agent, AgentStatus
from app.models.user import User

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: DbSession = None,  # type: ignore[assignment]
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="token expired") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid token") from exc

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="wrong token type")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="invalid token payload") from exc

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="user not found")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_current_agent(
    authorization: Annotated[str | None, Header()] = None,
    db: DbSession = None,  # type: ignore[assignment]
) -> Agent:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=401,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ", 1)[1].strip()
    token_hash = hash_agent_token(token)
    result = await db.execute(select(Agent).where(Agent.token_hash == token_hash))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=401, detail="unknown agent token")
    if agent.status == AgentStatus.REJECTED.value:
        raise HTTPException(status_code=403, detail="agent rejected")
    return agent


CurrentAgent = Annotated[Agent, Depends(get_current_agent)]
