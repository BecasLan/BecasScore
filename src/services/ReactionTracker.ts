import { Client, MessageReaction, PartialMessageReaction, User, PartialUser } from 'discord.js';
import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * ReactionTracker
 *
 * Tracks reaction activity across Discord servers:
 * - Message reactions added/removed
 * - Reaction patterns per user
 * - Relationship signals from reactions
 * - Emoji preferences and sentiment
 *
 * Integrates with social graph and conflict prediction.
 */

export interface ReactionRecord {
  messageId: string;
  serverId: string;
  channelId: string;
  authorId: string;
  reactorId: string;
  emojiName: string;
  emojiId?: string;
  isCustomEmoji: boolean;
  reactionSentiment: 'positive' | 'negative' | 'neutral';
  reactedAt: Date;
  removedAt?: Date;
}

export interface ReactionPattern {
  serverId: string;
  userId: string;
  totalReactionsGiven: number;
  reactionsGivenLast30d: number;
  favoriteEmojis: Array<{ emoji: string; count: number }>;
  totalReactionsReceived: number;
  reactionsReceivedLast30d: number;
  popularEmojisReceived: Array<{ emoji: string; count: number }>;
  positiveReactionsGiven: number;
  negativeReactionsGiven: number;
  positiveReactionsReceived: number;
  negativeReactionsReceived: number;
  mostReactedToUsers: Array<{ userId: string; count: number }>;
  mostReactedByUsers: Array<{ userId: string; count: number }>;
}

export interface RelationshipSignal {
  serverId: string;
  userId1: string;
  userId2: string;
  reactions1to2: number;
  reactions2to1: number;
  positive1to2: number;
  negative1to2: number;
  positive2to1: number;
  negative2to1: number;
  reciprocityScore: number;
  relationshipStrength: number;
  firstReaction: Date;
  lastReaction: Date;
}

export class ReactionTracker {
  constructor(
    private client: Client,
    private db: Pool
  ) {}

  /**
   * Initialize reaction tracking
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Reaction Tracker...');

      // Set up event listeners
      this.setupEventListeners();

      logger.info('✓ Reaction Tracker initialized');
    } catch (error) {
      logger.error('Failed to initialize Reaction Tracker:', error);
      throw error;
    }
  }

  /**
   * Set up Discord reaction event listeners
   */
  private setupEventListeners(): void {
    // Reaction added
    this.client.on('messageReactionAdd', async (
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser
    ) => {
      try {
        // Fetch partial data if needed
        if (reaction.partial) {
          await reaction.fetch();
        }
        if (user.partial) {
          await user.fetch();
        }

        await this.handleReactionAdd(reaction as MessageReaction, user as User);
      } catch (error) {
        logger.error('Error handling reaction add:', error);
      }
    });

    // Reaction removed
    this.client.on('messageReactionRemove', async (
      reaction: MessageReaction | PartialMessageReaction,
      user: User | PartialUser
    ) => {
      try {
        // Fetch partial data if needed
        if (reaction.partial) {
          await reaction.fetch();
        }
        if (user.partial) {
          await user.fetch();
        }

        await this.handleReactionRemove(reaction as MessageReaction, user as User);
      } catch (error) {
        logger.error('Error handling reaction remove:', error);
      }
    });
  }

  /**
   * Handle reaction added to message
   */
  private async handleReactionAdd(reaction: MessageReaction, user: User): Promise<void> {
    // Ignore bot reactions
    if (user.bot) return;

    const message = reaction.message;
    const messageId = message.id;
    const serverId = message.guildId;
    const channelId = message.channelId;
    const authorId = message.author?.id;
    const reactorId = user.id;

    if (!serverId || !authorId) return;

    // Get emoji info
    const emoji = reaction.emoji;
    const emojiName = emoji.name || 'unknown';
    const emojiId = emoji.id || undefined;
    const isCustomEmoji = !!emoji.id;

    try {
      const query = `
        INSERT INTO message_reactions
        (message_id, server_id, channel_id, author_id, reactor_id, emoji_name, emoji_id, is_custom_emoji, reacted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (message_id, reactor_id, emoji_name, emoji_id) DO NOTHING
      `;

      await this.db.query(query, [
        messageId,
        serverId,
        channelId,
        authorId,
        reactorId,
        emojiName,
        emojiId,
        isCustomEmoji,
        new Date()
      ]);

      logger.debug(`Reaction added: ${reactorId} reacted ${emojiName} to ${authorId}'s message`);
    } catch (error) {
      logger.error('Error logging reaction add:', error);
    }
  }

  /**
   * Handle reaction removed from message
   */
  private async handleReactionRemove(reaction: MessageReaction, user: User): Promise<void> {
    // Ignore bot reactions
    if (user.bot) return;

    const messageId = reaction.message.id;
    const reactorId = user.id;
    const emojiName = reaction.emoji.name || 'unknown';
    const emojiId = reaction.emoji.id || undefined;

    try {
      const query = `
        UPDATE message_reactions
        SET removed_at = $1
        WHERE message_id = $2
        AND reactor_id = $3
        AND emoji_name = $4
        AND (emoji_id = $5 OR (emoji_id IS NULL AND $5 IS NULL))
        AND removed_at IS NULL
      `;

      await this.db.query(query, [
        new Date(),
        messageId,
        reactorId,
        emojiName,
        emojiId
      ]);

      logger.debug(`Reaction removed: ${reactorId} removed ${emojiName}`);
    } catch (error) {
      logger.error('Error logging reaction remove:', error);
    }
  }

  /**
   * Get reaction pattern for a user
   */
  async getUserReactionPattern(serverId: string, userId: string): Promise<ReactionPattern | null> {
    try {
      const query = `
        SELECT * FROM user_reaction_patterns
        WHERE server_id = $1 AND user_id = $2
      `;

      const result = await this.db.query(query, [serverId, userId]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        serverId: row.server_id,
        userId: row.user_id,
        totalReactionsGiven: row.total_reactions_given,
        reactionsGivenLast30d: row.reactions_given_last_30d,
        favoriteEmojis: row.favorite_emojis || [],
        totalReactionsReceived: row.total_reactions_received,
        reactionsReceivedLast30d: row.reactions_received_last_30d,
        popularEmojisReceived: row.popular_emojis_received || [],
        positiveReactionsGiven: row.positive_reactions_given,
        negativeReactionsGiven: row.negative_reactions_given,
        positiveReactionsReceived: row.positive_reactions_received,
        negativeReactionsReceived: row.negative_reactions_received,
        mostReactedToUsers: row.most_reacted_to_users || [],
        mostReactedByUsers: row.most_reacted_by_users || []
      };
    } catch (error) {
      logger.error('Error getting user reaction pattern:', error);
      return null;
    }
  }

  /**
   * Get relationship signal between two users
   */
  async getRelationshipSignal(
    serverId: string,
    userId1: string,
    userId2: string
  ): Promise<RelationshipSignal | null> {
    try {
      // Ensure consistent ordering
      const [user1, user2] = userId1 < userId2 ? [userId1, userId2] : [userId2, userId1];

      const query = `
        SELECT * FROM reaction_relationship_signals
        WHERE server_id = $1 AND user_id_1 = $2 AND user_id_2 = $3
      `;

      const result = await this.db.query(query, [serverId, user1, user2]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        serverId: row.server_id,
        userId1: row.user_id_1,
        userId2: row.user_id_2,
        reactions1to2: row.reactions_1_to_2,
        reactions2to1: row.reactions_2_to_1,
        positive1to2: row.positive_1_to_2,
        negative1to2: row.negative_1_to_2,
        positive2to1: row.positive_2_to_1,
        negative2to1: row.negative_2_to_1,
        reciprocityScore: parseFloat(row.reciprocity_score),
        relationshipStrength: parseFloat(row.relationship_strength),
        firstReaction: new Date(row.first_reaction),
        lastReaction: new Date(row.last_reaction)
      };
    } catch (error) {
      logger.error('Error getting relationship signal:', error);
      return null;
    }
  }

  /**
   * Get strongest relationships in server (by reaction strength)
   */
  async getStrongestRelationships(serverId: string, limit: number = 20): Promise<RelationshipSignal[]> {
    try {
      const query = `
        SELECT * FROM reaction_relationship_signals
        WHERE server_id = $1 AND relationship_strength > 2.0
        ORDER BY relationship_strength DESC
        LIMIT $2
      `;

      const result = await this.db.query(query, [serverId, limit]);

      return result.rows.map(row => ({
        serverId: row.server_id,
        userId1: row.user_id_1,
        userId2: row.user_id_2,
        reactions1to2: row.reactions_1_to_2,
        reactions2to1: row.reactions_2_to_1,
        positive1to2: row.positive_1_to_2,
        negative1to2: row.negative_1_to_2,
        positive2to1: row.positive_2_to_1,
        negative2to1: row.negative_2_to_1,
        reciprocityScore: parseFloat(row.reciprocity_score),
        relationshipStrength: parseFloat(row.relationship_strength),
        firstReaction: new Date(row.first_reaction),
        lastReaction: new Date(row.last_reaction)
      }));
    } catch (error) {
      logger.error('Error getting strongest relationships:', error);
      return [];
    }
  }

  /**
   * Get negative relationships (potential conflicts)
   */
  async getNegativeRelationships(serverId: string, limit: number = 20): Promise<RelationshipSignal[]> {
    try {
      const query = `
        SELECT * FROM reaction_relationship_signals
        WHERE server_id = $1 AND relationship_strength < -1.0
        ORDER BY relationship_strength ASC
        LIMIT $2
      `;

      const result = await this.db.query(query, [serverId, limit]);

      return result.rows.map(row => ({
        serverId: row.server_id,
        userId1: row.user_id_1,
        userId2: row.user_id_2,
        reactions1to2: row.reactions_1_to_2,
        reactions2to1: row.reactions_2_to_1,
        positive1to2: row.positive_1_to_2,
        negative1to2: row.negative_1_to_2,
        positive2to1: row.positive_2_to_1,
        negative2to1: row.negative_2_to_1,
        reciprocityScore: parseFloat(row.reciprocity_score),
        relationshipStrength: parseFloat(row.relationship_strength),
        firstReaction: new Date(row.first_reaction),
        lastReaction: new Date(row.last_reaction)
      }));
    } catch (error) {
      logger.error('Error getting negative relationships:', error);
      return [];
    }
  }

  /**
   * Get most popular emojis in server
   */
  async getPopularEmojis(serverId: string, limit: number = 10): Promise<Array<{
    emoji: string;
    usageCount: number;
    sentiment: string;
  }>> {
    try {
      const query = `
        SELECT
          emoji_name as emoji,
          COUNT(*) as usage_count,
          reaction_sentiment as sentiment
        FROM message_reactions
        WHERE server_id = $1 AND removed_at IS NULL
        GROUP BY emoji_name, reaction_sentiment
        ORDER BY usage_count DESC
        LIMIT $2
      `;

      const result = await this.db.query(query, [serverId, limit]);

      return result.rows.map(row => ({
        emoji: row.emoji,
        usageCount: parseInt(row.usage_count),
        sentiment: row.sentiment
      }));
    } catch (error) {
      logger.error('Error getting popular emojis:', error);
      return [];
    }
  }

  /**
   * Get user's favorite emojis
   */
  async getUserFavoriteEmojis(serverId: string, userId: string, limit: number = 10): Promise<Array<{
    emoji: string;
    count: number;
  }>> {
    try {
      const query = `
        SELECT emoji_name as emoji, COUNT(*) as count
        FROM message_reactions
        WHERE server_id = $1 AND reactor_id = $2 AND removed_at IS NULL
        GROUP BY emoji_name
        ORDER BY count DESC
        LIMIT $3
      `;

      const result = await this.db.query(query, [serverId, userId, limit]);

      return result.rows.map(row => ({
        emoji: row.emoji,
        count: parseInt(row.count)
      }));
    } catch (error) {
      logger.error('Error getting user favorite emojis:', error);
      return [];
    }
  }

  /**
   * Get users who react to this user the most
   */
  async getMostReactiveUsers(serverId: string, userId: string, limit: number = 10): Promise<Array<{
    userId: string;
    reactionCount: number;
  }>> {
    try {
      const query = `
        SELECT reactor_id as user_id, COUNT(*) as reaction_count
        FROM message_reactions
        WHERE server_id = $1 AND author_id = $2 AND removed_at IS NULL
        GROUP BY reactor_id
        ORDER BY reaction_count DESC
        LIMIT $3
      `;

      const result = await this.db.query(query, [serverId, userId, limit]);

      return result.rows.map(row => ({
        userId: row.user_id,
        reactionCount: parseInt(row.reaction_count)
      }));
    } catch (error) {
      logger.error('Error getting most reactive users:', error);
      return [];
    }
  }

  /**
   * Update reaction pattern analytics (run periodically)
   */
  async updateReactionPatternAnalytics(serverId: string, userId: string): Promise<void> {
    try {
      // Get favorite emojis
      const favoriteEmojis = await this.getUserFavoriteEmojis(serverId, userId, 5);

      // Get popular emojis received
      const popularReceivedQuery = `
        SELECT emoji_name as emoji, COUNT(*) as count
        FROM message_reactions
        WHERE server_id = $1 AND author_id = $2 AND removed_at IS NULL
        GROUP BY emoji_name
        ORDER BY count DESC
        LIMIT 5
      `;
      const popularReceivedResult = await this.db.query(popularReceivedQuery, [serverId, userId]);
      const popularEmojisReceived = popularReceivedResult.rows.map(row => ({
        emoji: row.emoji,
        count: parseInt(row.count)
      }));

      // Get most reacted to users
      const mostReactedToQuery = `
        SELECT author_id as user_id, COUNT(*) as count
        FROM message_reactions
        WHERE server_id = $1 AND reactor_id = $2 AND removed_at IS NULL
        GROUP BY author_id
        ORDER BY count DESC
        LIMIT 5
      `;
      const mostReactedToResult = await this.db.query(mostReactedToQuery, [serverId, userId]);
      const mostReactedToUsers = mostReactedToResult.rows.map(row => ({
        userId: row.user_id,
        count: parseInt(row.count)
      }));

      // Get most reacted by users
      const mostReactedBy = await this.getMostReactiveUsers(serverId, userId, 5);

      // Update patterns
      const updateQuery = `
        UPDATE user_reaction_patterns
        SET
          favorite_emojis = $1,
          popular_emojis_received = $2,
          most_reacted_to_users = $3,
          most_reacted_by_users = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE server_id = $5 AND user_id = $6
      `;

      await this.db.query(updateQuery, [
        JSON.stringify(favoriteEmojis),
        JSON.stringify(popularEmojisReceived),
        JSON.stringify(mostReactedToUsers),
        JSON.stringify(mostReactedBy),
        serverId,
        userId
      ]);

      logger.debug(`Updated reaction patterns for user ${userId}`);
    } catch (error) {
      logger.error('Error updating reaction pattern analytics:', error);
    }
  }

  /**
   * Update relationship metrics (run periodically via cron)
   */
  async updateRelationshipMetrics(): Promise<void> {
    try {
      await this.db.query('SELECT update_reaction_relationship_metrics()');
      logger.debug('Updated reaction relationship metrics');
    } catch (error) {
      logger.error('Error updating relationship metrics:', error);
    }
  }
}

/**
 * Example usage:
 *
 * const reactionTracker = new ReactionTracker(discordClient, db);
 * await reactionTracker.initialize();
 *
 * // Get user's reaction pattern
 * const pattern = await reactionTracker.getUserReactionPattern(serverId, userId);
 * console.log(`Total reactions given: ${pattern.totalReactionsGiven}`);
 *
 * // Get relationship signal between two users
 * const signal = await reactionTracker.getRelationshipSignal(serverId, user1, user2);
 * console.log(`Relationship strength: ${signal.relationshipStrength}`);
 *
 * // Get strongest relationships in server
 * const strongest = await reactionTracker.getStrongestRelationships(serverId);
 * console.log('Friend groups:', strongest);
 *
 * // Get negative relationships (potential conflicts)
 * const negative = await reactionTracker.getNegativeRelationships(serverId);
 * console.log('Potential conflicts:', negative);
 */
