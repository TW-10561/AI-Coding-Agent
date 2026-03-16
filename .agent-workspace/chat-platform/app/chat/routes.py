"""
Chat API Routes
"""
from typing import List
from fastapi import APIRouter, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from sqlalchemy import select
from app.database import get_db
from app.chat.models import ChatRoom, Message, RoomMember, RoomType, MessageType
from app.chat.schemas import (
    ChatRoomCreate,
    ChatRoomUpdate,
    MessageCreate,
    MessageResponse,
    ChatRoomResponse,
    ChatRoomDetailResponse,
    UserInfo,
)
from app.chat.services import ChatService
from app.chat.websocket_manager import connection_manager
from app.auth.jwt_handler import jwt_handler
import json


router = APIRouter(
    prefix="/chat",
    tags=["Chat"]
)


# ============== REST Endpoints ==============

@router.post(
    "/rooms",
    response_model=ChatRoomResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new chat room",
)
async def create_room(room_data: ChatRoomCreate, current_user_id: int = 1):
    """Create a new chat room"""
    async with get_db() as db:
        chat_service = ChatService(db)
        
        # Create room
        room = await chat_service.create_room(
            name=room_data.name,
            owner_id=current_user_id,
            description=room_data.description,
            room_type=room_data.room_type,
        )
        
        # Add members
        for member_id in room_data.members:
            if member_id != current_user_id:
                await chat_service.add_member(room.id, member_id)
        
        return ChatRoomResponse(
            id=room.id,
            name=room.name,
            description=room.description,
            room_type=room.room_type.value,
            owner_id=room.owner_id,
            is_active=room.is_active,
            created_at=room.created_at,
        )


@router.get(
    "/rooms",
    response_model=List[ChatRoomResponse],
    summary="Get all chat rooms for current user",
)
async def get_rooms(current_user_id: int = 1):
    """Get all chat rooms for current user"""
    async with get_db() as db:
        chat_service = ChatService(db)
        rooms = await chat_service.get_rooms_by_user(current_user_id)
        
        return [
            ChatRoomResponse(
                id=room.id,
                name=room.name,
                description=room.description,
                room_type=room.room_type.value,
                owner_id=room.owner_id,
                is_active=room.is_active,
                created_at=room.created_at,
            )
            for room in rooms
        ]


@router.get(
    "/rooms/{room_id}",
    response_model=ChatRoomDetailResponse,
    summary="Get chat room details",
)
async def get_room(room_id: int, current_user_id: int = 1):
    """Get chat room details with members and last message"""
    async with get_db() as db:
        chat_service = ChatService(db)
        
        # Check if user is in room
        is_member = await chat_service.is_user_in_room(room_id, current_user_id)
        if not is_member:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this room"
            )
        
        # Get room
        room = await chat_service.get_room(room_id)
        if not room:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Room not found"
            )
        
        # Get members
        members = await chat_service.get_room_members(room_id)
        
        # Get last message
        messages = await chat_service.get_messages(room_id, limit=1)
        last_message = messages[0] if messages else None
        
        return ChatRoomDetailResponse(
            id=room.id,
            name=room.name,
            description=room.description,
            room_type=room.room_type.value,
            owner_id=room.owner_id,
            is_active=room.is_active,
            created_at=room.created_at,
            members=[
                UserInfo(id=m.id, username=m.username, full_name=m.full_name)
                for m in members
            ],
            last_message=MessageResponse(
                id=last_message.id,
                room_id=last_message.room_id,
                sender_id=last_message.sender_id,
                content=last_message.content,
                message_type=last_message.message_type.value,
                parent_id=last_message.parent_id,
                is_edited=last_message.is_edited,
                is_deleted=last_message.is_deleted,
                created_at=last_message.created_at,
            ) if last_message else None,
            message_count=len(messages),
        )


@router.post(
    "/rooms/{room_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send a message to a chat room",
)
async def send_message(
    room_id: int,
    message_data: MessageCreate,
    current_user_id: int = 1,
):
    """Send a message to a chat room"""
    async with get_db() as db:
        chat_service = ChatService(db)
        
        # Check if user is in room
        is_member = await chat_service.is_user_in_room(room_id, current_user_id)
        if not is_member:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this room"
            )
        
        # Send message
        message = await chat_service.send_message(
            room_id=room_id,
            sender_id=current_user_id,
            content=message_data.content,
            message_type=message_data.message_type,
            parent_id=message_data.parent_id,
        )
        
        return MessageResponse(
            id=message.id,
            room_id=message.room_id,
            sender_id=message.sender_id,
            content=message.content,
            message_type=message.message_type.value,
            parent_id=message.parent_id,
            is_edited=message.is_edited,
            is_deleted=message.is_deleted,
            created_at=message.created_at,
        )


@router.get(
    "/rooms/{room_id}/messages",
    response_model=List[MessageResponse],
    summary="Get messages in a chat room",
)
async def get_messages(
    room_id: int,
    limit: int = 50,
    offset: int = 0,
    current_user_id: int = 1,
):
    """Get messages in a chat room with pagination"""
    async with get_db() as db:
        chat_service = ChatService(db)
        
        # Check if user is in room
        is_member = await chat_service.is_user_in_room(room_id, current_user_id)
        if not is_member:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this room"
            )
        
        # Get messages
        messages = await chat_service.get_messages(
            room_id,
            limit=limit,
            offset=offset,
        )
        
        return [
            MessageResponse(
                id=msg.id,
                room_id=msg.room_id,
                sender_id=msg.sender_id,
                content=msg.content,
                message_type=msg.message_type.value,
                parent_id=msg.parent_id,
                is_edited=msg.is_edited,
                is_deleted=msg.is_deleted,
                created_at=msg.created_at,
            )
            for msg in messages
        ]


@router.post(
    "/rooms/{room_id}/members/{user_id}",
    response_model=dict,
    summary="Add a member to a chat room",
)
async def add_member(
    room_id: int,
    user_id: int,
    current_user_id: int = 1,
):
    """Add a member to a chat room"""
    async with get_db() as db:
        chat_service = ChatService(db)
        
        # Check if current user is admin
        is_admin = await chat_service.is_user_admin(room_id, current_user_id)
        if not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You must be an admin to add members"
            )
        
        # Add member
        await chat_service.add_member(room_id, user_id)
        
        return {"message": "Member added successfully"}


@router.delete(
    "/rooms/{room_id}/members/{user_id}",
    response_model=dict,
    summary="Remove a member from a chat room",
)
async def remove_member(
    room_id: int,
    user_id: int,
    current_user_id: int = 1,
):
    """Remove a member from a chat room"""
    async with get_db() as db:
        chat_service = ChatService(db)
        
        # Check if current user is admin
        is_admin = await chat_service.is_user_admin(room_id, current_user_id)
        if not is_admin:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You must be an admin to remove members"
            )
        
        # Remove member
        removed = await chat_service.remove_member(room_id, user_id)
        
        if not removed:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found"
            )
        
        return {"message": "Member removed successfully"}


# ============== WebSocket Endpoints ==============

@router.websocket("/ws/{room_id}")
async def websocket_chat(
    websocket: WebSocket,
    room_id: int,
    token: str,
    username: str,
):
    """WebSocket endpoint for real-time chat"""
    # Verify token
    try:
        payload = jwt_handler.decode_access_token(token)
        user_id = int(payload.get("sub"))
    except Exception:
        await websocket.close(code=4001)
        return
    
    # Connect to room
    await connection_manager.connect(
        websocket,
        room_id,
        user_id,
        username,
    )
    
    try:
        # Handle WebSocket messages
        while True:
            try:
                data = await websocket.receive_text()
                data_json = json.loads(data)
                
                # Handle different message types
                if data_json.get("type") == "message":
                    # Send message
                    async with get_db() as db:
                        chat_service = ChatService(db)
                        
                        # Check if user is in room
                        is_member = await chat_service.is_user_in_room(room_id, user_id)
                        if is_member:
                            message = await chat_service.send_message(
                                room_id=room_id,
                                sender_id=user_id,
                                content=data_json.get("content", ""),
                            )
                
                elif data_json.get("type") == "typing":
                    # Broadcast typing status
                    is_typing = data_json.get("is_typing", False)
                    await connection_manager.broadcast_typing_status(
                        room_id,
                        user_id,
                        username,
                        is_typing,
                    )
                            
            except WebSocketDisconnect:
                break
                
    except Exception:
        pass
        
    finally:
        # Disconnect from room
        connection_manager.disconnect(websocket, room_id, user_id)