/**
 * BULK ACTION RESOLVER - Parse and Resolve Bulk Targets
 *
 * Handles bulk action patterns like:
 * - "last 20 users"
 * - "everyone in this argument"
 * - "all active users"
 */

import { Message, TextChannel, Collection, GuildMember } from 'discord.js';
import { createLogger } from './Logger';

const logger = createLogger('BulkActionResolver');

export interface BulkTarget {
  type: 'last_n_users' | 'argument_participants' | 'all_active' | 'role_members';
  userIds: string[];
  count: number;
  description: string;
}

export class BulkActionResolver {
  /**
   * Parse bulk target expression
   */
  async parseBulkTarget(
    expression: string,
    message: Message
  ): Promise<BulkTarget | null> {
    const normalized = expression.toLowerCase().trim();

    // Pattern: "last N users" / "last N people"
    const lastNPattern = /last\s+(\d+)\s+(users?|people|members?)/i;
    const lastNMatch = normalized.match(lastNPattern);
    if (lastNMatch) {
      const count = parseInt(lastNMatch[1]);
      return await this.getLastNMessageAuthors(message, count);
    }

    // Pattern: "everyone in argument" / "all argument participants"
    if (normalized.includes('argument') || normalized.includes('conflict')) {
      return await this.getArgumentParticipants(message);
    }

    // Pattern: "all active" / "everyone active"
    if (normalized.includes('all active') || normalized.includes('everyone active')) {
      return await this.getAllActiveUsers(message);
    }

    return null;
  }

  /**
   * Get last N unique message authors
   */
  private async getLastNMessageAuthors(
    message: Message,
    count: number
  ): Promise<BulkTarget | null> {
    if (!(message.channel instanceof TextChannel)) return null;

    try {
      // Fetch recent messages (limit to 100 max for performance)
      const fetchLimit = Math.min(count * 3, 100); // Fetch more to account for duplicates
      const messages = await message.channel.messages.fetch({ limit: fetchLimit, before: message.id });

      // Get unique authors (excluding bots and the moderator)
      const uniqueAuthors = new Set<string>();
      for (const [, msg] of messages) {
        if (msg.author.bot) continue;
        if (msg.author.id === message.author.id) continue; // Don't target the moderator

        uniqueAuthors.add(msg.author.id);

        if (uniqueAuthors.size >= count) break;
      }

      const userIds = Array.from(uniqueAuthors);

      return {
        type: 'last_n_users',
        userIds,
        count: userIds.length,
        description: `Last ${userIds.length} unique message authors`
      };

    } catch (error) {
      logger.error('Failed to fetch last N users', error);
      return null;
    }
  }

  /**
   * Get users involved in recent argument/conflict
   */
  private async getArgumentParticipants(
    message: Message
  ): Promise<BulkTarget | null> {
    if (!(message.channel instanceof TextChannel)) return null;

    try {
      // Fetch last 20 messages
      const messages = await message.channel.messages.fetch({ limit: 20, before: message.id });

      // Find users with multiple messages (active in argument)
      const userMessageCounts = new Map<string, number>();

      for (const [, msg] of messages) {
        if (msg.author.bot) continue;
        if (msg.author.id === message.author.id) continue;

        const count = userMessageCounts.get(msg.author.id) || 0;
        userMessageCounts.set(msg.author.id, count + 1);
      }

      // Filter users with 2+ messages (actively participating)
      const participantIds = Array.from(userMessageCounts.entries())
        .filter(([, count]) => count >= 2)
        .map(([userId]) => userId);

      if (participantIds.length === 0) return null;

      return {
        type: 'argument_participants',
        userIds: participantIds,
        count: participantIds.length,
        description: `${participantIds.length} argument participants`
      };

    } catch (error) {
      logger.error('Failed to get argument participants', error);
      return null;
    }
  }

  /**
   * Get all recently active users (last 50 messages)
   */
  private async getAllActiveUsers(
    message: Message
  ): Promise<BulkTarget | null> {
    if (!(message.channel instanceof TextChannel)) return null;

    try {
      // Fetch last 50 messages
      const messages = await message.channel.messages.fetch({ limit: 50, before: message.id });

      // Get unique authors
      const uniqueAuthors = new Set<string>();
      for (const [, msg] of messages) {
        if (msg.author.bot) continue;
        if (msg.author.id === message.author.id) continue;

        uniqueAuthors.add(msg.author.id);
      }

      const userIds = Array.from(uniqueAuthors);

      return {
        type: 'all_active',
        userIds,
        count: userIds.length,
        description: `All ${userIds.length} recently active users`
      };

    } catch (error) {
      logger.error('Failed to get all active users', error);
      return null;
    }
  }

  /**
   * Check if bulk target count is dangerous (>5 users)
   */
  isDangerous(bulkTarget: BulkTarget): boolean {
    return bulkTarget.count > 5;
  }

  /**
   * Get usernames for bulk target (for confirmation UI)
   */
  async getUsernames(
    bulkTarget: BulkTarget,
    guild: Message['guild']
  ): Promise<string[]> {
    if (!guild) return [];

    const usernames: string[] = [];

    for (const userId of bulkTarget.userIds) {
      try {
        const member = await guild.members.fetch(userId);
        usernames.push(member.user.username);
      } catch (error) {
        usernames.push(`Unknown User (${userId})`);
      }
    }

    return usernames;
  }
}
