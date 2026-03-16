"""
Authentication Pydantic Schemas
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr, Field, validator


# ============== Request Schemas ==============

class UserCreate(BaseModel):
    """Schema for user registration"""
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: Optional[str] = None
    
    @validator("username")
    def username_alphanumeric(cls, v):
        if not v.replace("_", "").isalnum():
            raise ValueError("Username must be alphanumeric")
        return v.lower()


class UserLogin(BaseModel):
    """Schema for user login"""
    username: str
    password: str


class TokenRefresh(BaseModel):
    """Schema for token refresh"""
    refresh_token: str


# ============== Response Schemas ==============

class UserResponse(BaseModel):
    """Schema for user response"""
    id: int
    username: str
    email: str
    full_name: Optional[str]
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class UserInDB(UserResponse):
    """Schema for user in database (includes hashed password)"""
    hashed_password: str


class TokenResponse(BaseModel):
    """Schema for token response"""
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None
    expires_in: int


class MessageResponse(BaseModel):
    """Schema for message response"""
    id: int
    content: str
    sender_id: int
    room_id: int
    message_type: str
    created_at: datetime
    
    class Config:
        from_attributes = True


class ChatRoomResponse(BaseModel):
    """Schema for chat room response"""
    id: int
    name: str
    description: Optional[str]
    room_type: str
    owner_id: int
    created_at: datetime
    
    class Config:
        from_attributes = True


class ChatRoomDetailResponse(ChatRoomResponse):
    """Schema for detailed chat room response"""
    members: List[UserResponse]
    last_message: Optional[MessageResponse]
    message_count: int