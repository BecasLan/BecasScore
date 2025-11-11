-- ==================================================
-- ADD MISSING PARTITIONS FOR 2025 (July - December)
-- ==================================================
-- Fix: "no partition of relation user_actions found for row"
-- This happens when trying to insert data for months that don't have partitions

-- user_actions partitions (July - December 2025)
CREATE TABLE IF NOT EXISTS user_actions_2025_07 PARTITION OF user_actions
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE IF NOT EXISTS user_actions_2025_08 PARTITION OF user_actions
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE IF NOT EXISTS user_actions_2025_09 PARTITION OF user_actions
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE IF NOT EXISTS user_actions_2025_10 PARTITION OF user_actions
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE IF NOT EXISTS user_actions_2025_11 PARTITION OF user_actions
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE IF NOT EXISTS user_actions_2025_12 PARTITION OF user_actions
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Add 2026 partitions (prepare for next year)
CREATE TABLE IF NOT EXISTS user_actions_2026_01 PARTITION OF user_actions
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS user_actions_2026_02 PARTITION OF user_actions
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS user_actions_2026_03 PARTITION OF user_actions
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS user_actions_2026_04 PARTITION OF user_actions
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS user_actions_2026_05 PARTITION OF user_actions
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS user_actions_2026_06 PARTITION OF user_actions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- messages partitions (if they exist - July - December 2025)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'messages' AND schemaname = 'public') THEN
        -- Check if messages is partitioned
        IF EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relname = 'messages'
            AND n.nspname = 'public'
            AND c.relkind = 'p'  -- 'p' means partitioned table
        ) THEN
            CREATE TABLE IF NOT EXISTS messages_2025_07 PARTITION OF messages
                FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

            CREATE TABLE IF NOT EXISTS messages_2025_08 PARTITION OF messages
                FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

            CREATE TABLE IF NOT EXISTS messages_2025_09 PARTITION OF messages
                FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

            CREATE TABLE IF NOT EXISTS messages_2025_10 PARTITION OF messages
                FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

            CREATE TABLE IF NOT EXISTS messages_2025_11 PARTITION OF messages
                FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

            CREATE TABLE IF NOT EXISTS messages_2025_12 PARTITION OF messages
                FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');
        END IF;
    END IF;
END$$;

-- Log successful migration
DO $$
BEGIN
    RAISE NOTICE 'Successfully created missing partitions for 2025-07 through 2026-06';
END$$;
