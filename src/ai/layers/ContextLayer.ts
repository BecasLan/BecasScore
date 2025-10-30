/**
 * CONTEXT LAYER - Conversation Thread & Historical Context Analysis
 *
 * Analyzes conversation context to understand:
 * - Was user provoked?
 * - Is this an escalation of previous conflict?
 * - Who said what when?
 * - Conversation flow and participant dynamics
 *
 * Purpose:
 * - Fair moderation (consider provocation)
 * - Detect multi-message harassment
 * - Understand conversation escalation
 * - Identify argument participants
 */

import { Message, TextChannel } from 'discord.js';
import { MessageRepository } from '../../database/repositories/MessageRepository';
import { OllamaService } from '../../services/OllamaService';
import { createLogger } from '../../services/Logger';

const logger = createLogger('ContextLayer');

export interface ContextResult {
  // Thread Analysis
  thread: {
    isReply: boolean;
    repliedTo?: {
      userId: string;
      content: string;
      toxicity?: number;
    };
    threadLength: number; // How many messages in this thread
    threadParticipants: string[]; // User IDs in this thread
  };

  // Provocation Detection
  provocation: {
    wasProvoked: boolean;
    provoker?: string; // User ID who provoked
    provocationSeverity: number; // 0-1
    reasoning: string;
  };

  // Conversation Context
  conversation: {
    recentMessages: Array<{
      userId: string;
      content: string;
      timestamp: Date;
      toxicity?: number;
    }>;
    isEscalating: boolean; // Conflict getting worse
    conflictDuration: number; // Minutes
    mood: 'calm' | 'tense' | 'heated' | 'hostile';
  };

  // Historical Patterns
  history: {
    hasInteractedBefore: boolean;
    previousConflicts: number;
    relationshipType: 'friendly' | 'neutral' | 'hostile' | 'unknown';
  };

  processingTime: number;
}

export class ContextLayer {
  private ollama: OllamaService;

  constructor(
    private messageRepo: MessageRepository
  ) {
    this.ollama = new OllamaService('analysis'); // Qwen3:8b
    logger.info('ContextLayer initialized');
  }

  /**
   * Analyze conversation context
   */
  async analyze(message: Message): Promise<ContextResult> {
    const startTime = Date.now();

    try {
      // Get thread info if this is a reply
      const threadInfo = await this.analyzeThread(message);

      // Get recent conversation context (last 20 messages in channel)
      const recentMessages = await this.getRecentMessages(message);

      // Detect provocation if replying to someone
      const provocationInfo = await this.detectProvocation(message, threadInfo, recentMessages);

      // Analyze conversation escalation
      const conversationInfo = await this.analyzeConversation(recentMessages);

      // Get historical interaction patterns
      const historyInfo = await this.analyzeHistory(message, recentMessages);

      return {
        thread: threadInfo,
        provocation: provocationInfo,
        conversation: conversationInfo,
        history: historyInfo,
        processingTime: Date.now() - startTime,
      };

    } catch (error) {
      logger.error('Context analysis failed', error);

      // Fallback result
      return {
        thread: {
          isReply: false,
          threadLength: 0,
          threadParticipants: [],
        },
        provocation: {
          wasProvoked: false,
          provocationSeverity: 0,
          reasoning: 'Analysis failed',
        },
        conversation: {
          recentMessages: [],
          isEscalating: false,
          conflictDuration: 0,
          mood: 'calm',
        },
        history: {
          hasInteractedBefore: false,
          previousConflicts: 0,
          relationshipType: 'unknown',
        },
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Analyze thread structure
   */
  private async analyzeThread(message: Message): Promise<ContextResult['thread']> {
    if (!message.reference) {
      return {
        isReply: false,
        threadLength: 0,
        threadParticipants: [],
      };
    }

    try {
      // Get replied-to message
      const repliedMsg = await message.channel.messages.fetch(message.reference.messageId!);

      // TODO: Query database for full thread analysis
      // For now, simplified analysis

      return {
        isReply: true,
        repliedTo: {
          userId: repliedMsg.author.id,
          content: repliedMsg.content,
          toxicity: undefined, // Would get from database
        },
        threadLength: 2, // Simplified
        threadParticipants: [message.author.id, repliedMsg.author.id],
      };

    } catch (error) {
      logger.error('Failed to analyze thread', error);
      return {
        isReply: false,
        threadLength: 0,
        threadParticipants: [],
      };
    }
  }

  /**
   * Get recent messages for context
   */
  private async getRecentMessages(message: Message): Promise<ContextResult['conversation']['recentMessages']> {
    try {
      const channel = message.channel as TextChannel;
      const messages = await channel.messages.fetch({ limit: 20, before: message.id });

      return Array.from(messages.values()).map(msg => ({
        userId: msg.author.id,
        content: msg.content,
        timestamp: msg.createdAt,
        toxicity: undefined, // Would get from database
      }));

    } catch (error) {
      logger.error('Failed to fetch recent messages', error);
      return [];
    }
  }

  /**
   * Detect if user was provoked
   */
  private async detectProvocation(
    message: Message,
    threadInfo: ContextResult['thread'],
    recentMessages: ContextResult['conversation']['recentMessages']
  ): Promise<ContextResult['provocation']> {
    if (!threadInfo.isReply || !threadInfo.repliedTo) {
      return {
        wasProvoked: false,
        provocationSeverity: 0,
        reasoning: 'Not a reply',
      };
    }

    const prompt = `Analyze if the user's response was provoked by the previous message.

Previous message (from ${threadInfo.repliedTo.userId}):
"${threadInfo.repliedTo.content}"

User's response:
"${message.content}"

Consider:
- Was the previous message insulting, aggressive, or provocative?
- Is the user's response defensive or retaliatory?
- Does the severity of the response match the provocation?

Respond ONLY with JSON:
{
  "wasProvoked": true/false,
  "provoker": "${threadInfo.repliedTo.userId}",
  "provocationSeverity": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.2,
        maxTokens: 150,
      });

      const parsed = JSON.parse(result);
      return {
        wasProvoked: parsed.wasProvoked || false,
        provoker: parsed.provoker,
        provocationSeverity: parsed.provocationSeverity || 0,
        reasoning: parsed.reasoning || 'Unknown',
      };

    } catch (error) {
      logger.error('Provocation detection failed', error);
      return {
        wasProvoked: false,
        provocationSeverity: 0,
        reasoning: 'Analysis failed',
      };
    }
  }

  /**
   * Analyze conversation for escalation
   */
  private async analyzeConversation(
    recentMessages: ContextResult['conversation']['recentMessages']
  ): Promise<ContextResult['conversation']> {
    if (recentMessages.length === 0) {
      return {
        recentMessages: [],
        isEscalating: false,
        conflictDuration: 0,
        mood: 'calm',
      };
    }

    // Build conversation summary for AI
    const conversationSummary = recentMessages
      .slice(0, 10) // Last 10 messages
      .reverse() // Chronological order
      .map((msg, i) => `${i + 1}. User ${msg.userId}: "${msg.content}"`)
      .join('\n');

    const prompt = `Analyze this conversation for escalation and mood.

Recent conversation:
${conversationSummary}

Determine:
1. Is the conversation escalating (getting more hostile)?
2. Overall mood: calm, tense, heated, or hostile
3. How long has any conflict been going on?

Respond ONLY with JSON:
{
  "isEscalating": true/false,
  "mood": "calm|tense|heated|hostile",
  "conflictDuration": minutes (estimate)
}`;

    try {
      const result = await this.ollama.generate(prompt, undefined, {
        temperature: 0.2,
        maxTokens: 100,
      });

      const parsed = JSON.parse(result);

      return {
        recentMessages,
        isEscalating: parsed.isEscalating || false,
        conflictDuration: parsed.conflictDuration || 0,
        mood: parsed.mood || 'calm',
      };

    } catch (error) {
      logger.error('Conversation analysis failed', error);
      return {
        recentMessages,
        isEscalating: false,
        conflictDuration: 0,
        mood: 'calm',
      };
    }
  }

  /**
   * Analyze historical interactions between users
   */
  private async analyzeHistory(
    message: Message,
    recentMessages: ContextResult['conversation']['recentMessages']
  ): Promise<ContextResult['history']> {
    // TODO: Query database for historical interactions
    // For now, analyze recent messages only

    const authorId = message.author.id;
    const otherUsers = new Set(recentMessages.map(m => m.userId).filter(id => id !== authorId));

    return {
      hasInteractedBefore: otherUsers.size > 0,
      previousConflicts: 0, // Would query database
      relationshipType: 'unknown', // Would analyze from database
    };
  }

  /**
   * Check if two users have conflict history
   */
  async checkConflictHistory(userId1: string, userId2: string, serverId: string): Promise<{
    hasHistory: boolean;
    conflictCount: number;
    lastConflict?: Date;
  }> {
    // TODO: Query database for conflict history between these users
    return {
      hasHistory: false,
      conflictCount: 0,
    };
  }

  /**
   * Get conversation mood over time
   */
  async getMoodTimeline(channelId: string, minutes: number): Promise<Array<{
    timestamp: Date;
    mood: string;
    toxicityScore: number;
  }>> {
    // TODO: Query database for mood timeline
    return [];
  }
}
