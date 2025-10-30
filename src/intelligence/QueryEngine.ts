import { Guild } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { ServerMapper, ServerStructure, ChannelMap } from './ServerMapper';
import { DeepUserProfiler, UserProfile } from './DeepUserProfiler';

/**
 * QUERY ENGINE - Natural Language Server Queries
 *
 * This system enables natural language queries about the server:
 * - "find 10 people who code"
 * - "who are the most active users this week?"
 * - "which channels are dead?"
 * - "who knows about Docker?"
 *
 * Uses ServerMapper + DeepUserProfiler data to answer intelligently.
 */

export type QueryType =
  | 'user_search'      // Find users by criteria
  | 'channel_search'   // Find channels by criteria
  | 'stats'            // Server statistics
  | 'activity'         // Activity analysis
  | 'expertise'        // Expertise/skill search
  | 'unknown';

export interface QueryResult {
  type: QueryType;
  query: string;
  results: any[];
  summary: string;
  confidence: number;
}

export interface UserSearchResult {
  userId: string;
  username: string;
  score: number;
  reason: string;
  expertise?: Map<string, number>;
  interests?: string[];
}

export interface ChannelSearchResult {
  channelId: string;
  channelName: string;
  score: number;
  reason: string;
  purpose?: string;
  activityLevel?: string;
}

export class QueryEngine {
  private llm: OllamaService;
  private serverMapper: ServerMapper;
  private userProfiler: DeepUserProfiler;

  constructor(serverMapper: ServerMapper, userProfiler: DeepUserProfiler) {
    this.llm = new OllamaService('analysis');
    this.serverMapper = serverMapper;
    this.userProfiler = userProfiler;
    console.log('🔍 QueryEngine initialized - AI can answer server queries');
  }

  /**
   * Process natural language query
   */
  async query(
    guildId: string,
    naturalLanguageQuery: string
  ): Promise<QueryResult> {
    console.log(`\n🔍 ===== QUERY: "${naturalLanguageQuery}" =====`);

    // Step 1: Understand query type and intent
    const queryType = await this.classifyQuery(naturalLanguageQuery);
    console.log(`  Query type: ${queryType}`);

    // Step 2: Execute appropriate query handler
    let results: any[] = [];
    let summary = '';
    let confidence = 0;

    switch (queryType) {
      case 'user_search':
      case 'expertise':
        const userResults = await this.handleUserSearch(guildId, naturalLanguageQuery);
        results = userResults.users;
        summary = userResults.summary;
        confidence = userResults.confidence;
        break;

      case 'channel_search':
        const channelResults = await this.handleChannelSearch(guildId, naturalLanguageQuery);
        results = channelResults.channels;
        summary = channelResults.summary;
        confidence = channelResults.confidence;
        break;

      case 'activity':
        const activityResults = await this.handleActivityQuery(guildId, naturalLanguageQuery);
        results = activityResults.data;
        summary = activityResults.summary;
        confidence = activityResults.confidence;
        break;

      case 'stats':
        const statsResults = await this.handleStatsQuery(guildId, naturalLanguageQuery);
        results = statsResults.data;
        summary = statsResults.summary;
        confidence = statsResults.confidence;
        break;

      default:
        summary = 'I couldn\'t understand that query. Try asking about users, channels, or server activity.';
        confidence = 0;
    }

    console.log(`✅ Query complete: ${results.length} results found`);

    return {
      type: queryType,
      query: naturalLanguageQuery,
      results,
      summary,
      confidence
    };
  }

  /**
   * Classify query type using AI
   */
  private async classifyQuery(query: string): Promise<QueryType> {
    const prompt = `Classify this Discord server query into ONE of these types:

Query: "${query}"

Types:
- user_search: Finding specific users (e.g., "find people who...")
- expertise: Finding users by skill/knowledge (e.g., "who knows Docker?")
- channel_search: Finding channels (e.g., "which channels are for gaming?")
- activity: Activity analysis (e.g., "most active users", "dead channels")
- stats: Server statistics (e.g., "how many members?")
- unknown: Can't classify

Respond with ONLY the type name, nothing else.`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a query classifier. Output only the type name.',
        { temperature: 0.1, maxTokens: 20 }
      );

      const type = response.trim().toLowerCase();

      if (['user_search', 'expertise', 'channel_search', 'activity', 'stats'].includes(type)) {
        return type as QueryType;
      }

      // Fallback heuristics
      if (query.match(/find.*(people|users|members)/i)) return 'user_search';
      if (query.match(/who (knows|is expert|understands)/i)) return 'expertise';
      if (query.match(/(channel|where|what channel)/i)) return 'channel_search';
      if (query.match(/(active|inactive|dead|busy)/i)) return 'activity';
      if (query.match(/(how many|count|total|stats)/i)) return 'stats';

    } catch (error) {
      console.error('Query classification error:', error);
    }

    return 'unknown';
  }

  /**
   * Handle user/expertise search
   */
  private async handleUserSearch(
    guildId: string,
    query: string
  ): Promise<{
    users: UserSearchResult[];
    summary: string;
    confidence: number;
  }> {
    // Extract search criteria
    const criteria = await this.extractUserSearchCriteria(query);
    console.log(`  Search criteria:`, criteria);

    const allProfiles = this.userProfiler.getAllProfiles();
    const matches: UserSearchResult[] = [];

    for (const profile of allProfiles) {
      let score = 0;
      const reasons: string[] = [];

      // Match expertise
      if (criteria.skills.length > 0) {
        for (const skill of criteria.skills) {
          for (const [userSkill, level] of profile.expertise.entries()) {
            if (userSkill.toLowerCase().includes(skill.toLowerCase()) ||
                skill.toLowerCase().includes(userSkill.toLowerCase())) {
              score += level;
              reasons.push(`${userSkill} (${(level * 100).toFixed(0)}%)`);
            }
          }
        }
      }

      // Match interests
      if (criteria.interests.length > 0) {
        for (const interest of criteria.interests) {
          if (profile.interests.some(i => i.toLowerCase().includes(interest.toLowerCase()))) {
            score += 0.3;
            reasons.push(`interested in ${interest}`);
          }
        }
      }

      // Match traits
      if (criteria.traits.length > 0) {
        for (const trait of criteria.traits) {
          if (profile.personalityTraits.some(t => t.toLowerCase().includes(trait.toLowerCase()))) {
            score += 0.2;
            reasons.push(trait);
          }
        }
      }

      if (score > 0) {
        matches.push({
          userId: profile.userId,
          username: profile.username,
          score,
          reason: reasons.join(', '),
          expertise: profile.expertise,
          interests: profile.interests
        });
      }
    }

    // Sort by score and limit
    const limit = criteria.limit || 10;
    const topMatches = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Generate summary
    const summary = this.generateUserSearchSummary(topMatches, criteria);

    return {
      users: topMatches,
      summary,
      confidence: topMatches.length > 0 ? 0.85 : 0.3
    };
  }

  /**
   * Extract user search criteria using AI
   */
  private async extractUserSearchCriteria(query: string): Promise<{
    skills: string[];
    interests: string[];
    traits: string[];
    limit: number;
  }> {
    const prompt = `Extract search criteria from this query:

Query: "${query}"

Extract:
- Skills/expertise mentioned (e.g., "coding", "JavaScript", "Docker")
- Interests mentioned (e.g., "gaming", "music")
- Personality traits (e.g., "helpful", "active")
- Number limit (default 10)

Respond ONLY with JSON:
{
  "skills": ["skill1", "skill2"],
  "interests": ["interest1"],
  "traits": ["trait1"],
  "limit": 10
}`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You extract search criteria. Output only valid JSON.',
        { temperature: 0.2, maxTokens: 150 }
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          skills: data.skills || [],
          interests: data.interests || [],
          traits: data.traits || [],
          limit: data.limit || 10
        };
      }
    } catch (error) {
      console.error('Criteria extraction error:', error);
    }

    // Fallback: Simple keyword extraction
    const skills: string[] = [];
    const keywords = ['coding', 'javascript', 'python', 'docker', 'react', 'node', 'java', 'c++', 'rust'];
    for (const keyword of keywords) {
      if (query.toLowerCase().includes(keyword)) {
        skills.push(keyword);
      }
    }

    return { skills, interests: [], traits: [], limit: 10 };
  }

  /**
   * Generate user search summary
   */
  private generateUserSearchSummary(
    matches: UserSearchResult[],
    criteria: any
  ): string {
    if (matches.length === 0) {
      return 'No users found matching your criteria.';
    }

    const criteriaStr = [...criteria.skills, ...criteria.interests, ...criteria.traits]
      .join(', ') || 'your criteria';

    return `Found ${matches.length} user${matches.length > 1 ? 's' : ''} matching ${criteriaStr}:\n\n` +
      matches.map((m, i) =>
        `${i + 1}. **${m.username}** - ${m.reason} (score: ${m.score.toFixed(2)})`
      ).join('\n');
  }

  /**
   * Handle channel search
   */
  private async handleChannelSearch(
    guildId: string,
    query: string
  ): Promise<{
    channels: ChannelSearchResult[];
    summary: string;
    confidence: number;
  }> {
    const serverMap = this.serverMapper.getServerMap(guildId);
    if (!serverMap) {
      return { channels: [], summary: 'Server not mapped yet', confidence: 0 };
    }

    // Extract search keywords
    const keywords = query.toLowerCase()
      .replace(/which|what|find|show|me|channels|for|about|the/g, '')
      .trim()
      .split(/\s+/);

    const matches: ChannelSearchResult[] = [];

    for (const channel of serverMap.channels.values()) {
      let score = 0;
      const reasons: string[] = [];

      // Match name
      for (const keyword of keywords) {
        if (channel.name.toLowerCase().includes(keyword)) {
          score += 0.5;
          reasons.push(`name matches "${keyword}"`);
        }
      }

      // Match purpose
      if (channel.purpose) {
        for (const keyword of keywords) {
          if (channel.purpose.toLowerCase().includes(keyword)) {
            score += 0.7;
            reasons.push(`purpose: ${channel.purpose}`);
          }
        }
      }

      // Match topics
      for (const topic of channel.topics) {
        for (const keyword of keywords) {
          if (topic.toLowerCase().includes(keyword)) {
            score += 0.4;
            reasons.push(`topic: ${topic}`);
          }
        }
      }

      if (score > 0) {
        matches.push({
          channelId: channel.id,
          channelName: channel.name,
          score,
          reason: reasons.join(', '),
          purpose: channel.purpose,
          activityLevel: channel.activityLevel
        });
      }
    }

    const topMatches = matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const summary = topMatches.length > 0
      ? `Found ${topMatches.length} channel${topMatches.length > 1 ? 's' : ''}:\n\n` +
        topMatches.map((m, i) =>
          `${i + 1}. **#${m.channelName}** - ${m.reason}`
        ).join('\n')
      : 'No channels found matching your query.';

    return {
      channels: topMatches,
      summary,
      confidence: topMatches.length > 0 ? 0.8 : 0.2
    };
  }

  /**
   * Handle activity queries
   */
  private async handleActivityQuery(
    guildId: string,
    query: string
  ): Promise<{
    data: any[];
    summary: string;
    confidence: number;
  }> {
    const serverMap = this.serverMapper.getServerMap(guildId);
    const allProfiles = this.userProfiler.getAllProfiles();

    if (!serverMap) {
      return { data: [], summary: 'Server not mapped yet', confidence: 0 };
    }

    // Detect activity query type
    if (query.match(/most active.*users/i)) {
      // Most active users
      const sortedUsers = allProfiles
        .sort((a, b) => b.messageStats.totalMessages - a.messageStats.totalMessages)
        .slice(0, 10);

      const summary = `**Most Active Users:**\n\n` +
        sortedUsers.map((u, i) =>
          `${i + 1}. **${u.username}** - ${u.messageStats.totalMessages} messages`
        ).join('\n');

      return { data: sortedUsers, summary, confidence: 0.9 };
    }

    if (query.match(/dead.*channels/i) || query.match(/inactive.*channels/i)) {
      // Dead channels
      const deadChannels = Array.from(serverMap.channels.values())
        .filter(ch => ch.activityLevel === 'low')
        .sort((a, b) => a.messageCount - b.messageCount)
        .slice(0, 10);

      const summary = deadChannels.length > 0
        ? `**Inactive Channels:**\n\n` +
          deadChannels.map((ch, i) =>
            `${i + 1}. **#${ch.name}** - ${ch.messageCount} messages, last active: ${ch.lastActive.toLocaleDateString()}`
          ).join('\n')
        : 'No inactive channels found.';

      return { data: deadChannels, summary, confidence: 0.85 };
    }

    if (query.match(/active.*channels/i)) {
      // Active channels
      const activeChannels = Array.from(serverMap.channels.values())
        .filter(ch => ch.activityLevel === 'high')
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 10);

      const summary = activeChannels.length > 0
        ? `**Most Active Channels:**\n\n` +
          activeChannels.map((ch, i) =>
            `${i + 1}. **#${ch.name}** - ${ch.messageCount} messages`
          ).join('\n')
        : 'No highly active channels found.';

      return { data: activeChannels, summary, confidence: 0.85 };
    }

    return {
      data: [],
      summary: 'I couldn\'t understand that activity query.',
      confidence: 0.2
    };
  }

  /**
   * Handle stats queries
   */
  private async handleStatsQuery(
    guildId: string,
    query: string
  ): Promise<{
    data: any[];
    summary: string;
    confidence: number;
  }> {
    const serverMap = this.serverMapper.getServerMap(guildId);
    const allProfiles = this.userProfiler.getAllProfiles();

    if (!serverMap) {
      return { data: [], summary: 'Server not mapped yet', confidence: 0 };
    }

    const stats = {
      totalChannels: serverMap.channels.size,
      totalRoles: serverMap.roles.size,
      totalCategories: serverMap.categories.size,
      totalMembers: serverMap.totalMembers,
      profiledUsers: allProfiles.length,
      activeChannels: Array.from(serverMap.channels.values()).filter(ch => ch.activityLevel === 'high').length,
      totalMessages: allProfiles.reduce((sum, u) => sum + u.messageStats.totalMessages, 0)
    };

    const summary = `**Server Statistics:**\n\n` +
      `📊 Total Channels: ${stats.totalChannels}\n` +
      `🎭 Total Roles: ${stats.totalRoles}\n` +
      `📁 Categories: ${stats.totalCategories}\n` +
      `👥 Members: ${stats.totalMembers}\n` +
      `🔍 Profiled Users: ${stats.profiledUsers}\n` +
      `⚡ Active Channels: ${stats.activeChannels}\n` +
      `💬 Total Messages Analyzed: ${stats.totalMessages}`;

    return {
      data: [stats],
      summary,
      confidence: 0.95
    };
  }
}
