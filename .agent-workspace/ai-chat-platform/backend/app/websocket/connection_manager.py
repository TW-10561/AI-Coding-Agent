"""
WebSocket connection manager for handling multiple concurrent connections.
"""
from typing import Dict, List, Optional
from fastapi import WebSocket, WebSocketState
from .config import settings
import json
import asyncio
from datetime import datetime
from enum import Enum


class ConnectionState(Enum):
    """Enum for connection states."""
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    AUTHENTICATED = "authenticated"
    TYPING = "typing"


class ConnectionManager:
    """
    Manages WebSocket connections for real-time chat.
    Supports multiple users and rooms.
    """
    
    def __init__(self):
        # Active connections: {user_id: {websocket: WebSocket}}
        self.active_connections: Dict[int, Dict[str, WebSocket]] = {}
        
        # User connection state tracking
        self.user_rooms: Dict[int, int] = {}  # user_id -> room_id
        self.user_status: Dict[int, str] = {}  # user_id -> status
        self.user_typing: Dict[int, bool] = {}  # user_id -> is_typing
        
        # Room members: {room_id: {user_id: WebSocket}}
        self.room_connections: Dict[int, Dict[int, WebSocket]] = {}
        
        # Message queue for background processing
        self.message_queue: asyncio.Queue = asyncio.Queue()
        
    async def connect(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int
    ) -> None:
        """Accept and store a new WebSocket connection."""
        await websocket.accept()
        
        # Add to active connections
        if user_id not in self.active_connections:
            self.active_connections[user_id] = {}
        self.active_connections[user_id][f"room_{room_id}"] = websocket
        
        # Add to room connections
        if room_id not in self.room_connections:
            self.room_connections[room_id] = {}
        self.room_connections[room_id][user_id] = websocket
        
        # Update user state
        self.user_rooms[user_id] = room_id
        self.user_status[user_id] = ConnectionState.CONNECTED.value
        
        # Send join notification to room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "user_joined",
                "user_id": user_id,
                "room_id": room_id,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    
    async def disconnect(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int
    ) -> None:
        """Remove a WebSocket connection."""
        # Remove from active connections
        if user_id in self.active_connections:
            if f"room_{room_id}" in self.active_connections[user_id]:
                del self.active_connections[user_id][f"room_{room_id}"]
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        
        # Remove from room connections
        if room_id in self.room_connections:
            if user_id in self.room_connections[room_id]:
                del self.room_connections[room_id][user_id]
        
        # Update user state
        if user_id in self.user_rooms:
            del self.user_rooms[user_id]
        if user_id in self.user_status:
            del self.user_status[user_id]
        if user_id in self.user_typing:
            del self.user_typing[user_id]
        
        # Send leave notification to room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "user_left",
                "user_id": user_id,
                "room_id": room_id,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    
    async def send_personal_message(
        self,
        message: dict,
        user_id: int,
        room_id: int
    ) -> None:
        """Send a message to a specific user in a room."""
        if (
            user_id in self.active_connections
            and f"room_{room_id}" in self.active_connections[user_id]
        ):
            websocket = self.active_connections[user_id][f"room_{room_id}"]
            await websocket.send_json(message)
    
    async def broadcast_to_room(
        self,
        room_id: int,
        message: dict
    ) -> None:
        """Broadcast a message to all users in a room."""
        if room_id in self.room_connections:
            disconnected_users = []
            for user_id, websocket in self.room_connections[room_id].items():
                try:
                    await websocket.send_json(message)
                except Exception:
                    disconnected_users.append(user_id)
            
            # Clean up disconnected users
            for user_id in disconnected_users:
                if user_id in self.room_connections[room_id]:
                    del self.room_connections[room_id][user_id]
    
    async def broadcast_to_all(
        self,
        message: dict
    ) -> None:
        """Broadcast a message to all connected users."""
        for room_id in self.room_connections:
            await self.broadcast_to_room(room_id, message)
    
    def get_room_members(self, room_id: int) -> List[int]:
        """Get list of user IDs in a room."""
        if room_id in self.room_connections:
            return list(self.room_connections[room_id].keys())
        return []
    
    def get_user_room(self, user_id: int) -> Optional[int]:
        """Get the room ID a user is connected to."""
        return self.user_rooms.get(user_id)
    
    def get_user_status(self, user_id: int) -> Optional[str]:
        """Get the status of a user."""
        return self.user_status.get(user_id)
    
    async def set_typing_status(
        self,
        user_id: int,
        room_id: int,
        is_typing: bool
    ) -> None:
        """Update typing status for a user."""
        self.user_typing[user_id] = is_typing
        
        # Broadcast typing status to room
        await self.broadcast_to_room(
            room_id,
            {
                "type": "typing_status",
                "user_id": user_id,
                "room_id": room_id,
                "is_typing": is_typing,
                "timestamp": datetime.utcnow().isoformat(),
            }
        )
    
    def get_typing_users(self, room_id: int) -> List[int]:
        """Get list of users currently typing in a room."""
        return [
            user_id
            for user_id, typing in self.user_typing.items()
            if typing and self.user_rooms.get(user_id) == room_id
        ]
    
    @property
    def connected_user_count(self) -> int:
        """Get total number of connected users."""
        return len(self.active_connections)
    
    @property
    def active_rooms(self) -> List[int]:
        """Get list of active room IDs."""
        return list(self.room_connections.keys())


# Global connection manager instance
connection_manager = ConnectionManager()