-- =====================================================
-- PHASE 9: OPTIMIZATION & SCALING
-- Performance Optimization & Monitoring
-- =====================================================

-- =====================================================
-- ADDITIONAL INDEXES FOR PERFORMANCE
-- =====================================================

-- Messages table optimizations
CREATE INDEX IF NOT EXISTS idx_messages_server_channel_time
ON messages(server_id, channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_user_server_time
ON messages(user_id, server_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_content_search
ON messages USING gin(to_tsvector('english', content));

-- Anomalies optimizations
CREATE INDEX IF NOT EXISTS idx_anomalies_severity
ON anomaly_detections(server_id, severity, detected_at DESC);

-- Voice sessions optimizations
CREATE INDEX IF NOT EXISTS idx_voice_sessions_duration
ON voice_sessions(server_id, session_duration DESC NULLS LAST);

-- Health snapshots optimizations
CREATE INDEX IF NOT EXISTS idx_health_snapshots_score
ON server_health_snapshots(server_id, health_score, snapshot_time DESC);

-- =====================================================
-- MATERIALIZED VIEWS FOR ANALYTICS
-- =====================================================

-- Server statistics materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS server_stats_summary AS
SELECT
  server_id,
  COUNT(DISTINCT user_id) as total_users,
  COUNT(*) as total_messages,
  AVG(toxicity_score) as avg_toxicity,
  MAX(created_at) as last_activity
FROM messages
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY server_id;

CREATE UNIQUE INDEX ON server_stats_summary(server_id);

-- User activity summary
CREATE MATERIALIZED VIEW IF NOT EXISTS user_activity_summary AS
SELECT
  server_id,
  user_id,
  COUNT(*) as message_count,
  COUNT(DISTINCT channel_id) as channels_used,
  AVG(LENGTH(content)) as avg_message_length,
  MAX(created_at) as last_message_at,
  MIN(created_at) as first_message_at
FROM messages
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY server_id, user_id;

CREATE UNIQUE INDEX ON user_activity_summary(server_id, user_id);

-- Refresh materialized views (run hourly via cron)
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY server_stats_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY user_activity_summary;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TABLE: performance_metrics
-- Tracks system performance over time
-- =====================================================

CREATE TABLE IF NOT EXISTS performance_metrics (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_type VARCHAR(50) NOT NULL,  -- 'latency', 'throughput', 'error_rate'
  metric_value DECIMAL(10, 2) NOT NULL,
  server_id VARCHAR(255),
  component VARCHAR(100),  -- 'message_analysis', 'ai_inference', 'database', etc.
  metadata JSONB DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_performance_metrics_name_time
ON performance_metrics(metric_name, recorded_at DESC);

CREATE INDEX idx_performance_metrics_component
ON performance_metrics(component, recorded_at DESC);

CREATE INDEX idx_performance_metrics_server
ON performance_metrics(server_id, recorded_at DESC)
WHERE server_id IS NOT NULL;

-- =====================================================
-- TABLE: query_cache
-- Simple query result caching
-- =====================================================

CREATE TABLE IF NOT EXISTS query_cache (
  cache_key VARCHAR(255) PRIMARY KEY,
  cache_value JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_query_cache_expires
ON query_cache(expires_at);

-- Auto-cleanup expired cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_cache()
RETURNS void AS $$
BEGIN
  DELETE FROM query_cache WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- QUERY OPTIMIZATION FUNCTIONS
-- =====================================================

-- Get cached query result
CREATE OR REPLACE FUNCTION get_cached_query(p_key VARCHAR)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT cache_value INTO v_result
  FROM query_cache
  WHERE cache_key = p_key
  AND expires_at > NOW();

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Set cached query result
CREATE OR REPLACE FUNCTION set_cached_query(
  p_key VARCHAR,
  p_value JSONB,
  p_ttl_seconds INTEGER DEFAULT 300
)
RETURNS void AS $$
BEGIN
  INSERT INTO query_cache (cache_key, cache_value, expires_at)
  VALUES (p_key, p_value, NOW() + (p_ttl_seconds || ' seconds')::INTERVAL)
  ON CONFLICT (cache_key) DO UPDATE SET
    cache_value = EXCLUDED.cache_value,
    expires_at = EXCLUDED.expires_at,
    created_at = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- OPTIMIZED QUERY FUNCTIONS
-- =====================================================

-- Get server health with caching
CREATE OR REPLACE FUNCTION get_server_health_cached(p_server_id VARCHAR)
RETURNS JSONB AS $$
DECLARE
  v_cache_key VARCHAR := 'health_' || p_server_id;
  v_cached JSONB;
  v_result JSONB;
BEGIN
  -- Try cache first
  v_cached := get_cached_query(v_cache_key);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  -- Query fresh data
  SELECT jsonb_build_object(
    'health_score', health_score,
    'health_status', health_status,
    'messages_count', messages_count,
    'toxicity_rate', toxicity_rate,
    'avg_sentiment', avg_sentiment,
    'snapshot_time', snapshot_time
  ) INTO v_result
  FROM server_health_snapshots
  WHERE server_id = p_server_id
  ORDER BY snapshot_time DESC
  LIMIT 1;

  -- Cache for 1 minute
  PERFORM set_cached_query(v_cache_key, v_result, 60);

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PERFORMANCE MONITORING FUNCTIONS
-- =====================================================

-- Log performance metric
CREATE OR REPLACE FUNCTION log_performance_metric(
  p_metric_name VARCHAR,
  p_metric_type VARCHAR,
  p_metric_value DECIMAL,
  p_server_id VARCHAR DEFAULT NULL,
  p_component VARCHAR DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void AS $$
BEGIN
  INSERT INTO performance_metrics
  (metric_name, metric_type, metric_value, server_id, component, metadata)
  VALUES (p_metric_name, p_metric_type, p_metric_value, p_server_id, p_component, p_metadata);
END;
$$ LANGUAGE plpgsql;

-- Get average latency for component
CREATE OR REPLACE FUNCTION get_avg_latency(
  p_component VARCHAR,
  p_hours INTEGER DEFAULT 24
)
RETURNS DECIMAL AS $$
DECLARE
  v_avg DECIMAL;
BEGIN
  SELECT AVG(metric_value) INTO v_avg
  FROM performance_metrics
  WHERE component = p_component
  AND metric_type = 'latency'
  AND recorded_at >= NOW() - (p_hours || ' hours')::INTERVAL;

  RETURN COALESCE(v_avg, 0);
END;
$$ LANGUAGE plpgsql;

-- Get performance degradation alerts
CREATE OR REPLACE FUNCTION get_performance_alerts(p_hours INTEGER DEFAULT 1)
RETURNS TABLE(
  component VARCHAR,
  metric_name VARCHAR,
  current_avg DECIMAL,
  baseline_avg DECIMAL,
  degradation_pct DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH current_metrics AS (
    SELECT
      pm.component,
      pm.metric_name,
      AVG(pm.metric_value) as avg_value
    FROM performance_metrics pm
    WHERE pm.recorded_at >= NOW() - (p_hours || ' hours')::INTERVAL
    AND pm.metric_type = 'latency'
    GROUP BY pm.component, pm.metric_name
  ),
  baseline_metrics AS (
    SELECT
      pm.component,
      pm.metric_name,
      AVG(pm.metric_value) as avg_value
    FROM performance_metrics pm
    WHERE pm.recorded_at >= NOW() - INTERVAL '7 days'
    AND pm.recorded_at < NOW() - INTERVAL '1 day'
    AND pm.metric_type = 'latency'
    GROUP BY pm.component, pm.metric_name
  )
  SELECT
    cm.component,
    cm.metric_name,
    cm.avg_value as current_avg,
    bm.avg_value as baseline_avg,
    ((cm.avg_value - bm.avg_value) / bm.avg_value * 100) as degradation_pct
  FROM current_metrics cm
  JOIN baseline_metrics bm
    ON cm.component = bm.component
    AND cm.metric_name = bm.metric_name
  WHERE cm.avg_value > bm.avg_value * 1.5  -- 50% degradation
  ORDER BY degradation_pct DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- DATA PARTITIONING (For large tables)
-- =====================================================

-- Partition messages table by month (for very large servers)
-- Note: This requires table recreation, run manually if needed
/*
CREATE TABLE messages_partitioned (
  LIKE messages INCLUDING ALL
) PARTITION BY RANGE (created_at);

CREATE TABLE messages_2025_01 PARTITION OF messages_partitioned
FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE messages_2025_02 PARTITION OF messages_partitioned
FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Create future partitions as needed
*/

-- =====================================================
-- CLEANUP & MAINTENANCE
-- =====================================================

-- Archive old messages (keep 1 year)
CREATE OR REPLACE FUNCTION archive_old_messages()
RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM messages
  WHERE created_at < NOW() - INTERVAL '1 year';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- Vacuum and analyze tables
CREATE OR REPLACE FUNCTION optimize_tables()
RETURNS void AS $$
BEGIN
  VACUUM ANALYZE messages;
  VACUUM ANALYZE user_relationships;
  VACUUM ANALYZE anomaly_detections;
  VACUUM ANALYZE server_health_snapshots;
  VACUUM ANALYZE threats;
  VACUUM ANALYZE user_actions;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- HELPER QUERIES
-- =====================================================

-- Check index usage
-- SELECT
--   schemaname,
--   tablename,
--   indexname,
--   idx_scan,
--   idx_tup_read,
--   idx_tup_fetch
-- FROM pg_stat_user_indexes
-- WHERE schemaname = 'public'
-- ORDER BY idx_scan ASC;

-- Find slow queries
-- SELECT
--   query,
--   mean_exec_time,
--   calls,
--   total_exec_time
-- FROM pg_stat_statements
-- ORDER BY mean_exec_time DESC
-- LIMIT 20;

-- Table sizes
-- SELECT
--   schemaname,
--   tablename,
--   pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- =====================================================
-- END OF PERFORMANCE OPTIMIZATION
-- =====================================================
