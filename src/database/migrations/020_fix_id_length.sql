-- ==================================================
-- FIX: Increase ID column lengths for Discord IDs
-- Discord IDs can be 19-20 characters, VARCHAR(20) is too small
-- ==================================================

-- Step 1: Drop ALL views - CASCADE will automatically drop dependent objects
DROP VIEW IF EXISTS high_risk_users CASCADE;
DROP VIEW IF EXISTS server_health CASCADE;
DROP VIEW IF EXISTS high_risk_personalities CASCADE;
DROP VIEW IF EXISTS helpful_members CASCADE;
DROP VIEW IF EXISTS recent_anomalies CASCADE;
DROP VIEW IF EXISTS pending_threats CASCADE;
DROP VIEW IF EXISTS false_positive_analysis CASCADE;
DROP VIEW IF EXISTS global_threat_scoreboard CASCADE;
DROP VIEW IF EXISTS federation_threat_summary CASCADE;
DROP VIEW IF EXISTS federation_server_health CASCADE;
DROP VIEW IF EXISTS federation_top_banned_users CASCADE;
DROP VIEW IF EXISTS users_in_distress CASCADE;
DROP VIEW IF EXISTS toxic_relationships CASCADE;
DROP VIEW IF EXISTS supportive_members CASCADE;
DROP VIEW IF EXISTS eq_development_progress CASCADE;
DROP VIEW IF EXISTS active_toxic_conversations CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_server_analytics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_user_risk_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS server_stats_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS user_activity_summary CASCADE;

-- Step 2: Increase server ID lengths
ALTER TABLE servers ALTER COLUMN id TYPE VARCHAR(30);
ALTER TABLE servers ALTER COLUMN owner_id TYPE VARCHAR(30);

-- Step 3: Increase user ID lengths
ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(30);

-- Step 4: Increase channel ID lengths
ALTER TABLE channels ALTER COLUMN id TYPE VARCHAR(30);
ALTER TABLE channels ALTER COLUMN server_id TYPE VARCHAR(30);

-- Step 5: Increase server_members ID lengths
ALTER TABLE server_members ALTER COLUMN server_id TYPE VARCHAR(30);
ALTER TABLE server_members ALTER COLUMN user_id TYPE VARCHAR(30);

-- Step 6: Increase user_actions ID lengths (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_actions') THEN
        ALTER TABLE user_actions ALTER COLUMN server_id TYPE VARCHAR(30);
        ALTER TABLE user_actions ALTER COLUMN user_id TYPE VARCHAR(30);
        ALTER TABLE user_actions ALTER COLUMN channel_id TYPE VARCHAR(30);
        ALTER TABLE user_actions ALTER COLUMN moderator_id TYPE VARCHAR(30);
    END IF;
END $$;

-- Step 7: Increase user_sicil_summary ID lengths (if table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_sicil_summary') THEN
        ALTER TABLE user_sicil_summary ALTER COLUMN server_id TYPE VARCHAR(30);
        ALTER TABLE user_sicil_summary ALTER COLUMN user_id TYPE VARCHAR(30);
    END IF;
END $$;

-- Step 8: Increase messages table ID lengths (if table exists and has columns)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        -- Only alter columns that actually exist
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'id') THEN
            ALTER TABLE messages ALTER COLUMN id TYPE VARCHAR(30);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'server_id') THEN
            ALTER TABLE messages ALTER COLUMN server_id TYPE VARCHAR(30);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'channel_id') THEN
            ALTER TABLE messages ALTER COLUMN channel_id TYPE VARCHAR(30);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'user_id') THEN
            ALTER TABLE messages ALTER COLUMN user_id TYPE VARCHAR(30);
        END IF;
    END IF;
END $$;

-- Step 9: Recreate server_health view (from 001_core_schema.sql)
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

-- Step 10: Recreate mv_server_analytics materialized view (from 006_indexes_optimization.sql)
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

-- Step 11: Recreate mv_user_risk_summary materialized view (from 006_indexes_optimization.sql)
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

COMMIT;
