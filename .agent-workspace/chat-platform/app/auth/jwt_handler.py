"""
JWT Token Handler for Authentication
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTKeyIssued, JWTError
from jose.jwt import decode
from passlib.context import CryptContext
from app.config import settings


class JWTHandler:
    """JWT token handling for authentication"""
    
    def __init__(self):
        self.secret_key = settings.SECRET_KEY
        self.algorithm = settings.ALGORITHM
        self.access_token_expire_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    
    def create_access_token(
        self,
        data: dict,
        expires_delta: Optional[timedelta] = None
    ) -> str:
        """Create a JWT access token"""
        to_encode = data.copy()
        
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=self.access_token_expire_minutes)
            
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(
            to_encode,
            self.secret_key,
            algorithm=self.algorithm
        )
        return encoded_jwt
    
    def decode_access_token(self, token: str) -> dict:
        """Decode a JWT access token"""
        payload = jwt.decode(
            token,
            self.secret_key,
            algorithms=[self.algorithm]
        )
        return payload
    
    def verify_token(self, token: str) -> bool:
        """Verify if a token is valid"""
        try:
            self.decode_access_token(token)
            return True
        except JWTError:
            return False


class PasswordHandler:
    """Password hashing and verification handler"""
    
    def __init__(self):
        self.pwd_context = CryptContext(
            schemes=["bcrypt"],
            deprecated="auto"
        )
    
    def hash_password(self, plain_password: str) -> str:
        """Hash a plain password"""
        return self.pwd_context.hash(plain_password)
    
    def verify_password(
        self,
        plain_password: str,
        hashed_password: str
    ) -> bool:
        """Verify a plain password against a hashed password"""
        return self.pwd_context.verify(plain_password, hashed_password)


# Initialize handlers
jwt_handler = JWTHandler()
password_handler = PasswordHandler()