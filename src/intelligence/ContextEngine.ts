/**
 * CONTEXT ENGINE
 *
 * Tüm geçmişi analiz edip AI'a context sağlar.
 * - Son N action'ı hatırlar
 * - "take it back", "undo that" gibi vague komutları anlar
 * - User history, conversation flow, server state'i bilir
 */

import { UnifiedMemoryStore, MemoryEntry } from '../persistence/UnifiedMemoryStore';
import { createLogger } from '../services/Logger';
import { Message, GuildMember } from 'discord.js';

const logger = createLogger('ContextEngine');

// ============================================
// TYPES
// ============================================

export interface ContextSnapshot {
  guildId: string;
  timestamp: number;

  // Recent actions (last 10)
  recentActions: ActionSummary[];

  // Conversation context (last 20 messages)
  recentMessages: MessageSummary[];

  // User context
  users: Map<string, UserContext>;

  // Server state
  serverState: {
    activeTimeouts: string[];  // User IDs
    recentBans: string[];      // User IDs
    ongoingIncidents: string[];  // Incident IDs
  };
}

export interface ActionSummary {
  id: string;
  type: 'ban' | 'timeout' | 'kick' | 'warn' | 'delete' | 'untimeout' | 'unban';
  targetUserId: string;
  targetUsername: string;
  executedBy: string;
  executedByName: string;
  reason?: string;
  timestamp: number;
  duration?: number;  // For timeout
  canBeUndone: boolean;
}

export interface MessageSummary {
  id: string;
  authorId: string;
  authorName: string;
  content: string;  // Truncated if long
  channelId: string;
  timestamp: number;
  wasFlagged: boolean;
}

export interface UserContext {
  userId: string;
  username: string;
  roles: string[];
  recentActions: string[];  // Action IDs they were involved in
  sentiment: 'positive' | 'neutral' | 'negative';
  trustScore: number;
}

// ============================================
// CONTEXT ENGINE
// ============================================

export class ContextEngine {
  private memory: UnifiedMemoryStore;

  constructor(memory: UnifiedMemoryStore) {
    this.memory = memory;
  }

  /**
   * Get full context snapshot for a guild
   */
  async getContext(guildId: string): Promise<ContextSnapshot> {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Get recent actions (last 10, within 1 hour)
    const actionMemories = await this.memory.query({
      type: 'action',
      guildId,
      since: oneHourAgo,
      limit: 10,
    });

    const recentActions: ActionSummary[] = actionMemories.map(m => ({
      id: m.id,
      type: m.data.type,
      targetUserId: m.data.targetUserId,
      targetUsername: m.data.targetUsername || 'Unknown',
      executedBy: m.data.executedBy,
      executedByName: m.data.executedByName || 'Bot',
      reason: m.data.reason,
      timestamp: m.metadata.createdAt,
      duration: m.data.duration,
      canBeUndone: this.canUndoAction(m.data.type, m.metadata.createdAt),
    }));

    // Get recent messages (last 20, within 10 minutes)
    const tenMinutesAgo = now - 600000;
    const messageMemories = await this.memory.query({
      type: 'conversation',
      guildId,
      since: tenMinutesAgo,
      limit: 20,
    });

    const recentMessages: MessageSummary[] = messageMemories.map(m => ({
      id: m.id,
      authorId: m.data.authorId,
      authorName: m.data.authorName,
      content: this.truncateContent(m.data.content),
      channelId: m.data.channelId,
      timestamp: m.metadata.createdAt,
      wasFlagged: m.metadata.tags.includes('flagged'),
    }));

    // Build user contexts
    const users = new Map<string, UserContext>();
    for (const action of recentActions) {
      if (!users.has(action.targetUserId)) {
        users.set(action.targetUserId, await this.getUserContext(action.targetUserId, guildId));
      }
    }

    // Get server state
    const serverState = await this.getServerState(guildId);

    return {
      guildId,
      timestamp: now,
      recentActions,
      recentMessages,
      users,
      serverState,
    };
  }

  /**
   * Resolve vague references like "him", "that user", "the last person"
   */
  async resolveUserReference(
    reference: string,
    context: ContextSnapshot,
    currentMessage: Message
  ): Promise<string | null> {
    const ref = reference.toLowerCase();

    // Direct mentions
    const mentionMatch = currentMessage.content.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      return mentionMatch[1];
    }

    // "the last person", "that user", "him", "her"
    if (
      ref.includes('last') ||
      ref.includes('that') ||
      ref === 'him' ||
      ref === 'her' ||
      ref.includes('person')
    ) {
      // Return the most recent action target
      if (context.recentActions.length > 0) {
        return context.recentActions[0].targetUserId;
      }
    }

    // "the scammer", "the spammer"
    if (ref.includes('scammer') || ref.includes('spam')) {
      for (const action of context.recentActions) {
        if (action.reason?.toLowerCase().includes('scam') || action.reason?.toLowerCase().includes('spam')) {
          return action.targetUserId;
        }
      }
    }

    // Username match
    for (const [userId, userCtx] of context.users) {
      if (userCtx.username.toLowerCase().includes(ref)) {
        return userId;
      }
    }

    logger.warn(`Could not resolve user reference: "${reference}"`);
    return null;
  }

  /**
   * Resolve vague action references like "that", "the last action", "the ban"
   */
  async resolveActionReference(
    reference: string,
    context: ContextSnapshot
  ): Promise<string | null> {
    const ref = reference.toLowerCase();

    // "the last action", "that action", "it"
    if (
      ref.includes('last') ||
      ref.includes('that') ||
      ref === 'it' ||
      ref.includes('action')
    ) {
      if (context.recentActions.length > 0) {
        return context.recentActions[0].id;
      }
    }

    // "the ban", "the timeout", "the kick"
    const actionTypes = ['ban', 'timeout', 'kick', 'warn', 'delete'];
    for (const type of actionTypes) {
      if (ref.includes(type)) {
        const matchingAction = context.recentActions.find(a => a.type === type);
        if (matchingAction) {
          return matchingAction.id;
        }
      }
    }

    logger.warn(`Could not resolve action reference: "${reference}"`);
    return null;
  }

  /**
   * Build context string for AI prompt
   */
  buildContextPrompt(context: ContextSnapshot): string {
    let prompt = '=== CONTEXT ===\n\n';

    // Recent actions
    if (context.recentActions.length > 0) {
      prompt += 'RECENT ACTIONS (last hour):\n';
      for (const action of context.recentActions) {
        const timeAgo = Math.floor((Date.now() - action.timestamp) / 1000);
        prompt += `- ${timeAgo}s ago: ${action.type.toUpperCase()} ${action.targetUsername} `;
        prompt += `(by ${action.executedByName})`;
        if (action.reason) prompt += ` - Reason: ${action.reason}`;
        if (action.duration) prompt += ` - Duration: ${this.formatDuration(action.duration)}`;
        prompt += `\n`;
      }
      prompt += '\n';
    }

    // Server state
    if (context.serverState.activeTimeouts.length > 0) {
      prompt += `ACTIVE TIMEOUTS: ${context.serverState.activeTimeouts.length} users\n`;
    }
    if (context.serverState.recentBans.length > 0) {
      prompt += `RECENT BANS: ${context.serverState.recentBans.length} users\n`;
    }

    prompt += '\n=== END CONTEXT ===\n';
    return prompt;
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private canUndoAction(actionType: string, timestamp: number): boolean {
    const fiveMinutes = 300000;
    const timeSinceAction = Date.now() - timestamp;

    // Can only undo recent actions (within 5 minutes)
    if (timeSinceAction > fiveMinutes) return false;

    // Can't undo warnings (they're just messages)
    if (actionType === 'warn') return false;

    return true;
  }

  private truncateContent(content: string, maxLength: number = 100): string {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  private async getUserContext(userId: string, guildId: string): Promise<UserContext> {
    // Try to get from memory first
    const profileMemories = await this.memory.query({
      type: 'user_profile',
      guildId,
      tags: [userId],
      limit: 1,
    });

    if (profileMemories.length > 0) {
      const profile = profileMemories[0].data;
      return {
        userId,
        username: profile.username || 'Unknown',
        roles: profile.roles || [],
        recentActions: profile.recentActions || [],
        sentiment: profile.sentiment || 'neutral',
        trustScore: profile.trustScore || 0.5,
      };
    }

    // Default context
    return {
      userId,
      username: 'Unknown',
      roles: [],
      recentActions: [],
      sentiment: 'neutral',
      trustScore: 0.5,
    };
  }

  private async getServerState(guildId: string): Promise<ContextSnapshot['serverState']> {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    // Get recent actions to determine state
    const recentActions = await this.memory.query({
      type: 'action',
      guildId,
      since: oneHourAgo,
    });

    const activeTimeouts = new Set<string>();
    const recentBans = new Set<string>();

    for (const action of recentActions) {
      if (action.data.type === 'timeout') {
        // Check if timeout expired
        const expiresAt = action.metadata.createdAt + (action.data.duration || 600000);
        if (expiresAt > now) {
          activeTimeouts.add(action.data.targetUserId);
        }
      } else if (action.data.type === 'ban') {
        recentBans.add(action.data.targetUserId);
      } else if (action.data.type === 'untimeout') {
        activeTimeouts.delete(action.data.targetUserId);
      } else if (action.data.type === 'unban') {
        recentBans.delete(action.data.targetUserId);
      }
    }

    return {
      activeTimeouts: Array.from(activeTimeouts),
      recentBans: Array.from(recentBans),
      ongoingIncidents: [],  // TODO: Implement incident tracking
    };
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }
}
