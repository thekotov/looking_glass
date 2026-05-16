"""Role-based access control helpers.

Roles (low → high):
    readonly: view-only (list agents, list tasks, view results)
    operator: + create/cancel tasks
    admin:    + approve/reject/delete agents, manage users, see audit log

Use the typed dependency aliases (CurrentAdmin, CurrentOperator) in endpoint
signatures. The base CurrentUser remains for "any authenticated user" endpoints.
"""
from __future__ import annotations

from typing import Annotated, Callable

from fastapi import Depends, HTTPException

from app.core.deps import CurrentUser
from app.models.user import User

ROLE_LEVELS = {"readonly": 0, "operator": 1, "admin": 2}


def require_role(min_role: str) -> Callable[[User], User]:
    """Returns a dependency that asserts the current user has at least `min_role`."""
    min_level = ROLE_LEVELS[min_role]

    def check(user: CurrentUser) -> User:
        if ROLE_LEVELS.get(user.role, 0) < min_level:
            raise HTTPException(
                status_code=403,
                detail=f"requires role: {min_role} (you are: {user.role})",
            )
        return user

    return check


CurrentAdmin = Annotated[User, Depends(require_role("admin"))]
CurrentOperator = Annotated[User, Depends(require_role("operator"))]
