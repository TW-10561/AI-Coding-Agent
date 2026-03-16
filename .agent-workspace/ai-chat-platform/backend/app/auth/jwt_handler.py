"""
JWT token handling for authentication.
"""
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi.security import JWTToken
from fastapi import Depends, HTTPException, status
from jose import jwt, JWTError, JWKError
from passlib.context import CryptContext

from app.config import settings
from app.database import AsyncSessionLocal
from app.models import User, RefreshToken
from app.schemas import TokenType


# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash."""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password."""
    return pwd_context.hash(password)


def create_token(
    user_id: UUID,
    token_type: TokenType,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """
    Create a JWT token.
    
    Args:
        user_id: User ID to encode in the token
        token_type: Type of token (access or refresh)
        expires_delta: Optional expiration time delta
    
    Returns:
        Encoded JWT token string
    """
    if expires_delta is None:
        if token_type == TokenType.ACCESS:
            expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        else:
            expires_delta = timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    
    expire = datetime.utcnow() + expires_delta
    
    payload = {
        "sub": str(user_id),
        "type": token_type.value,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode a JWT token.
    
    Args:
        token: JWT token string
    
    Returns:
        Decoded payload dictionary
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
        )


async def create_tokens_for_user(user: User) -> dict:
    """
    Create access and refresh tokens for a user.
    Also stores the refresh token in the database.
    
    Args:
        user: User database object
    
    Returns:
        Dictionary with access_token, refresh_token, token_type, and expires_in
    """
    # Create tokens
    access_token = create_token(user.id, TokenType.ACCESS)
    refresh_token = create_token(user.id, TokenType.REFRESH)
    
    # Decode refresh token to get expiration
    refresh_payload = decode_token(refresh_token)
    expires_at = datetime.fromtimestamp(refresh_payload["exp"])
    
    async def store_refresh_token():
        async_session = AsyncSessionLocal()
        try:
            # Delete existing refresh token for user
            existing = await async_session.execute(
                RefreshToken.__table__.select().where(RefreshToken.user_id == user.id)
            )
            if existing:
                await async_session.delete(existing)
            
            # Create new refresh token
            db_refresh = RefreshToken(
                token=refresh_token,
                user_id=user.id,
                expires_at=expires_at,
            )
            async_session.add(db_refresh)
            await async_session.commit()
        finally:
            await async_session.close()
    
    # Store refresh token (fire and forget)
    import asyncio
    asyncio.create_task(store_refresh_token())
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


async def verify_refresh_token(refresh_token: str) -> User:
    """
    Verify a refresh token and return the associated user.
    
    Args:
        refresh_token: Refresh token string
    
    Returns:
        User database object if valid
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    payload = decode_token(refresh_token)
    
    if payload.get("type") != TokenType.REFRESH.value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )
    
    user_id = UUID(payload["sub"])
    
    async_session = AsyncSessionLocal()
    try:
        # Check if refresh token exists in database
        result = await async_session.execute(
            RefreshToken.__table__.select().where(RefreshToken.token == refresh_token)
        )
        db_refresh = result.scalar_one_or_none()
        
        if not db_refresh:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token not found",
            )
        
        # Get user
        result = await async_session.execute(
            User.__table__.select().where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
        
        return user
    finally:
        await async_session.close()


class TokenDep:
    """FastAPI dependency for extracting and verifying access token."""
    
    def __init__(self, required: bool = True):
        self.required = required
    
    async def __call__(
        self,
        token: Optional[str] = Depends(JWTToken()),
    ) -> Optional[str]:
        """Extract token from Authorization header."""
        if self.required and not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing authentication token",
            )
        return token
    
    async def get_user_id(self, token: str) -> UUID:
        """Get user ID from token."""
        payload = decode_token(token)
        return UUID(payload["sub"])


# Convenience instances
token_dependency = TokenDep()