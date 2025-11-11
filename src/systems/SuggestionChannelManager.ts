import { Client, Guild, TextChannel, ChannelType, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';
import type { V3Integration } from '../integration/V3Integration';

const logger = createLogger('SuggestionChannelManager');

/**
 * AI SUGGESTION CHANNEL MANAGER
 *
 * Makes AI predictions and suggestions visible in Discord by:
 * 1. Auto-discovering existing suggestion channels
 * 2. Creating a channel if none exists
 * 3. Posting formatted predictions for moderator visibility
 *
 * This enables the AI to be truly autonomous - not just thinking,
 * but communicating its insights directly to moderators.
 */

export interface AISuggestion {
  type: 'prediction' | 'recommendation' | 'alert' | 'insight';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  details?: string[];
  targetUser?: {
    id: string;
    username: string;
  };
  confidence?: number;
  suggestedActions?: string[];
  timestamp: Date;
}

interface SuggestionChannelCache {
  [guildId: string]: string; // guildId -> channelId
}

export class SuggestionChannelManager {
  private client: Client;
  private storage: StorageService;
  private channelCache: SuggestionChannelCache = {};
  private v3Integration?: V3Integration;

  // Keywords to search for when finding suggestion channels (multi-language)
  private readonly CHANNEL_KEYWORDS = [
    'öneri',          // Turkish: suggestion
    'suggestion',     // English
    'öneriler',       // Turkish: suggestions
    'suggestions',    // English
    'recommendation', // English
    'tavsiye',        // Turkish: recommendation
    'ai-öneri',       // Turkish: ai-suggestion
    'ai-suggestion',  // English
    'ai-önerileri',   // Turkish: ai-suggestions
    'ai-suggestions', // English
    'bot-öneri',      // Turkish: bot-suggestion
    'bot-önerileri',  // Turkish: bot-suggestions
    'yapay-zeka',     // Turkish: artificial intelligence
    'ai-insights',    // English
  ];

  constructor(client: Client, storage: StorageService, v3Integration?: V3Integration) {
    this.client = client;
    this.storage = storage;
    this.v3Integration = v3Integration;
    this.loadCache();
  }

  /**
   * Load cached channel IDs from storage
   */
  private async loadCache(): Promise<void> {
    try {
      const cached = await this.storage.load('suggestion_channels.json') as SuggestionChannelCache;
      if (cached) {
        this.channelCache = cached;
        logger.info(`Loaded ${Object.keys(cached).length} suggestion channel mappings`);
      }
    } catch (error) {
      logger.error('Failed to load suggestion channel cache', error);
    }
  }

  /**
   * Save channel cache to storage
   */
  private async saveCache(): Promise<void> {
    try {
      await this.storage.save('suggestion_channels.json', this.channelCache);
    } catch (error) {
      logger.error('Failed to save suggestion channel cache', error);
    }
  }

  /**
   * Find or create a suggestion channel for the guild
   */
  async getOrCreateSuggestionChannel(guild: Guild): Promise<TextChannel | null> {
    try {
      // 1. Check cache first
      if (this.channelCache[guild.id]) {
        const cachedChannel = guild.channels.cache.get(this.channelCache[guild.id]) as TextChannel;
        if (cachedChannel) {
          logger.debug(`Using cached suggestion channel: ${cachedChannel.name}`);
          return cachedChannel;
        } else {
          // Channel was deleted, remove from cache
          delete this.channelCache[guild.id];
          await this.saveCache();
        }
      }

      // 2. Try to find existing suggestion channel
      const existingChannel = await this.findSuggestionChannel(guild);
      if (existingChannel) {
        logger.info(`Found existing suggestion channel: ${existingChannel.name}`);
        this.channelCache[guild.id] = existingChannel.id;
        await this.saveCache();
        return existingChannel;
      }

      // 3. Create new suggestion channel
      logger.info(`No suggestion channel found in ${guild.name}, creating one...`);
      const newChannel = await this.createSuggestionChannel(guild);

      if (newChannel) {
        this.channelCache[guild.id] = newChannel.id;
        await this.saveCache();
        logger.info(`Created new suggestion channel: ${newChannel.name}`);
        return newChannel;
      }

      return null;
    } catch (error) {
      logger.error('Failed to get or create suggestion channel', error);
      return null;
    }
  }

  /**
   * Find existing suggestion channel by keywords
   */
  private async findSuggestionChannel(guild: Guild): Promise<TextChannel | null> {
    try {
      const channels = guild.channels.cache.filter(
        ch => ch.type === ChannelType.GuildText
      ) as any;

      for (const [_, channel] of channels) {
        const channelName = channel.name.toLowerCase();

        // Check if channel name contains any of our keywords
        for (const keyword of this.CHANNEL_KEYWORDS) {
          if (channelName.includes(keyword.toLowerCase())) {
            logger.debug(`Found matching channel: ${channel.name} (keyword: ${keyword})`);
            return channel as TextChannel;
          }
        }
      }

      return null;
    } catch (error) {
      logger.error('Error finding suggestion channel', error);
      return null;
    }
  }

  /**
   * Create a new suggestion channel
   */
  private async createSuggestionChannel(guild: Guild): Promise<TextChannel | null> {
    try {
      // Check if bot has permission to create channels
      const botMember = guild.members.cache.get(this.client.user!.id);
      if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
        logger.warn(`Bot lacks permission to create channels in ${guild.name}`);
        return null;
      }

      // Create professional English-only channel
      const channel = await guild.channels.create({
        name: 'ai-insights',
        type: ChannelType.GuildText,
        topic: 'AI-generated predictions, insights, and recommendations for moderation team',
        reason: 'Auto-created by Becas AI for intelligent moderation suggestions',
      });

      // Send welcome message
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🤖 AI Insights Channel Initialized')
            .setDescription(
              'This channel receives AI-generated insights including:\n\n' +
              '• Behavioral predictions and pattern analysis\n' +
              '• Proactive threat detection alerts\n' +
              '• Moderation action recommendations\n' +
              '• Community health insights\n\n' +
              'All predictions include confidence scores and suggested actions.'
            )
            .setColor('#00D9FF')
            .setTimestamp(),
        ],
      });

      logger.info(`Successfully created suggestion channel: ${channel.name}`);
      return channel;
    } catch (error) {
      logger.error('Failed to create suggestion channel', error);
      return null;
    }
  }

  /**
   * Post an AI suggestion to the appropriate channel
   */
  async postSuggestion(guild: Guild, suggestion: AISuggestion): Promise<boolean> {
    try {
      const channel = await this.getOrCreateSuggestionChannel(guild);
      if (!channel) {
        logger.warn(`Could not find or create suggestion channel for ${guild.name}`);
        return false;
      }

      // Build embed based on suggestion type
      const embed = this.buildSuggestionEmbed(suggestion);

      // Post to channel
      const message = await channel.send({ embeds: [embed] });

      // Store in unified memory for retrieval later
      if (this.v3Integration) {
        try {
          await this.v3Integration.storeSuggestion(guild.id, suggestion, message.id);
        } catch (error) {
          logger.error('Failed to store suggestion in unified memory', error);
          // Don't fail the command - posting is more important
        }
      }

      logger.info(
        `Posted ${suggestion.type} suggestion (severity: ${suggestion.severity}) to ${channel.name}`
      );

      return true;
    } catch (error) {
      logger.error('Failed to post suggestion', error);
      return false;
    }
  }

  /**
   * Build formatted embed for suggestion
   */
  private buildSuggestionEmbed(suggestion: AISuggestion): EmbedBuilder {
    const embed = new EmbedBuilder();

    // Set color based on severity
    const severityColors: Record<string, number> = {
      low: 0x3498db,      // Blue
      medium: 0xf39c12,   // Orange
      high: 0xe74c3c,     // Red
      critical: 0x8b0000, // Dark Red
    };
    embed.setColor(severityColors[suggestion.severity] || 0x00D9FF);

    // Set emoji and title based on type
    const typeEmojis: Record<string, string> = {
      prediction: '🔮',
      recommendation: '💡',
      alert: '⚠️',
      insight: '🧠',
    };
    const emoji = typeEmojis[suggestion.type] || '🤖';
    embed.setTitle(`${emoji} ${suggestion.title}`);

    // Description
    embed.setDescription(suggestion.description);

    // Add details as fields
    if (suggestion.details && suggestion.details.length > 0) {
      embed.addFields({
        name: '📋 Details',
        value: suggestion.details.map((d, i) => `${i + 1}. ${d}`).join('\n'),
        inline: false,
      });
    }

    // Add target user if present
    if (suggestion.targetUser) {
      embed.addFields({
        name: '👤 Target User',
        value: `<@${suggestion.targetUser.id}> (${suggestion.targetUser.username})`,
        inline: true,
      });
    }

    // Add confidence if present
    if (suggestion.confidence !== undefined) {
      embed.addFields({
        name: '🎯 Confidence',
        value: `${(suggestion.confidence * 100).toFixed(1)}%`,
        inline: true,
      });
    }

    // Add severity
    embed.addFields({
      name: '⚡ Severity',
      value: suggestion.severity.toUpperCase(),
      inline: true,
    });

    // Add suggested actions if present
    if (suggestion.suggestedActions && suggestion.suggestedActions.length > 0) {
      embed.addFields({
        name: '🔧 Suggested Actions',
        value: suggestion.suggestedActions.map((a, i) => `${i + 1}. ${a}`).join('\n'),
        inline: false,
      });
    }

    // Timestamp
    embed.setTimestamp(suggestion.timestamp);
    embed.setFooter({ text: 'Becas AI Autonomous System' });

    return embed;
  }

  /**
   * Post multiple suggestions at once (batch)
   */
  async postSuggestions(guild: Guild, suggestions: AISuggestion[]): Promise<number> {
    let successCount = 0;

    for (const suggestion of suggestions) {
      const success = await this.postSuggestion(guild, suggestion);
      if (success) successCount++;

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return successCount;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      cachedGuilds: Object.keys(this.channelCache).length,
      channels: this.channelCache,
    };
  }
}
