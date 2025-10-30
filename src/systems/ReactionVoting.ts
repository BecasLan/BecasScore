// ReactionVoting.ts - Community-driven moderation through reactions

import { Message, MessageReaction, User, TextChannel } from 'discord.js';
import { StorageService } from '../services/StorageService';

export interface VoteRecord {
  messageId: string;
  channelId: string;
  guildId: string;
  authorId: string;
  votes: {
    userId: string;
    userName: string;
    timestamp: Date;
  }[];
  actionTaken: boolean;
  actionType?: 'delete' | 'warn' | 'timeout';
  threshold: number;
}

export class ReactionVoting {
  private storage: StorageService;
  private voteRecords: Map<string, VoteRecord> = new Map();
  private readonly VOTE_EMOJI = '🚫';
  private readonly DEFAULT_THRESHOLD = 3; // 3 votes = action

  constructor(storage: StorageService) {
    this.storage = storage;
  }

  /**
   * Process a reaction add event
   */
  async processReaction(
    reaction: MessageReaction,
    user: User
  ): Promise<{ shouldTakeAction: boolean; actionType: string; voteCount: number }> {
    // Ignore bot reactions
    if (user.bot) return { shouldTakeAction: false, actionType: '', voteCount: 0 };

    // Only process 🚫 emoji
    if (reaction.emoji.name !== this.VOTE_EMOJI) {
      return { shouldTakeAction: false, actionType: '', voteCount: 0 };
    }

    const message = reaction.message;
    const key = `${message.guildId}:${message.id}`;

    // Get or create vote record
    let voteRecord = this.voteRecords.get(key);
    if (!voteRecord) {
      voteRecord = {
        messageId: message.id,
        channelId: message.channelId,
        guildId: message.guildId!,
        authorId: message.author!.id,
        votes: [],
        actionTaken: false,
        threshold: this.DEFAULT_THRESHOLD,
      };
      this.voteRecords.set(key, voteRecord);
    }

    // Add vote if not already voted
    if (!voteRecord.votes.some(v => v.userId === user.id)) {
      voteRecord.votes.push({
        userId: user.id,
        userName: user.username,
        timestamp: new Date(),
      });

      console.log(`🗳️ Vote recorded: ${user.username} voted on message from ${message.author?.username}`);
      console.log(`   Total votes: ${voteRecord.votes.length}/${voteRecord.threshold}`);
    }

    // Check if threshold reached
    if (!voteRecord.actionTaken && voteRecord.votes.length >= voteRecord.threshold) {
      voteRecord.actionTaken = true;

      const actionType = this.determineActionType(voteRecord.votes.length);
      console.log(`⚡ Threshold reached! Taking action: ${actionType}`);

      return {
        shouldTakeAction: true,
        actionType,
        voteCount: voteRecord.votes.length,
      };
    }

    return {
      shouldTakeAction: false,
      actionType: '',
      voteCount: voteRecord.votes.length,
    };
  }

  /**
   * Determine action type based on vote count
   */
  private determineActionType(voteCount: number): string {
    if (voteCount >= 5) return 'timeout'; // 5+ votes = timeout
    if (voteCount >= 3) return 'delete'; // 3-4 votes = delete
    return 'warn'; // Fallback
  }

  /**
   * Get vote statistics for a message
   */
  getVoteStats(messageId: string, guildId: string): VoteRecord | undefined {
    const key = `${guildId}:${messageId}`;
    return this.voteRecords.get(key);
  }

  /**
   * Clear old vote records (cleanup)
   */
  cleanup(): void {
    const now = Date.now();
    const ONE_HOUR = 3600000;

    for (const [key, record] of this.voteRecords.entries()) {
      const oldestVote = record.votes[0];
      if (oldestVote && now - oldestVote.timestamp.getTime() > ONE_HOUR) {
        this.voteRecords.delete(key);
      }
    }

    console.log(`🧹 Cleaned up old vote records. Remaining: ${this.voteRecords.size}`);
  }

  /**
   * Add voting emoji to a message automatically
   */
  async addVoteOption(message: Message): Promise<void> {
    try {
      await message.react(this.VOTE_EMOJI);
    } catch (error) {
      console.error('Failed to add vote reaction:', error);
    }
  }
}
