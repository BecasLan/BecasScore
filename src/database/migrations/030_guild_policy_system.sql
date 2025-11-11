-- ============================================================================
-- GUILD POLICY SYSTEM - DATABASE SCHEMA
-- ============================================================================
-- This migration creates tables for:
-- 1. Guild-specific policies (local enforcement, NO trust score impact)
-- 2. Becas core violations (global enforcement, trust score impact)
-- 3. Policy learning from moderation patterns
-- ============================================================================

-- ============================================================================
-- TABLE: guild_policies
-- Stores guild-specific rules that are enforced LOCALLY only
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(64) NOT NULL,

  -- Policy content
  rule_text TEXT NOT NULL,                    -- Original rule text
  ai_interpretation TEXT,                     -- AI's understanding of the rule
  category VARCHAR(32),                       -- 'content', 'behavior', 'channel_specific'

  -- Enforcement
  action_type VARCHAR(16) NOT NULL,           -- 'warn', 'timeout', 'ban' (LOCAL ONLY)
  action_params JSONB,                        -- { duration: 3600, reason: "..." }
  severity VARCHAR(16) NOT NULL,              -- 'low', 'medium', 'high'
  confidence FLOAT DEFAULT 1.0,               -- AI confidence (0-1)

  -- Metadata
  learned_from VARCHAR(32) DEFAULT 'manual',  -- 'manual', 'server_rules', 'mod_patterns'
  source_channel_id VARCHAR(64),              -- If channel-specific
  created_by VARCHAR(64),                     -- Admin who created/approved
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_triggered TIMESTAMPTZ
);

CREATE INDEX idx_guild_policies_guild ON guild_policies(guild_id) WHERE is_active = true;
CREATE INDEX idx_guild_policies_category ON guild_policies(category);
CREATE INDEX idx_guild_policies_learned_from ON guild_policies(learned_from);

-- ============================================================================
-- TABLE: guild_policy_enforcement
-- Log of guild policy enforcement (LOCAL actions)
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_policy_enforcement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(64) NOT NULL,
  policy_id UUID REFERENCES guild_policies(id) ON DELETE CASCADE,

  -- Violation details
  user_id VARCHAR(64) NOT NULL,
  message_content TEXT,                       -- What triggered the policy
  channel_id VARCHAR(64),

  -- Action taken
  action_taken VARCHAR(16) NOT NULL,          -- 'warn', 'timeout', 'ban'
  action_success BOOLEAN DEFAULT true,

  -- Metadata
  confidence FLOAT,                           -- Detection confidence
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_policy_enforcement_guild ON guild_policy_enforcement(guild_id);
CREATE INDEX idx_policy_enforcement_user ON guild_policy_enforcement(user_id);
CREATE INDEX idx_policy_enforcement_policy ON guild_policy_enforcement(policy_id);
CREATE INDEX idx_policy_enforcement_timestamp ON guild_policy_enforcement(timestamp DESC);

-- ============================================================================
-- TABLE: becas_core_violations
-- GLOBAL violations that affect trust score across all guilds
-- ============================================================================
CREATE TABLE IF NOT EXISTS becas_core_violations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL,
  guild_id VARCHAR(64) NOT NULL,

  -- Violation details
  violation_type VARCHAR(32) NOT NULL,        -- 'profanity', 'hate_speech', 'harassment', etc.
  content TEXT,                               -- What they said/did
  channel_id VARCHAR(64),

  -- Severity
  severity VARCHAR(16) NOT NULL,              -- 'low', 'medium', 'high', 'critical'
  confidence FLOAT NOT NULL,                  -- AI confidence (0-1)

  -- Punishment
  trust_penalty INT NOT NULL,                 -- How much score decreased (positive number)
  action_taken VARCHAR(32),                   -- 'timeout', 'ban', 'cross_ban', 'none'
  action_params JSONB,                        -- { duration: 3600, reason: "..." }

  -- Metadata
  detected_by VARCHAR(32) DEFAULT 'ai',       -- 'ai', 'manual', 'scam_detector'
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_core_violations_user ON becas_core_violations(user_id);
CREATE INDEX idx_core_violations_guild ON becas_core_violations(guild_id);
CREATE INDEX idx_core_violations_type ON becas_core_violations(violation_type);
CREATE INDEX idx_core_violations_timestamp ON becas_core_violations(timestamp DESC);

-- ============================================================================
-- TABLE: policy_learning_candidates
-- Moderation patterns that could become policies
-- ============================================================================
CREATE TABLE IF NOT EXISTS policy_learning_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(64) NOT NULL,

  -- Pattern detected
  pattern_type VARCHAR(32) NOT NULL,          -- 'repeated_moderation', 'similar_content'
  pattern_description TEXT,                   -- AI's description
  example_actions JSONB,                      -- Array of similar mod actions
  occurrence_count INT DEFAULT 1,             -- How many times seen

  -- Suggested policy
  suggested_rule TEXT,                        -- AI-suggested rule text
  suggested_action VARCHAR(16),               -- 'warn', 'timeout', 'ban'
  suggested_severity VARCHAR(16),

  -- Status
  status VARCHAR(16) DEFAULT 'pending',       -- 'pending', 'approved', 'rejected', 'ignored'
  reviewed_by VARCHAR(64),                    -- Admin who reviewed
  reviewed_at TIMESTAMPTZ,

  -- Timestamps
  first_detected TIMESTAMPTZ DEFAULT NOW(),
  last_occurrence TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_candidates_guild ON policy_learning_candidates(guild_id);
CREATE INDEX idx_learning_candidates_status ON policy_learning_candidates(status);

-- ============================================================================
-- TABLE: guild_policy_sync_log
-- Track daily policy discovery scans
-- ============================================================================
CREATE TABLE IF NOT EXISTS guild_policy_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id VARCHAR(64) NOT NULL,

  -- Scan results
  scan_type VARCHAR(16) NOT NULL,             -- 'daily', 'manual', 'initial'
  rules_found INT DEFAULT 0,
  policies_created INT DEFAULT 0,
  policies_updated INT DEFAULT 0,

  -- Status
  status VARCHAR(16) DEFAULT 'success',       -- 'success', 'failed', 'partial'
  error_message TEXT,

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_policy_sync_guild ON guild_policy_sync_log(guild_id);
CREATE INDEX idx_policy_sync_started ON guild_policy_sync_log(started_at DESC);

-- ============================================================================
-- FUNCTION: Update guild_policies.updated_at on modification
-- ============================================================================
CREATE OR REPLACE FUNCTION update_guild_policy_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guild_policies_updated
  BEFORE UPDATE ON guild_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_guild_policy_timestamp();

-- ============================================================================
-- FUNCTION: Update guild_policies.last_triggered when enforced
-- ============================================================================
CREATE OR REPLACE FUNCTION update_policy_last_triggered()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE guild_policies
  SET last_triggered = NEW.timestamp
  WHERE id = NEW.policy_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_policy_enforcement_update_last_triggered
  AFTER INSERT ON guild_policy_enforcement
  FOR EACH ROW
  EXECUTE FUNCTION update_policy_last_triggered();

-- ============================================================================
-- SAMPLE DATA (for testing)
-- ============================================================================
-- Example: No profanity in #general (this is a GUILD policy, not Becas core)
-- INSERT INTO guild_policies (guild_id, rule_text, ai_interpretation, category, action_type, action_params, severity, learned_from)
-- VALUES (
--   '1234567890',
--   'No inappropriate language in #general',
--   'Users should not use profanity or offensive language in the general channel',
--   'content',
--   'timeout',
--   '{"duration": 3600, "reason": "Inappropriate language in #general"}',
--   'medium',
--   'server_rules'
-- );

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
