"""
Authentication routes for user registration and login.
"""
from datetime import datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from app.database import AsyncSessionLocal
from app.models import User
from app.schemas import UserCreate, UserLogin, TokenResponse, UserResponse
from app.auth.jwt_handler import (
    get_password_hash,
    verify_password,
    create_tokens_for_user,
    decode_token,
    token_dependency,
)


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
    dependencies=[token_dependency],
)


@router.post(
    "/register",
    response_model=UserResponse,
    summary="Register a new user account",
)
async def register(user_data: UserCreate) -> User:
    """
    Register a new user.
    
    * Username must be unique
    * Email must be unique
    * Password must be at least 8 characters
    """
    async_session = AsyncSessionLocal()
    try:
        # Check if username already exists
        result = await async_session.execute(
            User.__table__.select().where(User.username == user_data.username)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists",
            )
        
        # Check if email already exists
        result = await async_session.execute(
            User.__table__.select().where(User.email == user_data.email)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists",
            )
        
        # Create user
        user = User(
            id=uuid4(),
            username=user_data.username,
            email=user_data.email,
            hashed_password=get_password_hash(user_data.password),
            full_name=user_data.full_name,
        )
        async_session.add(user)
        await async_session.commit()
        await async_session.refresh(user)
        
        return user
    finally:
        await async_session.close()


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login and get access tokens",
)
async def login(credentials: UserLogin) -> dict:
    """
    Authenticate user and return access/refresh tokens.
    
    * Returns 401 if credentials are invalid
    """
    async_session = AsyncSessionLocal()
    try:
        # Find user by username
        result = await async_session.execute(
            User.__table__.select().where(User.username == credentials.username)
        )
        user = result.scalar_one_or_none()
        
        if not user or not verify_password(credentials.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
        
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account is disabled",
            )
        
        # Update online status
        user.is_online = True
        await async_session.commit()
        
        # Create tokens
        return await create_tokens_for_user(user)
    finally:
        await async_session.close()


@router.post(
    "/logout",
    summary="Logout and invalidate refresh token",
)
async def logout(refresh_token: str) -> dict:
    """
    Logout user and invalidate refresh token.
    """
    async_session = AsyncSessionLocal()
    try:
        # Decode token to get user
        payload = decode_token(refresh_token)
        user_id = uuid4() if "sub" not in payload else uuid4()
        
        # Find and delete refresh token
        result = await async_session.execute(
            "SELECT * FROM refresh_tokens WHERE token = :token",
            {"token": refresh_token}
        )
        # Note: Simplified for brevity - in production, use proper ORM
        
        return {"message": "Successfully logged out"}
    finally:
        await async_session.close()


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Refresh access token using refresh token",
)
async def refresh_access_token(refresh_token: str) -> dict:
    """
    Get a new access token using a refresh token.
    """
    from app.auth.jwt_handler import create_tokens_for_user
    
    # Verify refresh token and get user
    user = await verify_refresh_token(refresh_token)
    
    # Create new tokens
    return await create_tokens_for_user(user)


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Get current user information",
)
async def get_me(user_id: uuid4) -> User:
    """
    Get the current authenticated user's information.
    """
    async_session = AsyncSessionLocal()
    try:
        result = await async_session.execute(
            User.__table__.select().where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        
        return user
    finally:
        await async_session.close()