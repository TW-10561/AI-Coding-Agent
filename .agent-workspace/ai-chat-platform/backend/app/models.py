"""
SQLAlchemy database models for the AI Chat Platform.
"""
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped
from sqlalchemy.sql import func

from app.database import Base
from app.schemas import UserRole, MessageType


class User(Base):
    """User account model."""
    __tablename__ = "users"
    
    id: Column = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    username: Column = Column(String(50), unique=True, nullable=False)
    email: Column = Column(String(255), unique=True, nullable=False)
    hashed_password: Column = Column(String(255), nullable=False)
    full_name: Column = Column(String(100), nullable=True)
    is_active: Column = Column(Boolean, default=True, nullable=False)
    is_online: Column = Column(Boolean, default=False, nullable=False)
    role: Column = Column(String(20), default=UserRole.USER.value, nullable=False)
    created_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    sent_messages: List["Message"] = relationship(
        "Message",
        foreign_keys="Message.sender_id",
        backref="sender",
        lazy="selectin",
    )
    received_messages: List["Message"] = relationship(
        "Message",
        foreign_keys="Message.receiver_id",
        backref="receiver",
        lazy="selectin",
    )
    room_memberships: List["RoomMember"] = relationship(
        "RoomMember",
        foreign_keys="RoomMember.user_id",
        backref="user",
        lazy="selectin",
    )
    
    def __repr__(self) -> str:
        return f"<User {self.username}>"


class Room(Base):
    """Chat room model."""
    __tablename__ = "rooms"
    
    id: Column = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Column = Column(String(100), unique=True, nullable=False)
    description: Column = Column(Text, nullable=True)
    is_private: Column = Column(Boolean, default=False, nullable=False)
    created_by_id: Column = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    created_by: User = relationship("User", foreign_keys=[created_by_id])
    members: List["RoomMember"] = relationship(
        "RoomMember",
        foreign_keys="RoomMember.room_id",
        backref="room",
        lazy="selectin",
    )
    messages: List["Message"] = relationship(
        "Message",
        foreign_keys="Message.room_id",
        backref="room",
        lazy="selectin",
    )
    
    def __repr__(self) -> str:
        return f"<Room {self.name}>"


class RoomMember(Base):
    """Association table for users and rooms (many-to-many)."""
    __tablename__ = "room_members"
    
    id: Column = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    room_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("rooms.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_admin: Column = Column(Boolean, default=False, nullable=False)
    joined_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    
    def __repr__(self) -> str:
        return f"<RoomMember room={self.room_id} user={self.user_id}>"


class Message(Base):
    """Chat message model."""
    __tablename__ = "messages"
    
    id: Column = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    content: Column = Column(Text, nullable=False)
    sender_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    receiver_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    room_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("rooms.id", ondelete="CASCADE"),
        nullable=True,
    )
    message_type: Column = Column(String(20), default=MessageType.TEXT.value, nullable=False)
    is_ai_response: Column = Column(Boolean, default=False, nullable=False)
    parent_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    created_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    updated_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    parent: Message = relationship(
        "Message",
        foreign_keys=[parent_id],
        remote_side=[id],
        backref="replies",
    )
    
    def __repr__(self) -> str:
        return f"<Message id={str(self.id)[:8]}>"


class RefreshToken(Base):
    """Refresh token model for session management."""
    __tablename__ = "refresh_tokens"
    
    id: Column = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    token: Column = Column(String(255), unique=True, nullable=False)
    user_id: Column = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    expires_at: Column = Column(DateTime(timezone=True), nullable=False)
    created_at: Column = Column(DateTime(timezone=True), server_default=func.now())
    
    def __repr__(self) -> str:
        return f"<RefreshToken user={self.user_id}>"