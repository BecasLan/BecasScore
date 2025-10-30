// ServerAnalysis.ts - Discover and understand server structure
// Enables: finding rules channels, understanding categories, identifying important channels

import { Guild, TextChannel, CategoryChannel, Channel, ChannelType } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('ServerAnalysis');

// ============================================
// TYPES
// ============================================

export interface ServerStructure {
  guildId: string;
  guildName: string;
  analyzedAt: number;

  channels: ChannelInfo[];
  categories: CategoryInfo[];

  // Special channels discovered
  rulesChannel?: string; // channel ID
  announcementsChannel?: string;
  generalChannel?: string;
  modLogChannel?: string;
  welcomeChannel?: string;

  // Server characteristics
  memberCount: number;
  roleCount: number;
  hasVerificationLevel: boolean;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  categoryId?: string;
  categoryName?: string;
  topic?: string;
  inferredPurpose?: string; // AI-determined purpose
}

export interface CategoryInfo {
  id: string;
  name: string;
  channelCount: number;
  inferredPurpose?: string;
}

// ============================================
// SERVER ANALYSIS ENGINE
// ============================================

export class ServerAnalysis {
  private ollama: OllamaService;
  private structures: Map<string, ServerStructure> = new Map(); // guildId -> structure
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  constructor(ollama: OllamaService) {
    this.ollama = ollama;
    logger.info('ServerAnalysis initialized');
  }

  /**
   * Analyze server structure and discover important channels
   */
  async analyzeServer(guild: Guild): Promise<ServerStructure> {
    logger.info(`Analyzing server structure for: ${guild.name}`);

    // Check cache first
    const cached = this.structures.get(guild.id);
    if (cached && Date.now() - cached.analyzedAt < this.CACHE_TTL) {
      logger.debug(`Using cached structure for ${guild.name}`);
      return cached;
    }

    const channels: ChannelInfo[] = [];
    const categories: Map<string, CategoryInfo> = new Map();

    // Collect all channels
    for (const [channelId, channel] of guild.channels.cache) {
      if (channel.type === ChannelType.GuildCategory) {
        const category = channel as CategoryChannel;
        categories.set(category.id, {
          id: category.id,
          name: category.name,
          channelCount: category.children.cache.size,
        });
      } else if (channel.type === ChannelType.GuildText) {
        const textChannel = channel as TextChannel;
        channels.push({
          id: textChannel.id,
          name: textChannel.name,
          type: 'text',
          categoryId: textChannel.parentId || undefined,
          categoryName: textChannel.parent?.name || undefined,
          topic: textChannel.topic || undefined,
        });
      }
    }

    // Discover special channels using pattern matching and AI
    const rulesChannel = await this.findRulesChannel(channels);
    const announcementsChannel = await this.findChannelByPurpose(channels, ['announcement', 'news', 'updates']);
    const generalChannel = await this.findChannelByPurpose(channels, ['general', 'chat', 'main']);
    const modLogChannel = await this.findChannelByPurpose(channels, ['mod-log', 'modlog', 'audit', 'logs']);
    const welcomeChannel = await this.findChannelByPurpose(channels, ['welcome', 'intro', 'introductions']);

    const structure: ServerStructure = {
      guildId: guild.id,
      guildName: guild.name,
      analyzedAt: Date.now(),
      channels,
      categories: Array.from(categories.values()),
      rulesChannel,
      announcementsChannel,
      generalChannel,
      modLogChannel,
      welcomeChannel,
      memberCount: guild.memberCount,
      roleCount: guild.roles.cache.size,
      hasVerificationLevel: guild.verificationLevel !== 0,
    };

    // Use AI to infer channel purposes
    await this.inferChannelPurposes(structure);

    this.structures.set(guild.id, structure);
    logger.info(`Server analysis complete for ${guild.name}`);
    logger.info(`  Rules: ${structure.rulesChannel ? '✓' : '✗'}`);
    logger.info(`  Announcements: ${structure.announcementsChannel ? '✓' : '✗'}`);
    logger.info(`  General: ${structure.generalChannel ? '✓' : '✗'}`);
    logger.info(`  Mod Log: ${structure.modLogChannel ? '✓' : '✗'}`);

    return structure;
  }

  /**
   * Find the rules channel
   */
  private async findRulesChannel(channels: ChannelInfo[]): Promise<string | undefined> {
    // Check for explicit rules channel names
    const rulesPatterns = ['rules', 'rule', 'guidelines', 'server-rules', 'info'];

    for (const channel of channels) {
      const nameLower = channel.name.toLowerCase();
      if (rulesPatterns.some(pattern => nameLower.includes(pattern))) {
        // Verify it's likely a rules channel by checking topic
        if (channel.topic) {
          const topicLower = channel.topic.toLowerCase();
          if (topicLower.includes('rule') || topicLower.includes('guideline') || topicLower.includes('please read')) {
            logger.info(`Found rules channel: #${channel.name}`);
            return channel.id;
          }
        }
        // If no topic, still count as rules channel if name matches strongly
        if (nameLower === 'rules' || nameLower === 'server-rules' || nameLower === 'guidelines') {
          logger.info(`Found rules channel: #${channel.name}`);
          return channel.id;
        }
      }
    }

    logger.warn('No rules channel found');
    return undefined;
  }

  /**
   * Find a channel by purpose keywords
   */
  private async findChannelByPurpose(channels: ChannelInfo[], keywords: string[]): Promise<string | undefined> {
    for (const channel of channels) {
      const nameLower = channel.name.toLowerCase();
      for (const keyword of keywords) {
        if (nameLower.includes(keyword)) {
          return channel.id;
        }
      }
    }
    return undefined;
  }

  /**
   * Use AI to infer channel purposes
   */
  private async inferChannelPurposes(structure: ServerStructure): Promise<void> {
    // Build channel list for AI
    const channelList = structure.channels
      .slice(0, 20) // Limit to first 20 channels to avoid token overload
      .map(c => {
        const topic = c.topic ? ` (topic: ${c.topic.substring(0, 100)})` : '';
        const category = c.categoryName ? ` [${c.categoryName}]` : '';
        return `- #${c.name}${category}${topic}`;
      })
      .join('\n');

    const prompt = `You are analyzing a Discord server's channel structure. Identify the purpose of each channel.

SERVER: ${structure.guildName}
MEMBER COUNT: ${structure.memberCount}

CHANNELS:
${channelList}

For each channel, infer its likely purpose in 2-4 words. Return JSON:
{
  "channels": {
    "channel_name": "purpose",
    ...
  }
}

Examples:
- "general" → "Main chat"
- "memes" → "Fun and memes"
- "dev-discussion" → "Developer talk"
- "bot-commands" → "Bot interactions"

Output ONLY valid JSON.`;

    try {
      const response = await this.ollama.generate(
        prompt,
        'You are a JSON generator. Output ONLY valid JSON.'
      );

      let cleaned = response.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        logger.warn('Failed to parse channel purposes from AI');
        return;
      }

      const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);

      if (parsed.channels) {
        for (const channel of structure.channels) {
          const purpose = parsed.channels[channel.name];
          if (purpose) {
            channel.inferredPurpose = purpose;
          }
        }
        logger.debug('Channel purposes inferred successfully');
      }

    } catch (error: any) {
      logger.error('Failed to infer channel purposes:', error);
    }
  }

  /**
   * Get server structure (from cache or analyze)
   */
  async getStructure(guild: Guild): Promise<ServerStructure> {
    const cached = this.structures.get(guild.id);
    if (cached && Date.now() - cached.analyzedAt < this.CACHE_TTL) {
      return cached;
    }
    return await this.analyzeServer(guild);
  }

  /**
   * Find rules channel for a guild
   */
  async findRules(guild: Guild): Promise<TextChannel | undefined> {
    const structure = await this.getStructure(guild);
    if (!structure.rulesChannel) {
      return undefined;
    }

    const channel = guild.channels.cache.get(structure.rulesChannel);
    if (channel && channel.type === ChannelType.GuildText) {
      return channel as TextChannel;
    }

    return undefined;
  }

  /**
   * Find a specific special channel
   */
  async findSpecialChannel(guild: Guild, type: 'rules' | 'announcements' | 'general' | 'modlog' | 'welcome'): Promise<TextChannel | undefined> {
    const structure = await this.getStructure(guild);

    let channelId: string | undefined;
    switch (type) {
      case 'rules':
        channelId = structure.rulesChannel;
        break;
      case 'announcements':
        channelId = structure.announcementsChannel;
        break;
      case 'general':
        channelId = structure.generalChannel;
        break;
      case 'modlog':
        channelId = structure.modLogChannel;
        break;
      case 'welcome':
        channelId = structure.welcomeChannel;
        break;
    }

    if (!channelId) {
      return undefined;
    }

    const channel = guild.channels.cache.get(channelId);
    if (channel && channel.type === ChannelType.GuildText) {
      return channel as TextChannel;
    }

    return undefined;
  }

  /**
   * Get a summary of the server structure
   */
  async getSummary(guild: Guild): Promise<string> {
    const structure = await this.getStructure(guild);

    const lines = [
      `📊 **Server Analysis: ${structure.guildName}**`,
      `👥 Members: ${structure.memberCount}`,
      `🎭 Roles: ${structure.roleCount}`,
      `📝 Channels: ${structure.channels.length}`,
      `📁 Categories: ${structure.categories.length}`,
      '',
      '**Special Channels:**',
      `Rules: ${structure.rulesChannel ? '✓' : '✗'}`,
      `Announcements: ${structure.announcementsChannel ? '✓' : '✗'}`,
      `General: ${structure.generalChannel ? '✓' : '✗'}`,
      `Mod Log: ${structure.modLogChannel ? '✓' : '✗'}`,
    ];

    return lines.join('\n');
  }

  /**
   * Clear cached structure for a guild
   */
  clearCache(guildId: string): void {
    this.structures.delete(guildId);
    logger.info(`Cleared structure cache for guild ${guildId}`);
  }
}
