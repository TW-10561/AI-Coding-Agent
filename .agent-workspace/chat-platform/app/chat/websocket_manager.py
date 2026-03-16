"""
WebSocket Connection Manager for Real-time Chat
"""
from typing import Dict, List, Optional
from fastapi import WebSocket, WebSocketException
from app.config import settings
from app.database import get_db
from app.chat.services import ChatService
import json
import asyncio


class ConnectionManager:
    """
    Manages WebSocket connections for real-time chat.
    Supports multiple rooms and users.
    """
    
    def __init__(self):
        # Active connections: {room_id: {user_id: WebSocket}}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # User typing status: {room_id: {user_id: bool}}
        self.user_typing: Dict[int, Dict[int, bool]] = {}
        # User info: {websocket: user_id}
        self.websocket_to_user: Dict[WebSocket, int] = {}
        # User info: {websocket: username}
        self.websocket_to_username: Dict[WebSocket, str] = {}
    
    async def connect(
        self,
        websocket: WebSocket,
        room_id: int,
        user_id: int,
        username: str
    ):
        """Connect a user to a chat room"""
        # Accept WebSocket connection
        await websocket.accept()
        
        # Add to active connections
        if room_id not in self.active_connections:
            self.active_connections[room_id] = {}
            self.user_typing[room_id] = {}
        
        self.active_connections[room_id][user_id] = websocket
        self.websocket_to_user[websocket] = user_id
        self.websocket_to_username[websocket] = username
        
        # Notify other users about connection
        await self.broadcast_user_joined(room_id, user_id, username)
    
    def disconnect(self, websocket: WebSocket, room_id: int, user_id: int):
        """Disconnect a user from a chat room"""
        # Remove from active connections
        if room_id in self.active_connections:
            if user_id in self.active_connections[room_id]:
                del self.active_connections[room_id][user_id]
            
            if user_id in self.user_typing.get(room_id, {}):
                del self.user_typing[room_id][user_id]
        
        # Remove from user info
        if websocket in self.websocket_to_user:
            del self.websocket_to_user[websocket]
        if websocket in self.websocket_to_username:
            del self.websocket_to_username[websocket]
        
        # Clean up empty rooms
        if room_id in self.active_connections and not self.active_connections[room_id]:
            del self.active_connections[room_id]
            if room_id in self.user_typing:
                del self.user_typing[room_id]
    
    async def send_personal_message(
        self,
        message: str,
        websocket: WebSocket
    ):
        """Send a message to a specific WebSocket"""
        try:
            await websocket.send_text(message)
        except Exception:
            # Connection closed
            pass
    
    async def broadcast_message(
        self,
        room_id: int,
        message: str,
        exclude_user_id: Optional[int] = None
    ):
        """Broadcast a message to all users in a room"""
        if room_id not in self.active_connections:
            return
        
        for user_id, connection in self.active_connections[room_id].items():
            if user_id != exclude_user_id:
                try:
                    await connection.send_text(message)
                except Exception:
                    # Connection closed, remove from active connections
                    self.disconnect(connection, room_id, user_id)
    
    async def broadcast_typing_status(
        self,
        room_id: int,
        user_id: int,
        username: str,
        is_typing: bool
    ):
        """Broadcast typing status to all users in a room"""
        # Update typing status
        if room_id in self.user_typing:
            self.user_typing[room_id][user_id] = is_typing
        
        # Create typing notification
        notification = {
            "type": "typing",
            "user_id": user_id,
            "username": username,
            "is_typing": is_typing,
        }
        
        # Broadcast to all users in room
        if room_id in self.active_connections:
            for user_id_, connection in self.active_connections[room_id].items():
                if user_id_ != user_id:
                    try:
                        await connection.send_text(json.dumps(notification))
                    except Exception:
                        pass
    
    async def broadcast_user_joined(
        self,
        room_id: int,
        user_id: int,
        username: str
    ):
        """Notify all users in room about a new user joining"""
        notification = {
            "type": "user_joined",
            "user_id": user_id,
            "username": username,
        }
        
        if room_id in self.active_connections:
            for user_id_, connection in self.active_connections[room_id].items():
                if user_id_ != user_id:
                    try:
                        await connection.send_text(json.dumps(notification))
                    except Exception:
                        pass
    
    async def broadcast_user_left(
        self,
        room_id: int,
        user_id: int,
        username: str
    ):
        """Notify all users in room about a user leaving"""
        notification = {
            "type": "user_left",
            "user_id": user_id,
            "username": username,
        }
        
        if room_id in self.active_connections:
            for user_id_, connection in self.active_connections[room_id].items():
                if user_id_ != user_id:
                    try:
                        await connection.send_text(json.dumps(notification))
                    except Exception:
                        pass
    
    def get_room_members(self, room_id: int) -> List[int]:
        """Get list of user IDs in a room"""
        if room_id in self.active_connections:
            return list(self.active_connections[room_id].keys())
        return []
    
    def get_typing_users(self, room_id: int) -> List[int]:
        """Get list of user IDs currently typing in a room"""
        if room_id in self.user_typing:
            return [uid for uid, typing in self.user_typing[room_id].items() if typing]
        return []
    
    def is_user_in_room(self, room_id: int, user_id: int) -> bool:
        """Check if a user is in a room"""
        return (
            room_id in self.active_connections
            and user_id in self.active_connections[room_id]
        )


# Initialize connection manager
connection_manager = ConnectionManager()