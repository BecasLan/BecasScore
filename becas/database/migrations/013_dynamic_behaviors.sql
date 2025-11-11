-- =====================================================
-- DYNAMIC BEHAVIORS SCHEMA
-- Phase 5: Dynamic Behavior Engine
-- =====================================================

-- Table: dynamic_behaviors
-- Stores all custom behaviors created by moderators
CREATE TABLE IF NOT EXISTS dynamic_behaviors (
    id VARCHAR(255) PRIMARY KEY,
    server_id VARCHAR(255) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    enabled BOOLEAN DEFAULT true,

    -- BDL JSON structure
    trigger JSONB NOT NULL,
    tracking JSONB,
    analysis JSONB,
    actions JSONB NOT NULL,
    safety JSONB NOT NULL,

    -- Metadata
    execution_count INTEGER DEFAULT 0,
    last_executed TIMESTAMP,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_server_behaviors ON dynamic_behaviors(server_id, enabled);
CREATE INDEX idx_trigger_type ON dynamic_behaviors((trigger->>'type'));

-- Table: behavior_executions
-- Audit log of all behavior executions
CREATE TABLE IF NOT EXISTS behavior_executions (
    id SERIAL PRIMARY KEY,
    behavior_id VARCHAR(255) NOT NULL,
    server_id VARCHAR(255) NOT NULL,

    -- Trigger context
    triggered_by VARCHAR(255),  -- User ID who triggered
    trigger_event VARCHAR(100),
    trigger_data JSONB,

    -- Execution details
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'running',  -- running, completed, failed, skipped

    -- Results
    actions_executed INTEGER DEFAULT 0,
    analysis_result JSONB,
    error TEXT,

    -- Performance
    execution_time_ms INTEGER
);

CREATE INDEX idx_behavior_executions ON behavior_executions(behavior_id, started_at);
CREATE INDEX idx_server_executions ON behavior_executions(server_id, started_at);
CREATE INDEX idx_status ON behavior_executions(status);

-- Table: behavior_active_tracking
-- Stores active tracking sessions for users/channels/servers
CREATE TABLE IF NOT EXISTS behavior_active_tracking (
    id VARCHAR(255) PRIMARY KEY,
    behavior_id VARCHAR(255) NOT NULL,
    execution_id INTEGER,
    server_id VARCHAR(255) NOT NULL,

    -- Tracking target
    target_type VARCHAR(50) NOT NULL,  -- user, channel, server
    target_id VARCHAR(255) NOT NULL,

    -- Tracking config
    duration VARCHAR(50),
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,

    -- Collected data
    collected_data JSONB DEFAULT '{}',
    stop_conditions JSONB,

    -- Status
    status VARCHAR(50) DEFAULT 'active',  -- active, completed, expired, stopped
    completed_at TIMESTAMP
);

CREATE INDEX idx_active_tracking ON behavior_active_tracking(server_id, target_type, target_id, status);
CREATE INDEX idx_behavior_tracking ON behavior_active_tracking(behavior_id, status);
CREATE INDEX idx_expires ON behavior_active_tracking(expires_at);

-- Table: behavior_rate_limits
-- Track rate limits per behavior to prevent abuse
CREATE TABLE IF NOT EXISTS behavior_rate_limits (
    id SERIAL PRIMARY KEY,
    behavior_id VARCHAR(255) NOT NULL,
    server_id VARCHAR(255) NOT NULL,

    -- Rate limit tracking
    window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    execution_count INTEGER DEFAULT 0,

    -- Per-user rate limits
    user_executions JSONB DEFAULT '{}'  -- { "userId": count }
);

CREATE INDEX idx_rate_limits ON behavior_rate_limits(behavior_id, window_start);

-- Table: behavior_templates
-- Pre-built behavior templates
CREATE TABLE IF NOT EXISTS behavior_templates (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),

    -- Template BDL (with placeholders)
    template_bdl JSONB NOT NULL,

    -- Required placeholders
    required_placeholders JSONB,  -- ["ROLE_ID", "CHANNEL_ID"]

    -- Metadata
    usage_count INTEGER DEFAULT 0,
    is_official BOOLEAN DEFAULT false,
    created_by VARCHAR(255),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_category ON behavior_templates(category);
CREATE INDEX idx_usage ON behavior_templates(usage_count DESC);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Find enabled behaviors for a server
CREATE INDEX IF NOT EXISTS idx_server_enabled_behaviors
ON dynamic_behaviors(server_id)
WHERE enabled = true;

-- Find behaviors by trigger type (event, schedule, etc.)
CREATE INDEX IF NOT EXISTS idx_trigger_event
ON dynamic_behaviors((trigger->>'event'))
WHERE (trigger->>'type') = 'event';

-- Find active tracking sessions that are expiring soon
CREATE INDEX IF NOT EXISTS idx_expiring_tracking
ON behavior_active_tracking(expires_at)
WHERE status = 'active';

-- Find recent executions for a behavior
CREATE INDEX IF NOT EXISTS idx_recent_executions
ON behavior_executions(behavior_id, started_at DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function: Clean up expired tracking sessions
CREATE OR REPLACE FUNCTION cleanup_expired_tracking()
RETURNS INTEGER AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    UPDATE behavior_active_tracking
    SET status = 'expired',
        completed_at = CURRENT_TIMESTAMP
    WHERE status = 'active'
    AND expires_at < CURRENT_TIMESTAMP;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RETURN affected_rows;
END;
$$ LANGUAGE plpgsql;

-- Function: Update behavior execution count
CREATE OR REPLACE FUNCTION increment_behavior_execution(
    p_behavior_id VARCHAR(255)
)
RETURNS VOID AS $$
BEGIN
    UPDATE dynamic_behaviors
    SET execution_count = execution_count + 1,
        last_executed = CURRENT_TIMESTAMP
    WHERE id = p_behavior_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Record behavior error
CREATE OR REPLACE FUNCTION record_behavior_error(
    p_behavior_id VARCHAR(255),
    p_error TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE dynamic_behaviors
    SET error_count = error_count + 1,
        last_error = p_error,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_behavior_id;

    -- Auto-disable if too many errors
    UPDATE dynamic_behaviors
    SET enabled = false,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_behavior_id
    AND error_count >= 5
    AND (safety->>'disableOnErrors')::boolean = true;
END;
$$ LANGUAGE plpgsql;

-- Function: Get behavior statistics
CREATE OR REPLACE FUNCTION get_behavior_stats(
    p_server_id VARCHAR(255),
    p_days INTEGER DEFAULT 7
)
RETURNS TABLE(
    total_behaviors INTEGER,
    enabled_behaviors INTEGER,
    total_executions BIGINT,
    successful_executions BIGINT,
    failed_executions BIGINT,
    avg_execution_time_ms NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT b.id)::INTEGER as total_behaviors,
        COUNT(DISTINCT CASE WHEN b.enabled THEN b.id END)::INTEGER as enabled_behaviors,
        COUNT(e.id) as total_executions,
        COUNT(CASE WHEN e.status = 'completed' THEN 1 END) as successful_executions,
        COUNT(CASE WHEN e.status = 'failed' THEN 1 END) as failed_executions,
        AVG(e.execution_time_ms) as avg_execution_time_ms
    FROM dynamic_behaviors b
    LEFT JOIN behavior_executions e ON b.id = e.behavior_id
        AND e.started_at >= CURRENT_TIMESTAMP - (p_days || ' days')::INTERVAL
    WHERE b.server_id = p_server_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_behavior_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_behavior_timestamp
BEFORE UPDATE ON dynamic_behaviors
FOR EACH ROW
EXECUTE FUNCTION update_behavior_timestamp();

-- =====================================================
-- SAMPLE DATA (for development)
-- =====================================================

-- Insert official templates
INSERT INTO behavior_templates (id, name, description, category, template_bdl, required_placeholders, is_official)
VALUES
(
    'welcome-dm-template',
    'Welcome DM',
    'Send a welcome message to new members',
    'onboarding',
    '{
        "name": "Welcome DM",
        "description": "Send welcome message to new members",
        "trigger": { "type": "event", "event": "guildMemberAdd" },
        "actions": [
            {
                "type": "sendDM",
                "target": "${triggeredUserId}",
                "message": "Welcome to {{SERVER_NAME}}! Please read the rules in {{RULES_CHANNEL}}."
            }
        ],
        "safety": { "maxExecutionsPerHour": 100 }
    }'::jsonb,
    '["SERVER_NAME", "RULES_CHANNEL"]'::jsonb,
    true
),
(
    'bot-verification-template',
    'Bot Verification',
    'Ask new users a math question to verify they are human',
    'security',
    '{
        "name": "Math Question Verification",
        "description": "New users must answer a math question",
        "trigger": { "type": "event", "event": "guildMemberAdd" },
        "actions": [
            {
                "type": "askQuestion",
                "target": "${triggeredUserId}",
                "question": "Welcome! Please solve: 5 + 3 = ?",
                "expectedAnswer": "8",
                "timeout": "60s",
                "onCorrect": { "type": "addRole", "roleId": "{{VERIFIED_ROLE_ID}}" },
                "onIncorrect": { "type": "kick", "reason": "Failed verification" }
            }
        ],
        "safety": { "maxExecutionsPerHour": 50 }
    }'::jsonb,
    '["VERIFIED_ROLE_ID"]'::jsonb,
    true
),
(
    'auto-role-activity-template',
    'Auto Role on Activity',
    'Give role to users after reaching message threshold',
    'rewards',
    '{
        "name": "Active Member Role",
        "description": "Reward active users with a role",
        "trigger": { "type": "event", "event": "messageCreate" },
        "analysis": {
            "type": "threshold",
            "metrics": { "userTotalMessages": { "min": 50 } }
        },
        "actions": [
            {
                "type": "addRole",
                "target": "${triggeredUserId}",
                "roleId": "{{ACTIVE_ROLE_ID}}",
                "condition": "userTotalMessages >= 50"
            }
        ],
        "safety": { "maxExecutionsPerUser": 1 }
    }'::jsonb,
    '["ACTIVE_ROLE_ID"]'::jsonb,
    true
)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE dynamic_behaviors IS 'Stores custom behaviors created by moderators using BDL';
COMMENT ON TABLE behavior_executions IS 'Audit log of all behavior executions with performance metrics';
COMMENT ON TABLE behavior_active_tracking IS 'Active tracking sessions for monitoring users/channels/servers';
COMMENT ON TABLE behavior_rate_limits IS 'Rate limiting data to prevent behavior abuse';
COMMENT ON TABLE behavior_templates IS 'Pre-built behavior templates for common use cases';

COMMENT ON COLUMN dynamic_behaviors.trigger IS 'BDL trigger definition (event, schedule, condition, or pattern)';
COMMENT ON COLUMN dynamic_behaviors.tracking IS 'Optional tracking configuration for monitoring targets';
COMMENT ON COLUMN dynamic_behaviors.analysis IS 'Optional analysis configuration (AI, rules, threshold, pattern)';
COMMENT ON COLUMN dynamic_behaviors.actions IS 'Array of actions to execute when behavior triggers';
COMMENT ON COLUMN dynamic_behaviors.safety IS 'Safety settings (rate limits, error handling, permissions)';

-- =====================================================
-- END OF SCHEMA
-- =====================================================
