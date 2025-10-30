-- =====================================================
-- PHASE 7: VOICE & REACTION INTELLIGENCE
-- Voice Activity Tracking Database Schema
-- =====================================================

-- =====================================================
-- TABLE: voice_sessions
-- Tracks individual voice channel sessions
-- =====================================================

CREATE TABLE IF NOT EXISTS voice_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) UNIQUE NOT NULL,  -- Unique session identifier
  server_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,

  -- Timestamps
  joined_at TIMESTAMP NOT NULL,
  left_at TIMESTAMP,
  session_duration INTEGER,  -- In seconds (calculated on leave)

  -- Voice state during session
  was_muted BOOLEAN DEFAULT FALSE,
  was_deafened BOOLEAN DEFAULT FALSE,
  was_streaming BOOLEAN DEFAULT FALSE,
  was_video BOOLEAN DEFAULT FALSE,

  -- Session metadata
  disconnect_reason VARCHAR(50),  -- 'user_leave', 'kicked', 'moved', 'disconnect'

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_voice_sessions_server_user ON voice_sessions(server_id, user_id, joined_at DESC);
CREATE INDEX idx_voice_sessions_channel ON voice_sessions(channel_id, joined_at DESC);
CREATE INDEX idx_voice_sessions_time ON voice_sessions(joined_at DESC);
CREATE INDEX idx_voice_sessions_active ON voice_sessions(server_id, left_at) WHERE left_at IS NULL;

-- =====================================================
-- TABLE: voice_participants
-- Tracks co-participants in voice sessions
-- =====================================================

CREATE TABLE IF NOT EXISTS voice_participants (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  participant_id VARCHAR(255) NOT NULL,  -- The other user
  server_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,

  -- Overlap tracking
  overlap_start TIMESTAMP NOT NULL,
  overlap_end TIMESTAMP,
  overlap_duration INTEGER,  -- In seconds

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (session_id) REFERENCES voice_sessions(session_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_voice_participants_user ON voice_participants(user_id, participant_id);
CREATE INDEX idx_voice_participants_session ON voice_participants(session_id);
CREATE INDEX idx_voice_participants_overlap ON voice_participants(overlap_start DESC);

-- =====================================================
-- TABLE: user_voice_patterns
-- Aggregated voice activity patterns per user
-- =====================================================

CREATE TABLE IF NOT EXISTS user_voice_patterns (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,

  -- Activity statistics
  total_sessions INTEGER DEFAULT 0,
  total_voice_time INTEGER DEFAULT 0,  -- In seconds
  avg_session_duration INTEGER DEFAULT 0,
  longest_session_duration INTEGER DEFAULT 0,

  -- Recent activity (last 30 days)
  sessions_last_30d INTEGER DEFAULT 0,
  voice_time_last_30d INTEGER DEFAULT 0,

  -- Favorite channels (JSON array of {channel_id, session_count})
  favorite_channels JSONB DEFAULT '[]'::jsonb,

  -- Voice partners (JSON array of {user_id, sessions_together, total_time})
  frequent_partners JSONB DEFAULT '[]'::jsonb,

  -- Behavioral patterns
  typical_join_hours JSONB DEFAULT '[]'::jsonb,  -- Array of hours (0-23)
  mute_rate DECIMAL(3, 2) DEFAULT 0.00,  -- % of time muted
  streaming_rate DECIMAL(3, 2) DEFAULT 0.00,  -- % of time streaming

  -- Timestamps
  first_voice_session TIMESTAMP,
  last_voice_session TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(server_id, user_id)
);

-- Indexes
CREATE INDEX idx_voice_patterns_server ON user_voice_patterns(server_id);
CREATE INDEX idx_voice_patterns_user ON user_voice_patterns(user_id);
CREATE INDEX idx_voice_patterns_active ON user_voice_patterns(last_voice_session DESC);

-- =====================================================
-- TABLE: voice_channel_analytics
-- Per-channel voice statistics
-- =====================================================

CREATE TABLE IF NOT EXISTS voice_channel_analytics (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,

  -- Activity metrics
  total_sessions INTEGER DEFAULT 0,
  unique_users_count INTEGER DEFAULT 0,
  total_voice_time INTEGER DEFAULT 0,  -- In seconds
  avg_participants DECIMAL(5, 2) DEFAULT 0.00,
  peak_participants INTEGER DEFAULT 0,

  -- Recent activity
  sessions_last_7d INTEGER DEFAULT 0,
  sessions_last_30d INTEGER DEFAULT 0,

  -- Peak times (JSON array of {hour, session_count})
  peak_hours JSONB DEFAULT '[]'::jsonb,

  -- Timestamps
  first_activity TIMESTAMP,
  last_activity TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(server_id, channel_id)
);

-- Indexes
CREATE INDEX idx_voice_channel_analytics_server ON voice_channel_analytics(server_id);
CREATE INDEX idx_voice_channel_analytics_channel ON voice_channel_analytics(channel_id);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to calculate session duration on voice leave
CREATE OR REPLACE FUNCTION calculate_voice_session_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.left_at IS NOT NULL AND OLD.left_at IS NULL THEN
    NEW.session_duration := EXTRACT(EPOCH FROM (NEW.left_at - NEW.joined_at))::INTEGER;
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for session duration
DROP TRIGGER IF EXISTS trigger_calculate_voice_duration ON voice_sessions;
CREATE TRIGGER trigger_calculate_voice_duration
BEFORE UPDATE ON voice_sessions
FOR EACH ROW
EXECUTE FUNCTION calculate_voice_session_duration();

-- Function to update user voice patterns when session ends
CREATE OR REPLACE FUNCTION update_voice_patterns_on_session_end()
RETURNS TRIGGER AS $$
DECLARE
  v_session_duration INTEGER;
BEGIN
  -- Only run when session is completed (left_at is set)
  IF NEW.left_at IS NOT NULL AND OLD.left_at IS NULL THEN
    v_session_duration := NEW.session_duration;

    -- Upsert user voice patterns
    INSERT INTO user_voice_patterns (
      server_id,
      user_id,
      total_sessions,
      total_voice_time,
      avg_session_duration,
      longest_session_duration,
      sessions_last_30d,
      voice_time_last_30d,
      first_voice_session,
      last_voice_session
    ) VALUES (
      NEW.server_id,
      NEW.user_id,
      1,
      v_session_duration,
      v_session_duration,
      v_session_duration,
      1,
      v_session_duration,
      NEW.joined_at,
      NEW.left_at
    )
    ON CONFLICT (server_id, user_id) DO UPDATE SET
      total_sessions = user_voice_patterns.total_sessions + 1,
      total_voice_time = user_voice_patterns.total_voice_time + v_session_duration,
      avg_session_duration = (user_voice_patterns.total_voice_time + v_session_duration) / (user_voice_patterns.total_sessions + 1),
      longest_session_duration = GREATEST(user_voice_patterns.longest_session_duration, v_session_duration),
      last_voice_session = NEW.left_at,
      updated_at = CURRENT_TIMESTAMP;

    -- Update channel analytics
    INSERT INTO voice_channel_analytics (
      server_id,
      channel_id,
      total_sessions,
      total_voice_time,
      first_activity,
      last_activity
    ) VALUES (
      NEW.server_id,
      NEW.channel_id,
      1,
      v_session_duration,
      NEW.joined_at,
      NEW.left_at
    )
    ON CONFLICT (server_id, channel_id) DO UPDATE SET
      total_sessions = voice_channel_analytics.total_sessions + 1,
      total_voice_time = voice_channel_analytics.total_voice_time + v_session_duration,
      last_activity = NEW.left_at,
      updated_at = CURRENT_TIMESTAMP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updating patterns
DROP TRIGGER IF EXISTS trigger_update_voice_patterns ON voice_sessions;
CREATE TRIGGER trigger_update_voice_patterns
AFTER UPDATE ON voice_sessions
FOR EACH ROW
EXECUTE FUNCTION update_voice_patterns_on_session_end();

-- =====================================================
-- HELPER QUERIES
-- =====================================================

-- Get active voice sessions
-- SELECT * FROM voice_sessions WHERE left_at IS NULL;

-- Get user's voice history
-- SELECT * FROM voice_sessions
-- WHERE user_id = 'USER_ID' AND server_id = 'SERVER_ID'
-- ORDER BY joined_at DESC LIMIT 20;

-- Get voice partners for a user
-- SELECT participant_id, COUNT(*) as sessions_together, SUM(overlap_duration) as total_time
-- FROM voice_participants
-- WHERE user_id = 'USER_ID' AND server_id = 'SERVER_ID'
-- GROUP BY participant_id
-- ORDER BY sessions_together DESC LIMIT 10;

-- Get channel activity summary
-- SELECT channel_id, total_sessions, total_voice_time, unique_users_count
-- FROM voice_channel_analytics
-- WHERE server_id = 'SERVER_ID'
-- ORDER BY total_sessions DESC;

-- Get users currently in voice
-- SELECT DISTINCT user_id, channel_id, joined_at
-- FROM voice_sessions
-- WHERE server_id = 'SERVER_ID' AND left_at IS NULL
-- ORDER BY joined_at DESC;

-- =====================================================
-- END OF VOICE TRACKING SCHEMA
-- =====================================================
