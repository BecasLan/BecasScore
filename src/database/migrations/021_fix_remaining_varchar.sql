-- ==================================================
-- FIX: Increase ALL remaining VARCHAR columns that might be too small
-- ==================================================

BEGIN;

-- Step 1: Drop ALL views and materialized views that depend on these columns
DROP VIEW IF EXISTS server_health CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_user_risk_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_server_analytics CASCADE;
DROP MATERIALIZED VIEW IF EXISTS server_stats_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS user_activity_summary CASCADE;

-- Check current column types to diagnose the issue
DO $$
BEGIN
    RAISE NOTICE 'Checking column types for user_sicil_summary...';
END $$;

-- Fix ANY remaining VARCHAR(20) or VARCHAR(30) columns that might be too small
-- Increase to VARCHAR(50) to give plenty of room for Discord IDs

-- user_sicil_summary table
ALTER TABLE user_sicil_summary ALTER COLUMN server_id TYPE VARCHAR(50);
ALTER TABLE user_sicil_summary ALTER COLUMN user_id TYPE VARCHAR(50);

-- Make sure all other tables also have sufficient space
ALTER TABLE servers ALTER COLUMN id TYPE VARCHAR(50);
ALTER TABLE servers ALTER COLUMN owner_id TYPE VARCHAR(50);

ALTER TABLE users ALTER COLUMN id TYPE VARCHAR(50);

ALTER TABLE channels ALTER COLUMN id TYPE VARCHAR(50);
ALTER TABLE channels ALTER COLUMN server_id TYPE VARCHAR(50);

ALTER TABLE server_members ALTER COLUMN server_id TYPE VARCHAR(50);
ALTER TABLE server_members ALTER COLUMN user_id TYPE VARCHAR(50);

-- user_actions table
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_actions') THEN
        ALTER TABLE user_actions ALTER COLUMN server_id TYPE VARCHAR(50);
        ALTER TABLE user_actions ALTER COLUMN user_id TYPE VARCHAR(50);

        -- Check and alter channel_id if it exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_actions' AND column_name = 'channel_id') THEN
            ALTER TABLE user_actions ALTER COLUMN channel_id TYPE VARCHAR(50);
        END IF;

        -- Check and alter moderator_id if it exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_actions' AND column_name = 'moderator_id') THEN
            ALTER TABLE user_actions ALTER COLUMN moderator_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- messages table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'id') THEN
            ALTER TABLE messages ALTER COLUMN id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'server_id') THEN
            ALTER TABLE messages ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'channel_id') THEN
            ALTER TABLE messages ALTER COLUMN channel_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'user_id') THEN
            ALTER TABLE messages ALTER COLUMN user_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- threats table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'threats') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'threats' AND column_name = 'server_id') THEN
            ALTER TABLE threats ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'threats' AND column_name = 'user_id') THEN
            ALTER TABLE threats ALTER COLUMN user_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'threats' AND column_name = 'channel_id') THEN
            ALTER TABLE threats ALTER COLUMN channel_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'threats' AND column_name = 'moderator_id') THEN
            ALTER TABLE threats ALTER COLUMN moderator_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- anomaly_detections table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'anomaly_detections') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'anomaly_detections' AND column_name = 'server_id') THEN
            ALTER TABLE anomaly_detections ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'anomaly_detections' AND column_name = 'resolved_by') THEN
            ALTER TABLE anomaly_detections ALTER COLUMN resolved_by TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- server_health_snapshots table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'server_health_snapshots') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'server_health_snapshots' AND column_name = 'server_id') THEN
            ALTER TABLE server_health_snapshots ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- conflict_predictions table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conflict_predictions') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conflict_predictions' AND column_name = 'server_id') THEN
            ALTER TABLE conflict_predictions ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conflict_predictions' AND column_name = 'user_a') THEN
            ALTER TABLE conflict_predictions ALTER COLUMN user_a TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'conflict_predictions' AND column_name = 'user_b') THEN
            ALTER TABLE conflict_predictions ALTER COLUMN user_b TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- topic_trends table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'topic_trends') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'topic_trends' AND column_name = 'server_id') THEN
            ALTER TABLE topic_trends ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- alert_history table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'alert_history') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alert_history' AND column_name = 'server_id') THEN
            ALTER TABLE alert_history ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alert_history' AND column_name = 'sent_to_channel') THEN
            ALTER TABLE alert_history ALTER COLUMN sent_to_channel TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'alert_history' AND column_name = 'acknowledged_by') THEN
            ALTER TABLE alert_history ALTER COLUMN acknowledged_by TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- analytics_reports table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'analytics_reports') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'analytics_reports' AND column_name = 'server_id') THEN
            ALTER TABLE analytics_reports ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'analytics_reports' AND column_name = 'sent_to_channel') THEN
            ALTER TABLE analytics_reports ALTER COLUMN sent_to_channel TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- performance_metrics table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'performance_metrics') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'performance_metrics' AND column_name = 'server_id') THEN
            ALTER TABLE performance_metrics ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- user_relationships table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_relationships') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_relationships' AND column_name = 'server_id') THEN
            ALTER TABLE user_relationships ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_relationships' AND column_name = 'user_a') THEN
            ALTER TABLE user_relationships ALTER COLUMN user_a TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_relationships' AND column_name = 'user_b') THEN
            ALTER TABLE user_relationships ALTER COLUMN user_b TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

-- voice_sessions table (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'voice_sessions') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voice_sessions' AND column_name = 'server_id') THEN
            ALTER TABLE voice_sessions ALTER COLUMN server_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voice_sessions' AND column_name = 'user_id') THEN
            ALTER TABLE voice_sessions ALTER COLUMN user_id TYPE VARCHAR(50);
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voice_sessions' AND column_name = 'channel_id') THEN
            ALTER TABLE voice_sessions ALTER COLUMN channel_id TYPE VARCHAR(50);
        END IF;
    END IF;
END $$;

COMMIT;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE '✅ All VARCHAR columns increased to VARCHAR(50)';
END $$;
