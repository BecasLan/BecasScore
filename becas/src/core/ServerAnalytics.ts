import { Guild, TextChannel, GuildMember, Message } from 'discord.js';
import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';
import { UserProfileBadgeSystem, UserProfile } from './UserProfileBadges';

const logger = createLogger('ServerAnalytics');

/**
 * SERVER ANALYTICS SYSTEM
 *
 * AI-powered analytics engine that can answer questions about:
 * - User behavior and history
 * - Channel activity and conflicts
 * - Server statistics and trends
 * - Trust score distribution
 * - Badge-based filtering and ranking
 *
 * Examples:
 * - "Becas, analyze user @someone"
 * - "Becas, show me the most toxic users"
 * - "Becas, which channels have the most conflict?"
 * - "Becas, who are the most helpful members?"
 */

// ==========================================
// INTERFACES
// ==========================================

export interface AnalyticsQuery {
  type: 'user' | 'channel' | 'server' | 'badge' | 'ranking';
  target?: string; // User ID, channel ID, badge name
  filter?: {
    badgeType?: 'positive' | 'negative' | 'neutral';
    trustScoreMin?: number;
    trustScoreMax?: number;
    limit?: number;
  };
}

export interface AnalyticsResult {
  query: AnalyticsQuery;
  data: any;
  summary: string;
  insights: string[];
  timestamp: Date;
}

// ==========================================
// SERVER ANALYTICS SYSTEM
// ==========================================

export class ServerAnalytics {
  private badgeSystem: UserProfileBadgeSystem;
  private llm: OllamaService;
  private channelStats: Map<string, any> = new Map();
  private serverStats: Map<string, any> = new Map();

  constructor(badgeSystem: UserProfileBadgeSystem, llm: OllamaService) {
    this.badgeSystem = badgeSystem;
    this.llm = llm;
    logger.info('ServerAnalytics initialized');
  }

  /**
   * Process natural language analytics query
   */
  async processQuery(
    query: string,
    guild: Guild,
    trustEngine: any,
    memory: any
  ): Promise<AnalyticsResult> {
    logger.info(`📊 Processing analytics query: "${query}"`);

    // Parse query intent
    const intent = await this.parseQueryIntent(query);

    logger.info(`🎯 Query intent: ${intent.type} (target: ${intent.target || 'none'})`);

    // Route to appropriate handler
    switch (intent.type) {
      case 'user':
        return await this.analyzeUser(intent, guild, trustEngine, memory);

      case 'channel':
        return await this.analyzeChannel(intent, guild, memory);

      case 'server':
        return await this.analyzeServer(intent, guild, trustEngine);

      case 'badge':
        return await this.analyzeBadges(intent, guild);

      case 'ranking':
        return await this.generateRanking(intent, guild, trustEngine);

      default:
        return {
          query: intent,
          data: {},
          summary: 'Unable to understand query',
          insights: [],
          timestamp: new Date(),
        };
    }
  }

  /**
   * Parse natural language query into structured intent
   */
  private async parseQueryIntent(query: string): Promise<AnalyticsQuery> {
    const queryLower = query.toLowerCase();

    // Simple pattern matching (can be enhanced with LLM)
    if (queryLower.includes('analyze user') || queryLower.includes('user ') || queryLower.includes('@')) {
      // Extract user mention
      const mentionMatch = query.match(/<@!?(\d+)>/);
      return {
        type: 'user',
        target: mentionMatch ? mentionMatch[1] : undefined,
      };
    }

    if (queryLower.includes('channel') || queryLower.includes('#')) {
      const channelMatch = query.match(/<#(\d+)>/);
      return {
        type: 'channel',
        target: channelMatch ? channelMatch[1] : undefined,
      };
    }

    if (queryLower.includes('badge') || queryLower.includes('users with') || queryLower.includes('filter')) {
      // Extract badge name
      const badgeMatch = query.match(/(toxic|helpful|profanity|respectful|scammer|trusted)/i);
      return {
        type: 'badge',
        target: badgeMatch ? badgeMatch[1] : undefined,
      };
    }

    if (queryLower.includes('most') || queryLower.includes('top') || queryLower.includes('rank')) {
      return {
        type: 'ranking',
        filter: {
          limit: 10,
        },
      };
    }

    // Default to server stats
    return { type: 'server' };
  }

  /**
   * Analyze specific user
   */
  private async analyzeUser(
    query: AnalyticsQuery,
    guild: Guild,
    trustEngine: any,
    memory: any
  ): Promise<AnalyticsResult> {
    if (!query.target) {
      return {
        query,
        data: {},
        summary: 'No user specified',
        insights: [],
        timestamp: new Date(),
      };
    }

    const userId = query.target;

    // Get trust data
    const trustScore = trustEngine.getTrustScore(userId, guild.id);

    // Get user profile with badges
    let profile = this.badgeSystem.getProfile(userId, guild.id);

    // If no profile exists, create one
    if (!profile) {
      const badgeAnalysis = await this.badgeSystem.analyzeAndAssignBadges(
        userId,
        guild.id,
        trustScore.history,
        [], // Would pass message history from memory
        trustScore.score
      );

      profile = this.badgeSystem.getProfile(userId, guild.id);
    }

    // Get member info
    let member: GuildMember | undefined;
    try {
      member = await guild.members.fetch(userId);
    } catch (error) {
      // Member not found
    }

    // Build comprehensive user report
    const data = {
      userId,
      username: member?.user.username || 'Unknown',
      trustScore: trustScore.score,
      trustLevel: trustScore.level,
      badges: profile?.badges || [],
      summary: profile?.summary || 'No analysis available',
      history: trustScore.history.slice(-10), // Last 10 events
      joinedAt: member?.joinedAt,
      roles: member?.roles.cache.map(r => r.name).filter(n => n !== '@everyone'),
    };

    // Generate AI insights
    const insights = await this.generateUserInsights(data);

    return {
      query,
      data,
      summary: `User Analysis: ${data.username}`,
      insights,
      timestamp: new Date(),
    };
  }

  /**
   * Generate AI insights about user
   */
  private async generateUserInsights(data: any): Promise<string[]> {
    const insights: string[] = [];

    // Trust-based insights
    if (data.trustScore >= 80) {
      insights.push(`✅ Highly trusted member (${data.trustScore}/100)`);
    } else if (data.trustScore <= 30) {
      insights.push(`⚠️ Low trust score (${data.trustScore}/100) - potential risk`);
    }

    // Badge insights
    const positiveBadges = data.badges.filter((b: any) => b.type === 'positive');
    const negativeBadges = data.badges.filter((b: any) => b.type === 'negative');

    if (positiveBadges.length > negativeBadges.length) {
      insights.push(`👍 Mostly positive behavior (${positiveBadges.length} positive badges)`);
    } else if (negativeBadges.length > 0) {
      insights.push(`⚠️ Negative behavior patterns detected (${negativeBadges.length} negative badges)`);
    }

    // History insights
    if (data.history.length > 5) {
      const recentPunishments = data.history.filter((h: any) =>
        h.action === 'timeout' || h.action === 'ban'
      );
      if (recentPunishments.length > 2) {
        insights.push(`🚨 Repeat offender - ${recentPunishments.length} recent punishments`);
      }
    }

    return insights;
  }

  /**
   * Analyze channel
   */
  private async analyzeChannel(
    query: AnalyticsQuery,
    guild: Guild,
    memory: any
  ): Promise<AnalyticsResult> {
    const channelId = query.target || 'all';

    // Get channel stats (would be tracked over time)
    const stats = {
      messageCount: 0,
      conflictCount: 0,
      avgToxicity: 0,
      activeUsers: 0,
    };

    return {
      query,
      data: stats,
      summary: `Channel analysis: ${channelId}`,
      insights: ['Channel analytics implementation in progress'],
      timestamp: new Date(),
    };
  }

  /**
   * Analyze server
   */
  private async analyzeServer(
    query: AnalyticsQuery,
    guild: Guild,
    trustEngine: any
  ): Promise<AnalyticsResult> {
    // Fetch all members
    await guild.members.fetch();
    const allMembers = Array.from(guild.members.cache.values());

    // Filter out bots
    const humanMembers = allMembers.filter(m => !m.user.bot);

    logger.info(`📊 Analyzing ${humanMembers.length} human members (${allMembers.length} total including bots)`);

    // Calculate stats from ALL members (not just profiled ones)
    const trustScores: number[] = [];
    let positiveBadges = 0;
    let negativeBadges = 0;
    let highRisk = 0;
    let trusted = 0;

    for (const member of humanMembers) {
      const trustScore = trustEngine.getTrustScore(member.id, guild.id);
      trustScores.push(trustScore.score);

      if (trustScore.score < 30) highRisk++;
      if (trustScore.score >= 80) trusted++;

      // Check if profile exists
      const profile = this.badgeSystem.getProfile(member.id, guild.id);
      if (profile) {
        positiveBadges += profile.badges.filter(b => b.type === 'positive').length;
        negativeBadges += profile.badges.filter(b => b.type === 'negative').length;
      }
    }

    const avgTrustScore = trustScores.reduce((sum, s) => sum + s, 0) / trustScores.length || 0;
    const profiledMembers = this.badgeSystem.getAllProfiles(guild.id).length;

    const stats = {
      totalMembers: allMembers.length,
      humanMembers: humanMembers.length,
      profiledMembers,
      avgTrustScore,
      positiveBadges,
      negativeBadges,
      highRisk,
      trusted,
    };

    const insights = [
      `📊 ${stats.humanMembers} human members (${stats.profiledMembers} have detailed profiles)`,
      `⭐ Average trust score: ${stats.avgTrustScore.toFixed(0)}/100`,
      `✅ ${stats.trusted} trusted members (≥80 score)`,
      `⚠️ ${stats.highRisk} high-risk members (<30 score)`,
      `🏷️ ${stats.positiveBadges} positive badges, ${stats.negativeBadges} negative badges`,
    ];

    return {
      query,
      data: stats,
      summary: `Server Analysis: ${guild.name}`,
      insights,
      timestamp: new Date(),
    };
  }

  /**
   * Analyze users by badge
   */
  private async analyzeBadges(
    query: AnalyticsQuery,
    guild: Guild
  ): Promise<AnalyticsResult> {
    if (!query.target) {
      // Return all badge types
      const allProfiles = this.badgeSystem.getAllProfiles(guild.id);
      const badgeCounts = new Map<string, number>();

      allProfiles.forEach(profile => {
        profile.badges.forEach(badge => {
          badgeCounts.set(badge.label, (badgeCounts.get(badge.label) || 0) + 1);
        });
      });

      const data = Array.from(badgeCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);

      return {
        query,
        data,
        summary: `Badge distribution across ${allProfiles.length} members`,
        insights: data.slice(0, 5).map(b => `🏷️ ${b.label}: ${b.count} members`),
        timestamp: new Date(),
      };
    }

    // Filter by specific badge
    const users = this.badgeSystem.filterByBadge(guild.id, query.target);

    return {
      query,
      data: users,
      summary: `Found ${users.length} users with badge: ${query.target}`,
      insights: users.slice(0, 5).map(u => `👤 ${u.userId} (Trust: ${u.trustScore})`),
      timestamp: new Date(),
    };
  }

  /**
   * Generate ranking
   */
  private async generateRanking(
    query: AnalyticsQuery,
    guild: Guild,
    trustEngine: any
  ): Promise<AnalyticsResult> {
    const limit = query.filter?.limit || 10;

    // Rank by trust score
    const ranked = this.badgeSystem.rankUsersByTrust(guild.id, limit);

    const insights = ranked.map((profile, index) =>
      `${index + 1}. User ${profile.userId} - Trust: ${profile.trustScore}/100 - ${profile.badges.map(b => b.label).join(', ')}`
    );

    return {
      query,
      data: ranked,
      summary: `Top ${limit} users by trust score`,
      insights,
      timestamp: new Date(),
    };
  }

  /**
   * Format analytics result for Discord
   */
  formatForDiscord(result: AnalyticsResult): string {
    const lines: string[] = [];

    lines.push(`**${result.summary}**`);
    lines.push('');

    if (result.insights.length > 0) {
      lines.push('**Key Insights:**');
      result.insights.forEach(insight => lines.push(insight));
      lines.push('');
    }

    // Add user-specific details if available
    if (result.query.type === 'user' && result.data.badges) {
      lines.push('**Profile Badges:**');
      result.data.badges.forEach((badge: any) => {
        const emoji = badge.type === 'positive' ? '✅' : badge.type === 'negative' ? '⚠️' : '🔷';
        lines.push(`${emoji} ${badge.label} (${(badge.confidence * 100).toFixed(0)}% confidence)`);
      });
      lines.push('');

      if (result.data.history && result.data.history.length > 0) {
        lines.push('**Recent History:**');
        result.data.history.slice(-5).forEach((event: any) => {
          lines.push(`- ${event.action}: ${event.reason}`);
        });
      }
    }

    lines.push(`\n_Analysis timestamp: ${result.timestamp.toLocaleString()}_`);

    return lines.join('\n');
  }
}
