-- =====================================================
-- PHASE 6: ADVANCED ANALYTICS & PREDICTION
-- Database Schema for Analytics Systems
-- =====================================================

-- 1. ANOMALY DETECTIONS TABLE
-- Stores detected anomalies for audit and analysis
CREATE TABLE IF NOT EXISTS anomaly_detections (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL, -- activity_spike, time_anomaly, behavior_change, link_spam_spike, account_compromise, coordinated_attack
  severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
  confidence DECIMAL(3,2) NOT NULL, -- 0.00 - 1.00
  description TEXT NOT NULL,
  affected_users TEXT[] DEFAULT '{}',
  affected_channels TEXT[] DEFAULT '{}',
  baseline_value DECIMAL(10,2),
  current_value DECIMAL(10,2),
  deviation DECIMAL(10,2),
  recommended_action TEXT,
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(255)
);

CREATE INDEX idx_anomaly_server_time ON anomaly_detections(server_id, detected_at DESC);
CREATE INDEX idx_anomaly_severity ON anomaly_detections(severity) WHERE NOT resolved;
CREATE INDEX idx_anomaly_type ON anomaly_detections(type);

-- 2. SERVER HEALTH SNAPSHOTS TABLE
-- Hourly snapshots of server health metrics
CREATE TABLE IF NOT EXISTS server_health_snapshots (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  snapshot_time TIMESTAMP NOT NULL,

  -- Activity metrics
  active_users_count INTEGER DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  messages_per_hour DECIMAL(10,2) DEFAULT 0,

  -- Sentiment metrics
  avg_sentiment DECIMAL(3,2) DEFAULT 0, -- -1.00 to 1.00
  sentiment_trend VARCHAR(20), -- improving, stable, declining

  -- Toxicity metrics
  toxicity_rate DECIMAL(5,4) DEFAULT 0, -- 0.0000 to 1.0000
  toxic_messages_count INTEGER DEFAULT 0,

  -- Moderation metrics
  moderation_actions_count INTEGER DEFAULT 0,
  warnings_count INTEGER DEFAULT 0,
  timeouts_count INTEGER DEFAULT 0,
  kicks_count INTEGER DEFAULT 0,
  bans_count INTEGER DEFAULT 0,

  -- Engagement metrics
  avg_message_length DECIMAL(10,2) DEFAULT 0,
  links_shared_count INTEGER DEFAULT 0,
  reactions_count INTEGER DEFAULT 0,

  -- Trends (vs previous snapshot)
  messages_change_percent DECIMAL(5,2), -- % change vs previous hour
  toxicity_change_percent DECIMAL(5,2),
  sentiment_change_percent DECIMAL(5,2),

  -- Health score (0-100)
  health_score INTEGER DEFAULT 100,
  health_status VARCHAR(20) DEFAULT 'healthy', -- healthy, warning, critical

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_server_time ON server_health_snapshots(server_id, snapshot_time DESC);
CREATE INDEX idx_health_status ON server_health_snapshots(health_status);

-- 3. CONFLICT PREDICTIONS TABLE
-- Stores predicted conflicts between users
CREATE TABLE IF NOT EXISTS conflict_predictions (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  user_a VARCHAR(255) NOT NULL,
  user_b VARCHAR(255) NOT NULL,
  conflict_probability DECIMAL(3,2) NOT NULL, -- 0.00 - 1.00
  risk_level VARCHAR(20) NOT NULL, -- low, medium, high, critical

  -- Contributing factors
  past_conflicts_count INTEGER DEFAULT 0,
  last_conflict_date TIMESTAMP,
  negative_interactions_count INTEGER DEFAULT 0,
  relationship_score DECIMAL(3,2) DEFAULT 0, -- -1.00 to 1.00

  -- Context
  both_active_in_channels TEXT[],
  recent_interaction_count INTEGER DEFAULT 0,

  -- Prediction
  predicted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP, -- Prediction validity window

  -- Outcome
  occurred BOOLEAN DEFAULT NULL, -- null = pending, true = conflict happened, false = avoided
  occurred_at TIMESTAMP,
  intervention_taken BOOLEAN DEFAULT false,
  intervention_type VARCHAR(50),

  -- Feedback
  prediction_accurate BOOLEAN DEFAULT NULL,
  moderator_notes TEXT
);

CREATE INDEX idx_conflict_server_users ON conflict_predictions(server_id, user_a, user_b);
CREATE INDEX idx_conflict_risk ON conflict_predictions(risk_level) WHERE occurred IS NULL;
CREATE INDEX idx_conflict_prediction_time ON conflict_predictions(predicted_at DESC);

-- 4. TOPIC TRENDS TABLE
-- Tracks trending topics in conversations
CREATE TABLE IF NOT EXISTS topic_trends (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  topic_category VARCHAR(100), -- general, gaming, tech, politics, etc.

  -- Metrics
  mention_count INTEGER DEFAULT 1,
  unique_users_count INTEGER DEFAULT 1,
  sentiment_avg DECIMAL(3,2) DEFAULT 0,

  -- Trend data
  first_mentioned_at TIMESTAMP NOT NULL,
  last_mentioned_at TIMESTAMP NOT NULL,
  peak_hour TIMESTAMP,
  peak_mentions_per_hour INTEGER DEFAULT 0,

  -- Trend status
  trend_score DECIMAL(10,2) DEFAULT 0, -- Calculated trending score
  trend_status VARCHAR(20) DEFAULT 'rising', -- rising, trending, declining, dead

  -- Weekly aggregation
  week_start DATE,
  week_mentions INTEGER DEFAULT 0,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_topic_server_trend ON topic_trends(server_id, trend_score DESC);
CREATE INDEX idx_topic_status ON topic_trends(trend_status);
CREATE INDEX idx_topic_week ON topic_trends(server_id, week_start);

-- 5. ALERT HISTORY TABLE
-- Logs all alerts sent to moderators
CREATE TABLE IF NOT EXISTS alert_history (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  alert_type VARCHAR(50) NOT NULL, -- anomaly, conflict, health, trend, behavior
  severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,

  -- Alert data
  related_anomaly_id INTEGER REFERENCES anomaly_detections(id),
  related_conflict_id INTEGER REFERENCES conflict_predictions(id),
  related_users TEXT[],
  related_channels TEXT[],

  -- Delivery
  sent_to_channel VARCHAR(255),
  sent_to_users TEXT[],
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Response
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by VARCHAR(255),
  acknowledged_at TIMESTAMP,
  action_taken BOOLEAN DEFAULT false,
  action_type VARCHAR(100),
  action_notes TEXT
);

CREATE INDEX idx_alert_server_time ON alert_history(server_id, sent_at DESC);
CREATE INDEX idx_alert_severity ON alert_history(severity) WHERE NOT acknowledged;
CREATE INDEX idx_alert_type ON alert_history(alert_type);

-- 6. ANALYTICS REPORTS TABLE
-- Stores generated reports (weekly, monthly, custom)
CREATE TABLE IF NOT EXISTS analytics_reports (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  report_type VARCHAR(50) NOT NULL, -- weekly, monthly, custom, incident
  report_period_start TIMESTAMP NOT NULL,
  report_period_end TIMESTAMP NOT NULL,

  -- Report content
  title VARCHAR(255) NOT NULL,
  summary TEXT,
  key_metrics JSONB, -- JSON object with key metrics
  insights JSONB, -- AI-generated insights
  recommendations JSONB, -- AI-generated recommendations

  -- Report data
  health_trend VARCHAR(20), -- improving, stable, declining
  anomalies_count INTEGER DEFAULT 0,
  conflicts_count INTEGER DEFAULT 0,
  top_topics TEXT[],

  -- Generation
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by VARCHAR(50) DEFAULT 'AI', -- AI or user_id
  generation_time_ms INTEGER,

  -- Delivery
  sent_to_channel VARCHAR(255),
  sent_at TIMESTAMP
);

CREATE INDEX idx_report_server_type ON analytics_reports(server_id, report_type);
CREATE INDEX idx_report_period ON analytics_reports(report_period_start DESC);

-- =====================================================
-- FUNCTIONS FOR ANALYTICS
-- =====================================================

-- Function: Calculate server health score
CREATE OR REPLACE FUNCTION calculate_server_health_score(
  p_server_id VARCHAR(255),
  p_snapshot_time TIMESTAMP
) RETURNS INTEGER AS $$
DECLARE
  v_health_score INTEGER := 100;
  v_toxicity_rate DECIMAL(5,4);
  v_moderation_rate DECIMAL(5,4);
  v_sentiment_avg DECIMAL(3,2);
BEGIN
  -- Get current metrics
  SELECT
    toxicity_rate,
    CASE WHEN messages_count > 0
      THEN moderation_actions_count::DECIMAL / messages_count
      ELSE 0
    END as moderation_rate,
    avg_sentiment
  INTO v_toxicity_rate, v_moderation_rate, v_sentiment_avg
  FROM server_health_snapshots
  WHERE server_id = p_server_id
  AND snapshot_time = p_snapshot_time;

  -- Deduct points for toxicity (up to -50)
  IF v_toxicity_rate > 0.5 THEN
    v_health_score := v_health_score - 50;
  ELSIF v_toxicity_rate > 0.3 THEN
    v_health_score := v_health_score - 30;
  ELSIF v_toxicity_rate > 0.15 THEN
    v_health_score := v_health_score - 15;
  END IF;

  -- Deduct points for high moderation rate (up to -30)
  IF v_moderation_rate > 0.2 THEN
    v_health_score := v_health_score - 30;
  ELSIF v_moderation_rate > 0.1 THEN
    v_health_score := v_health_score - 15;
  END IF;

  -- Deduct points for negative sentiment (up to -20)
  IF v_sentiment_avg < -0.5 THEN
    v_health_score := v_health_score - 20;
  ELSIF v_sentiment_avg < -0.2 THEN
    v_health_score := v_health_score - 10;
  END IF;

  -- Ensure score is in valid range
  v_health_score := GREATEST(0, LEAST(100, v_health_score));

  RETURN v_health_score;
END;
$$ LANGUAGE plpgsql;

-- Function: Get server analytics summary
CREATE OR REPLACE FUNCTION get_server_analytics_summary(
  p_server_id VARCHAR(255),
  p_days INTEGER DEFAULT 7
) RETURNS TABLE(
  total_messages INTEGER,
  total_active_users INTEGER,
  avg_toxicity_rate DECIMAL(5,4),
  avg_sentiment DECIMAL(3,2),
  total_moderation_actions INTEGER,
  anomalies_count INTEGER,
  conflicts_predicted INTEGER,
  avg_health_score INTEGER,
  health_trend VARCHAR(20)
) AS $$
BEGIN
  RETURN QUERY
  WITH recent_snapshots AS (
    SELECT *
    FROM server_health_snapshots
    WHERE server_id = p_server_id
    AND snapshot_time >= NOW() - INTERVAL '1 day' * p_days
  ),
  first_half AS (
    SELECT AVG(health_score) as avg_health
    FROM recent_snapshots
    WHERE snapshot_time < (NOW() - INTERVAL '1 day' * (p_days / 2))
  ),
  second_half AS (
    SELECT AVG(health_score) as avg_health
    FROM recent_snapshots
    WHERE snapshot_time >= (NOW() - INTERVAL '1 day' * (p_days / 2))
  )
  SELECT
    SUM(rs.messages_count)::INTEGER as total_messages,
    MAX(rs.active_users_count)::INTEGER as total_active_users,
    AVG(rs.toxicity_rate)::DECIMAL(5,4) as avg_toxicity_rate,
    AVG(rs.avg_sentiment)::DECIMAL(3,2) as avg_sentiment,
    SUM(rs.moderation_actions_count)::INTEGER as total_moderation_actions,
    (SELECT COUNT(*)::INTEGER FROM anomaly_detections
     WHERE server_id = p_server_id
     AND detected_at >= NOW() - INTERVAL '1 day' * p_days) as anomalies_count,
    (SELECT COUNT(*)::INTEGER FROM conflict_predictions
     WHERE server_id = p_server_id
     AND predicted_at >= NOW() - INTERVAL '1 day' * p_days) as conflicts_predicted,
    AVG(rs.health_score)::INTEGER as avg_health_score,
    CASE
      WHEN (SELECT avg_health FROM second_half) > (SELECT avg_health FROM first_half) + 5
        THEN 'improving'
      WHEN (SELECT avg_health FROM second_half) < (SELECT avg_health FROM first_half) - 5
        THEN 'declining'
      ELSE 'stable'
    END as health_trend
  FROM recent_snapshots rs;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Auto-calculate health score on insert
CREATE OR REPLACE FUNCTION trigger_calculate_health_score()
RETURNS TRIGGER AS $$
BEGIN
  NEW.health_score := calculate_server_health_score(NEW.server_id, NEW.snapshot_time);

  -- Set health status based on score
  NEW.health_status := CASE
    WHEN NEW.health_score >= 80 THEN 'healthy'
    WHEN NEW.health_score >= 60 THEN 'warning'
    ELSE 'critical'
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_health_score_trigger
BEFORE INSERT ON server_health_snapshots
FOR EACH ROW
EXECUTE FUNCTION trigger_calculate_health_score();

-- =====================================================
-- SAMPLE DATA (for testing)
-- =====================================================

-- Sample anomaly
-- INSERT INTO anomaly_detections (server_id, type, severity, confidence, description, affected_users, baseline_value, current_value, deviation, recommended_action)
-- VALUES ('test-server-1', 'activity_spike', 'high', 0.85, 'Unusual activity spike: 150 messages vs 25 average', ARRAY['user1', 'user2'], 25, 150, 5.0, 'Investigate possible raid');

-- Sample health snapshot
-- INSERT INTO server_health_snapshots (server_id, snapshot_time, active_users_count, messages_count, avg_sentiment, toxicity_rate, moderation_actions_count)
-- VALUES ('test-server-1', NOW(), 50, 125, 0.65, 0.08, 2);

COMMENT ON TABLE anomaly_detections IS 'Phase 6: Stores detected behavioral anomalies for proactive moderation';
COMMENT ON TABLE server_health_snapshots IS 'Phase 6: Hourly server health metrics for trend analysis';
COMMENT ON TABLE conflict_predictions IS 'Phase 6: Predicted conflicts between users for proactive intervention';
COMMENT ON TABLE topic_trends IS 'Phase 6: Trending topics in server conversations';
COMMENT ON TABLE alert_history IS 'Phase 6: History of alerts sent to moderators';
COMMENT ON TABLE analytics_reports IS 'Phase 6: Generated analytics reports';
