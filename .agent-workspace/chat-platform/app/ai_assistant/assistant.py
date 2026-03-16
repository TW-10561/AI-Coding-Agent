"""
AI Assistant Integration
"""
from typing import Optional
from app.config import settings
from app.database import get_db
from app.chat.services import ChatService
from app.chat.models import MessageType
import logging


logger = logging.getLogger(__name__)


class AIAssistant:
    """
    AI Assistant for chat rooms.
    Processes user questions and returns answers.
    """
    
    def __init__(self):
        self.enabled = settings.AI_ASSISTANT_ENABLED
        self.model_name = settings.AI_MODEL_NAME
        self.timeout = settings.AI_TIMEOUT_SECONDS
    
    async def process_question(
        self,
        room_id: int,
        user_id: int,
        question: str,
    ) -> str:
        """
        Process a user question and return an answer.
        
        This is a placeholder implementation. In production,
        this would call an actual AI model.
        """
        if not self.enabled:
            return "AI assistant is not enabled."
        
        try:
            # Import AI processing library (e.g., OpenAI, Anthropic, etc.)
            # from ai_processing import get_ai_response
            # answer = await get_ai_response(question)
            
            # Placeholder: Simple echo with prefix
            answer = f"AI: {question}?"
            
            # Log processing
            logger.info(
                f"AI processing for user {user_id} in room {room_id}: {question}"
            )
            
            return answer
            
        except Exception as e:
            logger.error(f"AI processing error: {e}")
            return f"Error processing question: {str(e)}"
    
    async def get_answer(
        self,
        room_id: int,
        user_id: int,
        question: str,
    ) -> str:
        """
        Get AI answer for a question.
        Includes context from previous messages.
        """
        # Get chat context
        async with get_db() as db:
            chat_service = ChatService(db)
            
            # Get recent messages for context
            messages = await chat_service.get_messages(room_id, limit=10)
            
            # Build context
            context = self._build_context(messages)
            
            # Process question with context
            answer = await self._get_answer_with_context(
                context,
                question,
            )
            
            return answer
    
    def _build_context(self, messages: list) -> str:
        """Build context string from messages"""
        if not messages:
            return ""
        
        context_parts = []
        for msg in messages[-5:]:  # Last 5 messages
            if not msg.is_deleted:
                context_parts.append(f"- {msg.content}")
        
        return "\n".join(context_parts)
    
    async def _get_answer_with_context(
        self,
        context: str,
        question: str,
    ) -> str:
        """
        Get AI answer with context.
        
        In production, this would call an LLM API.
        """
        # Placeholder implementation
        if context:
            return f"Based on the conversation: {context}\n\nAI: {question}"
        else:
            return f"AI: {question}"
    
    async def summarize_conversation(
        self,
        room_id: int,
        max_messages: int = 50,
    ) -> str:
        """Summarize the conversation in a room"""
        async with get_db() as db:
            chat_service = ChatService(db)
            messages = await chat_service.get_messages(room_id, limit=max_messages)
        
        if not messages:
            return "No messages in this conversation."
        
        # Build summary
        message_count = len([m for m in messages if not m.is_deleted])
        first_message = messages[0] if messages else None
        last_message = messages[-1] if messages else None
        
        summary = (
            f"Conversation summary:\n"
            f"- Total messages: {message_count}\n"
        )
        
        if first_message:
            summary += f"- Started: {first_message.created_at}\n"
        if last_message:
            summary += f"- Last activity: {last_message.created_at}\n"
        
        return summary
    
    async def generate_response_options(
        self,
        question: str,
        options: int = 3,
    ) -> list:
        """
        Generate response options for a question.
        Returns a list of suggested responses.
        """
        # Placeholder: Generate simple options
        base_responses = [
            "I can help you with that.",
            "Here are some suggestions:",
            "Let me think about it...",
        ]
        
        return [
            f"{base_responses[i % len(base_responses)]} ({i+1})"
            for i in range(options)
        ]


# Initialize AI assistant
ai_assistant = AIAssistant()