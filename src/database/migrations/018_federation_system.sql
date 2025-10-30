/**
 * Migration 018: Federation System
 *
 * Creates tables for multi-server coordination:
 * - Federation server registry
 * - Shared threat intelligence
 * - Global ban list
 * - Cross-server reputation
 * - Federation events
 */

-- ============================================================================
-- FEDERATION SERVERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS federation_servers (
  server_id VARCHAR(255) PRIMARY KEY,
  server_name VARCHAR(255) NOT NULL,
  guild_id VARCHAR(255) NOT NULL UNIQUE,
  federation_level VARCHAR(50) NOT NULL DEFAULT 'public',
    CHECK (federation_level IN ('public', 'trusted', 'private')),
  is_active BOOLEAN DEFAULT true,
  shared_threats BOOLEAN DEFAULT true,
  shared_bans BOOLEAN DEFAULT true,
  shared_reputation BOOLEAN DEFAULT true,
  joined_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_federation_servers_active ON federation_servers(is_active);
CREATE INDEX idx_federation_servers_level ON federation_servers(federation_level);

-- ============================================================================
-- SHARED THREATS
-- ============================================================================

CREATE TABLE IF NOT EXISTS shared_threats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_server_id VARCHAR(255) NOT NULL REFERENCES federation_servers(server_id),
  type VARCHAR(100) NOT NULL,
  severity VARCHAR(50) NOT NULL,
  confidence DECIMAL(3, 2) NOT NULL,
  description TEXT NOT NULL,
  user_id VARCHAR(255),
  message_content TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  detected_at TIMESTAMP DEFAULT NOW(),
  shared_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shared_threats_server ON shared_threats(origin_server_id);
CREATE INDEX idx_shared_threats_type ON shared_threats(type);
CREATE INDEX idx_shared_threats_severity ON shared_threats(severity);
CREATE INDEX idx_shared_threats_shared_at ON shared_threats(shared_at DESC);
CREATE INDEX idx_shared_threats_user ON shared_threats(user_id);

-- Track which servers have seen/acted on shared threats
CREATE TABLE IF NOT EXISTS shared_threat_acknowledgments (
  threat_id UUID REFERENCES shared_threats(id) ON DELETE CASCADE,
  server_id VARCHAR(255) REFERENCES federation_servers(server_id),
  action VARCHAR(50) NOT NULL,
    CHECK (action IN ('investigated', 'acted', 'ignored')),
  acknowledged_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (threat_id, server_id)
);

CREATE INDEX idx_threat_acks_threat ON shared_threat_acknowledgments(threat_id);
CREATE INDEX idx_threat_acks_server ON shared_threat_acknowledgments(server_id);

-- ============================================================================
-- GLOBAL BAN LIST
-- ============================================================================

CREATE TABLE IF NOT EXISTS global_ban_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  username VARCHAR(255) NOT NULL,
  reason TEXT NOT NULL,
  banned_by VARCHAR(255) NOT NULL,
  origin_server_id VARCHAR(255) NOT NULL REFERENCES federation_servers(server_id),
  ban_type VARCHAR(50) NOT NULL,
    CHECK (ban_type IN ('scam', 'raid', 'spam', 'toxicity', 'manual')),
  confidence DECIMAL(3, 2) NOT NULL,
  evidence JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  banned_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, origin_server_id)
);

CREATE INDEX idx_global_ban_user ON global_ban_list(user_id);
CREATE INDEX idx_global_ban_type ON global_ban_list(ban_type);
CREATE INDEX idx_global_ban_active ON global_ban_list(is_active);
CREATE INDEX idx_global_ban_server ON global_ban_list(origin_server_id);
CREATE INDEX idx_global_ban_confidence ON global_ban_list(confidence DESC);
CREATE INDEX idx_global_ban_expires ON global_ban_list(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- GLOBAL REPUTATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS global_reputation (
  user_id VARCHAR(255) PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  total_messages INTEGER DEFAULT 0,
  total_violations INTEGER DEFAULT 0,
  total_bans INTEGER DEFAULT 0,
  first_seen TIMESTAMP DEFAULT NOW(),
  last_updated TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_global_rep_messages ON global_reputation(total_messages DESC);
CREATE INDEX idx_global_rep_violations ON global_reputation(total_violations DESC);
CREATE INDEX idx_global_rep_bans ON global_reputation(total_bans DESC);
CREATE INDEX idx_global_rep_updated ON global_reputation(last_updated DESC);

-- Server-specific reputation scores
CREATE TABLE IF NOT EXISTS server_reputation (
  user_id VARCHAR(255) NOT NULL,
  server_id VARCHAR(255) NOT NULL REFERENCES federation_servers(server_id),
  trust_score_delta DECIMAL(5, 2) DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  violation_count INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, server_id)
);

CREATE INDEX idx_server_rep_user ON server_reputation(user_id);
CREATE INDEX idx_server_rep_server ON server_reputation(server_id);
CREATE INDEX idx_server_rep_trust ON server_reputation(trust_score_delta DESC);

-- ============================================================================
-- FEDERATION EVENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS federation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_server_id VARCHAR(255) NOT NULL REFERENCES federation_servers(server_id),
  event_type VARCHAR(100) NOT NULL,
  event_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_federation_events_server ON federation_events(origin_server_id);
CREATE INDEX idx_federation_events_type ON federation_events(event_type);
CREATE INDEX idx_federation_events_created ON federation_events(created_at DESC);

-- ============================================================================
-- FEDERATION ANALYTICS VIEWS
-- ============================================================================

-- Network-wide threat summary
CREATE OR REPLACE VIEW federation_threat_summary AS
SELECT
  type,
  COUNT(*) as total_count,
  AVG(confidence) as avg_confidence,
  COUNT(DISTINCT origin_server_id) as affected_servers,
  MAX(shared_at) as last_seen
FROM shared_threats
WHERE shared_at >= NOW() - INTERVAL '7 days'
GROUP BY type
ORDER BY total_count DESC;

-- Server health overview
CREATE OR REPLACE VIEW federation_server_health AS
SELECT
  fs.server_id,
  fs.server_name,
  fs.federation_level,
  COUNT(DISTINCT st.id) as shared_threats,
  COUNT(DISTINCT gbl.id) as global_bans_originated,
  COUNT(DISTINCT sr.user_id) as tracked_users,
  AVG(sr.trust_score_delta) as avg_trust_delta,
  fs.is_active
FROM federation_servers fs
LEFT JOIN shared_threats st ON fs.server_id = st.origin_server_id
  AND st.shared_at >= NOW() - INTERVAL '7 days'
LEFT JOIN global_ban_list gbl ON fs.server_id = gbl.origin_server_id
  AND gbl.is_active = true
LEFT JOIN server_reputation sr ON fs.server_id = sr.server_id
GROUP BY fs.server_id, fs.server_name, fs.federation_level, fs.is_active;

-- Top globally banned users
CREATE OR REPLACE VIEW federation_top_banned_users AS
SELECT
  user_id,
  username,
  COUNT(DISTINCT origin_server_id) as ban_count,
  ARRAY_AGG(DISTINCT ban_type) as ban_types,
  MAX(confidence) as max_confidence,
  MAX(banned_at) as last_banned
FROM global_ban_list
WHERE is_active = true
GROUP BY user_id, username
HAVING COUNT(DISTINCT origin_server_id) >= 2
ORDER BY ban_count DESC, max_confidence DESC
LIMIT 100;

-- ============================================================================
-- FEDERATION FUNCTIONS
-- ============================================================================

/**
 * Get federated user reputation score
 */
CREATE OR REPLACE FUNCTION get_federated_reputation(p_user_id VARCHAR)
RETURNS TABLE (
  user_id VARCHAR,
  username VARCHAR,
  global_trust_score DECIMAL,
  total_messages INTEGER,
  total_violations INTEGER,
  total_bans INTEGER,
  server_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gr.user_id,
    gr.username,
    GREATEST(0, LEAST(100,
      50 +
      LEAST(gr.total_messages / 100, 30) -
      (gr.total_violations * 5) -
      (gr.total_bans * 20) +
      (COALESCE(AVG(sr.trust_score_delta), 0) * 0.2)
    )) as global_trust_score,
    gr.total_messages,
    gr.total_violations,
    gr.total_bans,
    COUNT(DISTINCT sr.server_id)::INTEGER as server_count
  FROM global_reputation gr
  LEFT JOIN server_reputation sr ON gr.user_id = sr.user_id
  WHERE gr.user_id = p_user_id
  GROUP BY gr.user_id, gr.username, gr.total_messages, gr.total_violations, gr.total_bans;
END;
$$ LANGUAGE plpgsql;

/**
 * Get network threat intelligence
 */
CREATE OR REPLACE FUNCTION get_network_threat_intel(p_hours INTEGER DEFAULT 24)
RETURNS TABLE (
  threat_type VARCHAR,
  total_occurrences BIGINT,
  avg_confidence DECIMAL,
  affected_servers BIGINT,
  trend VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  WITH current_period AS (
    SELECT
      type,
      COUNT(*) as count_now,
      AVG(confidence) as avg_conf,
      COUNT(DISTINCT origin_server_id) as servers
    FROM shared_threats
    WHERE shared_at >= NOW() - (p_hours || ' hours')::INTERVAL
    GROUP BY type
  ),
  previous_period AS (
    SELECT
      type,
      COUNT(*) as count_before
    FROM shared_threats
    WHERE shared_at >= NOW() - (p_hours * 2 || ' hours')::INTERVAL
    AND shared_at < NOW() - (p_hours || ' hours')::INTERVAL
    GROUP BY type
  )
  SELECT
    cp.type as threat_type,
    cp.count_now as total_occurrences,
    cp.avg_conf as avg_confidence,
    cp.servers as affected_servers,
    CASE
      WHEN pp.count_before IS NULL OR pp.count_before = 0 THEN 'new'
      WHEN cp.count_now > pp.count_before * 1.2 THEN 'increasing'
      WHEN cp.count_now < pp.count_before * 0.8 THEN 'decreasing'
      ELSE 'stable'
    END as trend
  FROM current_period cp
  LEFT JOIN previous_period pp ON cp.type = pp.type
  ORDER BY cp.count_now DESC;
END;
$$ LANGUAGE plpgsql;

/**
 * Check if user should be auto-banned based on federation data
 */
CREATE OR REPLACE FUNCTION should_auto_ban_federated(p_user_id VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
  ban_count INTEGER;
  scam_ban_count INTEGER;
  avg_confidence DECIMAL;
BEGIN
  -- Count active bans across federation
  SELECT
    COUNT(*),
    COUNT(CASE WHEN ban_type = 'scam' THEN 1 END),
    AVG(confidence)
  INTO ban_count, scam_ban_count, avg_confidence
  FROM global_ban_list
  WHERE user_id = p_user_id
  AND is_active = true
  AND (expires_at IS NULL OR expires_at > NOW());

  -- Auto-ban if:
  -- 1. Banned for scam on 2+ servers
  -- 2. Banned on 3+ servers with high confidence
  RETURN (scam_ban_count >= 2) OR
         (ban_count >= 3 AND avg_confidence >= 0.8);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update federation server timestamp on modification
CREATE OR REPLACE FUNCTION update_federation_server_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_federation_server_timestamp
BEFORE UPDATE ON federation_servers
FOR EACH ROW
EXECUTE FUNCTION update_federation_server_timestamp();

-- Update global reputation timestamp
CREATE OR REPLACE FUNCTION update_global_reputation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_updated = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_global_reputation_timestamp
BEFORE UPDATE ON global_reputation
FOR EACH ROW
EXECUTE FUNCTION update_global_reputation_timestamp();

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Add comment metadata
COMMENT ON TABLE federation_servers IS 'Registry of servers participating in BECAS federation';
COMMENT ON TABLE shared_threats IS 'Threat intelligence shared across federation';
COMMENT ON TABLE global_ban_list IS 'Users banned across multiple servers';
COMMENT ON TABLE global_reputation IS 'Cross-server user reputation tracking';
COMMENT ON TABLE server_reputation IS 'Server-specific user reputation scores';
COMMENT ON TABLE federation_events IS 'Federation-wide event log for synchronization';

COMMENT ON FUNCTION get_federated_reputation IS 'Calculate user reputation score across all federated servers';
COMMENT ON FUNCTION get_network_threat_intel IS 'Aggregate threat intelligence across network';
COMMENT ON FUNCTION should_auto_ban_federated IS 'Determine if user should be auto-banned based on cross-server data';

-- Migration complete
SELECT 'Migration 018 (Federation System) completed successfully' as status;
