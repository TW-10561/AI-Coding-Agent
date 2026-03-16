-- AI Chat Platform Database Schema
-- PostgreSQL 15+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" CASCADE;

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    role VARCHAR(20) DEFAULT 'user',
    preferences JSONB DEFAULT '{}',
    last_seen_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);

-- ============================================
-- ROOMS TABLE
-- ============================================
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_type VARCHAR(20) DEFAULT 'public',
    settings JSONB DEFAULT '{}',
    max_members INT DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rooms_owner ON rooms(owner_id);
CREATE INDEX idx_rooms_type ON rooms(room_type);

-- ============================================
-- ROOM MEMBERS TABLE
-- ============================================
CREATE TABLE room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_read_message_id UUID,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    UNIQUE(room_id, user_id)
);

CREATE INDEX idx_room_members_room ON room_members(room_id);
CREATE INDEX idx_room_members_user ON room_members(user_id);

-- ============================================
-- MESSAGES TABLE
-- ============================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    metadata JSONB DEFAULT '{}',
    is_edited BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    parent_id UUID REFERENCES messages(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_room ON messages(room_id);
CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_messages_room_created ON messages(room_id, created_at);
CREATE INDEX idx_messages_parent ON messages(parent_id);

-- ============================================
-- PRIVATE MESSAGES TABLE (for direct messaging)
-- ============================================
CREATE TABLE private_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text',
    metadata JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT sender_not_receiver CHECK (sender_id != receiver_id)
);

CREATE INDEX idx_private_messages_sender ON private_messages(sender_id);
CREATE INDEX idx_private_messages_receiver ON private_messages(receiver_id);
CREATE INDEX idx_private_messages_unread ON private_messages(receiver_id) WHERE is_read = FALSE;

-- ============================================
-- AI CHAT COMPLEMENTS TABLE
-- ============================================
CREATE TABLE ai_complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    response TEXT NOT NULL,
    model VARCHAR(50) DEFAULT 'gpt-3.5-turbo',
    input_tokens INT,
    output_tokens INT,
    processing_time_ms INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ai_complaints_message ON ai_complaints(message_id);
CREATE INDEX idx_ai_complaints_created ON ai_complaints(created_at);

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE is_read = FALSE;

-- ============================================
-- SESSIONS TABLE (for WebSocket connections)
-- ============================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_active ON sessions(is_active);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Get user's unread message count
CREATE OR REPLACE FUNCTION count_unread_messages(p_user_id UUID)
RETURNS BIGINT AS $$
    SELECT COUNT(*)
    FROM private_messages
    WHERE receiver_id = p_user_id AND is_read = FALSE;
$$ LANGUAGE SQL;

-- Get room member count
CREATE OR REPLACE FUNCTION count_room_members(p_room_id UUID)
RETURNS INT AS $$
    SELECT COUNT(*) FROM room_members WHERE room_id = p_room_id;
$$ LANGUAGE SQL;

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS
-- ============================================

-- User rooms view
CREATE OR REPLACE VIEW user_rooms AS
SELECT 
    rm.*,
    r.name as room_name,
    r.room_type,
    r.settings,
    u.username as owner_username,
    u.avatar_url as owner_avatar
FROM room_members rm
JOIN rooms r ON r.id = rm.room_id
JOIN users u ON u.id = r.owner_id;

-- User inbox view
CREATE OR REPLACE VIEW user_inbox AS
SELECT 
    pm.*,
    CONCAT(u.full_name, ' (@', u.username, ')') as sender_display
FROM private_messages pm
JOIN users u ON u.id = pm.sender_id;

-- ============================================
-- ROLES & PERMISSIONS
-- ============================================

-- Room roles: owner, admin, moderator, member, guest
-- Permission matrix:
-- | Role       | Read | Write | Invite | Manage | Delete |
-- |------------|------|-------|--------|--------|--------|
-- | owner      | Y    | Y     | Y      | Y      | Y      |
-- | admin      | Y    | Y     | Y      | Y      | N      |
-- | moderator  | Y    | Y     | Y      | N      | N      |
-- | member     | Y    | Y     | N      | N      | N      |
-- | guest      | Y    | N     | N      | N      | N      |

-- ============================================
-- SAMPLE DATA
-- ============================================

-- Insert test users
INSERT INTO users (username, email, hashed_password, full_name, role) VALUES
    ('admin', 'admin@example.com', '$2b$12$hashedpassword', 'Admin User', 'admin'),
    ('assistant', 'ai@example.com', '$2b$12$hashedpassword', 'AI Assistant', 'ai'),
    ('user1', 'user1@example.com', '$2b$12$hashedpassword', 'User One', 'user'),
    ('user2', 'user2@example.com', '$2b$12$hashedpassword', 'User Two', 'user');

-- Insert test room
INSERT INTO rooms (name, description, owner_id, room_type) VALUES
    ('General Chat', 'General purpose chat room', (SELECT id FROM users WHERE username = 'admin'), 'public');

-- Insert room members
INSERT INTO room_members (room_id, user_id, role) VALUES
    ((SELECT id FROM rooms WHERE name = 'General Chat'), (SELECT id FROM users WHERE username = 'admin'), 'owner'),
    ((SELECT id FROM rooms WHERE name = 'General Chat'), (SELECT id FROM users WHERE username = 'user1'), 'member'),
    ((SELECT id FROM rooms WHERE name = 'General Chat'), (SELECT id FROM users WHERE username = 'user2'), 'member');