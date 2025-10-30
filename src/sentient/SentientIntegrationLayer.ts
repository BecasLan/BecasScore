/**
 * SENTIENT INTEGRATION LAYER - Central Hub for Phase 2 Systems
 *
 * Purpose: Wire together all sentient AI systems with event-driven architecture
 * - EmotionEngine: Process emotional events from moderation actions
 * - BehaviorGenePool: Record outcomes and trigger evolution
 * - DreamCycle: Gather memories for nightly processing
 * - VectorStore: Store semantic memories of interactions
 *
 * This layer ensures all sentient systems work together cohesively
 */

import { Message } from 'discord.js';
import { EmotionEngine, EmotionalEvent } from './EmotionEngine';
import { BehaviorGenePool, BehaviorOutcome, Chromosome } from './BehaviorGenePool';
import { DreamCycle } from './DreamCycle';
import { VectorStore } from '../memory/VectorStore';
import { createLogger } from '../services/Logger';

const logger = createLogger('SentientIntegration');

/**
 * Moderation action types that can trigger emotions
 */
export type ModerationActionType =
  | 'ban'
  | 'kick'
  | 'warn'
  | 'timeout'
  | 'delete_message'
  | 'purge'
  | 'raid_detected'
  | 'spam_blocked'
  | 'scam_detected'
  | 'helped_user'
  | 'answered_question'
  | 'conflict_resolved';

/**
 * Outcome of a moderation action (for behavior scoring)
 */
export interface ActionOutcome {
  action: ModerationActionType;
  success: boolean;
  confidence: number; // 0-1 how confident we were
  targetUserId?: string;
  guildId: string;
  reason?: string;
  timestamp: number;
  chromosomeUsed?: string; // Which behavior profile was active
}

/**
 * Memory to be stored for learning
 */
export interface InteractionMemory {
  type: 'conversation' | 'moderation' | 'decision' | 'outcome';
  content: string;
  guildId: string;
  userId?: string;
  importance: number; // 0-1
  emotionalValence: number; // -1 to +1 (negative to positive)
  timestamp: number;
  metadata?: any;
}

/**
 * Decision context (includes emotional state + behavior genes)
 */
export interface DecisionContext {
  emotionalConfidence: number; // 0-1
  responseStyle: 'calm' | 'energetic' | 'cautious' | 'assertive' | 'empathetic';
  priorityShift: {
    safety: number;
    engagement: number;
    learning: number;
  };
  behaviorChromosome: Chromosome;
  behaviorDescription: string;
}

export class SentientIntegrationLayer {
  private emotionEngine: EmotionEngine;
  private behaviorGenePool: BehaviorGenePool;
  private dreamCycle: DreamCycle;
  private vectorStore: VectorStore;

  // Track current chromosome for outcome recording
  private currentChromosome: Chromosome | null = null;

  constructor(
    emotionEngine: EmotionEngine,
    behaviorGenePool: BehaviorGenePool,
    dreamCycle: DreamCycle,
    vectorStore: VectorStore
  ) {
    this.emotionEngine = emotionEngine;
    this.behaviorGenePool = behaviorGenePool;
    this.dreamCycle = dreamCycle;
    this.vectorStore = vectorStore;

    logger.info('SentientIntegrationLayer initialized');
  }

  /**
   * Get current decision context (emotions + behavior)
   * Call this BEFORE making a moderation decision
   */
  async getDecisionContext(): Promise<DecisionContext> {
    // Get emotional influence
    const emotionalInfluence = this.emotionEngine.getEmotionalInfluence();

    // Get best behavior chromosome
    this.currentChromosome = this.behaviorGenePool.getBestChromosome();

    // Generate human-readable description
    const behaviorDescription = this.behaviorGenePool.describeChromosome(this.currentChromosome);

    logger.debug(
      `Decision context: confidence=${(emotionalInfluence.confidence * 100).toFixed(1)}%, ` +
      `style=${emotionalInfluence.responseStyle}, ` +
      `behavior="${behaviorDescription}"`
    );

    return {
      emotionalConfidence: emotionalInfluence.confidence,
      responseStyle: emotionalInfluence.responseStyle,
      priorityShift: emotionalInfluence.priorityShift,
      behaviorChromosome: this.currentChromosome,
      behaviorDescription,
    };
  }

  /**
   * Process a moderation action (triggers emotions)
   * Call this AFTER executing a moderation action
   */
  async processModerationAction(action: ModerationActionType, outcome: ActionOutcome): Promise<void> {
    logger.info(`Processing moderation action: ${action} (success=${outcome.success})`);

    // 1. Trigger emotional response
    await this.triggerEmotion(action, outcome);

    // 2. Record behavior outcome
    await this.recordBehaviorOutcome(outcome);

    // 3. Store memory
    await this.storeMemory({
      type: 'moderation',
      content: `${action}: ${outcome.success ? 'successful' : 'failed'}. Reason: ${outcome.reason || 'none'}`,
      guildId: outcome.guildId,
      userId: outcome.targetUserId,
      importance: outcome.success ? 0.7 : 0.5,
      emotionalValence: outcome.success ? 0.3 : -0.2,
      timestamp: outcome.timestamp,
      metadata: {
        action,
        success: outcome.success,
        confidence: outcome.confidence,
      },
    });

    logger.debug(`✓ Sentient systems updated for action: ${action}`);
  }

  /**
   * Process a conversation interaction
   * Call this when Becas responds to a user
   */
  async processConversation(
    message: Message,
    response: string,
    helpfulness: number // 0-1 how helpful was the response
  ): Promise<void> {
    const content = `User: "${message.content.substring(0, 100)}"\nBecas: "${response.substring(0, 100)}"`;

    // Trigger mild joy if helpful
    if (helpfulness > 0.6) {
      await this.emotionEngine.processEvent({
        type: 'conversation',
        description: 'Helped a user',
        intensity: helpfulness * 0.5,
        primaryEmotion: 'joy',
        valence: 1,
      });
    }

    // Store conversation memory
    await this.storeMemory({
      type: 'conversation',
      content,
      guildId: message.guild!.id,
      userId: message.author.id,
      importance: helpfulness * 0.6,
      emotionalValence: helpfulness > 0.5 ? 0.5 : 0,
      timestamp: Date.now(),
      metadata: {
        messageId: message.id,
        channelId: message.channel.id,
        helpfulness,
      },
    });
  }

  /**
   * Get emotional state summary (for status commands)
   */
  getEmotionalState(): any {
    return this.emotionEngine.getEmotionalState();
  }

  /**
   * Get behavior evolution stats (for status commands)
   */
  getBehaviorStats(): any {
    return this.behaviorGenePool.getStats();
  }

  /**
   * Get dream cycle stats (for status commands)
   */
  getDreamStats(): any {
    return this.dreamCycle.getStats();
  }

  /**
   * Force run dream cycle (for testing)
   */
  async forceDreamCycle(): Promise<void> {
    logger.info('🌙 Forcing dream cycle...');
    await this.dreamCycle.forceRun();
  }

  /**
   * Trigger emotional response based on action
   * @private
   */
  private async triggerEmotion(action: ModerationActionType, outcome: ActionOutcome): Promise<void> {
    let event: EmotionalEvent;

    switch (action) {
      case 'ban':
        event = {
          type: 'moderation',
          description: outcome.success ? 'Moderation successful' : 'Moderation failed',
          intensity: outcome.success ? 0.6 : 0.4,
          primaryEmotion: outcome.success ? 'trust' : 'sadness',
          valence: outcome.success ? 1 : -1,
        };
        break;

      case 'kick':
        event = {
          type: 'moderation',
          description: outcome.success ? 'Moderation successful' : 'Moderation failed',
          intensity: outcome.success ? 0.5 : 0.3,
          primaryEmotion: outcome.success ? 'trust' : 'sadness',
          valence: outcome.success ? 1 : -1,
        };
        break;

      case 'warn':
        event = {
          type: 'moderation',
          description: `Warned user ${outcome.targetUserId}`,
          intensity: 0.3,
          primaryEmotion: 'trust',
          valence: outcome.success ? 1 : 0,
        };
        break;

      case 'raid_detected':
        event = {
          type: 'violation',
          description: 'Raid detected - high alert',
          intensity: 0.9,
          primaryEmotion: 'fear',
          valence: -1,
        };
        break;

      case 'spam_blocked':
        event = {
          type: 'moderation',
          description: 'Blocked spam message',
          intensity: 0.4,
          primaryEmotion: 'trust',
          valence: 1,
        };
        break;

      case 'scam_detected':
        event = {
          type: 'violation',
          description: 'Scam attempt detected',
          intensity: 0.7,
          primaryEmotion: 'fear',
          valence: -1,
        };
        break;

      case 'helped_user':
        event = {
          type: 'conversation',
          description: 'Successfully helped a user',
          intensity: 0.6,
          primaryEmotion: 'joy',
          valence: 1,
        };
        break;

      case 'conflict_resolved':
        event = {
          type: 'achievement',
          description: 'Conflict successfully resolved',
          intensity: 0.7,
          primaryEmotion: 'joy',
          valence: 1,
        };
        break;

      default:
        // Generic action
        event = {
          type: 'moderation',
          description: `Action: ${action}`,
          intensity: 0.2,
          primaryEmotion: 'trust',
          valence: outcome.success ? 1 : -1,
        };
    }

    await this.emotionEngine.processEvent(event);
    logger.debug(`Triggered emotion: ${event.primaryEmotion} (intensity=${event.intensity})`);
  }

  /**
   * Record behavior outcome for genetic evolution
   * @private
   */
  private async recordBehaviorOutcome(outcome: ActionOutcome): Promise<void> {
    if (!this.currentChromosome) {
      logger.warn('No current chromosome to record outcome');
      return;
    }

    // Convert outcome to fitness score (0-1)
    let score = outcome.confidence;

    if (outcome.success) {
      score = Math.min(1.0, score + 0.2); // Bonus for success
    } else {
      score = Math.max(0.0, score - 0.3); // Penalty for failure
    }

    const behaviorOutcome: BehaviorOutcome = {
      chromosomeId: this.currentChromosome.id,
      success: outcome.success,
      score,
      context: `${outcome.action} action`,
      timestamp: outcome.timestamp,
    };

    await this.behaviorGenePool.recordOutcome(behaviorOutcome);
    logger.debug(`Recorded behavior outcome: score=${(score * 100).toFixed(1)}%`);
  }

  /**
   * Store memory in vector database
   * @private
   */
  private async storeMemory(memory: InteractionMemory): Promise<void> {
    try {
      await this.vectorStore.store({
        id: `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        text: memory.content,
        metadata: {
          timestamp: memory.timestamp,
          type: memory.type,
          guildId: memory.guildId,
          userId: memory.userId,
          importance: memory.importance,
          emotionalValence: memory.emotionalValence,
          ...memory.metadata,
        },
      });

      logger.debug(`Stored memory: ${memory.type} (importance=${(memory.importance * 100).toFixed(0)}%)`);
    } catch (error) {
      logger.warn('Failed to store memory (vector store may be unavailable)', error);
    }
  }
}
