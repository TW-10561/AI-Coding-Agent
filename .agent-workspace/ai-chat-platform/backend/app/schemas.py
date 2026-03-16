"""
Pydantic schemas for request/response validation.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, validator


class UserRole(Enum):
    """User role enumeration."""
    USER = "user"
    ADMIN = "admin"
    AI_ASSISTANT = "ai_assistant"


class MessageType(Enum):
    """Message type enumeration."""
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    AI_RESPONSE = "ai_response"


class TokenType(Enum):
    """Authentication token type."""
    ACCESS = "access"
    REFRESH = "refresh"


# ============ Request Schemas ============

class UserCreate(BaseModel):
    """Schema for user registration."""
    username: str = Field(min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)
    full_name: Optional[str] = None
    
    @validator("username")
    def username_alphanumeric(cls, v: str) -> str:
        if not v.replace("_", "").isalphanumeric():
            raise ValueError("Username must be alphanumeric")
        return v


class UserLogin(BaseModel):
    """Schema for user login."""
    username: str
    password: str


class TokenRefresh(BaseModel):
    """Schema for token refresh."""
    refresh_token: str


class RoomCreate(BaseModel):
    """Schema for creating a new room."""
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    is_private: bool = False


class RoomUpdate(BaseModel):
    """Schema for updating a room."""
    name: Optional[str] = Field(min_length=1, max_length=100) = None
    description: Optional[str] = None
    is_private: Optional[bool] = None


class RoomJoin(BaseModel):
    """Schema for joining a room."""
    room_id: UUID


class MessageCreate(BaseModel):
    """Schema for creating a message."""
    content: str = Field(min_length=1)
    room_id: Optional[UUID] = None
    receiver_id: Optional[UUID] = None
    message_type: MessageType = MessageType.TEXT
    parent_id: Optional[UUID] = None


class AIRequest(BaseModel):
    """Schema for AI assistant request."""
    query: str = Field(min_length=1, max_length=1000)
    context: Optional[str] = None
    room_id: Optional[UUID] = None


# ============ Response Schemas ============

class UserResponse(BaseModel):
    """Schema for user data in responses."""
    id: UUID
    username: str
    email: str
    full_name: Optional[str]
    is_active: bool
    is_online: bool
    role: UserRole
    created_at: datetime
    
    class Config:
        from_attributes = True


class UserInDB(UserResponse):
    """Schema for user data from database."""
    hashed_password: str


class TokenResponse(BaseModel):
    """Schema for authentication tokens."""
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class MessageResponse(BaseModel):
    """Schema for message data in responses."""
    id: UUID
    content: str
    sender_id: UUID
    receiver_id: Optional[UUID]
    room_id: Optional[UUID]
    message_type: MessageType
    is_ai_response: bool
    parent_id: Optional[UUID]
    created_at: datetime
    
    class Config:
        from_attributes = True


class MessageWithSender(MessageResponse):
    """Schema for message with sender details."""
    sender: UserResponse


class RoomResponse(BaseModel):
    """Schema for room data in responses."""
    id: UUID
    name: str
    description: Optional[str]
    is_private: bool
    created_by_id: Optional[UUID]
    created_at: datetime
    member_count: int = 0
    last_activity: Optional[datetime]
    
    class Config:
        from_attributes = True


class RoomDetail(RoomResponse):
    """Schema for room with members and recent messages."""
    members: List[UserResponse] = []
    recent_messages: List[MessageResponse] = []


class TypingIndicator(BaseModel):
    """Schema for typing indicator events."""
    user_id: UUID
    room_id: UUID
    is_typing: bool


class Notification(BaseModel):
    """Schema for notification events."""
    type: str
    data: dict
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class HealthResponse(BaseModel):
    """Schema for health check endpoint."""
    status: str
    version: str
    database: str
    timestamp: datetime