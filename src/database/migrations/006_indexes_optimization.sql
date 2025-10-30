-- ==================================================
-- BECAS DATABASE - INDEXES & OPTIMIZATION
-- Migration 006: Additional Indexes and Performance Tuning
-- ==================================================

-- ==================================================
-- COMPOSITE INDEXES for Complex Queries
-- ==================================================

-- User sicil with trust score and violations
CREATE INDEX IF NOT EXISTS idx_sicil_composite_risk ON user_sicil_summary(
    server_id,
    risk_category,
    (total_warnings + total_timeouts + total_kicks + total_bans) DESC
) WHERE risk_category IN ('risky', 'dangerous');

-- Server members with activity
CREATE INDEX IF NOT EXISTS idx_server_members_active ON server_members(
    server_id,
    last_message_at DESC NULLS LAST,
    total_messages DESC
) WHERE left_at IS NULL;

-- Messages with high toxicity
CREATE INDEX IF NOT EXISTS idx_messages_high_toxicity ON messages(
    server_id,
    channel_id,
    created_at DESC
) WHERE toxicity_score > 70;

-- Threats needing action
CREATE INDEX IF NOT EXISTS idx_threats_actionable ON threats(
    server_id,
    severity,
    confidence DESC,
    detected_at DESC
) WHERE action_taken IS NULL AND confidence >= 70;

-- ==================================================
-- PARTIAL INDEXES for Specific Use Cases
-- ==================================================

-- Recent scammers (scam/phishing threats)
CREATE INDEX IF NOT EXISTS idx_threats_recent_scams ON threats(
    server_id,
    user_id,
    detected_at DESC
) WHERE threat_type IN ('scam', 'phishing');

-- Active conversations (not ended)
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversation_threads(
    server_id,
    channel_id,
    started_at DESC
) WHERE ended_at IS NULL;

-- Users with clean streaks
CREATE INDEX IF NOT EXISTS idx_sicil_clean_streaks ON user_sicil_summary(
    server_id,
    clean_streak_days DESC
) WHERE clean_streak_days >= 30;

-- Emotional distress (unresolved)
CREATE INDEX IF NOT EXISTS idx_emotional_recent_distress ON emotional_context(
    server_id,
    user_id,
    emotion_intensity DESC,
    detected_at DESC
) WHERE user_calmed_down = false;

-- ==================================================
-- GIN INDEXES for Array and JSONB Queries
-- ==================================================

-- Search in scam indicators
CREATE INDEX IF NOT EXISTS idx_threats_indicators_gin ON threats USING GIN(indicators);

-- Search in detected topics
CREATE INDEX IF NOT EXISTS idx_messages_topics_gin ON messages USING GIN(detected_topics);

-- Search in moderator notes
CREATE INDEX IF NOT EXISTS idx_sicil_notes_gin ON user_sicil_summary USING GIN(moderator_notes);

-- Search in emotions
CREATE INDEX IF NOT EXISTS idx_emotional_context_emotions_gin ON emotional_context USING GIN(emotions);

-- Search in conversation sentiment flow
CREATE INDEX IF NOT EXISTS idx_conversation_sentiment_gin ON conversation_threads USING GIN(sentiment_flow);

-- ==================================================
-- COVERING INDEXES (Include columns)
-- ==================================================

-- User lookup with username
CREATE INDEX IF NOT EXISTS idx_users_lookup ON users(id) INCLUDE (username, global_trust_score, global_risk_score);

-- Message lookup with content preview
CREATE INDEX IF NOT EXISTS idx_messages_lookup ON messages(id) INCLUDE (user_id, content, toxicity_score, created_at);

-- Threat lookup with details
CREATE INDEX IF NOT EXISTS idx_threats_lookup ON threats(id) INCLUDE (threat_type, severity, confidence, detected_at);

-- ==================================================
-- STATISTICS & ANALYZE
-- ==================================================

-- Update table statistics for query planner
ANALYZE servers;
ANALYZE channels;
ANALYZE users;
ANALYZE server_members;
ANALYZE user_actions;
ANALYZE user_sicil_summary;
ANALYZE user_character_profiles;
ANALYZE user_behavior_snapshots;
ANALYZE messages;
ANALYZE conversation_threads;
ANALYZE message_reactions;
ANALYZE threats;
ANALYZE attachment_analysis;
ANALYZE cross_server_alerts;
ANALYZE moderator_actions;
ANALYZE emotional_context;
ANALYZE user_relationships;
ANALYZE emotional_intelligence_scores;

-- ==================================================
-- MATERIALIZED VIEWS for Expensive Queries
-- ==================================================

-- Server analytics summary (refresh hourly)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_server_analytics AS
SELECT
    s.id as server_id,
    s.name as server_name,
    COUNT(DISTINCT sm.user_id) as total_members,
    COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.left_at IS NULL) as active_members,
    AVG(sm.trust_score)::INTEGER as avg_trust_score,
    COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.risk_category IN ('risky', 'dangerous')) as high_risk_members,
    COUNT(DISTINCT t.id) FILTER (WHERE t.detected_at > NOW() - INTERVAL '7 days') as threats_last_week,
    COUNT(DISTINCT t.id) FILTER (WHERE t.detected_at > NOW() - INTERVAL '24 hours') as threats_last_24h,
    s.total_messages_processed,
    s.total_violations_detected,
    CASE
        WHEN s.total_messages_processed > 0 THEN
            ROUND(100.0 * s.total_violations_detected / s.total_messages_processed, 2)
        ELSE 0
    END as violation_rate
FROM servers s
LEFT JOIN server_members sm ON s.id = sm.server_id
LEFT JOIN threats t ON s.id = t.server_id
GROUP BY s.id, s.name, s.total_messages_processed, s.total_violations_detected;

CREATE UNIQUE INDEX ON mv_server_analytics(server_id);

-- User risk summary (refresh every 6 hours)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_risk_summary AS
SELECT
    u.id as user_id,
    u.username,
    u.global_risk_score,
    u.global_trust_score,
    COUNT(DISTINCT sm.server_id) as active_server_count,
    COALESCE(SUM(uss.total_warnings + uss.total_timeouts + uss.total_kicks + uss.total_bans), 0) as total_violations,
    COUNT(DISTINCT t.id) FILTER (WHERE t.detected_at > NOW() - INTERVAL '30 days') as recent_threats,
    MAX(t.detected_at) as last_threat_detected
FROM users u
LEFT JOIN server_members sm ON u.id = sm.user_id AND sm.left_at IS NULL
LEFT JOIN user_sicil_summary uss ON u.id = uss.user_id
LEFT JOIN threats t ON u.id = t.user_id
GROUP BY u.id, u.username, u.global_risk_score, u.global_trust_score;

CREATE UNIQUE INDEX ON mv_user_risk_summary(user_id);
CREATE INDEX ON mv_user_risk_summary(global_risk_score DESC);
CREATE INDEX ON mv_user_risk_summary(recent_threats DESC);

-- ==================================================
-- REFRESH FUNCTIONS for Materialized Views
-- ==================================================

CREATE OR REPLACE FUNCTION refresh_server_analytics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_server_analytics;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_user_risk_summary()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_risk_summary;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- VACUUM & MAINTENANCE
-- ==================================================

-- Recommend running these periodically (via cron or pg_cron extension):
-- SELECT refresh_server_analytics(); -- Every hour
-- SELECT refresh_user_risk_summary(); -- Every 6 hours
-- VACUUM ANALYZE; -- Daily

COMMENT ON MATERIALIZED VIEW mv_server_analytics IS 'Server-level analytics (refresh hourly)';
COMMENT ON MATERIALIZED VIEW mv_user_risk_summary IS 'User risk summary across all servers (refresh every 6 hours)';
