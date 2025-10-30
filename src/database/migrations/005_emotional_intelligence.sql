-- ==================================================
-- BECAS DATABASE - EMOTIONAL INTELLIGENCE
-- Migration 005: Emotional Context & Support Tracking
-- ==================================================

-- ==================================================
-- TABLE: emotional_context
-- Track emotional states and triggers
-- ==================================================
CREATE TABLE IF NOT EXISTS emotional_context (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id VARCHAR(20),

    -- Emotion Detection (multi-label - user can have multiple emotions)
    emotions JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{emotion: "angry", intensity: 0.8}, {emotion: "frustrated", intensity: 0.6}]
    primary_emotion VARCHAR(50),
    emotion_intensity DECIMAL(5,2) CHECK (emotion_intensity BETWEEN 0 AND 100),

    -- Triggers
    was_triggered BOOLEAN DEFAULT false,
    was_triggered_by_message_id VARCHAR(20),
    trigger_type VARCHAR(100), -- personal_attack, topic_sensitive, group_pressure, etc.
    trigger_description TEXT,

    -- Emotional Regulation
    user_calmed_down BOOLEAN DEFAULT false,
    time_to_calm_down_minutes INTEGER,
    self_regulated BOOLEAN DEFAULT false, -- Did they calm down on their own?

    -- Support & Intervention
    received_support BOOLEAN DEFAULT false,
    support_user_ids TEXT[] DEFAULT '{}', -- Who helped calm them down
    moderator_intervened BOOLEAN DEFAULT false,
    moderator_intervention_type VARCHAR(50), -- warning, timeout, de-escalation_message

    -- Context
    conversation_thread_id UUID,
    related_conflict_id UUID,

    -- Metadata
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_emotional_context_server ON emotional_context(server_id, detected_at DESC);
CREATE INDEX idx_emotional_context_user ON emotional_context(user_id, detected_at DESC);
CREATE INDEX idx_emotional_context_emotion ON emotional_context(primary_emotion, emotion_intensity DESC);
CREATE INDEX idx_emotional_context_triggered ON emotional_context(server_id, was_triggered) WHERE was_triggered = true;
CREATE INDEX idx_emotional_context_unresolved ON emotional_context(server_id, detected_at DESC) WHERE user_calmed_down = false;

-- ==================================================
-- TABLE: user_relationships
-- Track social connections and dynamics
-- ==================================================
CREATE TABLE IF NOT EXISTS user_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_a_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Relationship Type
    relationship_type VARCHAR(50) DEFAULT 'neutral', -- friend, neutral, rival, toxic, supportive
    relationship_strength INTEGER DEFAULT 50 CHECK (relationship_strength BETWEEN 0 AND 100),

    -- Interaction Stats
    total_interactions INTEGER DEFAULT 0,
    positive_interactions INTEGER DEFAULT 0,
    negative_interactions INTEGER DEFAULT 0,
    neutral_interactions INTEGER DEFAULT 0,

    -- Conflict History
    total_conflicts INTEGER DEFAULT 0,
    last_conflict_at TIMESTAMP WITH TIME ZONE,
    conflict_resolution_rate DECIMAL(5,2) DEFAULT 0.0, -- % of conflicts that resolved peacefully

    -- Support History
    times_supported INTEGER DEFAULT 0, -- How many times user_a supported user_b
    last_support_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    first_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_interaction_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(server_id, user_a_id, user_b_id),
    CHECK (user_a_id < user_b_id) -- Ensure ordered pair to avoid duplicates
);

CREATE INDEX idx_user_relationships_server ON user_relationships(server_id);
CREATE INDEX idx_user_relationships_users ON user_relationships(user_a_id, user_b_id);
CREATE INDEX idx_user_relationships_type ON user_relationships(server_id, relationship_type);
CREATE INDEX idx_user_relationships_conflicts ON user_relationships(server_id, total_conflicts DESC) WHERE total_conflicts > 0;
CREATE INDEX idx_user_relationships_supportive ON user_relationships(server_id, times_supported DESC) WHERE relationship_type = 'supportive';

-- ==================================================
-- TABLE: emotional_intelligence_scores
-- Track users' emotional intelligence development
-- ==================================================
CREATE TABLE IF NOT EXISTS emotional_intelligence_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Self-Awareness
    self_awareness_score INTEGER DEFAULT 50 CHECK (self_awareness_score BETWEEN 0 AND 100),
    recognizes_own_emotions BOOLEAN DEFAULT false,
    apologizes_when_wrong BOOLEAN DEFAULT false,

    -- Self-Regulation
    self_regulation_score INTEGER DEFAULT 50 CHECK (self_regulation_score BETWEEN 0 AND 100),
    avg_time_to_calm_minutes INTEGER,
    escalation_tendency INTEGER DEFAULT 50 CHECK (escalation_tendency BETWEEN 0 AND 100), -- Higher = more likely to escalate

    -- Social Awareness
    social_awareness_score INTEGER DEFAULT 50 CHECK (social_awareness_score BETWEEN 0 AND 100),
    reads_room_well BOOLEAN DEFAULT false, -- Adjusts behavior based on context
    empathy_demonstrated_count INTEGER DEFAULT 0,

    -- Relationship Management
    relationship_management_score INTEGER DEFAULT 50 CHECK (relationship_management_score BETWEEN 0 AND 100),
    conflict_resolution_skill INTEGER DEFAULT 50 CHECK (conflict_resolution_skill BETWEEN 0 AND 100),
    helps_others_count INTEGER DEFAULT 0,

    -- Overall EQ Score
    overall_eq_score INTEGER DEFAULT 50 CHECK (overall_eq_score BETWEEN 0 AND 100),

    -- Development Tracking
    eq_trend VARCHAR(20) DEFAULT 'stable', -- improving, stable, declining
    last_significant_change_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(server_id, user_id)
);

CREATE INDEX idx_eq_scores_server ON emotional_intelligence_scores(server_id);
CREATE INDEX idx_eq_scores_user ON emotional_intelligence_scores(user_id);
CREATE INDEX idx_eq_scores_overall ON emotional_intelligence_scores(server_id, overall_eq_score DESC);
CREATE INDEX idx_eq_scores_improving ON emotional_intelligence_scores(server_id, eq_trend) WHERE eq_trend = 'improving';
CREATE INDEX idx_eq_scores_declining ON emotional_intelligence_scores(server_id, eq_trend) WHERE eq_trend = 'declining';

-- ==================================================
-- TRIGGERS
-- ==================================================
CREATE TRIGGER update_user_relationships_updated_at BEFORE UPDATE ON user_relationships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_eq_scores_updated_at BEFORE UPDATE ON emotional_intelligence_scores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- VIEWS
-- ==================================================

-- Users in emotional distress (recent triggers)
CREATE OR REPLACE VIEW users_in_distress AS
SELECT
    ec.server_id,
    ec.user_id,
    u.username,
    ec.primary_emotion,
    ec.emotion_intensity,
    ec.trigger_type,
    ec.received_support,
    ec.detected_at,
    NOW() - ec.detected_at as time_since_trigger
FROM emotional_context ec
JOIN users u ON ec.user_id = u.id
WHERE ec.detected_at > NOW() - INTERVAL '1 hour'
  AND ec.user_calmed_down = false
  AND ec.emotion_intensity >= 60
ORDER BY ec.emotion_intensity DESC, ec.detected_at DESC;

-- Toxic relationships
CREATE OR REPLACE VIEW toxic_relationships AS
SELECT
    ur.server_id,
    ur.user_a_id,
    ua.username as user_a_name,
    ur.user_b_id,
    ub.username as user_b_name,
    ur.relationship_type,
    ur.total_conflicts,
    ur.conflict_resolution_rate,
    ur.last_conflict_at
FROM user_relationships ur
JOIN users ua ON ur.user_a_id = ua.id
JOIN users ub ON ur.user_b_id = ub.id
WHERE ur.relationship_type IN ('rival', 'toxic')
   OR (ur.total_conflicts >= 3 AND ur.conflict_resolution_rate < 30)
ORDER BY ur.total_conflicts DESC, ur.last_conflict_at DESC;

-- Supportive community members
CREATE OR REPLACE VIEW supportive_members AS
SELECT
    eq.server_id,
    eq.user_id,
    u.username,
    eq.overall_eq_score,
    eq.empathy_demonstrated_count,
    eq.helps_others_count,
    COUNT(DISTINCT ur.user_b_id) as people_supported
FROM emotional_intelligence_scores eq
JOIN users u ON eq.user_id = u.id
LEFT JOIN user_relationships ur ON eq.user_id = ur.user_a_id AND ur.times_supported > 0
WHERE eq.overall_eq_score >= 70
  AND eq.helps_others_count >= 5
GROUP BY eq.server_id, eq.user_id, u.username, eq.overall_eq_score, eq.empathy_demonstrated_count, eq.helps_others_count
ORDER BY eq.overall_eq_score DESC, people_supported DESC;

-- EQ development progress
CREATE OR REPLACE VIEW eq_development_progress AS
SELECT
    eq.server_id,
    eq.user_id,
    u.username,
    eq.overall_eq_score,
    eq.eq_trend,
    eq.self_awareness_score,
    eq.self_regulation_score,
    eq.social_awareness_score,
    eq.relationship_management_score,
    CASE
        WHEN eq.eq_trend = 'improving' THEN '📈 Improving'
        WHEN eq.eq_trend = 'declining' THEN '📉 Declining'
        ELSE '➡️ Stable'
    END as trend_indicator
FROM emotional_intelligence_scores eq
JOIN users u ON eq.user_id = u.id
ORDER BY
    CASE eq.eq_trend
        WHEN 'improving' THEN 1
        WHEN 'stable' THEN 2
        WHEN 'declining' THEN 3
    END,
    eq.overall_eq_score DESC;

-- ==================================================
-- FUNCTIONS
-- ==================================================

-- Calculate emotional intelligence score
CREATE OR REPLACE FUNCTION calculate_eq_score(p_user_id VARCHAR(20), p_server_id VARCHAR(20))
RETURNS INTEGER AS $$
DECLARE
    v_self_awareness INTEGER;
    v_self_regulation INTEGER;
    v_social_awareness INTEGER;
    v_relationship_mgmt INTEGER;
    v_overall_eq INTEGER;
BEGIN
    -- Self-awareness (based on emotional context recognition)
    SELECT COALESCE(
        50 + (COUNT(*) FILTER (WHERE recognizes_own_emotions = true) * 10),
        50
    ) INTO v_self_awareness
    FROM emotional_context
    WHERE user_id = p_user_id AND server_id = p_server_id
    LIMIT 1;

    -- Self-regulation (based on calming down ability)
    SELECT COALESCE(
        50 + CASE
            WHEN AVG(time_to_calm_down_minutes) <= 5 THEN 30
            WHEN AVG(time_to_calm_down_minutes) <= 15 THEN 20
            WHEN AVG(time_to_calm_down_minutes) <= 30 THEN 10
            ELSE 0
        END,
        50
    ) INTO v_self_regulation
    FROM emotional_context
    WHERE user_id = p_user_id AND server_id = p_server_id AND user_calmed_down = true;

    -- Social awareness (based on relationship management)
    SELECT COALESCE(
        50 + (COUNT(*) FILTER (WHERE relationship_type = 'supportive') * 5),
        50
    ) INTO v_social_awareness
    FROM user_relationships
    WHERE (user_a_id = p_user_id OR user_b_id = p_user_id) AND server_id = p_server_id;

    -- Relationship management (conflict resolution)
    SELECT COALESCE(
        50 + (AVG(conflict_resolution_rate) / 2)::INTEGER,
        50
    ) INTO v_relationship_mgmt
    FROM user_relationships
    WHERE (user_a_id = p_user_id OR user_b_id = p_user_id) AND server_id = p_server_id;

    -- Overall EQ (weighted average)
    v_overall_eq := (
        v_self_awareness * 0.25 +
        v_self_regulation * 0.25 +
        v_social_awareness * 0.25 +
        v_relationship_mgmt * 0.25
    )::INTEGER;

    -- Clamp between 0-100
    v_overall_eq := GREATEST(0, LEAST(100, v_overall_eq));

    RETURN v_overall_eq;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE emotional_context IS 'Emotional state tracking and trigger detection';
COMMENT ON TABLE user_relationships IS 'Social connections and relationship dynamics';
COMMENT ON TABLE emotional_intelligence_scores IS 'Users emotional intelligence development tracking';
