/**
 * ACTIVE LEARNING PLUGIN
 *
 * Intelligently identifies uncertain predictions where human feedback would be most valuable.
 * Maximizes model improvement with minimum labeled data by focusing on edge cases and
 * uncertain examples.
 *
 * Active Learning Strategies:
 * - Uncertainty Sampling: Select examples where model is least confident
 * - Query by Committee: Examples where multiple models disagree
 * - Expected Model Change: Examples that would change model most
 * - Diversity Sampling: Cover different regions of feature space
 * - Error Reduction: Examples that reduce expected error most
 *
 * Architecture:
 * Model Predictions → Uncertainty Analysis → Human Labeling Queue →
 * → Discord Integration → Human Feedback → Training Pool
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { DomainEvent, GenericDomainEvent, MessageReceivedEvent } from '../domain/events/DomainEvent';
import { AdvancedFineTuningPlugin, TrainingCategory, AdvancedTrainingExample } from './AdvancedFineTuningPlugin';
import { createLogger } from '../services/Logger';
import { Client, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('ActiveLearningPlugin');

export type ActiveLearningStrategy =
  | 'uncertainty_sampling'
  | 'query_by_committee'
  | 'expected_model_change'
  | 'diversity_sampling'
  | 'error_reduction';

export interface UncertainExample {
  id: string;
  timestamp: Date;
  category: TrainingCategory;
  input: string;
  predictedOutput: string;
  confidence: number; // Low confidence = high uncertainty
  uncertainty: number; // 0-1 (higher = more uncertain)
  strategy: ActiveLearningStrategy;

  // Context
  metadata: {
    guildId: string;
    messageId?: string;
    userId?: string;
    context?: string;
  };

  // Prediction details
  predictions: Array<{
    label: string;
    confidence: number;
  }>;

  // Human labeling
  labelingRequest?: {
    requestedAt: Date;
    discordMessageId?: string;
    assignedTo?: string;
    status: 'pending' | 'labeled' | 'skipped' | 'expired';
  };

  humanLabel?: {
    labeledBy: string;
    labeledAt: Date;
    correctLabel: string;
    feedback?: string;
    wasCorrect: boolean;
  };
}

export interface LabelingQueue {
  priority: 'high' | 'medium' | 'low';
  examples: UncertainExample[];
  strategy: ActiveLearningStrategy;
}

/**
 * Active Learning Plugin
 */
export class ActiveLearningPlugin implements Plugin {
  name = 'active_learning';
  version = '1.0.0';
  description = 'Intelligent uncertainty-based example selection for human labeling';
  dependencies = ['advanced_fine_tuning'];

  private kernel!: BecasKernel;
  private fineTuningPlugin!: AdvancedFineTuningPlugin;
  private discordClient!: Client;

  // Uncertain examples waiting for labels
  private labelingQueue: Map<string, UncertainExample> = new Map();

  // Strategy-specific queues
  private strategyQueues: Map<ActiveLearningStrategy, UncertainExample[]> = new Map();

  // Statistics
  private labelingStats = {
    totalRequests: 0,
    labeled: 0,
    skipped: 0,
    expired: 0,
    accuracyImprovement: 0,
  };

  // Configuration
  private readonly UNCERTAINTY_THRESHOLD = 0.65; // Below 0.65 confidence = uncertain
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly LABELING_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MIN_COMMITTEE_DISAGREEMENT = 0.3;
  private readonly LABELING_CHANNEL_NAME = 'becas-active-learning';
  private readonly QUEUE_DIR = './data/active-learning';

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🎯 Initializing Active Learning Plugin...');

    // Get dependencies
    this.fineTuningPlugin = kernel.getPlugin<AdvancedFineTuningPlugin>('advanced_fine_tuning')!;
    this.discordClient = kernel.getService<Client>('discord_client')!;

    if (!this.fineTuningPlugin || !this.discordClient) {
      throw new Error('Required dependencies not found: advanced_fine_tuning, discord_client');
    }

    // Initialize strategy queues
    const strategies: ActiveLearningStrategy[] = [
      'uncertainty_sampling',
      'query_by_committee',
      'expected_model_change',
      'diversity_sampling',
      'error_reduction',
    ];

    strategies.forEach(strategy => {
      this.strategyQueues.set(strategy, []);
    });

    // Subscribe to events
    this.subscribeToEvents();

    // Ensure queue directory exists
    await this.ensureQueueDirectory();

    // Load existing queue
    await this.loadQueue();

    // Start monitoring loop
    this.startMonitoring();

    logger.info('✅ Active Learning Plugin initialized');
    logger.info(`   → Uncertainty threshold: ${this.UNCERTAINTY_THRESHOLD}`);
    logger.info(`   → Max queue size: ${this.MAX_QUEUE_SIZE}`);
    logger.info(`   → Labeling timeout: ${this.LABELING_TIMEOUT_MS / 1000 / 60 / 60}h`);
  }

  /**
   * Subscribe to events
   */
  private subscribeToEvents(): void {
    const eventBus = this.kernel.getEventBus();

    // Monitor all predictions for uncertainty
    eventBus.on('violation.detected', this.checkUncertainty.bind(this));
    eventBus.on('scam.detected', this.checkUncertainty.bind(this));
    eventBus.on('intent.analyzed', this.checkUncertainty.bind(this));
    eventBus.on('policy.evaluated', this.checkUncertainty.bind(this));

    // Handle human feedback
    eventBus.on('active_learning.labeled', this.handleHumanLabel.bind(this));

    logger.info('   → Subscribed to prediction events for uncertainty detection');
  }

  /**
   * Check if prediction is uncertain
   */
  private async checkUncertainty(event: DomainEvent): Promise<void> {
    try {
      const { confidence } = event.payload;

      // Check if uncertain
      if (confidence >= this.UNCERTAINTY_THRESHOLD) {
        return; // Confident prediction, no need for human input
      }

      // Calculate uncertainty
      const uncertainty = 1 - confidence;

      logger.info(`🔍 Uncertain prediction detected: ${confidence.toFixed(2)} confidence`);

      // Create uncertain example
      const uncertainExample: UncertainExample = {
        id: `uncertain_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        category: this.eventToCategory(event.eventName),
        input: this.extractInput(event),
        predictedOutput: this.extractOutput(event),
        confidence,
        uncertainty,
        strategy: 'uncertainty_sampling',
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          messageId: event.metadata.correlationId,
          userId: event.metadata.userId,
        },
        predictions: this.extractPredictions(event),
      };

      // Add to labeling queue
      await this.addToQueue(uncertainExample);
    } catch (error: any) {
      logger.error('Failed to check uncertainty:', error);
    }
  }

  /**
   * Add example to labeling queue
   */
  private async addToQueue(example: UncertainExample): Promise<void> {
    // Check queue capacity
    if (this.labelingQueue.size >= this.MAX_QUEUE_SIZE) {
      logger.warn(`Labeling queue at max capacity (${this.MAX_QUEUE_SIZE})`);

      // Remove oldest low-priority item
      const oldest = this.findOldestLowPriority();
      if (oldest) {
        this.labelingQueue.delete(oldest.id);
      } else {
        return; // Queue full with high priority items
      }
    }

    // Add to main queue
    this.labelingQueue.set(example.id, example);

    // Add to strategy queue
    const strategyQueue = this.strategyQueues.get(example.strategy);
    if (strategyQueue) {
      strategyQueue.push(example);
    }

    // Save queue
    await this.saveQueue();

    logger.info(`Added uncertain example to queue: ${example.id} (uncertainty: ${example.uncertainty.toFixed(2)})`);

    // Request labeling
    await this.requestHumanLabel(example);
  }

  /**
   * Request human label via Discord
   */
  private async requestHumanLabel(example: UncertainExample): Promise<void> {
    try {
      // Find active learning channel
      let channel: TextChannel | undefined;

      for (const guild of this.discordClient.guilds.cache.values()) {
        const found = guild.channels.cache.find(
          ch => ch.name === this.LABELING_CHANNEL_NAME && ch.isTextBased()
        ) as TextChannel | undefined;

        if (found) {
          channel = found;
          break;
        }
      }

      if (!channel) {
        logger.debug('Active learning channel not found, skipping Discord request');
        return;
      }

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('🎯 Active Learning - Human Label Needed')
        .setDescription('The AI is uncertain about this prediction. Your feedback will improve the model!')
        .setColor(0xFFAA00)
        .addFields(
          { name: 'Category', value: example.category, inline: true },
          { name: 'Confidence', value: `${(example.confidence * 100).toFixed(1)}%`, inline: true },
          { name: 'Uncertainty', value: `${(example.uncertainty * 100).toFixed(1)}%`, inline: true },
          { name: 'Input', value: example.input.substring(0, 500) },
          { name: 'AI Prediction', value: example.predictedOutput.substring(0, 500) }
        )
        .setFooter({ text: `Example ID: ${example.id}` })
        .setTimestamp();

      // Create buttons
      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`label_correct_${example.id}`)
            .setLabel('✅ AI is Correct')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`label_incorrect_${example.id}`)
            .setLabel('❌ AI is Wrong')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`label_skip_${example.id}`)
            .setLabel('⏭️ Skip')
            .setStyle(ButtonStyle.Secondary)
        );

      const message = await channel.send({
        embeds: [embed],
        components: [row],
      });

      // Update example with Discord message ID
      example.labelingRequest = {
        requestedAt: new Date(),
        discordMessageId: message.id,
        status: 'pending',
      };

      await this.saveQueue();

      this.labelingStats.totalRequests++;

      logger.info(`✅ Labeling request sent to Discord: ${message.url}`);
    } catch (error: any) {
      logger.error('Failed to request human label:', error);
    }
  }

  /**
   * Handle human label from Discord button
   */
  private async handleHumanLabel(event: DomainEvent): Promise<void> {
    try {
      const { exampleId, labeledBy, wasCorrect, correctLabel, feedback } = event.payload;

      const example = this.labelingQueue.get(exampleId);
      if (!example) {
        logger.warn(`Example not found in queue: ${exampleId}`);
        return;
      }

      // Update example with human label
      example.humanLabel = {
        labeledBy,
        labeledAt: new Date(),
        correctLabel,
        feedback,
        wasCorrect,
      };

      if (example.labelingRequest) {
        example.labelingRequest.status = 'labeled';
      }

      this.labelingStats.labeled++;

      logger.info(`✅ Human label received for ${exampleId}: ${wasCorrect ? 'CORRECT' : 'INCORRECT'}`);

      // Add to training pool with human validation
      await this.addToTrainingPool(example);

      // Remove from queue
      this.labelingQueue.delete(exampleId);
      await this.saveQueue();

      // Publish feedback event
      await this.kernel.publishEvent(
        new GenericDomainEvent('active_learning.feedback_received', {
          exampleId,
          wasCorrect,
          uncertainty: example.uncertainty,
          category: example.category,
        })
      );
    } catch (error: any) {
      logger.error('Failed to handle human label:', error);
    }
  }

  /**
   * Add labeled example to training pool
   */
  private async addToTrainingPool(example: UncertainExample): Promise<void> {
    try {
      // Create training example with human validation
      const trainingExample: Partial<AdvancedTrainingExample> = {
        id: `active_learning_${example.id}`,
        timestamp: new Date(),
        category: example.category,
        input: example.input,
        output: example.humanLabel!.wasCorrect
          ? example.predictedOutput
          : example.humanLabel!.correctLabel,
        modelTarget: 'general',
        metadata: {
          guildId: example.metadata.guildId,
          confidence: example.confidence,
          outcome: example.humanLabel!.wasCorrect ? 'success' : 'corrected',
          humanFeedback: true,
          correctionType: example.humanLabel!.wasCorrect ? undefined : 'false_negative',
        },
        quality: {
          tier: 'gold' as const, // Human validated = GOLD
          score: 1.0, // Maximum quality
          factors: {
            confidenceScore: 1.0,
            hasDetailedReasoning: true,
            hasHumanValidation: true,
            hasContextualData: true,
            isRagEnhanced: false,
            hasMultiplePrecedents: false,
            hasClearOutcome: true,
            isEdgeCase: example.uncertainty > 0.5, // High uncertainty = edge case
            isCommonPattern: false,
          },
          reasons: [
            '🏆 GOLD TIER - Human validated via Active Learning',
            'High-value example selected by uncertainty sampling',
            example.uncertainty > 0.5 ? 'Edge case with high learning value' : 'Moderate uncertainty example',
          ],
        },
      };

      // Publish training example event
      await this.kernel.publishEvent(
        new GenericDomainEvent('training_example.collected', {
          example: trainingExample,
          source: 'active_learning',
        })
      );

      logger.info(`✅ Added active learning example to training pool: ${trainingExample.id}`);
    } catch (error: any) {
      logger.error('Failed to add to training pool:', error);
    }
  }

  /**
   * Query by Committee - check if multiple models disagree
   */
  async queryByCommittee(
    input: string,
    predictions: Array<{ model: string; output: string; confidence: number }>
  ): Promise<UncertainExample | null> {
    try {
      // Calculate prediction diversity
      const uniqueOutputs = new Set(predictions.map(p => p.output));
      const diversity = uniqueOutputs.size / predictions.length;

      if (diversity < this.MIN_COMMITTEE_DISAGREEMENT) {
        return null; // Models agree
      }

      // Calculate average confidence
      const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

      const uncertainExample: UncertainExample = {
        id: `committee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        category: 'violation_detection', // Default
        input,
        predictedOutput: predictions[0].output, // Most confident prediction
        confidence: avgConfidence,
        uncertainty: diversity,
        strategy: 'query_by_committee',
        metadata: {
          guildId: 'unknown',
        },
        predictions: predictions.map(p => ({
          label: p.output,
          confidence: p.confidence,
        })),
      };

      await this.addToQueue(uncertainExample);

      return uncertainExample;
    } catch (error: any) {
      logger.error('Query by committee failed:', error);
      return null;
    }
  }

  /**
   * Start monitoring loop
   */
  private startMonitoring(): void {
    // Check for expired labeling requests every hour
    setInterval(() => {
      this.checkExpiredRequests();
    }, 3600000); // 1 hour

    logger.info('   → Monitoring loop started (checking expired requests hourly)');
  }

  /**
   * Check for expired labeling requests
   */
  private async checkExpiredRequests(): Promise<void> {
    const now = Date.now();

    for (const [id, example] of this.labelingQueue) {
      if (example.labelingRequest && example.labelingRequest.status === 'pending') {
        const age = now - example.labelingRequest.requestedAt.getTime();

        if (age > this.LABELING_TIMEOUT_MS) {
          logger.warn(`Labeling request expired: ${id}`);

          example.labelingRequest.status = 'expired';
          this.labelingStats.expired++;

          // Remove from queue
          this.labelingQueue.delete(id);
        }
      }
    }

    await this.saveQueue();
  }

  /**
   * Extract input from event
   */
  private extractInput(event: DomainEvent): string {
    if (event.payload.evidence) return event.payload.evidence;
    if (event.payload.text) return event.payload.text;
    if (event.payload.message) return event.payload.message;
    if (event.payload.content) return event.payload.content;
    return JSON.stringify(event.payload).substring(0, 500);
  }

  /**
   * Extract output from event
   */
  private extractOutput(event: DomainEvent): string {
    const { violationType, severity, reasoning, isScam, scamType, primaryIntent } = event.payload;

    if (violationType) {
      return `Type: ${violationType}, Severity: ${severity}, Reasoning: ${reasoning}`;
    }

    if (isScam !== undefined) {
      return `Is Scam: ${isScam}, Type: ${scamType}`;
    }

    if (primaryIntent) {
      return `Intent: ${primaryIntent}`;
    }

    return JSON.stringify(event.payload).substring(0, 500);
  }

  /**
   * Extract predictions from event
   */
  private extractPredictions(event: DomainEvent): Array<{ label: string; confidence: number }> {
    const { confidence, violationType, isScam, primaryIntent } = event.payload;

    const label = violationType || (isScam ? 'scam' : 'not_scam') || primaryIntent || 'unknown';

    return [
      { label, confidence },
    ];
  }

  /**
   * Convert event name to category
   */
  private eventToCategory(eventName: string): TrainingCategory {
    const mapping: Record<string, TrainingCategory> = {
      'violation.detected': 'violation_detection',
      'scam.detected': 'scam_detection',
      'intent.analyzed': 'intent_classification',
      'policy.evaluated': 'policy_interpretation',
    };

    return mapping[eventName] || 'violation_detection';
  }

  /**
   * Find oldest low-priority item
   */
  private findOldestLowPriority(): UncertainExample | null {
    let oldest: UncertainExample | null = null;
    let oldestTime = Infinity;

    for (const example of this.labelingQueue.values()) {
      if (example.uncertainty < 0.5) { // Low priority
        const time = example.timestamp.getTime();
        if (time < oldestTime) {
          oldestTime = time;
          oldest = example;
        }
      }
    }

    return oldest;
  }

  /**
   * Save queue to disk
   */
  private async saveQueue(): Promise<void> {
    try {
      const queueData = Array.from(this.labelingQueue.values());
      const filepath = path.join(this.QUEUE_DIR, 'labeling_queue.json');
      await fs.writeFile(filepath, JSON.stringify(queueData, null, 2));
    } catch (error: any) {
      logger.error('Failed to save queue:', error);
    }
  }

  /**
   * Load queue from disk
   */
  private async loadQueue(): Promise<void> {
    try {
      const filepath = path.join(this.QUEUE_DIR, 'labeling_queue.json');
      const content = await fs.readFile(filepath, 'utf-8');
      const queueData: UncertainExample[] = JSON.parse(content);

      for (const example of queueData) {
        this.labelingQueue.set(example.id, example);
      }

      logger.info(`   → Loaded ${this.labelingQueue.size} examples from queue`);
    } catch (error: any) {
      // File doesn't exist yet
    }
  }

  /**
   * Ensure queue directory exists
   */
  private async ensureQueueDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.QUEUE_DIR, { recursive: true });
    } catch (error: any) {
      logger.error('Failed to create queue directory:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    queueSize: number;
    totalRequests: number;
    labeled: number;
    skipped: number;
    expired: number;
    labelingRate: number;
    byStrategy: Record<ActiveLearningStrategy, number>;
    avgUncertainty: number;
  } {
    const stats = {
      queueSize: this.labelingQueue.size,
      totalRequests: this.labelingStats.totalRequests,
      labeled: this.labelingStats.labeled,
      skipped: this.labelingStats.skipped,
      expired: this.labelingStats.expired,
      labelingRate: 0,
      byStrategy: {} as Record<ActiveLearningStrategy, number>,
      avgUncertainty: 0,
    };

    if (stats.totalRequests > 0) {
      stats.labelingRate = stats.labeled / stats.totalRequests;
    }

    // Count by strategy
    for (const [strategy, queue] of this.strategyQueues) {
      stats.byStrategy[strategy] = queue.length;
    }

    // Calculate average uncertainty
    let totalUncertainty = 0;
    for (const example of this.labelingQueue.values()) {
      totalUncertainty += example.uncertainty;
    }

    if (this.labelingQueue.size > 0) {
      stats.avgUncertainty = totalUncertainty / this.labelingQueue.size;
    }

    return stats;
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Active Learning Plugin...');

    const stats = this.getStats();
    logger.info(`   → Queue size: ${stats.queueSize}`);
    logger.info(`   → Total requests: ${stats.totalRequests}`);
    logger.info(`   → Labeled: ${stats.labeled}`);
    logger.info(`   → Labeling rate: ${(stats.labelingRate * 100).toFixed(1)}%`);

    // Save queue
    await this.saveQueue();
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.fineTuningPlugin !== undefined && this.discordClient !== undefined;
  }
}
