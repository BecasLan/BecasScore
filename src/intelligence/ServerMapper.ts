import { Guild, TextChannel, CategoryChannel, Role, GuildMember, Collection } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { StorageService } from '../services/StorageService';

/**
 * SERVER MAPPER - Deep Server Understanding
 *
 * This system creates a complete map of the server:
 * - All channels (purpose, activity, topics)
 * - All roles (hierarchy, permissions, members)
 * - All users (activity, interests, expertise)
 * - Server structure (categories, organization)
 *
 * Like OpenAI understanding a codebase, this understands the Discord server.
 */

export interface ChannelMap {
  id: string;
  name: string;
  type: string;
  category?: string;
  purpose?: string;           // AI-detected purpose
  topics: string[];           // Main topics discussed
  activityLevel: 'high' | 'medium' | 'low';
  messageCount: number;
  lastActive: Date;
  relatedChannels: string[];  // Similar channels
}

export interface RoleMap {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: string[];
  memberCount: number;
  purpose?: string;           // AI-detected purpose
}

export interface CategoryMap {
  id: string;
  name: string;
  channels: string[];
  purpose?: string;           // AI-detected purpose
}

export interface ServerStructure {
  guildId: string;
  name: string;
  channels: Map<string, ChannelMap>;
  roles: Map<string, RoleMap>;
  categories: Map<string, CategoryMap>;
  totalMembers: number;
  activeMembers: number;
  lastMapped: Date;
}

export class ServerMapper {
  private llm: OllamaService;
  private storage: StorageService;
  private serverMaps: Map<string, ServerStructure> = new Map();

  constructor(storage: StorageService) {
    this.llm = new OllamaService('analysis');
    this.storage = storage;
    console.log('🗺️ ServerMapper initialized - AI can now understand server structure');
  }

  /**
   * Map the entire server structure
   */
  async mapServer(guild: Guild): Promise<ServerStructure> {
    console.log(`\n🗺️ ===== MAPPING SERVER: ${guild.name} =====`);

    const structure: ServerStructure = {
      guildId: guild.id,
      name: guild.name,
      channels: new Map(),
      roles: new Map(),
      categories: new Map(),
      totalMembers: guild.memberCount,
      activeMembers: 0,
      lastMapped: new Date()
    };

    // Map categories
    await this.mapCategories(guild, structure);

    // Map channels
    await this.mapChannels(guild, structure);

    // Map roles
    await this.mapRoles(guild, structure);

    // Store the map
    this.serverMaps.set(guild.id, structure);

    console.log(`✅ Server mapped: ${structure.channels.size} channels, ${structure.roles.size} roles, ${structure.categories.size} categories`);

    return structure;
  }

  /**
   * Map all categories
   */
  private async mapCategories(guild: Guild, structure: ServerStructure): Promise<void> {
    const categories = guild.channels.cache.filter(ch => ch.type === 4); // CategoryChannel

    for (const [id, category] of categories) {
      const catChannel = category as CategoryChannel;
      const childChannels = guild.channels.cache.filter(ch => ch.parentId === id);

      // AI detects category purpose
      const purpose = await this.detectCategoryPurpose(
        catChannel.name,
        childChannels.map(ch => ch.name)
      );

      structure.categories.set(id, {
        id,
        name: catChannel.name,
        channels: childChannels.map(ch => ch.id),
        purpose
      });
    }
  }

  /**
   * Map all channels with deep understanding
   */
  private async mapChannels(guild: Guild, structure: ServerStructure): Promise<void> {
    const textChannels = guild.channels.cache.filter(
      ch => ch.isTextBased() && ch.type === 0
    ) as Collection<string, TextChannel>;

    for (const [id, channel] of textChannels) {
      console.log(`📊 Analyzing channel: #${channel.name}`);

      // Fetch recent messages to understand channel
      const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);

      let purpose = 'Unknown';
      let topics: string[] = [];
      let activityLevel: 'high' | 'medium' | 'low' = 'low';

      if (messages && messages.size > 0) {
        // AI analyzes messages to understand channel purpose
        const analysis = await this.analyzeChannelContent(
          channel.name,
          messages.map(m => m.content).slice(0, 20) // Last 20 messages
        );

        purpose = analysis.purpose;
        topics = analysis.topics;
        activityLevel = messages.size > 50 ? 'high' : messages.size > 20 ? 'medium' : 'low';
      }

      // Find related channels (similar names or topics)
      const relatedChannels = this.findRelatedChannels(
        channel.name,
        topics,
        Array.from(textChannels.values())
      );

      structure.channels.set(id, {
        id,
        name: channel.name,
        type: 'text',
        category: channel.parent?.name,
        purpose,
        topics,
        activityLevel,
        messageCount: messages?.size || 0,
        lastActive: messages?.first()?.createdAt || new Date(0),
        relatedChannels: relatedChannels.map(ch => ch.id)
      });
    }
  }

  /**
   * Map all roles
   */
  private async mapRoles(guild: Guild, structure: ServerStructure): Promise<void> {
    const roles = guild.roles.cache;

    for (const [id, role] of roles) {
      if (role.name === '@everyone') continue; // Skip default role

      const memberCount = guild.members.cache.filter(m => m.roles.cache.has(id)).size;

      // AI detects role purpose
      const purpose = await this.detectRolePurpose(role.name, role.permissions.toArray());

      structure.roles.set(id, {
        id,
        name: role.name,
        color: role.hexColor,
        position: role.position,
        permissions: role.permissions.toArray(),
        memberCount,
        purpose
      });
    }
  }

  /**
   * AI analyzes channel messages to understand purpose
   */
  private async analyzeChannelContent(
    channelName: string,
    recentMessages: string[]
  ): Promise<{ purpose: string; topics: string[] }> {
    if (recentMessages.length === 0) {
      return { purpose: 'Inactive or new channel', topics: [] };
    }

    const prompt = `Analyze this Discord channel based on its name and recent messages:

Channel Name: "${channelName}"

Recent Messages:
${recentMessages.slice(0, 10).map((msg, i) => `${i + 1}. ${msg.substring(0, 100)}`).join('\n')}

Determine:
1. The PRIMARY PURPOSE of this channel (1 sentence)
2. The MAIN TOPICS discussed (3-5 keywords)

Format your response as JSON:
{
  "purpose": "brief description",
  "topics": ["topic1", "topic2", "topic3"]
}`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are a Discord server analyst. Output only valid JSON.',
        { temperature: 0.3, maxTokens: 200 }
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        return {
          purpose: analysis.purpose || 'General discussion',
          topics: analysis.topics || []
        };
      }
    } catch (error) {
      console.error('Channel analysis error:', error);
    }

    return { purpose: 'General discussion', topics: [] };
  }

  /**
   * AI detects category purpose
   */
  private async detectCategoryPurpose(
    categoryName: string,
    channelNames: string[]
  ): Promise<string> {
    const prompt = `What is the purpose of this Discord category?

Category: "${categoryName}"
Channels: ${channelNames.join(', ')}

Answer in 5 words or less.`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are concise.',
        { temperature: 0.2, maxTokens: 20 }
      );

      return response.trim() || 'General organization';
    } catch (error) {
      return 'General organization';
    }
  }

  /**
   * AI detects role purpose
   */
  private async detectRolePurpose(roleName: string, permissions: string[]): Promise<string> {
    const hasModPerms = permissions.some(p =>
      p.includes('MANAGE') || p.includes('BAN') || p.includes('KICK')
    );

    if (hasModPerms) return 'Moderation and management';

    const prompt = `What is this Discord role for?

Role Name: "${roleName}"

Answer in 5 words or less.`;

    try {
      const response = await this.llm.generate(
        prompt,
        'You are concise.',
        { temperature: 0.2, maxTokens: 20 }
      );

      return response.trim() || 'Community role';
    } catch (error) {
      return 'Community role';
    }
  }

  /**
   * Find channels related to this one
   */
  private findRelatedChannels(
    channelName: string,
    topics: string[],
    allChannels: TextChannel[]
  ): TextChannel[] {
    return allChannels.filter(ch => {
      if (ch.name === channelName) return false;

      // Similar name
      const nameWords = channelName.toLowerCase().split('-');
      const otherWords = ch.name.toLowerCase().split('-');
      const commonWords = nameWords.filter(w => otherWords.includes(w));

      if (commonWords.length > 0) return true;

      // Similar topics would require analyzing that channel too
      // For now, just use name similarity
      return false;
    }).slice(0, 3); // Max 3 related channels
  }

  /**
   * Get server map
   */
  getServerMap(guildId: string): ServerStructure | undefined {
    return this.serverMaps.get(guildId);
  }

  /**
   * Find channels by purpose or topic
   */
  findChannelsByPurpose(guildId: string, query: string): ChannelMap[] {
    const structure = this.serverMaps.get(guildId);
    if (!structure) return [];

    query = query.toLowerCase();

    return Array.from(structure.channels.values()).filter(ch =>
      ch.purpose?.toLowerCase().includes(query) ||
      ch.topics.some(t => t.toLowerCase().includes(query)) ||
      ch.name.toLowerCase().includes(query)
    );
  }

  /**
   * Get channel recommendations for merging
   */
  getSimilarChannels(guildId: string, channelId: string): ChannelMap[] {
    const structure = this.serverMaps.get(guildId);
    if (!structure) return [];

    const channel = structure.channels.get(channelId);
    if (!channel) return [];

    // Find channels with similar topics or purpose
    return Array.from(structure.channels.values()).filter(ch => {
      if (ch.id === channelId) return false;

      // Check topic overlap
      const topicOverlap = channel.topics.filter(t =>
        ch.topics.some(t2 => t2.toLowerCase() === t.toLowerCase())
      );

      return topicOverlap.length > 0 ||
             (ch.purpose && channel.purpose &&
              ch.purpose.toLowerCase().includes(channel.purpose.toLowerCase().split(' ')[0]));
    });
  }

  /**
   * Save all server maps to disk
   */
  async saveCache(): Promise<void> {
    try {
      const cacheData: any = {};

      for (const [guildId, structure] of this.serverMaps) {
        cacheData[guildId] = {
          ...structure,
          channels: Array.from(structure.channels.entries()),
          roles: Array.from(structure.roles.entries()),
          categories: Array.from(structure.categories.entries())
        };
      }

      await this.storage.save('server_maps.json', cacheData);
    } catch (error) {
      console.error('Failed to save server maps cache:', error);
    }
  }

  /**
   * Load all server maps from disk
   */
  async loadCache(): Promise<void> {
    try {
      const cacheData = await this.storage.load('server_maps.json') as any;

      if (!cacheData) return;

      for (const [guildId, data] of Object.entries(cacheData)) {
        const structure: ServerStructure = {
          ...(data as any),
          channels: new Map((data as any).channels),
          roles: new Map((data as any).roles),
          categories: new Map((data as any).categories),
          lastMapped: new Date((data as any).lastMapped)
        };

        this.serverMaps.set(guildId, structure);
      }

      console.log(`📂 Loaded ${this.serverMaps.size} server maps from cache`);
    } catch (error) {
      console.error('Failed to load server maps cache:', error);
    }
  }
}
