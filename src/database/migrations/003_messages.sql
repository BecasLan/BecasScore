-- ==================================================
-- BECAS DATABASE - MESSAGES & CONVERSATIONS
-- Migration 003: Message Intelligence & Thread Tracking
-- ==================================================

-- ==================================================
-- TABLE: messages
-- Enhanced message storage with AI analysis
-- ==================================================
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(20), -- Discord message ID
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id VARCHAR(20) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Content
    content TEXT NOT NULL,
    content_length INTEGER DEFAULT 0,

    -- Message Type
    type VARCHAR(50) DEFAULT 'default', -- default, reply, thread_starter, etc.
    is_edited BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMP WITH TIME ZONE,

    -- Thread Context
    reply_to_message_id VARCHAR(20),
    thread_id VARCHAR(20),
    conversation_thread_id UUID, -- Link to conversation_threads table

    -- Mentions
    mentioned_user_ids TEXT[] DEFAULT '{}',
    mentioned_role_ids TEXT[] DEFAULT '{}',
    mentioned_everyone BOOLEAN DEFAULT false,

    -- Attachments
    has_attachments BOOLEAN DEFAULT false,
    attachment_count INTEGER DEFAULT 0,
    attachment_types TEXT[] DEFAULT '{}', -- image, video, file, etc.

    -- Links
    has_links BOOLEAN DEFAULT false,
    link_count INTEGER DEFAULT 0,
    extracted_links TEXT[] DEFAULT '{}',

    -- AI Analysis
    intent VARCHAR(100),
    sentiment VARCHAR(20), -- positive, negative, neutral, mixed
    emotions TEXT[] DEFAULT '{}', -- happy, angry, sad, excited, etc.

    toxicity_score DECIMAL(5,2) DEFAULT 0.0 CHECK (toxicity_score BETWEEN 0 AND 100),
    scam_score DECIMAL(5,2) DEFAULT 0.0 CHECK (scam_score BETWEEN 0 AND 100),
    spam_score DECIMAL(5,2) DEFAULT 0.0 CHECK (spam_score BETWEEN 0 AND 100),
    harassment_score DECIMAL(5,2) DEFAULT 0.0 CHECK (harassment_score BETWEEN 0 AND 100),

    -- AI Summary
    ai_summary TEXT, -- Short summary for long messages
    detected_topics TEXT[] DEFAULT '{}',
    language_detected VARCHAR(10) DEFAULT 'en',

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    edited_at TIMESTAMP WITH TIME ZONE,
    analyzed_at TIMESTAMP WITH TIME ZONE,

    -- Full-text search
    content_tsv tsvector,

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create partitions for 2025 (monthly)
CREATE TABLE messages_2025_01 PARTITION OF messages
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE messages_2025_02 PARTITION OF messages
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE messages_2025_03 PARTITION OF messages
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE messages_2025_04 PARTITION OF messages
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE messages_2025_05 PARTITION OF messages
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE messages_2025_06 PARTITION OF messages
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE messages_2025_07 PARTITION OF messages
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE messages_2025_08 PARTITION OF messages
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE messages_2025_09 PARTITION OF messages
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE messages_2025_10 PARTITION OF messages
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE messages_2025_11 PARTITION OF messages
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE messages_2025_12 PARTITION OF messages
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Indexes on partitioned table
CREATE INDEX idx_messages_server ON messages(server_id, created_at DESC);
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_user ON messages(user_id, created_at DESC);
CREATE INDEX idx_messages_thread ON messages(conversation_thread_id, created_at);
CREATE INDEX idx_messages_reply ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX idx_messages_toxicity ON messages(server_id, toxicity_score DESC) WHERE toxicity_score > 30;
CREATE INDEX idx_messages_scam ON messages(server_id, scam_score DESC) WHERE scam_score > 50;
CREATE INDEX idx_messages_deleted ON messages(server_id, deleted_at DESC) WHERE is_deleted = true;

-- Full-text search index
CREATE INDEX idx_messages_fts ON messages USING GIN(content_tsv);

-- Trigger to update tsvector for full-text search
CREATE OR REPLACE FUNCTION messages_tsvector_trigger() RETURNS trigger AS $$
BEGIN
    NEW.content_tsv := to_tsvector('english', COALESCE(NEW.content, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tsvector_update BEFORE INSERT OR UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION messages_tsvector_trigger();

-- ==================================================
-- TABLE: conversation_threads
-- Track conversation threads and their outcomes
-- ==================================================
CREATE TABLE IF NOT EXISTS conversation_threads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id VARCHAR(20) NOT NULL REFERENCES channels(id) ON DELETE CASCADE,

    -- Thread Details
    initiator_user_id VARCHAR(20) NOT NULL REFERENCES users(id),
    participant_user_ids TEXT[] DEFAULT '{}',
    participant_count INTEGER DEFAULT 0,

    -- Analysis
    topic VARCHAR(255),
    detected_topics TEXT[] DEFAULT '{}',
    sentiment_flow JSONB DEFAULT '[]'::jsonb, -- Array of {timestamp, sentiment, user_id}

    -- Conflict Detection
    conflict_detected BOOLEAN DEFAULT false,
    conflict_severity VARCHAR(20), -- low, medium, high
    conflict_participants TEXT[] DEFAULT '{}',

    -- Outcomes
    ended_in_violation BOOLEAN DEFAULT false,
    violation_type VARCHAR(50),
    moderator_intervened BOOLEAN DEFAULT false,
    moderator_id VARCHAR(20),

    -- Statistics
    total_messages INTEGER DEFAULT 0,
    avg_toxicity DECIMAL(5,2) DEFAULT 0.0,
    peak_toxicity DECIMAL(5,2) DEFAULT 0.0,
    duration_seconds INTEGER DEFAULT 0,

    -- Metadata
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversation_threads_server ON conversation_threads(server_id, started_at DESC);
CREATE INDEX idx_conversation_threads_channel ON conversation_threads(channel_id, started_at DESC);
CREATE INDEX idx_conversation_threads_conflict ON conversation_threads(server_id, conflict_detected) WHERE conflict_detected = true;
CREATE INDEX idx_conversation_threads_violations ON conversation_threads(server_id, ended_in_violation) WHERE ended_in_violation = true;
CREATE INDEX idx_conversation_threads_active ON conversation_threads(server_id, started_at DESC) WHERE ended_at IS NULL;

-- ==================================================
-- TABLE: message_reactions
-- Track reactions for sentiment analysis
-- ==================================================
CREATE TABLE IF NOT EXISTS message_reactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id VARCHAR(20) NOT NULL,
    user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id VARCHAR(20) NOT NULL REFERENCES servers(id) ON DELETE CASCADE,

    -- Reaction Details
    emoji VARCHAR(255) NOT NULL,
    is_custom_emoji BOOLEAN DEFAULT false,
    emoji_id VARCHAR(20),

    -- Sentiment
    reaction_sentiment VARCHAR(20), -- positive, negative, neutral

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_user ON message_reactions(user_id, created_at DESC);
CREATE INDEX idx_reactions_server ON message_reactions(server_id, created_at DESC);

-- ==================================================
-- TRIGGERS
-- ==================================================
CREATE TRIGGER update_conversation_threads_updated_at BEFORE UPDATE ON conversation_threads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- VIEWS
-- ==================================================

-- Active toxic conversations
CREATE OR REPLACE VIEW active_toxic_conversations AS
SELECT
    ct.id,
    ct.server_id,
    ct.channel_id,
    ct.topic,
    ct.conflict_severity,
    ct.total_messages,
    ct.avg_toxicity,
    ct.started_at,
    NOW() - ct.started_at as duration
FROM conversation_threads ct
WHERE ct.ended_at IS NULL
  AND (ct.conflict_detected = true OR ct.avg_toxicity > 50)
ORDER BY ct.avg_toxicity DESC, ct.started_at DESC;

-- Message search helper
CREATE OR REPLACE FUNCTION search_messages(
    p_server_id VARCHAR(20),
    p_search_query TEXT,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    message_id VARCHAR(20),
    user_id VARCHAR(20),
    username VARCHAR(255),
    content TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.user_id,
        u.username,
        m.content,
        m.created_at,
        ts_rank(m.content_tsv, plainto_tsquery('english', p_search_query)) as relevance
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.server_id = p_server_id
      AND m.content_tsv @@ plainto_tsquery('english', p_search_query)
    ORDER BY relevance DESC, m.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE messages IS 'Enhanced message storage with AI analysis and full-text search';
COMMENT ON TABLE conversation_threads IS 'Conversation thread tracking and conflict detection';
COMMENT ON TABLE message_reactions IS 'Message reaction tracking for sentiment analysis';
