"""
Chat Room and Message Database Models
"""
from datetime import datetime
from enum import Enum
from typing import List
from sqlalchemy import Column, String, Text, Integer, Boolean, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from app.database import Base


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


class ChatRoom(Base):
    """Chat room model"""
    __tablename__ = "chat_rooms"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    room_type: Mapped[str] = mapped_column(
        SQLEnum(RoomType),
        default=RoomType.PUBLIC,
        nullable=False
    )
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    
    # Relationships
    members: Mapped[List["RoomMember"]] = relationship(
        "RoomMember",
        back_populates="room",
        cascade="all, delete-orphan"
    )
    messages: Mapped[List["Message"]] = relationship(
        "Message",
        back_populates="room",
        cascade="all, delete-orphan"
    )
    
    def __repr__(self):
        return f"<ChatRoom(id={self.id}, name='{self.name}')>"


class RoomMember(Base):
    """Room membership model for multi-user chat rooms"""
    __tablename__ = "room_members"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False))
    can_send_messages: Mapped[bool] = mapped_column(Boolean, default=True))
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    
    # Relationships
    room: Mapped["ChatRoom"] = relationship("ChatRoom", back_populates="members")
    
    def __repr__(self):
        return f"<RoomMember(room_id={self.room_id}, user_id={self.user_id})>"


class Message(Base):
    """Message model for chat messages"""
    __tablename__ = "messages"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    sender_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(
        SQLEnum(MessageType),
        default=MessageType.TEXT,
        nullable=False
    )
    parent_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True
    )
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False))
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    
    # Relationships
    room: Mapped["ChatRoom"] = relationship("ChatRoom", back_populates="messages")
    
    def __repr__(self):
        return f"<Message(id={self.id}, content='{self.content[:20]}')>"