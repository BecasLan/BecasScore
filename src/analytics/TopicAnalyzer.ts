import { Pool } from 'pg';
import logger from '../utils/logger';

/**
 * TopicAnalyzer
 *
 * Analyzes conversation topics and identifies trending subjects.
 * Extracts keywords, tracks frequency, and calculates trend scores.
 *
 * Features:
 * - Automatic topic extraction from messages
 * - Trend score calculation (velocity + volume)
 * - Topic categorization
 * - Rising/declining trend detection
 * - Weekly topic aggregation
 */

export interface Topic {
  topic: string;
  category?: string;
  mentionCount: number;
  uniqueUsersCount: number;
  sentimentAvg: number;
  firstMentionedAt: Date;
  lastMentionedAt: Date;
  peakHour?: Date;
  peakMentionsPerHour: number;
  trendScore: number;
  trendStatus: 'rising' | 'trending' | 'declining' | 'dead';
}

export interface TrendingSummary {
  serverId: string;
  period: { start: Date; end: Date };
  topTopics: Topic[];
  risingTopics: Topic[];
  decliningTopics: Topic[];
  categories: Array<{ category: string; topicCount: number }>;
}

export class TopicAnalyzer {
  // Common stop words to ignore
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
    'just', 'like', 'get', 'got', 'so', 'then', 'than', 'there', 'here'
  ]);

  constructor(private db: Pool) {}

  /**
   * Analyze topics in recent messages
   */
  async analyzeRecentTopics(
    serverId: string,
    hours: number = 24
  ): Promise<Topic[]> {
    try {
      logger.info(`Analyzing topics for server ${serverId} (last ${hours}h)...`);

      // Get recent messages
      const messagesQuery = `
        SELECT
          content,
          author_id,
          created_at
        FROM messages
        WHERE server_id = $1
        AND created_at >= NOW() - INTERVAL '1 hour' * $2
        AND LENGTH(content) > 10
        ORDER BY created_at DESC
        LIMIT 1000
      `;

      const messagesResult = await this.db.query(messagesQuery, [serverId, hours]);

      if (messagesResult.rows.length === 0) {
        return [];
      }

      // Extract topics from messages
      const topicMap = new Map<string, {
        mentions: number;
        users: Set<string>;
        sentiments: number[];
        timestamps: Date[];
      }>();

      for (const row of messagesResult.rows) {
        const topics = this.extractTopics(row.content);

        for (const topic of topics) {
          if (!topicMap.has(topic)) {
            topicMap.set(topic, {
              mentions: 0,
              users: new Set(),
              sentiments: [],
              timestamps: []
            });
          }

          const data = topicMap.get(topic)!;
          data.mentions++;
          data.users.add(row.author_id);
          data.sentiments.push(this.estimateSentiment(row.content));
          data.timestamps.push(new Date(row.created_at));
        }
      }

      // Convert to Topic objects
      const topics: Topic[] = [];

      for (const [topicText, data] of topicMap.entries()) {
        if (data.mentions < 3) continue; // Minimum 3 mentions

        const timestamps = data.timestamps.sort((a, b) => a.getTime() - b.getTime());
        const trendScore = this.calculateTrendScore(data.mentions, timestamps);

        topics.push({
          topic: topicText,
          category: this.categorizeTopic(topicText),
          mentionCount: data.mentions,
          uniqueUsersCount: data.users.size,
          sentimentAvg: data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length,
          firstMentionedAt: timestamps[0],
          lastMentionedAt: timestamps[timestamps.length - 1],
          peakMentionsPerHour: this.calculatePeakMentions(timestamps),
          trendScore,
          trendStatus: this.getTrendStatus(trendScore, data.mentions)
        });
      }

      // Sort by trend score
      topics.sort((a, b) => b.trendScore - a.trendScore);

      // Store topics in database
      for (const topic of topics) {
        await this.storeTopic(serverId, topic);
      }

      logger.info(`✓ Analyzed ${topics.length} topics`);
      return topics;

    } catch (error) {
      logger.error('Error analyzing topics:', error);
      return [];
    }
  }

  /**
   * Extract topics from message content
   */
  private extractTopics(content: string): string[] {
    // Convert to lowercase and remove special characters
    const cleaned = content.toLowerCase().replace(/[^\w\s]/g, ' ');

    // Split into words
    const words = cleaned.split(/\s+/).filter(w => w.length > 3);

    // Filter stop words
    const meaningful = words.filter(w => !this.stopWords.has(w));

    // Extract 2-word phrases (bigrams) for better context
    const topics: Set<string> = new Set();

    // Add single words
    for (const word of meaningful) {
      topics.add(word);
    }

    // Add bigrams
    for (let i = 0; i < meaningful.length - 1; i++) {
      const bigram = `${meaningful[i]} ${meaningful[i + 1]}`;
      topics.add(bigram);
    }

    return Array.from(topics).slice(0, 10); // Max 10 topics per message
  }

  /**
   * Estimate sentiment from content (simple keyword matching)
   */
  private estimateSentiment(content: string): number {
    const positive = ['good', 'great', 'awesome', 'love', 'best', 'amazing', 'perfect', 'thanks', 'happy'];
    const negative = ['bad', 'worst', 'hate', 'terrible', 'awful', 'poor', 'sad', 'angry', 'stupid'];

    const lower = content.toLowerCase();
    let score = 0;

    for (const word of positive) {
      if (lower.includes(word)) score += 0.5;
    }

    for (const word of negative) {
      if (lower.includes(word)) score -= 0.5;
    }

    return Math.max(-1, Math.min(1, score));
  }

  /**
   * Categorize topic based on keywords
   */
  private categorizeTopic(topic: string): string {
    const categories: Record<string, string[]> = {
      gaming: ['game', 'play', 'fps', 'rpg', 'steam', 'console', 'xbox', 'playstation'],
      tech: ['code', 'programming', 'software', 'hardware', 'computer', 'tech', 'app', 'website'],
      entertainment: ['movie', 'show', 'series', 'music', 'song', 'album', 'artist', 'netflix'],
      politics: ['election', 'government', 'president', 'politics', 'vote', 'law', 'policy'],
      sports: ['football', 'basketball', 'soccer', 'baseball', 'sports', 'team', 'player'],
      food: ['food', 'recipe', 'cooking', 'restaurant', 'eat', 'meal', 'dish'],
      anime: ['anime', 'manga', 'episode', 'character', 'season'],
      crypto: ['crypto', 'bitcoin', 'ethereum', 'nft', 'blockchain', 'token'],
      memes: ['meme', 'funny', 'lol', 'lmao', 'joke']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      for (const keyword of keywords) {
        if (topic.includes(keyword)) {
          return category;
        }
      }
    }

    return 'general';
  }

  /**
   * Calculate trend score (velocity + volume)
   */
  private calculateTrendScore(mentions: number, timestamps: Date[]): number {
    if (timestamps.length < 2) return 0;

    // Calculate velocity (mentions per hour)
    const firstTimestamp = timestamps[0].getTime();
    const lastTimestamp = timestamps[timestamps.length - 1].getTime();
    const hoursSpan = (lastTimestamp - firstTimestamp) / (1000 * 60 * 60);

    const velocity = hoursSpan > 0 ? mentions / hoursSpan : mentions;

    // Calculate acceleration (are mentions increasing?)
    const midpoint = Math.floor(timestamps.length / 2);
    const firstHalfCount = midpoint;
    const secondHalfCount = timestamps.length - midpoint;

    const acceleration = secondHalfCount > firstHalfCount ? 1.5 : 1.0;

    // Trend score = velocity * acceleration * volume_factor
    const volumeFactor = Math.log10(mentions + 1);
    const trendScore = velocity * acceleration * volumeFactor;

    return trendScore;
  }

  /**
   * Calculate peak mentions per hour
   */
  private calculatePeakMentions(timestamps: Date[]): number {
    // Group by hour
    const hourCounts = new Map<string, number>();

    for (const timestamp of timestamps) {
      const hourKey = `${timestamp.getFullYear()}-${timestamp.getMonth()}-${timestamp.getDate()}-${timestamp.getHours()}`;
      hourCounts.set(hourKey, (hourCounts.get(hourKey) || 0) + 1);
    }

    return Math.max(...Array.from(hourCounts.values()), 0);
  }

  /**
   * Get trend status based on score and mentions
   */
  private getTrendStatus(trendScore: number, mentions: number): 'rising' | 'trending' | 'declining' | 'dead' {
    if (trendScore > 10) return 'trending';
    if (trendScore > 5) return 'rising';
    if (trendScore > 1) return 'rising';
    return 'declining';
  }

  /**
   * Store topic in database
   */
  private async storeTopic(serverId: string, topic: Topic): Promise<void> {
    try {
      const query = `
        INSERT INTO topic_trends
        (server_id, topic, topic_category, mention_count, unique_users_count, sentiment_avg,
         first_mentioned_at, last_mentioned_at, peak_mentions_per_hour, trend_score, trend_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (server_id, topic, first_mentioned_at)
        DO UPDATE SET
          mention_count = EXCLUDED.mention_count,
          unique_users_count = EXCLUDED.unique_users_count,
          sentiment_avg = EXCLUDED.sentiment_avg,
          last_mentioned_at = EXCLUDED.last_mentioned_at,
          peak_mentions_per_hour = EXCLUDED.peak_mentions_per_hour,
          trend_score = EXCLUDED.trend_score,
          trend_status = EXCLUDED.trend_status,
          updated_at = CURRENT_TIMESTAMP
      `;

      await this.db.query(query, [
        serverId,
        topic.topic,
        topic.category,
        topic.mentionCount,
        topic.uniqueUsersCount,
        topic.sentimentAvg,
        topic.firstMentionedAt,
        topic.lastMentionedAt,
        topic.peakMentionsPerHour,
        topic.trendScore,
        topic.trendStatus
      ]);

    } catch (error) {
      logger.error('Error storing topic:', error);
    }
  }

  /**
   * Get trending topics for server
   */
  async getTrendingTopics(
    serverId: string,
    limit: number = 10
  ): Promise<Topic[]> {
    try {
      const query = `
        SELECT *
        FROM topic_trends
        WHERE server_id = $1
        AND trend_status IN ('trending', 'rising')
        AND last_mentioned_at >= NOW() - INTERVAL '7 days'
        ORDER BY trend_score DESC
        LIMIT $2
      `;

      const result = await this.db.query(query, [serverId, limit]);

      return result.rows.map(row => ({
        topic: row.topic,
        category: row.topic_category,
        mentionCount: row.mention_count,
        uniqueUsersCount: row.unique_users_count,
        sentimentAvg: parseFloat(row.sentiment_avg),
        firstMentionedAt: new Date(row.first_mentioned_at),
        lastMentionedAt: new Date(row.last_mentioned_at),
        peakMentionsPerHour: row.peak_mentions_per_hour,
        trendScore: parseFloat(row.trend_score),
        trendStatus: row.trend_status
      }));

    } catch (error) {
      logger.error('Error getting trending topics:', error);
      return [];
    }
  }

  /**
   * Get trending summary for period
   */
  async getTrendingSummary(
    serverId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<TrendingSummary> {
    try {
      const query = `
        SELECT
          topic,
          topic_category,
          SUM(mention_count) as total_mentions,
          MAX(unique_users_count) as max_users,
          AVG(sentiment_avg) as avg_sentiment,
          MAX(trend_score) as max_trend_score,
          MAX(trend_status) as trend_status
        FROM topic_trends
        WHERE server_id = $1
        AND last_mentioned_at >= $2
        AND last_mentioned_at <= $3
        GROUP BY topic, topic_category
        ORDER BY total_mentions DESC
      `;

      const result = await this.db.query(query, [serverId, periodStart, periodEnd]);

      const allTopics = result.rows.map(row => ({
        topic: row.topic,
        category: row.topic_category,
        mentionCount: parseInt(row.total_mentions),
        uniqueUsersCount: parseInt(row.max_users),
        sentimentAvg: parseFloat(row.avg_sentiment),
        firstMentionedAt: periodStart,
        lastMentionedAt: periodEnd,
        peakMentionsPerHour: 0,
        trendScore: parseFloat(row.max_trend_score),
        trendStatus: row.trend_status
      }));

      // Categorize
      const topTopics = allTopics.slice(0, 10);
      const risingTopics = allTopics.filter(t => t.trendStatus === 'rising').slice(0, 5);
      const decliningTopics = allTopics.filter(t => t.trendStatus === 'declining').slice(0, 5);

      // Category breakdown
      const categoryCount = new Map<string, number>();
      for (const topic of allTopics) {
        const category = topic.category || 'general';
        categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
      }

      const categories = Array.from(categoryCount.entries())
        .map(([category, topicCount]) => ({ category, topicCount }))
        .sort((a, b) => b.topicCount - a.topicCount);

      return {
        serverId,
        period: { start: periodStart, end: periodEnd },
        topTopics,
        risingTopics,
        decliningTopics,
        categories
      };

    } catch (error) {
      logger.error('Error getting trending summary:', error);
      return {
        serverId,
        period: { start: periodStart, end: periodEnd },
        topTopics: [],
        risingTopics: [],
        decliningTopics: [],
        categories: []
      };
    }
  }
}

/**
 * Example usage:
 *
 * const analyzer = new TopicAnalyzer(db);
 *
 * // Analyze recent topics (run hourly via cron)
 * const topics = await analyzer.analyzeRecentTopics(serverId, 24);
 * console.log('Trending:', topics.slice(0, 5));
 *
 * // Get trending topics
 * const trending = await analyzer.getTrendingTopics(serverId, 10);
 *
 * // Get summary for report
 * const summary = await analyzer.getTrendingSummary(
 *   serverId,
 *   new Date('2025-01-20'),
 *   new Date('2025-01-27')
 * );
 *
 * console.log('Top Topics:', summary.topTopics);
 * console.log('Rising:', summary.risingTopics);
 * console.log('Categories:', summary.categories);
 */
