"""
Authentication Service
"""
from datetime import datetime, timedelta
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.users.models import User, RefreshToken
from app.auth.jwt_handler import jwt_handler, password_handler
from app.auth.auth_schemas import UserCreate, UserLogin, TokenResponse


class AuthService:
    """Authentication service for user registration and login"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def register(self, user_data: UserCreate) -> User:
        """Register a new user"""
        # Check if username exists
        existing_user = await self.get_user_by_username(user_data.username)
        if existing_user:
            raise ValueError("Username already exists")
        
        # Check if email exists
        existing_email = await self.get_user_by_email(user_data.email)
        if existing_email:
            raise ValueError("Email already exists")
        
        # Create user
        hashed_password = password_handler.hash_password(user_data.password)
        user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=hashed_password,
            full_name=user_data.full_name,
            is_active=True,
            is_superuser=False,
        )
        self.db.add(user)
        await self.db.flush()
        
        return user
    
    async def login(self, login_data: UserLogin) -> TokenResponse:
        """Authenticate user and return tokens"""
        user = await self.get_user_by_username(login_data.username)
        if not user:
            raise ValueError("Invalid username or password")
        
        if not user.is_active:
            raise ValueError("User is inactive")
        
        if not password_handler.verify_password(
            login_data.password,
            user.hashed_password
        ):
            raise ValueError("Invalid username or password")
        
        # Create tokens
        access_token = jwt_handler.create_access_token(
            data={"sub": str(user.id), "username": user.username}
        )
        
        # Create refresh token
        refresh_token = jwt_handler.create_access_token(
            data={"sub": str(user.id), "username": user.username},
            expires_delta=timedelta(days=7)
        )
        
        # Store refresh token
        await self.save_refresh_token(user.id, refresh_token)
        
        return TokenResponse(
            access_token=access_token,
            token_type="bearer",
            refresh_token=refresh_token,
            expires_in=jwt_handler.access_token_expire_minutes * 60
        )
    
    async def logout(self, user_id: int, refresh_token: str) -> bool:
        """Logout user and delete refresh token"""
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                RefreshToken.token == refresh_token
            )
        )
        rt = result.scalar_one_or_none()
        if rt:
            await self.db.delete(rt)
            return True
        return False
    
    async def refresh_token(self, refresh_token: str) -> str:
        """Generate new access token from refresh token"""
        payload = jwt_handler.decode_access_token(refresh_token)
        user_id = payload.get("sub")
        username = payload.get("username")
        
        # Verify refresh token exists
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                RefreshToken.token == refresh_token
            )
        )
        rt = result.scalar_one_or_none()
        if not rt:
            raise ValueError("Invalid refresh token")
        
        # Generate new access token
        return jwt_handler.create_access_token(
            data={"sub": str(user_id), "username": username}
        )
    
    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Get user by ID"""
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()
    
    async def get_user_by_username(self, username: str) -> Optional[User]:
        """Get user by username"""
        result = await self.db.execute(
            select(User).where(User.username == username.lower())
        )
        return result.scalar_one_or_none()
    
    async def get_user_by_email(self, email: str) -> Optional[User]:
        """Get user by email"""
        result = await self.db.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()
    
    async def save_refresh_token(self, user_id: int, token: str) -> RefreshToken:
        """Save or update refresh token"""
        # Delete existing refresh tokens for user
        await self.db.execute(
            RefreshToken.__table__.delete().where(
                RefreshToken.user_id == user_id
            )
        )
        
        # Create new refresh token
        rt = RefreshToken(
            user_id=user_id,
            token=token,
            expires_at=datetime.utcnow() + timedelta(days=7)
        )
        self.db.add(rt)
        await self.db.flush()
        
        return rt