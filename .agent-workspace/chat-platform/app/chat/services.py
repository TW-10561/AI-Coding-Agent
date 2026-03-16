"""
Chat Service Layer
"""
from typing import List, Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.chat.models import ChatRoom, Message, RoomMember, RoomType, MessageType
from app.chat.schemas import ChatRoomCreate, MessageCreate
from app.users.models import User
from app.chat.websocket_manager import connection_manager
from app.worker.celery_app import send_message_notification, process_ai_response


class ChatService:
    """Chat service for managing chat rooms and messages"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    # ============== Room Management ==============
    
    async def create_room(
        self,
        name: str,
        owner_id: int,
        description: Optional[str] = None,
        room_type: RoomType = RoomType.PUBLIC,
    ) -> ChatRoom:
        """Create a new chat room"""
        room = ChatRoom(
            name=name,
            description=description,
            room_type=room_type,
            owner_id=owner_id,
        )
        self.db.add(room)
        await self.db.flush()
        
        # Add owner as room member
        await self.add_member(room.id, owner_id, is_admin=True)
        
        return room
    
    async def get_room(self, room_id: int) -> Optional[ChatRoom]:
        """Get a chat room by ID"""
        result = await self.db.execute(
            select(ChatRoom).where(ChatRoom.id == room_id)
        )
        return result.scalar_one_or_none()
    
    async def get_rooms_by_user(self, user_id: int) -> List[ChatRoom]:
        """Get all chat rooms for a user"""
        result = await self.db.execute(
            select(RoomMember).where(RoomMember.user_id == user_id)
        )
        members = result.scalars().all()
        
        rooms = []
        for member in members:
            room = await self.get_room(member.room_id)
            if room:
                rooms.append(room)
        
        return rooms
    
    async def get_room_members(self, room_id: int) -> List[User]:
        """Get all members of a chat room"""
        result = await self.db.execute(
            select(RoomMember).where(RoomMember.room_id == room_id)
        )
        members = result.scalars().all()
        
        users = []
        for member in members:
            user = await self.get_user(member.user_id)
            if user:
                users.append(user)
        
        return users
    
    async def add_member(
        self,
        room_id: int,
        user_id: int,
        is_admin: bool = False,
    ) -> RoomMember:
        """Add a member to a chat room"""
        # Check if already a member
        existing = await self.get_room_member(room_id, user_id)
        if existing:
            return existing
        
        member = RoomMember(
            room_id=room_id,
            user_id=user_id,
            is_admin=is_admin,
        )
        self.db.add(member)
        await self.db.flush()
        
        return member
    
    async def remove_member(self, room_id: int, user_id: int) -> bool:
        """Remove a member from a chat room"""
        member = await self.get_room_member(room_id, user_id)
        if member:
            await self.db.delete(member)
            return True
        return False
    
    async def get_room_member(
        self,
        room_id: int,
        user_id: int
    ) -> Optional[RoomMember]:
        """Get a room member"""
        result = await self.db.execute(
            select(RoomMember).where(
                RoomMember.room_id == room_id,
                RoomMember.user_id == user_id
            )
        )
        return result.scalar_one_or_none()
    
    async def is_user_in_room(self, room_id: int, user_id: int) -> bool:
        """Check if a user is in a room"""
        member = await self.get_room_member(room_id, user_id)
        return member is not None
    
    async def is_user_admin(self, room_id: int, user_id: int) -> bool:
        """Check if a user is an admin in a room"""
        member = await self.get_room_member(room_id, user_id)
        return member.is_admin if member else False
    
    # ============== Message Management ==============
    
    async def send_message(
        self,
        room_id: int,
        sender_id: int,
        content: str,
        message_type: MessageType = MessageType.TEXT,
        parent_id: Optional[int] = None,
    ) -> Message:
        """Send a message to a chat room"""
        # Create message
        message = Message(
            room_id=room_id,
            sender_id=sender_id,
            content=content,
            message_type=message_type,
            parent_id=parent_id,
        )
        self.db.add(message)
        await self.db.flush()
        
        # Get sender username
        sender = await self.get_user(sender_id)
        username = sender.username if sender else "Unknown"
        
        # Broadcast message to all users in room via WebSocket
        message_data = {
            "id": message.id,
            "room_id": room_id,
            "sender_id": sender_id,
            "username": username,
            "content": content,
            "message_type": message_type.value,
            "created_at": message.created_at.isoformat(),
        }
        
        await connection_manager.broadcast_message(
            room_id,
            str(message_data),
            exclude_user_id=sender_id
        )
        
        # Queue notification task
        send_message_notification.delay(
            room_id=room_id,
            message_id=message.id,
            sender_id=sender_id,
        )
        
        # Check for AI assistant trigger
        if content.lower().startswith("/ai "):
            ai_question = content[4:]  # Remove "/ai " prefix
            process_ai_response.delay(
                message_id=message.id,
                room_id=room_id,
                question=ai_question,
                user_id=sender_id,
            )
        
        return message
    
    async def get_messages(
        self,
        room_id: int,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Message]:
        """Get messages for a room with pagination"""
        result = await self.db.execute(
            select(Message)
            .where(Message.room_id == room_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        messages = result.scalas().all()
        
        # Return in chronological order
        return list(reversed(messages))
    
    async def get_message(self, message_id: int) -> Optional[Message]:
        """Get a message by ID"""
        result = await self.db.execute(
            select(Message).where(Message.id == message_id)
        )
        return result.scalar_one_or_none()
    
    async def edit_message(
        self,
        message_id: int,
        user_id: int,
        new_content: str,
    ) -> Optional[Message]:
        """Edit a message (only by sender)"""
        message = await self.get_message(message_id)
        if not message:
            return None
        
        if message.sender_id != user_id:
            return None
        
        message.content = new_content
        message.is_edited = True
        await self.db.flush()
        
        return message
    
    async def delete_message(self, message_id: int, user_id: int) -> bool:
        """Delete a message (only by sender)"""
        message = await self.get_message(message_id)
        if not message:
            return False
        
        if message.sender_id != user_id:
            return False
        
        message.is_deleted = True
        return True
    
    # ============== User Management ==============
    
    async def get_user(self, user_id: int) -> Optional[User]:
        """Get a user by ID"""
        result = await self.db.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()
    
    async def get_user_by_username(self, username: str) -> Optional[User]:
        """Get a user by username"""
        result = await self.db.execute(
            select(User).where(User.username == username.lower())
        )
        return result.scalar_one_or_none()