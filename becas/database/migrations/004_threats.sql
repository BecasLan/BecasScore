-- ==================================================
-- BECAS DATABASE - THREAT INTELLIGENCE
-- Migration 004: Threat Detection & Forensics
-- ==================================================

-- ==================================================
-- TABLE: threats
-- Detected security threats and violations
-- ==================================================
CREATE TABLE IF NOT EXISTS threats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id VARCHAR(20),
    message_id VARCHAR(20),

    -- Threat Classification
    threat_type VARCHAR(50) NOT NULL, -- scam, phishing, spam, harassment, nsfw, malware, etc.
    severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
    confidence DECIMAL(5,2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),

    -- Evidence
    evidence_content TEXT,
    evidence_metadata JSONB DEFAULT '{}'::jsonb,
    detection_method VARCHAR(100), -- ai_analysis, pattern_match, ml_model, user_report, etc.

    -- Indicators
    indicators TEXT[] DEFAULT '{}', -- List of specific threat indicators
    matched_patterns TEXT[] DEFAULT '{}',

    -- Action Taken
    action_taken VARCHAR(50), -- none, warn, timeout, kick, ban, delete_message
    action_timestamp TIMESTAMP WITH TIME ZONE,
    action_successful BOOLEAN,

    -- Learning & Feedback
    was_correct BOOLEAN, -- Was this a true positive?
    moderator_feedback TEXT,
    moderator_id VARCHAR(20),
    feedback_timestamp TIMESTAMP WITH TIME ZONE,

    -- Cross-server Intelligence
    is_global_threat BOOLEAN DEFAULT false,
    reported_to_global BOOLEAN DEFAULT false,

    -- Metadata
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_threats_server ON threats(server_id, detected_at DESC);
CREATE INDEX idx_threats_user ON threats(user_id, detected_at DESC);
CREATE INDEX idx_threats_type ON threats(threat_type, severity, detected_at DESC);
CREATE INDEX idx_threats_severity ON threats(server_id, severity, detected_at DESC);
CREATE INDEX idx_threats_unresolved ON threats(server_id, action_taken) WHERE action_taken IS NULL;
CREATE INDEX idx_threats_false_positives ON threats(server_id, was_correct) WHERE was_correct = false;
CREATE INDEX idx_threats_global ON threats(is_global_threat) WHERE is_global_threat = true;

-- ==================================================
-- TABLE: attachment_analysis
-- Vision AI analysis of images/videos
-- ==================================================
CREATE TABLE IF NOT EXISTS attachment_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id VARCHAR(20) NOT NULL,
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Attachment Details
    attachment_url TEXT NOT NULL,
    attachment_type VARCHAR(50) NOT NULL, -- image, video, file
    file_extension VARCHAR(10),
    file_size_bytes BIGINT,

    -- Image Forensics
    image_hash VARCHAR(64), -- Perceptual hash for duplicate detection
    image_width INTEGER,
    image_height INTEGER,

    -- Vision AI Analysis
    extracted_text TEXT, -- OCR results
    detected_objects TEXT[] DEFAULT '{}',
    scene_description TEXT,

    -- Safety Scores
    nsfw_score DECIMAL(5,2) DEFAULT 0.0 CHECK (nsfw_score BETWEEN 0 AND 100),
    violence_score DECIMAL(5,2) DEFAULT 0.0 CHECK (violence_score BETWEEN 0 AND 100),
    gore_score DECIMAL(5,2) DEFAULT 0.0 CHECK (gore_score BETWEEN 0 AND 100),

    -- Scam Detection
    contains_qr_code BOOLEAN DEFAULT false,
    qr_code_url TEXT,
    contains_fake_screenshot BOOLEAN DEFAULT false,
    scam_indicators TEXT[] DEFAULT '{}',

    -- Brand Detection
    detected_brands TEXT[] DEFAULT '{}',
    impersonation_detected BOOLEAN DEFAULT false,
    impersonated_brand VARCHAR(255),

    -- Action Taken
    flagged_for_review BOOLEAN DEFAULT false,
    action_taken VARCHAR(50),

    -- Metadata
    analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_attachment_analysis_message ON attachment_analysis(message_id);
CREATE INDEX idx_attachment_analysis_server ON attachment_analysis(server_id, analyzed_at DESC);
CREATE INDEX idx_attachment_analysis_user ON attachment_analysis(user_id, analyzed_at DESC);
CREATE INDEX idx_attachment_analysis_hash ON attachment_analysis(image_hash) WHERE image_hash IS NOT NULL;
CREATE INDEX idx_attachment_analysis_nsfw ON attachment_analysis(server_id, nsfw_score DESC) WHERE nsfw_score > 50;
CREATE INDEX idx_attachment_analysis_scam ON attachment_analysis(server_id, scam_indicators) WHERE array_length(scam_indicators, 1) > 0;

-- ==================================================
-- TABLE: cross_server_alerts
-- Global threat intelligence sharing
-- ==================================================
CREATE TABLE IF NOT EXISTS cross_server_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_by_server_id VARCHAR(20) NOT NULL REFERENCES servers(id),

    -- Global Reputation
    global_risk_score INTEGER DEFAULT 50 CHECK (global_risk_score BETWEEN 0 AND 100),
    banned_server_count INTEGER DEFAULT 0,
    total_violations_across_servers INTEGER DEFAULT 0,

    -- Pattern Detection
    is_server_hopping BOOLEAN DEFAULT false, -- Joins, violates, gets banned, repeats
    avg_time_before_violation_hours INTEGER, -- How quickly they violate after joining
    violation_pattern VARCHAR(100), -- consistent_scammer, toxic_user, spam_bot, etc.

    -- Shared Intelligence
    known_scam_phrases TEXT[] DEFAULT '{}',
    associated_account_ids TEXT[] DEFAULT '{}', -- Other Discord accounts linked to this user
    known_alt_accounts TEXT[] DEFAULT '{}',

    -- Threat Level
    alert_level VARCHAR(20) NOT NULL, -- low, medium, high, critical
    recommended_action VARCHAR(50), -- watch, auto_timeout, auto_ban, manual_review

    -- Evidence
    evidence_summary TEXT,
    reporting_servers TEXT[] DEFAULT '{}', -- List of server IDs that reported this user

    -- Metadata
    first_reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_cross_server_alerts_user ON cross_server_alerts(user_id);
CREATE INDEX idx_cross_server_alerts_risk ON cross_server_alerts(global_risk_score DESC);
CREATE INDEX idx_cross_server_alerts_level ON cross_server_alerts(alert_level, last_updated_at DESC);
CREATE INDEX idx_cross_server_alerts_hoppers ON cross_server_alerts(is_server_hopping) WHERE is_server_hopping = true;

-- ==================================================
-- TABLE: moderator_actions
-- Track moderator decisions for AI learning
-- ==================================================
CREATE TABLE IF NOT EXISTS moderator_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    moderator_id VARCHAR(20) NOT NULL REFERENCES users(id),
    target_user_id VARCHAR(20) NOT NULL REFERENCES users(id),

    -- Action Details
    action_type VARCHAR(50) NOT NULL, -- warn, timeout, kick, ban, delete_message, role_change
    reason TEXT,
    duration_seconds INTEGER, -- For timeouts

    -- Context
    message_id VARCHAR(20),
    channel_id VARCHAR(20),
    triggered_by_threat_id UUID REFERENCES threats(id),

    -- BECAS Learning
    was_becas_suggestion BOOLEAN DEFAULT false,
    becas_suggested_action VARCHAR(50),
    becas_confidence DECIMAL(5,2),

    moderator_agreed_with_becas BOOLEAN,
    moderator_feedback TEXT,

    -- Metadata
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_moderator_actions_server ON moderator_actions(server_id, executed_at DESC);
CREATE INDEX idx_moderator_actions_moderator ON moderator_actions(moderator_id, executed_at DESC);
CREATE INDEX idx_moderator_actions_target ON moderator_actions(target_user_id, executed_at DESC);
CREATE INDEX idx_moderator_actions_becas_learning ON moderator_actions(was_becas_suggestion, moderator_agreed_with_becas);
CREATE INDEX idx_moderator_actions_threat ON moderator_actions(triggered_by_threat_id) WHERE triggered_by_threat_id IS NOT NULL;

-- ==================================================
-- TRIGGERS
-- ==================================================
CREATE TRIGGER update_threats_updated_at BEFORE UPDATE ON threats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- VIEWS
-- ==================================================

-- Active threats requiring attention
CREATE OR REPLACE VIEW pending_threats AS
SELECT
    t.id,
    t.server_id,
    t.user_id,
    u.username,
    t.threat_type,
    t.severity,
    t.confidence,
    t.detected_at,
    NOW() - t.detected_at as age
FROM threats t
JOIN users u ON t.user_id = u.id
WHERE t.action_taken IS NULL
  AND t.confidence >= 70
ORDER BY
    CASE t.severity
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
    END,
    t.detected_at DESC;

-- False positive analysis
CREATE OR REPLACE VIEW false_positive_analysis AS
SELECT
    threat_type,
    detection_method,
    COUNT(*) as total_detections,
    COUNT(*) FILTER (WHERE was_correct = false) as false_positives,
    ROUND(100.0 * COUNT(*) FILTER (WHERE was_correct = false) / COUNT(*), 2) as false_positive_rate,
    AVG(confidence) as avg_confidence
FROM threats
WHERE was_correct IS NOT NULL
GROUP BY threat_type, detection_method
ORDER BY false_positive_rate DESC;

-- Global threat scoreboard
CREATE OR REPLACE VIEW global_threat_scoreboard AS
SELECT
    u.id,
    u.username,
    csa.global_risk_score,
    csa.banned_server_count,
    csa.alert_level,
    csa.violation_pattern,
    csa.is_server_hopping,
    array_length(csa.reporting_servers, 1) as reporting_server_count
FROM cross_server_alerts csa
JOIN users u ON csa.user_id = u.id
WHERE csa.alert_level IN ('high', 'critical')
ORDER BY csa.global_risk_score DESC, csa.banned_server_count DESC;

-- ==================================================
-- FUNCTIONS
-- ==================================================

-- Report threat to global intelligence
CREATE OR REPLACE FUNCTION report_global_threat(
    p_user_id VARCHAR(20),
    p_server_id VARCHAR(20),
    p_threat_type VARCHAR(50),
    p_evidence TEXT
)
RETURNS UUID AS $$
DECLARE
    v_alert_id UUID;
    v_existing_alert UUID;
BEGIN
    -- Check if alert already exists
    SELECT id INTO v_existing_alert
    FROM cross_server_alerts
    WHERE user_id = p_user_id;

    IF v_existing_alert IS NOT NULL THEN
        -- Update existing alert
        UPDATE cross_server_alerts
        SET
            banned_server_count = banned_server_count + 1,
            total_violations_across_servers = total_violations_across_servers + 1,
            reporting_servers = array_append(reporting_servers, p_server_id),
            last_updated_at = NOW()
        WHERE id = v_existing_alert;

        RETURN v_existing_alert;
    ELSE
        -- Create new alert
        INSERT INTO cross_server_alerts (
            user_id,
            reported_by_server_id,
            alert_level,
            violation_pattern,
            evidence_summary,
            reporting_servers
        ) VALUES (
            p_user_id,
            p_server_id,
            'medium',
            p_threat_type,
            p_evidence,
            ARRAY[p_server_id]
        )
        RETURNING id INTO v_alert_id;

        RETURN v_alert_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE threats IS 'Detected security threats and violations with AI analysis';
COMMENT ON TABLE attachment_analysis IS 'Vision AI analysis of images and videos for safety';
COMMENT ON TABLE cross_server_alerts IS 'Global threat intelligence sharing across BECAS servers';
COMMENT ON TABLE moderator_actions IS 'Moderator decisions for AI learning and improvement';
