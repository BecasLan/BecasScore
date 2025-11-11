/**
 * FINE-TUNING PLUGIN
 *
 * Collects high-quality training data from production events for model fine-tuning.
 * Enables continuous learning from real-world Discord moderation data.
 *
 * Architecture:
 * ALL Events → FineTuningPlugin → Filter Quality Examples → Store Training Data → Export for Fine-Tuning
 *
 * Training Data Sources:
 * - Violation detections (with human feedback)
 * - Moderation actions (successful/unsuccessful)
 * - Trust score changes (behavior patterns)
 * - RAG-enhanced decisions (context-aware examples)
 *
 * Fine-Tuning Workflow:
 * 1. Collect examples during production
 * 2. Filter for quality (high confidence, clear outcomes)
 * 3. Export in fine-tuning format (JSONL)
 * 4. Fine-tune Ollama models periodically
 * 5. A/B test fine-tuned vs base models
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import {
  ViolationDetectedEvent,
  ModerationActionExecutedEvent,
  TrustScoreChangedEvent,
  DomainEvent,
} from '../domain/events/DomainEvent';
import { AnalyticsPlugin } from './AnalyticsPlugin';
import { createLogger } from '../services/Logger';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('FineTuningPlugin');

export interface TrainingExample {
  id: string;
  timestamp: Date;
  category: 'violation_detection' | 'moderation_decision' | 'context_analysis';
  input: string; // Model input (prompt)
  output: string; // Expected model output
  metadata: {
    guildId: string;
    confidence?: number;
    outcome?: 'success' | 'failure' | 'uncertain';
    humanFeedback?: boolean;
    ragEnhanced?: boolean;
  };
  quality: {
    score: number; // 0-1 (higher = better quality example)
    reasons: string[]; // Why this is good/bad training data
  };
}

export interface FineTuningDataset {
  name: string;
  description: string;
  examples: TrainingExample[];
  stats: {
    total: number;
    highQuality: number; // quality >= 0.8
    mediumQuality: number; // 0.5 <= quality < 0.8
    lowQuality: number; // quality < 0.5
    byCategory: Record<string, number>;
  };
  createdAt: Date;
}

/**
 * FineTuningPlugin - Automated training data collection
 */
export class FineTuningPlugin implements Plugin {
  name = 'fine_tuning';
  version = '1.0.0';
  description = 'Training data collection for model fine-tuning';
  dependencies = ['analytics']; // Requires AnalyticsPlugin

  private kernel!: BecasKernel;
  private analyticsPlugin!: AnalyticsPlugin;

  // Training data storage
  private trainingExamples: Map<string, TrainingExample> = new Map();

  // Configuration
  private readonly MIN_CONFIDENCE_FOR_TRAINING = 0.85; // Only collect high-confidence examples
  private readonly MAX_EXAMPLES = 100000; // Max training examples to store
  private readonly DATA_DIR = './data/fine-tuning'; // Export directory

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🎓 Initializing Fine-Tuning Plugin...');

    // Get AnalyticsPlugin for statistics
    this.analyticsPlugin = kernel.getPlugin<AnalyticsPlugin>('analytics')!;
    if (!this.analyticsPlugin) {
      logger.warn('AnalyticsPlugin not found - fine-tuning will have limited context');
    }

    // Subscribe to events
    const eventBus = kernel.getEventBus();

    // Violation detection examples
    eventBus.on<ViolationDetectedEvent['payload']>(
      'violation.detected',
      this.collectViolationExample.bind(this)
    );

    // Moderation action examples
    eventBus.on<ModerationActionExecutedEvent['payload']>(
      'moderation.action_executed',
      this.collectModerationExample.bind(this)
    );

    // RAG-enhanced examples (highest quality)
    eventBus.on('rag.context_enhanced', this.collectRAGExample.bind(this));

    // Ensure data directory exists
    await this.ensureDataDirectory();

    logger.info('✅ Fine-Tuning Plugin initialized');
    logger.info('   → Subscribed to: violation.detected, moderation.action_executed, rag.context_enhanced');
    logger.info(`   → Data directory: ${this.DATA_DIR}`);
    logger.info(`   → Min confidence for training: ${this.MIN_CONFIDENCE_FOR_TRAINING}`);
  }

  /**
   * Collect violation detection example
   */
  private async collectViolationExample(event: ViolationDetectedEvent): Promise<void> {
    try {
      const { violationType, severity, confidence, evidence, reasoning } = event.payload;

      // Only collect high-confidence examples
      if (confidence < this.MIN_CONFIDENCE_FOR_TRAINING) {
        return;
      }

      const guildId = event.metadata.guildId || 'unknown';
      const exampleId = `viol_${event.metadata.eventId}`;

      // Build training example
      const input = `Analyze this message for content policy violations:
Message: "${evidence}"

Determine if this violates content policies and provide:
1. Violation type (if any)
2. Severity level
3. Confidence score
4. Detailed reasoning`;

      const output = `Violation detected:
Type: ${violationType}
Severity: ${severity}
Confidence: ${confidence.toFixed(2)}
Reasoning: ${reasoning}`;

      // Calculate quality score
      const qualityScore = this.calculateQualityScore({
        confidence,
        hasReasoning: reasoning.length > 50,
        clearOutcome: true,
      });

      const example: TrainingExample = {
        id: exampleId,
        timestamp: event.metadata.timestamp,
        category: 'violation_detection',
        input,
        output,
        metadata: {
          guildId,
          confidence,
          outcome: 'success', // Assumed successful detection
        },
        quality: {
          score: qualityScore,
          reasons: this.getQualityReasons(qualityScore, {
            highConfidence: confidence >= 0.9,
            detailedReasoning: reasoning.length > 100,
          }),
        },
      };

      this.addTrainingExample(example);

      logger.debug(`Collected violation example: ${exampleId} (quality: ${qualityScore.toFixed(2)})`);
    } catch (error: any) {
      logger.error('Failed to collect violation example:', error);
    }
  }

  /**
   * Collect moderation action example
   */
  private async collectModerationExample(event: ModerationActionExecutedEvent): Promise<void> {
    try {
      const { actionType, targetUserId, reason, guildId } = event.payload;

      const exampleId = `mod_${event.metadata.eventId}`;

      // Build training example for moderation decision-making
      const input = `Given the following violation, determine the appropriate moderation action:

Violation reason: "${reason}"
User ID: ${targetUserId}
Server context: Standard community guidelines

What action should be taken?`;

      const output = `Recommended action: ${actionType}
Justification: ${reason}`;

      const qualityScore = this.calculateQualityScore({
        confidence: 0.9, // Moderation actions are deliberate
        hasReasoning: reason.length > 20,
        clearOutcome: true,
      });

      const example: TrainingExample = {
        id: exampleId,
        timestamp: event.metadata.timestamp,
        category: 'moderation_decision',
        input,
        output,
        metadata: {
          guildId,
          outcome: 'success',
        },
        quality: {
          score: qualityScore,
          reasons: this.getQualityReasons(qualityScore, {
            executedAction: true,
            clearReason: reason.length > 50,
          }),
        },
      };

      this.addTrainingExample(example);

      logger.debug(`Collected moderation example: ${exampleId} (quality: ${qualityScore.toFixed(2)})`);
    } catch (error: any) {
      logger.error('Failed to collect moderation example:', error);
    }
  }

  /**
   * Collect RAG-enhanced example (highest quality)
   */
  private async collectRAGExample(event: DomainEvent): Promise<void> {
    try {
      const {
        originalConfidence,
        enhancedConfidence,
        precedents,
        enhancedReasoning,
      } = event.payload;

      const guildId = event.metadata.guildId || 'unknown';
      const exampleId = `rag_${event.metadata.eventId}`;

      // RAG examples show context-aware decision-making
      const input = `Analyze the following content moderation case with historical context:

[Context: ${precedents} similar past cases available]

Current case reasoning: ${enhancedReasoning}

Provide an enhanced decision using historical precedents.`;

      const output = `Enhanced analysis:
Original confidence: ${originalConfidence.toFixed(2)}
Enhanced confidence: ${enhancedConfidence.toFixed(2)}
Reasoning: ${enhancedReasoning}
Precedents considered: ${precedents}`;

      // RAG-enhanced examples are highest quality
      const qualityScore = this.calculateQualityScore({
        confidence: enhancedConfidence,
        hasReasoning: true,
        clearOutcome: true,
        ragEnhanced: true,
        precedents,
      });

      const example: TrainingExample = {
        id: exampleId,
        timestamp: event.metadata.timestamp,
        category: 'context_analysis',
        input,
        output,
        metadata: {
          guildId,
          confidence: enhancedConfidence,
          outcome: 'success',
          ragEnhanced: true,
        },
        quality: {
          score: qualityScore,
          reasons: this.getQualityReasons(qualityScore, {
            ragEnhanced: true,
            multiplePrecedents: precedents > 2,
          }),
        },
      };

      this.addTrainingExample(example);

      logger.debug(`Collected RAG example: ${exampleId} (quality: ${qualityScore.toFixed(2)})`);
    } catch (error: any) {
      logger.error('Failed to collect RAG example:', error);
    }
  }

  /**
   * Calculate quality score for a training example
   */
  private calculateQualityScore(factors: {
    confidence: number;
    hasReasoning: boolean;
    clearOutcome: boolean;
    ragEnhanced?: boolean;
    precedents?: number;
  }): number {
    let score = 0;

    // Base score from confidence (0-0.4)
    score += factors.confidence * 0.4;

    // Detailed reasoning (+0.2)
    if (factors.hasReasoning) score += 0.2;

    // Clear outcome (+0.2)
    if (factors.clearOutcome) score += 0.2;

    // RAG-enhanced (bonus +0.15)
    if (factors.ragEnhanced) score += 0.15;

    // Multiple precedents (bonus +0.05)
    if (factors.precedents && factors.precedents > 2) score += 0.05;

    return Math.min(1.0, score);
  }

  /**
   * Get quality reasons for explanation
   */
  private getQualityReasons(
    score: number,
    factors: Record<string, boolean | undefined>
  ): string[] {
    const reasons: string[] = [];

    if (score >= 0.8) reasons.push('High-quality example suitable for fine-tuning');
    else if (score >= 0.5) reasons.push('Medium-quality example, may need review');
    else reasons.push('Low-quality example, not recommended for training');

    if (factors.highConfidence) reasons.push('High confidence score (>= 0.9)');
    if (factors.detailedReasoning) reasons.push('Detailed reasoning provided');
    if (factors.ragEnhanced) reasons.push('RAG-enhanced with historical context');
    if (factors.multiplePrecedents) reasons.push('Multiple precedents available');
    if (factors.executedAction) reasons.push('Real moderation action executed');

    return reasons;
  }

  /**
   * Add training example to collection
   */
  private addTrainingExample(example: TrainingExample): void {
    // Check max capacity
    if (this.trainingExamples.size >= this.MAX_EXAMPLES) {
      logger.warn(`Max training examples reached (${this.MAX_EXAMPLES}) - skipping`);
      return;
    }

    this.trainingExamples.set(example.id, example);
  }

  /**
   * Export training dataset in JSONL format (for Ollama fine-tuning)
   */
  async exportDataset(
    name: string,
    options: {
      minQuality?: number;
      category?: TrainingExample['category'];
      maxExamples?: number;
    } = {}
  ): Promise<string> {
    try {
      const minQuality = options.minQuality || 0.7;

      // Filter examples
      let examples = Array.from(this.trainingExamples.values()).filter(
        ex => ex.quality.score >= minQuality
      );

      // Filter by category if specified
      if (options.category) {
        examples = examples.filter(ex => ex.category === options.category);
      }

      // Limit examples if specified
      if (options.maxExamples) {
        examples = examples.slice(0, options.maxExamples);
      }

      // Create dataset
      const dataset: FineTuningDataset = {
        name,
        description: `Fine-tuning dataset for Becas moderation (min quality: ${minQuality})`,
        examples,
        stats: this.calculateDatasetStats(examples),
        createdAt: new Date(),
      };

      // Export as JSONL (one JSON object per line)
      const jsonlLines = examples.map(ex =>
        JSON.stringify({
          input: ex.input,
          output: ex.output,
          metadata: ex.metadata,
        })
      );

      const filename = `${name}_${Date.now()}.jsonl`;
      const filepath = path.join(this.DATA_DIR, filename);

      await fs.writeFile(filepath, jsonlLines.join('\n'));

      logger.info(`✅ Exported ${examples.length} training examples to ${filepath}`);
      logger.info(`   → High quality: ${dataset.stats.highQuality}`);
      logger.info(`   → Medium quality: ${dataset.stats.mediumQuality}`);
      logger.info(`   → Low quality: ${dataset.stats.lowQuality}`);

      return filepath;
    } catch (error: any) {
      logger.error('Failed to export dataset:', error);
      throw error;
    }
  }

  /**
   * Calculate dataset statistics
   */
  private calculateDatasetStats(
    examples: TrainingExample[]
  ): FineTuningDataset['stats'] {
    const stats = {
      total: examples.length,
      highQuality: examples.filter(ex => ex.quality.score >= 0.8).length,
      mediumQuality: examples.filter(ex => ex.quality.score >= 0.5 && ex.quality.score < 0.8).length,
      lowQuality: examples.filter(ex => ex.quality.score < 0.5).length,
      byCategory: {} as Record<string, number>,
    };

    // Count by category
    for (const example of examples) {
      stats.byCategory[example.category] = (stats.byCategory[example.category] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get training statistics
   */
  getStats(): {
    total: number;
    highQuality: number;
    mediumQuality: number;
    lowQuality: number;
    byCategory: Record<string, number>;
  } {
    const examples = Array.from(this.trainingExamples.values());
    const stats = this.calculateDatasetStats(examples);
    return {
      total: stats.total,
      highQuality: stats.highQuality,
      mediumQuality: stats.mediumQuality,
      lowQuality: stats.lowQuality,
      byCategory: stats.byCategory,
    };
  }

  /**
   * Ensure data directory exists
   */
  private async ensureDataDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.DATA_DIR, { recursive: true });
    } catch (error: any) {
      logger.error('Failed to create data directory:', error);
    }
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Fine-Tuning Plugin...');

    const stats = this.getStats();
    logger.info(`   → ${stats.total} training examples collected`);
    logger.info(`   → High quality: ${stats.highQuality}`);
    logger.info(`   → Medium quality: ${stats.mediumQuality}`);
    logger.info(`   → Low quality: ${stats.lowQuality}`);

    // Auto-export on shutdown if we have enough high-quality examples
    if (stats.highQuality >= 100) {
      logger.info('Auto-exporting high-quality examples...');
      try {
        await this.exportDataset('auto_export', { minQuality: 0.8 });
      } catch (error: any) {
        logger.error('Failed to auto-export dataset:', error);
      }
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return true; // Always healthy
  }
}
