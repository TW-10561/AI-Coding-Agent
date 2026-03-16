# Message models for chat messages
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from . import Base
from datetime import datetime
import enum


class MessageType(enum.Enum):
    """Enum for message types."""
    TEXT = "text"
    IMAGE = "image"
    FILE = "file"
    AI = "ai"
    SYSTEM = "system"


class Message(Base):
    """Message model for storing chat messages."""
    __tablename__ = "messages"
    
    id = Column(Integer, primary_key=True, index=True)
    content = Column(Text, nullable=False)
    room_id = Column(Integer, ForeignKey("rooms.id"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    message_type = Column(String(20), default=MessageType.TEXT.value)
    parent_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    is_edited = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    room = relationship("Room", back_populates="messages")
    sender = relationship("User")
    parent = relationship("Message", remote_side=[id])
    
    def __repr__(self):
        return f"<Message(id={self.id}, room_id={self.room_id}, sender_id={self.sender_id})>"
    
    def to_dict(self):
        return {
            "id": self.id,
            "content": self.content,
            "room_id": self.room_id,
            "sender_id": self.sender_id,
            "message_type": self.message_type,
            "parent_id": self.parent_id,
            "is_edited": self.is_edited,
            "is_deleted": self.is_deleted,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }