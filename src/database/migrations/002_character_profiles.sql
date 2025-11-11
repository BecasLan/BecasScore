-- ==================================================
-- BECAS DATABASE - CHARACTER PROFILES
-- Migration 002: User Character Analysis & Profiling
-- ==================================================

-- ==================================================
-- TABLE: user_character_profiles
-- Deep personality and behavioral analysis
-- ==================================================
CREATE TABLE IF NOT EXISTS user_character_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Personality Traits (0-100 scale)
    aggression_level INTEGER DEFAULT 50 CHECK (aggression_level BETWEEN 0 AND 100),
    helpfulness_level INTEGER DEFAULT 50 CHECK (helpfulness_level BETWEEN 0 AND 100),
    leadership_level INTEGER DEFAULT 50 CHECK (leadership_level BETWEEN 0 AND 100),
    humor_level INTEGER DEFAULT 50 CHECK (humor_level BETWEEN 0 AND 100),
    formality_level INTEGER DEFAULT 50 CHECK (formality_level BETWEEN 0 AND 100),
    sociability_level INTEGER DEFAULT 50 CHECK (sociability_level BETWEEN 0 AND 100),

    -- Behavioral Patterns
    avg_message_length INTEGER DEFAULT 0,
    emoji_usage_rate DECIMAL(5,2) DEFAULT 0.0, -- Emojis per message
    caps_usage_rate DECIMAL(5,2) DEFAULT 0.0, -- % of messages with caps
    link_sharing_rate DECIMAL(5,2) DEFAULT 0.0, -- Links per message
    mention_rate DECIMAL(5,2) DEFAULT 0.0, -- Mentions per message

    -- Social Dynamics
    response_rate DECIMAL(5,2) DEFAULT 0.0, -- % of messages that are replies
    conversation_starter_rate DECIMAL(5,2) DEFAULT 0.0, -- % of messages that start threads
    conflict_involvement_rate DECIMAL(5,2) DEFAULT 0.0, -- % of toxic conversations involved in

    -- Time Patterns
    most_active_hour INTEGER CHECK (most_active_hour BETWEEN 0 AND 23),
    avg_session_length_minutes INTEGER DEFAULT 0,
    avg_messages_per_day DECIMAL(8,2) DEFAULT 0.0,

    -- Language Characteristics
    vocabulary_size INTEGER DEFAULT 0, -- Unique words used
    slang_usage_rate DECIMAL(5,2) DEFAULT 0.0,
    technical_language_rate DECIMAL(5,2) DEFAULT 0.0,
    multilingual BOOLEAN DEFAULT false,
    primary_language VARCHAR(10) DEFAULT 'en',

    -- Risk Indicators
    impulsivity_score INTEGER DEFAULT 50 CHECK (impulsivity_score BETWEEN 0 AND 100),
    deception_indicators INTEGER DEFAULT 0, -- Count of deceptive patterns
    manipulation_score INTEGER DEFAULT 0 CHECK (manipulation_score BETWEEN 0 AND 100),

    -- Emotional Intelligence
    empathy_score INTEGER DEFAULT 50 CHECK (empathy_score BETWEEN 0 AND 100),
    emotional_stability INTEGER DEFAULT 50 CHECK (emotional_stability BETWEEN 0 AND 100),

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_messages_analyzed INTEGER DEFAULT 0,

    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_character_profiles_server ON user_character_profiles(server_id);
CREATE INDEX idx_character_profiles_user ON user_character_profiles(user_id);
CREATE INDEX idx_character_profiles_aggression ON user_character_profiles(server_id, aggression_level DESC);
CREATE INDEX idx_character_profiles_risk ON user_character_profiles(server_id, manipulation_score DESC, impulsivity_score DESC);
CREATE INDEX idx_character_profiles_helpfulness ON user_character_profiles(server_id, helpfulness_level DESC);

-- ==================================================
-- TABLE: user_behavior_snapshots
-- Weekly behavioral evolution tracking
-- ==================================================
CREATE TABLE IF NOT EXISTS user_behavior_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Time Period
    week_start_date DATE NOT NULL,
    week_end_date DATE NOT NULL,

    -- Activity Metrics
    messages_sent INTEGER DEFAULT 0,
    avg_toxicity DECIMAL(5,2) DEFAULT 0.0,
    avg_sentiment DECIMAL(5,2) DEFAULT 0.0, -- -100 to 100

    -- Trend Analysis
    toxicity_trend VARCHAR(20), -- increasing, decreasing, stable
    activity_trend VARCHAR(20), -- increasing, decreasing, stable
    social_trend VARCHAR(20), -- more_social, less_social, stable

    -- Anomaly Detection
    is_anomalous BOOLEAN DEFAULT false,
    anomaly_reason TEXT,
    anomaly_score DECIMAL(5,2) DEFAULT 0.0,

    -- Milestones
    warnings_this_week INTEGER DEFAULT 0,
    timeouts_this_week INTEGER DEFAULT 0,
    helpful_actions_this_week INTEGER DEFAULT 0, -- Helping others, answering questions, etc.

    -- Behavioral Changes
    character_shift_detected BOOLEAN DEFAULT false,
    character_shift_description TEXT,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(server_id, user_id, week_start_date)
);

CREATE INDEX idx_behavior_snapshots_server ON user_behavior_snapshots(server_id);
CREATE INDEX idx_behavior_snapshots_user ON user_behavior_snapshots(user_id, week_start_date DESC);
CREATE INDEX idx_behavior_snapshots_anomalies ON user_behavior_snapshots(server_id, is_anomalous) WHERE is_anomalous = true;
CREATE INDEX idx_behavior_snapshots_week ON user_behavior_snapshots(week_start_date DESC);

-- ==================================================
-- TRIGGERS
-- ==================================================
CREATE TRIGGER update_character_profiles_updated_at BEFORE UPDATE ON user_character_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- VIEWS
-- ==================================================

-- High-risk personalities
CREATE OR REPLACE VIEW high_risk_personalities AS
SELECT
    ucp.server_id,
    ucp.user_id,
    u.username,
    ucp.aggression_level,
    ucp.impulsivity_score,
    ucp.manipulation_score,
    ucp.deception_indicators,
    (ucp.aggression_level + ucp.impulsivity_score + ucp.manipulation_score) / 3 as combined_risk_score
FROM user_character_profiles ucp
JOIN users u ON ucp.user_id = u.id
WHERE ucp.aggression_level >= 70
   OR ucp.impulsivity_score >= 70
   OR ucp.manipulation_score >= 70
ORDER BY combined_risk_score DESC;

-- Helpful community members
CREATE OR REPLACE VIEW helpful_members AS
SELECT
    ucp.server_id,
    ucp.user_id,
    u.username,
    ucp.helpfulness_level,
    ucp.empathy_score,
    ucp.sociability_level,
    (ucp.helpfulness_level + ucp.empathy_score + ucp.sociability_level) / 3 as helpfulness_score
FROM user_character_profiles ucp
JOIN users u ON ucp.user_id = u.id
WHERE ucp.helpfulness_level >= 70
ORDER BY helpfulness_score DESC;

-- Behavioral anomalies this week
CREATE OR REPLACE VIEW recent_anomalies AS
SELECT
    ubs.server_id,
    ubs.user_id,
    u.username,
    ubs.week_start_date,
    ubs.anomaly_reason,
    ubs.anomaly_score,
    ubs.toxicity_trend,
    ubs.warnings_this_week
FROM user_behavior_snapshots ubs
JOIN users u ON ubs.user_id = u.id
WHERE ubs.is_anomalous = true
  AND ubs.week_start_date >= CURRENT_DATE - INTERVAL '4 weeks'
ORDER BY ubs.anomaly_score DESC, ubs.week_start_date DESC;

COMMENT ON TABLE user_character_profiles IS 'Deep personality and behavioral analysis of users';
COMMENT ON TABLE user_behavior_snapshots IS 'Weekly behavioral evolution tracking and anomaly detection';
