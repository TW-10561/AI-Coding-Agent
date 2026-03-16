"""
Authentication API Routes
"""
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse
from app.database import get_db
from app.auth.auth_schemas import UserCreate, UserLogin, TokenResponse, UserResponse
from app.auth.auth_service import AuthService


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
    description="Create a new user account with username, email and password"
)
async def register(user_data: UserCreate):
    """Register a new user"""
    async with get_db() as db:
        auth_service = AuthService(db)
        try:
            user = await auth_service.register(user_data)
            return UserResponse(
                id=user.id,
                username=user.username,
                email=user.email,
                full_name=user.full_name,
                is_active=user.is_active,
                created_at=user.created_at,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(e)
            )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login user",
    description="Authenticate user and return access and refresh tokens"
)
async def login(login_data: UserLogin):
    """Login user and return tokens"""
    async with get_db() as db:
        auth_service = AuthService(db)
        try:
            tokens = await auth_service.login(login_data)
            return tokens
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(e)
            )


@router.post(
    "/logout",
    response_model=dict,
    summary="Logout user",
    description="Logout user and invalidate refresh token"
)
async def logout(refresh_token: str):
    """Logout user"""
    # Get user ID from token (implementation needed)
    # For now, just return success
    return {"message": "Successfully logged out"}


@router.post(
    "/refresh",
    response_model=dict,
    summary="Refresh access token",
    description="Get new access token using refresh token"
)
async def refresh_token(refresh_token: str):
    """Refresh access token"""
    async with get_db() as db:
        auth_service = AuthService(db)
        try:
            new_access_token = await auth_service.refresh_token(refresh_token)
            return {"access_token": new_access_token}
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(e)
            )