"""
WebSocket chat handler for real-time chat messaging.
"""
from fastapi import WebSocket
from typing import Optional
from datetime import datetime
import json
import traceback

from .connection_manager import connection_manager
from .config import settings
from ..services import ai_service


class ChatWebSocketHandler:
    """
    Handles WebSocket events for chat functionality.
    """
    
    def __init__(self):
        self.connection_manager = connection_manager
    
    async def handle_chat_message(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """
        Handle incoming chat messages.
        Process and broadcast to room.
        """
        message_type = data.get("type", "message")
        
        if message_type == "message":
            await self._handle_message(websocket, user_id, room_id, data)
        elif message_type == "typing":
            await self._handle_typing(websocket, user_id, room_id, data)
        elif message_type == "ai_request":
            await self._handle_ai_request(websocket, user_id, room_id, data)
        elif message_type == "message_edit":
            await self._handle_message_edit(websocket, user_id, room_id, data)
        elif message_type == "message_delete":
            await self._handle_message_delete(websocket, user_id, room_id, data)
        else:
            await self._handle_unknown(websocket, user_id, room_id, data)
    
    async def _handle_message(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """Handle a regular chat message."""
        message = {
            "type": "message",
            "user_id": user_id,
            "room_id": room_id,
            "content": data.get("content", ""),
            "message_type": data.get("message_type", "text"),
            "timestamp": datetime.utcnow().isoformat(),
        }
        
        # Broadcast to room
        await self.connection_manager.broadcast_to_room(room_id, message)
    
    async def _handle_typing(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """Handle typing indicator."""
        is_typing = data.get("is_typing", False)
        await self.connection_manager.set_typing_status(user_id, room_id, is_typing)
    
    async def _handle_ai_request(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """Handle AI request from user."""
        query = data.get("query", "")
        context = data.get("context", "")
        
        # Send processing indicator
        await self.connection_manager.set_typing_status(user_id, room_id, True)
        
        try:
            # Process AI request in background
            response = await ai_service.process_query(
                query=query,
                context=context,
                user_id=user_id,
                room_id=room_id,
            )
            
            # Send AI response
            ai_message = {
                "type": "ai_response",
                "user_id": 0,  # AI user
                "room_id": room_id,
                "content": response,
                "timestamp": datetime.utcnow().isoformat(),
            }
            await self.connection_manager.broadcast_to_room(room_id, ai_message)
            
        except Exception as e:
            error_message = {
                "type": "error",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat(),
            }
            await websocket.send_json(error_message)
        
        finally:
            # Clear typing status
            await self.connection_manager.set_typing_status(user_id, room_id, False)
    
    async def _handle_message_edit(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """Handle message edit request."""
        message_id = data.get("message_id")
        new_content = data.get("content", "")
        
        edit_message = {
            "type": "message_edited",
            "user_id": user_id,
            "room_id": room_id,
            "message_id": message_id,
            "content": new_content,
            "timestamp": datetime.utcnow().isoformat(),
        }
        
        await self.connection_manager.broadcast_to_room(room_id, edit_message)
    
    async def _handle_message_delete(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """Handle message delete request."""
        message_id = data.get("message_id")
        
        delete_message = {
            "type": "message_deleted",
            "user_id": user_id,
            "room_id": room_id,
            "message_id": message_id,
            "timestamp": datetime.utcnow().isoformat(),
        }
        
        await self.connection_manager.broadcast_to_room(room_id, delete_message)
    
    async def _handle_unknown(
        self,
        websocket: WebSocket,
        user_id: int,
        room_id: int,
        data: dict
    ) -> None:
        """Handle unknown message type."""
        await websocket.send_json({
            "type": "error",
            "error": f"Unknown message type: {data.get('type')}",
            "timestamp": datetime.utcnow().isoformat(),
        })


# Global chat WebSocket handler instance
chat_ws_handler = ChatWebSocketHandler()