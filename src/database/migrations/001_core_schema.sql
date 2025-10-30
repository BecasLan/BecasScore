-- ==================================================
-- BECAS DATABASE - CORE SCHEMA
-- Migration 001: Servers, Channels, Users Base
-- ==================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ==================================================
-- TABLE: servers
-- Discord guilds that BECAS monitors
-- ==================================================
CREATE TABLE IF NOT EXISTS servers (
    id VARCHAR(20) PRIMARY KEY, -- Discord guild ID
    name VARCHAR(255) NOT NULL,
    icon_url TEXT,
    owner_id VARCHAR(20) NOT NULL,
    member_count INTEGER DEFAULT 0,

    -- BECAS Configuration
    config JSONB DEFAULT '{}'::jsonb, -- Guild-specific settings
    features TEXT[] DEFAULT '{}', -- Enabled features

    -- Metadata
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Statistics
    total_messages_processed BIGINT DEFAULT 0,
    total_violations_detected BIGINT DEFAULT 0,
    total_moderations_taken BIGINT DEFAULT 0
);

CREATE INDEX idx_servers_owner ON servers(owner_id);
CREATE INDEX idx_servers_joined ON servers(joined_at DESC);

-- ==================================================
-- TABLE: channels
-- Discord channels (neurons in BECAS's network)
-- ==================================================
CREATE TABLE IF NOT EXISTS channels (
    id VARCHAR(20) PRIMARY KEY, -- Discord channel ID
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- text, voice, announcement, etc.

    -- Activity Analysis
    topic TEXT,
    primary_topics TEXT[] DEFAULT '{}', -- Detected main topics
    activity_level VARCHAR(20) DEFAULT 'normal', -- low, normal, high, very_high
    avg_messages_per_day INTEGER DEFAULT 0,

    -- Moderation Settings
    is_monitored BOOLEAN DEFAULT true,
    slowmode_seconds INTEGER DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE,

    -- Statistics
    total_messages BIGINT DEFAULT 0,
    total_violations BIGINT DEFAULT 0
);

CREATE INDEX idx_channels_server ON channels(server_id);
CREATE INDEX idx_channels_activity ON channels(server_id, activity_level);
CREATE INDEX idx_channels_last_message ON channels(last_message_at DESC);

-- ==================================================
-- TABLE: users
-- Discord users across all servers
-- ==================================================
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(20) PRIMARY KEY, -- Discord user ID
    username VARCHAR(255) NOT NULL,
    discriminator VARCHAR(10),
    global_name VARCHAR(255),
    avatar_url TEXT,

    -- Bot flags
    is_bot BOOLEAN DEFAULT false,
    is_system BOOLEAN DEFAULT false,

    -- Global reputation (across all servers)
    global_risk_score INTEGER DEFAULT 50 CHECK (global_risk_score BETWEEN 0 AND 100),
    global_trust_score INTEGER DEFAULT 50 CHECK (global_trust_score BETWEEN 0 AND 100),

    -- Cross-server tracking
    banned_server_count INTEGER DEFAULT 0,
    is_known_scammer BOOLEAN DEFAULT false,
    is_known_spammer BOOLEAN DEFAULT false,

    -- Metadata
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_risk ON users(global_risk_score);
CREATE INDEX idx_users_trust ON users(global_trust_score);
CREATE INDEX idx_users_scammer ON users(is_known_scammer) WHERE is_known_scammer = true;
CREATE INDEX idx_users_last_seen ON users(last_seen_at DESC);

-- ==================================================
-- TABLE: server_members
-- User membership in specific servers
-- ==================================================
CREATE TABLE IF NOT EXISTS server_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Server-specific trust
    trust_score INTEGER DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100),
    risk_category VARCHAR(20) DEFAULT 'safe', -- safe, watch, risky, dangerous

    -- Roles & Permissions
    roles TEXT[] DEFAULT '{}', -- Array of role IDs
    is_moderator BOOLEAN DEFAULT false,
    is_admin BOOLEAN DEFAULT false,

    -- Activity
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    left_at TIMESTAMP WITH TIME ZONE,
    total_messages BIGINT DEFAULT 0,
    last_message_at TIMESTAMP WITH TIME ZONE,

    -- Violations
    total_warnings INTEGER DEFAULT 0,
    total_timeouts INTEGER DEFAULT 0,
    total_kicks INTEGER DEFAULT 0,
    total_bans INTEGER DEFAULT 0,

    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_server_members_server ON server_members(server_id);
CREATE INDEX idx_server_members_user ON server_members(user_id);
CREATE INDEX idx_server_members_trust ON server_members(server_id, trust_score);
CREATE INDEX idx_server_members_risk ON server_members(server_id, risk_category);
CREATE INDEX idx_server_members_moderators ON server_members(server_id, is_moderator) WHERE is_moderator = true;

-- ==================================================
-- TABLE: user_actions (Sicil - Criminal Record)
-- Complete forensic log of every user action
-- ==================================================
CREATE TABLE IF NOT EXISTS user_actions (
    id UUID DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id VARCHAR(20),

    -- Action Details
    action_type VARCHAR(50) NOT NULL, -- message, message_edit, message_delete, reaction, join, leave, role_change, etc.
    content TEXT, -- Original content
    content_after TEXT, -- Content after edit (for message_edit)

    -- AI Analysis
    intent VARCHAR(100), -- Detected intent
    sentiment VARCHAR(20), -- positive, negative, neutral, mixed
    toxicity_score DECIMAL(5,2) DEFAULT 0.0 CHECK (toxicity_score BETWEEN 0 AND 100),
    scam_score DECIMAL(5,2) DEFAULT 0.0 CHECK (scam_score BETWEEN 0 AND 100),
    spam_score DECIMAL(5,2) DEFAULT 0.0 CHECK (spam_score BETWEEN 0 AND 100),

    -- Context
    was_provoked BOOLEAN DEFAULT false,
    emotional_state VARCHAR(50), -- angry, frustrated, happy, neutral, etc.
    conversation_context TEXT, -- Summary of surrounding conversation

    -- Moderation
    triggered_moderation BOOLEAN DEFAULT false,
    moderation_action VARCHAR(50), -- warn, timeout, kick, ban, none
    moderator_override BOOLEAN DEFAULT false,
    moderator_id VARCHAR(20),

    -- Metadata
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional flexible data

    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create partitions for current and next 6 months
CREATE TABLE user_actions_2025_01 PARTITION OF user_actions
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE user_actions_2025_02 PARTITION OF user_actions
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE user_actions_2025_03 PARTITION OF user_actions
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE user_actions_2025_04 PARTITION OF user_actions
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE user_actions_2025_05 PARTITION OF user_actions
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE user_actions_2025_06 PARTITION OF user_actions
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

-- Indexes on partitioned table
CREATE INDEX idx_user_actions_user ON user_actions(user_id, timestamp DESC);
CREATE INDEX idx_user_actions_server ON user_actions(server_id, timestamp DESC);
CREATE INDEX idx_user_actions_type ON user_actions(action_type, timestamp DESC);
CREATE INDEX idx_user_actions_violations ON user_actions(server_id, user_id, triggered_moderation) WHERE triggered_moderation = true;
CREATE INDEX idx_user_actions_toxicity ON user_actions(server_id, user_id, toxicity_score DESC) WHERE toxicity_score > 50;

-- ==================================================
-- TABLE: user_sicil_summary (Criminal Record Card)
-- High-level summary for fast access
-- ==================================================
CREATE TABLE IF NOT EXISTS user_sicil_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Violation Counters
    total_warnings INTEGER DEFAULT 0,
    total_timeouts INTEGER DEFAULT 0,
    total_kicks INTEGER DEFAULT 0,
    total_bans INTEGER DEFAULT 0,

    -- Category Counters
    scam_violations INTEGER DEFAULT 0,
    phishing_violations INTEGER DEFAULT 0,
    toxicity_violations INTEGER DEFAULT 0,
    spam_violations INTEGER DEFAULT 0,
    harassment_violations INTEGER DEFAULT 0,

    -- Redemption Tracking
    clean_streak_days INTEGER DEFAULT 0,
    last_violation_at TIMESTAMP WITH TIME ZONE,
    rehabilitation_progress INTEGER DEFAULT 0 CHECK (rehabilitation_progress BETWEEN 0 AND 100),

    -- Risk Assessment
    risk_category VARCHAR(20) DEFAULT 'safe', -- safe, watch, risky, dangerous
    risk_factors TEXT[] DEFAULT '{}',

    -- Moderator Notes
    moderator_notes JSONB DEFAULT '[]'::jsonb, -- Array of { timestamp, moderator_id, note }

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_sicil_server ON user_sicil_summary(server_id);
CREATE INDEX idx_sicil_user ON user_sicil_summary(user_id);
CREATE INDEX idx_sicil_risk ON user_sicil_summary(server_id, risk_category);
CREATE INDEX idx_sicil_clean_streak ON user_sicil_summary(server_id, clean_streak_days DESC);
CREATE INDEX idx_sicil_violations ON user_sicil_summary(server_id, (total_warnings + total_timeouts + total_kicks + total_bans) DESC);

-- ==================================================
-- TRIGGERS: Auto-update timestamps
-- ==================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_servers_updated_at BEFORE UPDATE ON servers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sicil_updated_at BEFORE UPDATE ON user_sicil_summary
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- VIEWS: Convenience queries
-- ==================================================

-- High-risk users across all servers
CREATE OR REPLACE VIEW high_risk_users AS
SELECT
    u.id,
    u.username,
    u.global_risk_score,
    u.banned_server_count,
    u.is_known_scammer,
    COUNT(DISTINCT sm.server_id) as active_server_count,
    SUM(sm.total_warnings + sm.total_timeouts + sm.total_kicks) as total_violations
FROM users u
LEFT JOIN server_members sm ON u.id = sm.user_id
WHERE u.global_risk_score >= 70 OR u.is_known_scammer = true
GROUP BY u.id, u.username, u.global_risk_score, u.banned_server_count, u.is_known_scammer;

-- Server health dashboard
CREATE OR REPLACE VIEW server_health AS
SELECT
    s.id,
    s.name,
    s.member_count,
    s.total_messages_processed,
    s.total_violations_detected,
    ROUND(100.0 * s.total_violations_detected / NULLIF(s.total_messages_processed, 0), 2) as violation_rate,
    COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.risk_category IN ('risky', 'dangerous')) as high_risk_members,
    AVG(sm.trust_score) as avg_trust_score
FROM servers s
LEFT JOIN server_members sm ON s.id = sm.server_id
GROUP BY s.id, s.name, s.member_count, s.total_messages_processed, s.total_violations_detected;

-- ==================================================
-- FUNCTIONS: Helper utilities
-- ==================================================

-- Get user sicil for a server
CREATE OR REPLACE FUNCTION get_user_sicil(p_user_id VARCHAR(20), p_server_id VARCHAR(20))
RETURNS TABLE (
    username VARCHAR(255),
    trust_score INTEGER,
    risk_category VARCHAR(20),
    total_violations BIGINT,
    clean_streak_days INTEGER,
    last_violation TIMESTAMP WITH TIME ZONE,
    recent_actions BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.username,
        sm.trust_score,
        uss.risk_category,
        (uss.total_warnings + uss.total_timeouts + uss.total_kicks + uss.total_bans)::BIGINT,
        uss.clean_streak_days,
        uss.last_violation_at,
        COUNT(ua.id) as recent_actions
    FROM users u
    JOIN server_members sm ON u.id = sm.user_id AND sm.server_id = p_server_id
    LEFT JOIN user_sicil_summary uss ON u.id = uss.user_id AND uss.server_id = p_server_id
    LEFT JOIN user_actions ua ON u.id = ua.user_id AND ua.server_id = p_server_id
        AND ua.timestamp > NOW() - INTERVAL '7 days'
    WHERE u.id = p_user_id
    GROUP BY u.username, sm.trust_score, uss.risk_category, uss.total_warnings,
             uss.total_timeouts, uss.total_kicks, uss.total_bans,
             uss.clean_streak_days, uss.last_violation_at;
END;
$$ LANGUAGE plpgsql;

COMMENT ON DATABASE becas_db IS 'BECAS AI Moderation System - Complete User Sicil & Forensics Database';
