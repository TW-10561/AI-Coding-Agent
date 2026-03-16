# AI Chat Platform - Real-Time AI Chat Collaboration Platform
# Version: 1.0.0
# This project demonstrates coordinated work between subagents

from .config import settings
from .database import database, get_db
from .models import Base
from .api import app

__all__ = ["app", "settings", "database", "Base", "get_db"]