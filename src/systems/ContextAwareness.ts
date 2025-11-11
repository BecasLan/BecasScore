// ContextAwareness.ts - Track conversations, resolve references, expand on actions
// Enables: "timeout him", "make it 1 hour", "that user", etc.

import { Message, GuildMember, User } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('ContextAwareness');

// ============================================
// TYPES
// ============================================

export interface ConversationContext {
  channelId: string;
  guildId: string;
  messages: ContextMessage[];
  lastActionExecuted?: ActionContext;
  recentlyMentionedUsers: Map<string, UserReference>; // userId -> reference info
  lastUpdated: number;
}

export interface ContextMessage {
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  mentions: string[]; // user IDs mentioned
}

export interface ActionContext {
  actionType: string; // 'timeout', 'ban', 'kick', 'warn'
  targetUserId: string;
  targetUserTag: string;
  moderatorId: string;
  parameters: Record<string, any>;
  timestamp: number;
  actionId: string; // unique identifier for this action
}

export interface UserReference {
  userId: string;
  userTag: string;
  lastMentionedAt: number;
  mentionCount: number;
  roles: string[]; // role names
}

export interface ResolvedContext {
  targetUserId?: string; // Resolved from "him", "that user", etc.
  actionToModify?: string; // Resolved from "it", "the timeout", etc.
  relatedParameters?: Record<string, any>; // Extracted parameters
  confidence: number; // 0-1
}

// ============================================
// CONTEXT AWARENESS ENGINE
// ============================================

export class ContextAwareness {
  private ollama: OllamaService;
  private contexts: Map<string, ConversationContext> = new Map(); // channelId -> context
  private readonly CONTEXT_WINDOW = 10; // Track last 10 messages per channel
  private readonly CONTEXT_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(ollama: OllamaService) {
    this.ollama = ollama;
    logger.info('ContextAwareness initialized');

    // Cleanup old contexts every minute
    setInterval(() => this.cleanupOldContexts(), 60000);
  }

  /**
   * Track a message in the conversation context
   */
  async trackMessage(message: Message): Promise<void> {
    if (!message.guild || !message.channel) return;

    const channelId = message.channel.id;
    const context = this.getOrCreateContext(channelId, message.guild.id);

    // Extract mentioned users
    const mentions = Array.from(message.mentions.users.keys());

    // Add message to context
    const contextMsg: ContextMessage = {
      authorId: message.author.id,
      authorName: message.author.tag,
      content: message.content,
      timestamp: Date.now(),
      mentions,
    };

    context.messages.push(contextMsg);

    // Update recently mentioned users
    for (const userId of mentions) {
      const user = message.mentions.users.get(userId);
      if (!user) continue;

      const member = await message.guild.members.fetch(userId).catch(() => null);
      const roles = member ? Array.from(member.roles.cache.values()).map((r: any) => r.name) : [];

      const existing = context.recentlyMentionedUsers.get(userId);
      if (existing) {
        existing.lastMentionedAt = Date.now();
        existing.mentionCount++;
      } else {
        context.recentlyMentionedUsers.set(userId, {
          userId,
          userTag: user.tag,
          lastMentionedAt: Date.now(),
          mentionCount: 1,
          roles,
        });
      }
    }

    // Trim to window size
    if (context.messages.length > this.CONTEXT_WINDOW) {
      context.messages = context.messages.slice(-this.CONTEXT_WINDOW);
    }

    context.lastUpdated = Date.now();
    this.contexts.set(channelId, context);

    logger.debug(`Tracked message in channel ${channelId} (${context.messages.length} msgs)`);
  }

  /**
   * Track an executed action for context
   */
  async trackAction(
    message: Message,
    actionType: string,
    targetUserId: string,
    parameters: Record<string, any>
  ): Promise<void> {
    if (!message.guild || !message.channel) return;

    const channelId = message.channel.id;
    const context = this.getOrCreateContext(channelId, message.guild.id);

    const targetMember = await message.guild.members.fetch(targetUserId).catch(() => null);
    const actionId = `${actionType}_${targetUserId}_${Date.now()}`;

    context.lastActionExecuted = {
      actionType,
      targetUserId,
      targetUserTag: targetMember?.user.tag || targetUserId,
      moderatorId: message.author.id,
      parameters,
      timestamp: Date.now(),
      actionId,
    };

    context.lastUpdated = Date.now();
    this.contexts.set(channelId, context);

    logger.info(`Tracked action: ${actionType} on ${targetMember?.user.tag} in channel ${channelId}`);
  }

  /**
   * Resolve ambiguous references in a message using AI and context
   */
  async resolveContext(message: Message): Promise<ResolvedContext> {
    if (!message.guild || !message.channel) {
      return { confidence: 0 };
    }

    const channelId = message.channel.id;
    const context = this.contexts.get(channelId);

    if (!context || context.messages.length === 0) {
      return { confidence: 0 };
    }

    // Build context for AI
    const recentMessages = context.messages.slice(-5).map(m =>
      `[${m.authorName}]: ${m.content}`
    ).join('\n');

    const lastAction = context.lastActionExecuted;
    const lastActionStr = lastAction
      ? `Last action: ${lastAction.actionType} on ${lastAction.targetUserTag} by moderator (${Math.floor((Date.now() - lastAction.timestamp) / 1000)}s ago)`
      : 'No recent actions';

    const recentUsers = Array.from(context.recentlyMentionedUsers.values())
      .sort((a, b) => b.lastMentionedAt - a.lastMentionedAt)
      .slice(0, 3)
      .map(u => `- ${u.userTag} (mentioned ${u.mentionCount}x, ${Math.floor((Date.now() - u.lastMentionedAt) / 1000)}s ago)`)
      .join('\n');

    const prompt = `You are a context resolution AI. Analyze this conversation and resolve ambiguous references.

RECENT CONVERSATION:
${recentMessages}

CURRENT MESSAGE: "${message.content}"

${lastActionStr}

RECENTLY MENTIONED USERS:
${recentUsers || 'None'}

YOUR TASK:
1. If the message contains pronouns (he, him, she, her, they, them, that user, this person), identify WHO it refers to
2. If the message refers to a previous action (it, the timeout, the ban, that action), identify WHAT action
3. If the message modifies a parameter (make it X, change to Y, extend by Z), extract the new parameter value

Respond ONLY with valid JSON:
{
  "targetUserId": "user_id_if_resolved" | null,
  "targetUserTag": "user#tag_if_resolved" | null,
  "actionToModify": "action_type_if_modifying_previous" | null,
  "relatedParameters": {
    "duration_minutes": number | null,
    "reason": "string" | null
  },
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

EXAMPLES:

Input: "timeout him for spam"
Recent: "[Mod]: @John is being annoying"
Output: {"targetUserId": "john_id", "targetUserTag": "John#1234", "actionToModify": null, "relatedParameters": {"reason": "spam"}, "confidence": 0.9, "reasoning": "him refers to John who was just mentioned"}

Input: "make it 1 hour"
Last action: timeout on John#1234
Output: {"targetUserId": "john_id", "targetUserTag": "John#1234", "actionToModify": "timeout", "relatedParameters": {"duration_minutes": 60}, "confidence": 0.95, "reasoning": "it refers to the recent timeout action"}

Input: "ban that spammer"
Recent: "[User1]: this guy keeps posting links", "[User2]: yeah @BadActor is spam"
Output: {"targetUserId": "badactor_id", "targetUserTag": "BadActor#5678", "actionToModify": null, "relatedParameters": {"reason": "spam"}, "confidence": 0.85, "reasoning": "that spammer likely refers to BadActor who was accused of spam"}

Think step-by-step, then output clean JSON.`;

    try {
      const response = await this.ollama.generate(
        prompt,
        'You are a JSON generator. Output ONLY valid JSON. No markdown, no explanations, no extra text.'
      );

      // Extract JSON
      let cleaned = response.trim();
      cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        logger.warn('No JSON found in context resolution response');
        return { confidence: 0 };
      }

      const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);

      logger.info(`Context resolved: ${parsed.reasoning} (confidence: ${parsed.confidence})`);

      // Map userTag back to userId if AI provided tag but not ID
      let resolvedUserId = parsed.targetUserId;
      if (!resolvedUserId && parsed.targetUserTag) {
        // Try to find user by tag in recent mentions
        for (const [userId, ref] of context.recentlyMentionedUsers) {
          if (ref.userTag === parsed.targetUserTag) {
            resolvedUserId = userId;
            break;
          }
        }
      }

      return {
        targetUserId: resolvedUserId,
        actionToModify: parsed.actionToModify,
        relatedParameters: parsed.relatedParameters || {},
        confidence: parsed.confidence || 0,
      };

    } catch (error: any) {
      logger.error('Failed to resolve context:', error);
      return { confidence: 0 };
    }
  }

  /**
   * Get conversation history for a channel
   */
  getConversationHistory(channelId: string): ContextMessage[] {
    const context = this.contexts.get(channelId);
    return context ? [...context.messages] : [];
  }

  /**
   * Get last action executed in a channel
   */
  getLastAction(channelId: string): ActionContext | undefined {
    const context = this.contexts.get(channelId);
    return context?.lastActionExecuted;
  }

  /**
   * Clear context for a channel
   */
  clearContext(channelId: string): void {
    this.contexts.delete(channelId);
    logger.info(`Cleared context for channel ${channelId}`);
  }

  /**
   * Get or create context for a channel
   */
  private getOrCreateContext(channelId: string, guildId: string): ConversationContext {
    let context = this.contexts.get(channelId);
    if (!context) {
      context = {
        channelId,
        guildId,
        messages: [],
        recentlyMentionedUsers: new Map(),
        lastUpdated: Date.now(),
      };
      this.contexts.set(channelId, context);
    }
    return context;
  }

  /**
   * Cleanup old contexts
   */
  private cleanupOldContexts(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [channelId, context] of this.contexts) {
      if (now - context.lastUpdated > this.CONTEXT_TTL) {
        this.contexts.delete(channelId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old conversation contexts`);
    }
  }
}
