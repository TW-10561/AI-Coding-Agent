"""
Application configuration management.
Loads environment variables and provides centralized configuration.
"""
import os
from functools import lru_cache
from pydantic import BaseSettings, EmailStr


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # App
    APP_NAME: str = "AI Chat Platform"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"
    
    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/ai_chat"
    DATABASE_TEST_URL: str = "sqlite:///./test.db"
    
    # JWT Authentication
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    # Redis
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # Celery
    CELERY_BACKEND: str = "redis://localhost:6379/1"
    CELERY_BROKER: str = "redis://localhost:6379/2"
    
    # AI Service (mock/placeholder)
    AI_SERVICE_URL: str = "http://localhost:8000"
    AI_SERVICE_API_KEY: str = ""
    
    # CORS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:8000"
    
    class Config:
        env_prefix = ""
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    """Get application settings (cached)."""
    return Settings()


# Convenience accessors
settings = get_settings()