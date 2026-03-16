"""
Chat Pydantic Schemas
"""
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field, validator
from enum import Enum


class RoomType(str, Enum):
    """Chat room type enumeration"""
    PUBLIC = "public"
    PRIVATE = "private"
    GROUP = "group"


class MessageType(str, Enum):
    """Message type enumeration"""
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    AI = "ai"


# ============== Request Schemas ==============

class ChatRoomCreate(BaseModel):
    """Schema for creating a chat room"""
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None
    room_type: RoomType = RoomType.PUBLIC
    members: List[int] = []  # User IDs to add as members
    
    @validator("name")
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Room name cannot be empty")
        return v.strip()


class ChatRoomUpdate(BaseModel):
    """Schema for updating a chat room"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class MessageCreate(BaseModel):
    """Schema for creating a message"""
    content: str = Field(min_length=1)
    message_type: MessageType = MessageType.TEXT
    parent_id: Optional[int] = None


class MessageUpdate(BaseModel):
    """Schema for updating a message"""
    content: str = Field(min_length=1)


class RoomMemberAdd(BaseModel):
    """Schema for adding a member to a room"""
    user_id: int
    is_admin: bool = False


class TypingStatus(BaseModel):
    """Schema for typing status"""
    is_typing: bool


# ============== Response Schemas ==============

class UserInfo(BaseModel):
    """Schema for user information in chat"""
    id: int
    username: str
    full_name: Optional[str]
    
    class Config:
        from_attributes = True


class MessageResponse(BaseModel):
    """Schema for message response"""
    id: int
    room_id: int
    sender_id: int
    content: str
    message_type: str
    parent_id: Optional[int]
    is_edited: bool
    is_deleted: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class MessageDetailResponse(MessageResponse):
    """Schema for detailed message response"""
    sender: Optional[UserInfo]
    replies: List[MessageResponse] = []


class ChatRoomResponse(BaseModel):
    """Schema for chat room response"""
    id: int
    name: str
    description: Optional[str]
    room_type: str
    owner_id: int
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class ChatRoomDetailResponse(ChatRoomResponse):
    """Schema for detailed chat room response"""
    members: List[UserInfo]
    last_message: Optional[MessageResponse]
    message_count: int


class ChatRoomListResponse(BaseModel):
    """Schema for chat room list response"""
    rooms: List[ChatRoomResponse]
    total: int
    page: int
    page_size: int


class TypingNotification(BaseModel):
    """Schema for typing notification"""
    type: str = "typing"
    user_id: int
    username: str
    is_typing: bool


class MessageNotification(BaseModel):
    """Schema for message notification"""
    type: str = "message"
    message: MessageResponse


class UserNotification(BaseModel):
    """Schema for user notification"""
    type: str
    user_id: int
    username: str