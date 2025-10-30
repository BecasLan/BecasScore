/**
 * CONTEXT RESOLVER - Fill Missing Parameters Using Context
 *
 * When AI can't extract a parameter (e.g., "şu adamı" = "that guy"),
 * this service uses context clues to resolve ambiguous references.
 *
 * Strategies:
 * - Last mention in channel
 * - Replied message author
 * - Recent argument participants
 * - Last command target
 */

import { Message, User, TextChannel, GuildMember } from 'discord.js';
import { createLogger } from './Logger';

const logger = createLogger('ContextResolver');

export interface ResolutionCandidate {
  userId: string;
  username: string;
  confidence: number; // 0.0-1.0
  reason: string; // Why this candidate was selected
  member?: GuildMember;
}

export interface ResolvedParameter {
  value: any;
  confidence: number;
  method: string; // Which strategy was used
}

export class ContextResolver {
  // Cache last command targets per moderator (5 min TTL)
  private lastCommandTargets: Map<string, { userId: string; timestamp: number }> = new Map();

  constructor() {
    // Clean cache every 5 minutes
    setInterval(() => this.cleanCache(), 300000);
  }

  /**
   * Resolve a missing user parameter using context
   */
  async resolveMissingUser(
    message: Message,
    strategies: string[]
  ): Promise<ResolutionCandidate[]> {
    const candidates: ResolutionCandidate[] = [];

    for (const strategy of strategies) {
      try {
        switch (strategy) {
          case 'check_replied_message_author':
            {
              const candidate = await this.checkRepliedMessage(message);
              if (candidate) candidates.push(candidate);
            }
            break;

          case 'check_last_mention':
            {
              const candidate = await this.checkLastMention(message);
              if (candidate) candidates.push(candidate);
            }
            break;

          case 'check_last_argument_participants':
            {
              const candidatesList = await this.checkArgumentParticipants(message);
              candidates.push(...candidatesList);
            }
            break;

          case 'check_last_command_target':
            {
              const candidate = this.checkLastCommandTarget(message.author.id);
              if (candidate) candidates.push(candidate);
            }
            break;
        }
      } catch (error) {
        logger.error(`Strategy ${strategy} failed`, error);
      }
    }

    // Sort by confidence (highest first)
    candidates.sort((a, b) => b.confidence - a.confidence);

    // Remove duplicates (keep highest confidence)
    const seen = new Set<string>();
    const unique = candidates.filter(c => {
      if (seen.has(c.userId)) return false;
      seen.add(c.userId);
      return true;
    });

    logger.info(`Resolved ${unique.length} candidates for user parameter`);
    return unique;
  }

  /**
   * Strategy: Check if moderator replied to a message
   */
  private async checkRepliedMessage(message: Message): Promise<ResolutionCandidate | null> {
    if (!message.reference) return null;

    try {
      const repliedMessage = await message.fetchReference();
      const author = repliedMessage.author;

      if (author.bot) return null; // Don't target bots

      return {
        userId: author.id,
        username: author.username,
        confidence: 0.95, // Very high confidence
        reason: 'Moderator replied to this user\'s message',
        member: repliedMessage.member || undefined
      };
    } catch (error) {
      logger.debug('Could not fetch replied message', error);
      return null;
    }
  }

  /**
   * Strategy: Find last mentioned user in moderator's message
   */
  private async checkLastMention(message: Message): Promise<ResolutionCandidate | null> {
    if (message.mentions.users.size === 0) return null;

    // Get first mentioned user (moderators usually mention first)
    const mentionedUser = message.mentions.users.first();
    if (!mentionedUser || mentionedUser.bot) return null;

    const member = message.guild?.members.cache.get(mentionedUser.id);

    return {
      userId: mentionedUser.id,
      username: mentionedUser.username,
      confidence: 0.90, // High confidence
      reason: 'User was mentioned in command',
      member: member
    };
  }

  /**
   * Strategy: Find users involved in recent arguments/conflicts
   */
  private async checkArgumentParticipants(message: Message): Promise<ResolutionCandidate[]> {
    if (!(message.channel instanceof TextChannel)) return [];

    try {
      // Fetch last 10 messages before moderator's message
      const messages = await message.channel.messages.fetch({ limit: 10, before: message.id });

      // Detect conflict patterns
      const userMessageCounts = new Map<string, number>();
      const userLastMessage = new Map<string, Message>();

      for (const [, msg] of messages) {
        if (msg.author.bot) continue;

        const count = userMessageCounts.get(msg.author.id) || 0;
        userMessageCounts.set(msg.author.id, count + 1);
        userLastMessage.set(msg.author.id, msg);
      }

      // Find users with multiple messages (active in argument)
      const candidates: ResolutionCandidate[] = [];

      for (const [userId, count] of userMessageCounts) {
        if (count >= 2) { // At least 2 messages = engaged in discussion
          const msg = userLastMessage.get(userId)!;
          const member = msg.member;

          candidates.push({
            userId,
            username: msg.author.username,
            confidence: 0.70 + (count * 0.05), // More messages = higher confidence
            reason: `Active in recent discussion (${count} messages)`,
            member: member || undefined
          });
        }
      }

      return candidates;

    } catch (error) {
      logger.debug('Could not fetch recent messages', error);
      return [];
    }
  }

  /**
   * Strategy: Get last user this moderator took action on
   */
  private checkLastCommandTarget(moderatorId: string): ResolutionCandidate | null {
    const cached = this.lastCommandTargets.get(moderatorId);
    if (!cached) return null;

    // Check if cache is still valid (5 min)
    const age = Date.now() - cached.timestamp;
    if (age > 300000) {
      this.lastCommandTargets.delete(moderatorId);
      return null;
    }

    return {
      userId: cached.userId,
      username: 'Previous target', // We don't cache username
      confidence: 0.65, // Medium confidence
      reason: 'Last user this moderator targeted'
    };
  }

  /**
   * Remember last command target for this moderator
   */
  rememberTarget(moderatorId: string, targetUserId: string): void {
    this.lastCommandTargets.set(moderatorId, {
      userId: targetUserId,
      timestamp: Date.now()
    });
  }

  /**
   * Parse time expression (Turkish/English) into milliseconds
   */
  parseTimeExpression(input: string): number | null {
    const normalized = input.toLowerCase().trim();

    // English patterns
    const enPatterns: { [key: string]: number } = {
      's': 1000,
      'sec': 1000,
      'second': 1000,
      'seconds': 1000,
      'm': 60000,
      'min': 60000,
      'minute': 60000,
      'minutes': 60000,
      'h': 3600000,
      'hour': 3600000,
      'hours': 3600000,
      'd': 86400000,
      'day': 86400000,
      'days': 86400000
    };

    // Turkish patterns
    const trPatterns: { [key: string]: number } = {
      'saniye': 1000,
      'sn': 1000,
      'dakika': 60000,
      'dk': 60000,
      'saat': 3600000,
      'sa': 3600000,
      'gün': 86400000
    };

    // Try to match patterns like "10m", "1h", "30 dakika"
    const regex = /(\d+)\s*([a-zığüşöç]+)/gi;
    const matches = [...normalized.matchAll(regex)];

    if (matches.length === 0) return null;

    let totalMs = 0;

    for (const match of matches) {
      const amount = parseInt(match[1]);
      const unit = match[2].toLowerCase();

      const multiplier = enPatterns[unit] || trPatterns[unit];
      if (!multiplier) continue;

      totalMs += amount * multiplier;
    }

    return totalMs > 0 ? totalMs : null;
  }

  /**
   * Parse number from string
   */
  parseNumber(input: string): number | null {
    const match = input.match(/\d+/);
    return match ? parseInt(match[0]) : null;
  }

  /**
   * Resolve current channel
   */
  async resolveCurrentChannel(message: Message): Promise<ResolvedParameter | null> {
    if (!(message.channel instanceof TextChannel)) return null;

    return {
      value: message.channel.id,
      confidence: 1.0,
      method: 'current_channel'
    };
  }

  /**
   * Clean expired cache entries
   */
  private cleanCache(): void {
    const now = Date.now();
    for (const [moderatorId, data] of this.lastCommandTargets) {
      if (now - data.timestamp > 300000) {
        this.lastCommandTargets.delete(moderatorId);
      }
    }
  }
}
