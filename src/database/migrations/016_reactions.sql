-- =====================================================
-- PHASE 7: VOICE & REACTION INTELLIGENCE
-- Reaction Tracking Database Schema
-- =====================================================

-- =====================================================
-- TABLE: message_reactions
-- Tracks all reactions on messages
-- =====================================================

CREATE TABLE IF NOT EXISTS message_reactions (
  id SERIAL PRIMARY KEY,
  message_id VARCHAR(255) NOT NULL,
  server_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  author_id VARCHAR(255) NOT NULL,  -- Message author
  reactor_id VARCHAR(255) NOT NULL,  -- Who reacted

  -- Reaction details
  emoji_name VARCHAR(255) NOT NULL,
  emoji_id VARCHAR(255),  -- For custom emojis
  is_custom_emoji BOOLEAN DEFAULT FALSE,

  -- Sentiment (inferred from emoji)
  reaction_sentiment VARCHAR(20),  -- 'positive', 'negative', 'neutral'

  -- Timestamps
  reacted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  removed_at TIMESTAMP,  -- If reaction was removed

  UNIQUE(message_id, reactor_id, emoji_name, emoji_id)
);

-- Indexes for performance
CREATE INDEX idx_reactions_message ON message_reactions(message_id);
CREATE INDEX idx_reactions_author ON message_reactions(author_id, reacted_at DESC);
CREATE INDEX idx_reactions_reactor ON message_reactions(reactor_id, reacted_at DESC);
CREATE INDEX idx_reactions_server ON message_reactions(server_id, reacted_at DESC);
CREATE INDEX idx_reactions_relationship ON message_reactions(author_id, reactor_id);

-- =====================================================
-- TABLE: user_reaction_patterns
-- Aggregated reaction patterns per user
-- =====================================================

CREATE TABLE IF NOT EXISTS user_reaction_patterns (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,

  -- Reactions given
  total_reactions_given INTEGER DEFAULT 0,
  reactions_given_last_30d INTEGER DEFAULT 0,
  favorite_emojis JSONB DEFAULT '[]'::jsonb,  -- [{emoji, count}]

  -- Reactions received
  total_reactions_received INTEGER DEFAULT 0,
  reactions_received_last_30d INTEGER DEFAULT 0,
  popular_emojis_received JSONB DEFAULT '[]'::jsonb,  -- [{emoji, count}]

  -- Sentiment analysis
  positive_reactions_given INTEGER DEFAULT 0,
  negative_reactions_given INTEGER DEFAULT 0,
  positive_reactions_received INTEGER DEFAULT 0,
  negative_reactions_received INTEGER DEFAULT 0,

  -- Most reacted to users (who they react to most)
  most_reacted_to_users JSONB DEFAULT '[]'::jsonb,  -- [{userId, count}]

  -- Most reacted by users (who reacts to them most)
  most_reacted_by_users JSONB DEFAULT '[]'::jsonb,  -- [{userId, count}]

  -- Timestamps
  first_reaction_given TIMESTAMP,
  last_reaction_given TIMESTAMP,
  first_reaction_received TIMESTAMP,
  last_reaction_received TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(server_id, user_id)
);

-- Indexes
CREATE INDEX idx_reaction_patterns_server ON user_reaction_patterns(server_id);
CREATE INDEX idx_reaction_patterns_user ON user_reaction_patterns(user_id);

-- =====================================================
-- TABLE: reaction_relationship_signals
-- Tracks relationship indicators from reactions
-- =====================================================

CREATE TABLE IF NOT EXISTS reaction_relationship_signals (
  id SERIAL PRIMARY KEY,
  server_id VARCHAR(255) NOT NULL,
  user_id_1 VARCHAR(255) NOT NULL,
  user_id_2 VARCHAR(255) NOT NULL,

  -- Reaction statistics
  reactions_1_to_2 INTEGER DEFAULT 0,  -- User 1 reacts to User 2's messages
  reactions_2_to_1 INTEGER DEFAULT 0,  -- User 2 reacts to User 1's messages

  -- Sentiment breakdown
  positive_1_to_2 INTEGER DEFAULT 0,
  negative_1_to_2 INTEGER DEFAULT 0,
  positive_2_to_1 INTEGER DEFAULT 0,
  negative_2_to_1 INTEGER DEFAULT 0,

  -- Reciprocity metrics
  reciprocity_score DECIMAL(3, 2) DEFAULT 0.00,  -- 0-1 (how mutual)
  relationship_strength DECIMAL(5, 2) DEFAULT 0.00,  -- Overall strength

  -- Recent activity (last 30 days)
  reactions_1_to_2_last_30d INTEGER DEFAULT 0,
  reactions_2_to_1_last_30d INTEGER DEFAULT 0,

  -- Timestamps
  first_reaction TIMESTAMP,
  last_reaction TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(server_id, user_id_1, user_id_2)
);

-- Indexes
CREATE INDEX idx_reaction_relationship_server ON reaction_relationship_signals(server_id);
CREATE INDEX idx_reaction_relationship_users ON reaction_relationship_signals(user_id_1, user_id_2);
CREATE INDEX idx_reaction_relationship_strength ON reaction_relationship_signals(relationship_strength DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to infer sentiment from emoji
CREATE OR REPLACE FUNCTION infer_reaction_sentiment(emoji_name VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
  -- Positive emojis
  IF emoji_name IN ('👍', '❤️', '😊', '😄', '🎉', '🔥', '✨', '💯', '👏', '🙌',
                     '😍', '🥰', '😎', '💪', '🏆', '⭐', '💖', '💗', '💕', '💘',
                     'thumbsup', 'heart', 'smile', 'grin', 'tada', 'fire', 'sparkles',
                     'heart_eyes', 'sunglasses', 'muscle', 'trophy', 'star') THEN
    RETURN 'positive';

  -- Negative emojis
  ELSIF emoji_name IN ('👎', '😠', '😡', '💢', '😤', '🤬', '😢', '😭', '💔', '🗑️',
                        '❌', '🚫', '⛔', '🤮', '🤢', '💀', '☠️',
                        'thumbsdown', 'angry', 'rage', 'cry', 'sob', 'broken_heart',
                        'x', 'no_entry', 'skull') THEN
    RETURN 'negative';

  -- Neutral/ambiguous
  ELSE
    RETURN 'neutral';
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update reaction patterns when reaction is added
CREATE OR REPLACE FUNCTION update_reaction_patterns_on_add()
RETURNS TRIGGER AS $$
DECLARE
  v_sentiment VARCHAR;
BEGIN
  v_sentiment := infer_reaction_sentiment(NEW.emoji_name);

  -- Update sentiment in the reaction record
  NEW.reaction_sentiment := v_sentiment;

  -- Update reactor's patterns (reactions given)
  INSERT INTO user_reaction_patterns (
    server_id,
    user_id,
    total_reactions_given,
    reactions_given_last_30d,
    positive_reactions_given,
    negative_reactions_given,
    first_reaction_given,
    last_reaction_given
  ) VALUES (
    NEW.server_id,
    NEW.reactor_id,
    1,
    1,
    CASE WHEN v_sentiment = 'positive' THEN 1 ELSE 0 END,
    CASE WHEN v_sentiment = 'negative' THEN 1 ELSE 0 END,
    NEW.reacted_at,
    NEW.reacted_at
  )
  ON CONFLICT (server_id, user_id) DO UPDATE SET
    total_reactions_given = user_reaction_patterns.total_reactions_given + 1,
    reactions_given_last_30d = user_reaction_patterns.reactions_given_last_30d + 1,
    positive_reactions_given = user_reaction_patterns.positive_reactions_given +
      CASE WHEN v_sentiment = 'positive' THEN 1 ELSE 0 END,
    negative_reactions_given = user_reaction_patterns.negative_reactions_given +
      CASE WHEN v_sentiment = 'negative' THEN 1 ELSE 0 END,
    last_reaction_given = NEW.reacted_at,
    updated_at = CURRENT_TIMESTAMP;

  -- Update author's patterns (reactions received)
  INSERT INTO user_reaction_patterns (
    server_id,
    user_id,
    total_reactions_received,
    reactions_received_last_30d,
    positive_reactions_received,
    negative_reactions_received,
    first_reaction_received,
    last_reaction_received
  ) VALUES (
    NEW.server_id,
    NEW.author_id,
    1,
    1,
    CASE WHEN v_sentiment = 'positive' THEN 1 ELSE 0 END,
    CASE WHEN v_sentiment = 'negative' THEN 1 ELSE 0 END,
    NEW.reacted_at,
    NEW.reacted_at
  )
  ON CONFLICT (server_id, user_id) DO UPDATE SET
    total_reactions_received = user_reaction_patterns.total_reactions_received + 1,
    reactions_received_last_30d = user_reaction_patterns.reactions_received_last_30d + 1,
    positive_reactions_received = user_reaction_patterns.positive_reactions_received +
      CASE WHEN v_sentiment = 'positive' THEN 1 ELSE 0 END,
    negative_reactions_received = user_reaction_patterns.negative_reactions_received +
      CASE WHEN v_sentiment = 'negative' THEN 1 ELSE 0 END,
    last_reaction_received = NEW.reacted_at,
    updated_at = CURRENT_TIMESTAMP;

  -- Update relationship signal (if author != reactor)
  IF NEW.author_id != NEW.reactor_id THEN
    -- Ensure consistent ordering (smaller ID first)
    DECLARE
      v_user_1 VARCHAR := LEAST(NEW.author_id, NEW.reactor_id);
      v_user_2 VARCHAR := GREATEST(NEW.author_id, NEW.reactor_id);
      v_is_1_to_2 BOOLEAN := (NEW.reactor_id = v_user_1);
    BEGIN
      INSERT INTO reaction_relationship_signals (
        server_id,
        user_id_1,
        user_id_2,
        reactions_1_to_2,
        reactions_2_to_1,
        positive_1_to_2,
        negative_1_to_2,
        positive_2_to_1,
        negative_2_to_1,
        reactions_1_to_2_last_30d,
        reactions_2_to_1_last_30d,
        first_reaction,
        last_reaction
      ) VALUES (
        NEW.server_id,
        v_user_1,
        v_user_2,
        CASE WHEN v_is_1_to_2 THEN 1 ELSE 0 END,
        CASE WHEN v_is_1_to_2 THEN 0 ELSE 1 END,
        CASE WHEN v_is_1_to_2 AND v_sentiment = 'positive' THEN 1 ELSE 0 END,
        CASE WHEN v_is_1_to_2 AND v_sentiment = 'negative' THEN 1 ELSE 0 END,
        CASE WHEN NOT v_is_1_to_2 AND v_sentiment = 'positive' THEN 1 ELSE 0 END,
        CASE WHEN NOT v_is_1_to_2 AND v_sentiment = 'negative' THEN 1 ELSE 0 END,
        CASE WHEN v_is_1_to_2 THEN 1 ELSE 0 END,
        CASE WHEN v_is_1_to_2 THEN 0 ELSE 1 END,
        NEW.reacted_at,
        NEW.reacted_at
      )
      ON CONFLICT (server_id, user_id_1, user_id_2) DO UPDATE SET
        reactions_1_to_2 = reaction_relationship_signals.reactions_1_to_2 +
          CASE WHEN v_is_1_to_2 THEN 1 ELSE 0 END,
        reactions_2_to_1 = reaction_relationship_signals.reactions_2_to_1 +
          CASE WHEN v_is_1_to_2 THEN 0 ELSE 1 END,
        positive_1_to_2 = reaction_relationship_signals.positive_1_to_2 +
          CASE WHEN v_is_1_to_2 AND v_sentiment = 'positive' THEN 1 ELSE 0 END,
        negative_1_to_2 = reaction_relationship_signals.negative_1_to_2 +
          CASE WHEN v_is_1_to_2 AND v_sentiment = 'negative' THEN 1 ELSE 0 END,
        positive_2_to_1 = reaction_relationship_signals.positive_2_to_1 +
          CASE WHEN NOT v_is_1_to_2 AND v_sentiment = 'positive' THEN 1 ELSE 0 END,
        negative_2_to_1 = reaction_relationship_signals.negative_2_to_1 +
          CASE WHEN NOT v_is_1_to_2 AND v_sentiment = 'negative' THEN 1 ELSE 0 END,
        reactions_1_to_2_last_30d = reaction_relationship_signals.reactions_1_to_2_last_30d +
          CASE WHEN v_is_1_to_2 THEN 1 ELSE 0 END,
        reactions_2_to_1_last_30d = reaction_relationship_signals.reactions_2_to_1_last_30d +
          CASE WHEN v_is_1_to_2 THEN 0 ELSE 1 END,
        last_reaction = NEW.reacted_at,
        updated_at = CURRENT_TIMESTAMP;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for reaction pattern updates
DROP TRIGGER IF EXISTS trigger_update_reaction_patterns ON message_reactions;
CREATE TRIGGER trigger_update_reaction_patterns
BEFORE INSERT ON message_reactions
FOR EACH ROW
EXECUTE FUNCTION update_reaction_patterns_on_add();

-- Function to calculate reciprocity score
CREATE OR REPLACE FUNCTION calculate_reaction_reciprocity(
  reactions_a_to_b INTEGER,
  reactions_b_to_a INTEGER
) RETURNS DECIMAL AS $$
DECLARE
  total_reactions INTEGER;
  min_reactions INTEGER;
  max_reactions INTEGER;
BEGIN
  total_reactions := reactions_a_to_b + reactions_b_to_a;

  IF total_reactions = 0 THEN
    RETURN 0.00;
  END IF;

  min_reactions := LEAST(reactions_a_to_b, reactions_b_to_a);
  max_reactions := GREATEST(reactions_a_to_b, reactions_b_to_a);

  -- Reciprocity = (2 * min) / (min + max)
  -- Perfect reciprocity (50/50) = 1.0
  -- One-sided (100/0) = 0.0
  RETURN (2.0 * min_reactions / total_reactions::DECIMAL);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate relationship strength from reactions
CREATE OR REPLACE FUNCTION calculate_reaction_relationship_strength(
  positive_1_to_2 INTEGER,
  negative_1_to_2 INTEGER,
  positive_2_to_1 INTEGER,
  negative_2_to_1 INTEGER
) RETURNS DECIMAL AS $$
DECLARE
  total_positive INTEGER;
  total_negative INTEGER;
  total_reactions INTEGER;
  sentiment_score DECIMAL;
  volume_factor DECIMAL;
BEGIN
  total_positive := positive_1_to_2 + positive_2_to_1;
  total_negative := negative_1_to_2 + negative_2_to_1;
  total_reactions := total_positive + total_negative;

  IF total_reactions = 0 THEN
    RETURN 0.00;
  END IF;

  -- Sentiment score: -1 (all negative) to 1 (all positive)
  sentiment_score := (total_positive::DECIMAL - total_negative::DECIMAL) / total_reactions::DECIMAL;

  -- Volume factor: logarithmic scaling (more reactions = stronger)
  volume_factor := LOG(total_reactions + 1) / 5.0;  -- Normalized
  volume_factor := LEAST(volume_factor, 1.0);  -- Cap at 1.0

  -- Relationship strength = sentiment * volume
  -- Range: -5.0 (strong negative) to 5.0 (strong positive)
  RETURN sentiment_score * volume_factor * 5.0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Scheduled job to update relationship metrics
CREATE OR REPLACE FUNCTION update_reaction_relationship_metrics()
RETURNS void AS $$
BEGIN
  UPDATE reaction_relationship_signals
  SET
    reciprocity_score = calculate_reaction_reciprocity(reactions_1_to_2, reactions_2_to_1),
    relationship_strength = calculate_reaction_relationship_strength(
      positive_1_to_2,
      negative_1_to_2,
      positive_2_to_1,
      negative_2_to_1
    ),
    updated_at = CURRENT_TIMESTAMP
  WHERE updated_at < CURRENT_TIMESTAMP - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- HELPER QUERIES
-- =====================================================

-- Get user's reaction patterns
-- SELECT * FROM user_reaction_patterns
-- WHERE server_id = 'SERVER_ID' AND user_id = 'USER_ID';

-- Get relationship signals between two users
-- SELECT * FROM reaction_relationship_signals
-- WHERE server_id = 'SERVER_ID'
-- AND user_id_1 = LEAST('USER_1', 'USER_2')
-- AND user_id_2 = GREATEST('USER_1', 'USER_2');

-- Get users with strongest positive relationships
-- SELECT user_id_1, user_id_2, relationship_strength, reciprocity_score
-- FROM reaction_relationship_signals
-- WHERE server_id = 'SERVER_ID' AND relationship_strength > 2.0
-- ORDER BY relationship_strength DESC
-- LIMIT 20;

-- Get users with negative relationships (potential conflicts)
-- SELECT user_id_1, user_id_2, relationship_strength,
--        negative_1_to_2, negative_2_to_1
-- FROM reaction_relationship_signals
-- WHERE server_id = 'SERVER_ID' AND relationship_strength < -1.0
-- ORDER BY relationship_strength ASC
-- LIMIT 20;

-- Get most popular emojis in server
-- SELECT emoji_name, COUNT(*) as usage_count
-- FROM message_reactions
-- WHERE server_id = 'SERVER_ID'
-- GROUP BY emoji_name
-- ORDER BY usage_count DESC
-- LIMIT 10;

-- =====================================================
-- END OF REACTION TRACKING SCHEMA
-- =====================================================
