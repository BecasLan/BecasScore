/**
 * FINE-TUNING ORCHESTRATOR PLUGIN
 *
 * Manages the entire fine-tuning lifecycle:
 * 1. Data Collection → 2. Quality Filtering → 3. Dataset Balancing →
 * 4. Export to Ollama Format → 5. Fine-Tune Model → 6. A/B Testing →
 * 7. Performance Evaluation → 8. Model Promotion/Rollback
 *
 * Automated Fine-Tuning Pipeline:
 * - Monitors training data collection progress
 * - Automatically triggers fine-tuning when thresholds met
 * - Manages multiple models for different tasks
 * - Handles model versioning and rollback
 * - Integrates with A/B testing for validation
 *
 * Architecture:
 * AdvancedFineTuningPlugin → Orchestrator → Ollama Fine-Tuning →
 * → ModelABTestingPlugin → Performance Evaluation → Auto-Promotion
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { GenericDomainEvent } from '../domain/events/DomainEvent';
import { AdvancedFineTuningPlugin, TrainingCategory, QualityTier } from './AdvancedFineTuningPlugin';
import { ModelABTestingPlugin, TaskType, ModelConfig } from './ModelABTestingPlugin';
import { createLogger } from '../services/Logger';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const logger = createLogger('FineTuningOrchestrator');

// ========================================
// ORCHESTRATOR TYPES
// ========================================

export type PipelineStage =
  | 'collecting'
  | 'ready_for_training'
  | 'training'
  | 'testing'
  | 'evaluating'
  | 'promoting'
  | 'deployed'
  | 'failed';

export interface FineTuningJob {
  id: string;
  category: TrainingCategory;
  baseModel: string; // e.g., "qwen3:1.7b"
  targetModel: string; // e.g., "becas-qwen-violations-v1"
  stage: PipelineStage;
  createdAt: Date;
  updatedAt: Date;

  // Data collection
  trainingExamples: number;
  goldExamples: number;
  silverExamples: number;
  bronzeExamples: number;

  // Training
  datasetPath?: string;
  modelfilePath?: string;
  fineTuningStarted?: Date;
  fineTuningCompleted?: Date;
  fineTuningError?: string;

  // Testing
  abTestsCompleted: number;
  winRate?: number;
  averageQualityImprovement?: number;

  // Promotion
  promoted: boolean;
  promotedAt?: Date;
  promotionReason?: string;

  // Versioning
  version: number;
  previousVersion?: string;
}

export interface OrchestratorConfig {
  // Thresholds for automatic fine-tuning
  minGoldExamples: number;
  minTotalExamples: number;
  minQualityScore: number;

  // A/B testing requirements
  minTestsBeforePromotion: number;
  minWinRateForPromotion: number;

  // Automation settings
  autoFineTune: boolean;
  autoPromote: boolean;
  autoRollback: boolean;
}

/**
 * Fine-Tuning Orchestrator Plugin
 */
export class FineTuningOrchestratorPlugin implements Plugin {
  name = 'fine_tuning_orchestrator';
  version = '1.0.0';
  description = 'Automated fine-tuning pipeline orchestration and model management';
  dependencies = ['advanced_fine_tuning', 'model_ab_testing'];

  private kernel!: BecasKernel;
  private fineTuningPlugin!: AdvancedFineTuningPlugin;
  private abTestingPlugin!: ModelABTestingPlugin;

  // Active fine-tuning jobs
  private jobs: Map<string, FineTuningJob> = new Map();

  // Model registry (category → deployed model)
  private deployedModels: Map<TrainingCategory, ModelConfig> = new Map();

  // Configuration
  private config: OrchestratorConfig = {
    minGoldExamples: 500, // Need 500+ GOLD tier examples
    minTotalExamples: 2000, // Total 2000+ examples
    minQualityScore: 0.85, // Average quality >= 0.85
    minTestsBeforePromotion: 100,
    minWinRateForPromotion: 0.65,
    autoFineTune: true,
    autoPromote: false, // Manual approval for safety
    autoRollback: true,
  };

  private readonly JOBS_DIR = './data/fine-tuning/jobs';
  private readonly MODELFILES_DIR = './data/fine-tuning/modelfiles';

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🎯 Initializing Fine-Tuning Orchestrator Plugin...');

    // Get dependent plugins
    this.fineTuningPlugin = kernel.getPlugin<AdvancedFineTuningPlugin>('advanced_fine_tuning')!;
    this.abTestingPlugin = kernel.getPlugin<ModelABTestingPlugin>('model_ab_testing')!;

    if (!this.fineTuningPlugin || !this.abTestingPlugin) {
      throw new Error('Required plugins not found: advanced_fine_tuning, model_ab_testing');
    }

    // Subscribe to events
    this.subscribeToEvents();

    // Ensure directories exist
    await this.ensureDirectories();

    // Load existing jobs
    await this.loadJobs();

    // Start monitoring loop
    this.startMonitoring();

    logger.info('✅ Fine-Tuning Orchestrator initialized');
    logger.info(`   → Auto fine-tune: ${this.config.autoFineTune ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`   → Auto promote: ${this.config.autoPromote ? 'ENABLED' : 'DISABLED'}`);
    logger.info(`   → Thresholds: ${this.config.minGoldExamples} gold, ${this.config.minTotalExamples} total`);
  }

  /**
   * Subscribe to events
   */
  private subscribeToEvents(): void {
    const eventBus = this.kernel.getEventBus();

    // Monitor A/B test completions
    eventBus.on('ab_test.completed', this.handleABTestCompleted.bind(this));

    logger.info('   → Subscribed to orchestration events');
  }

  /**
   * Start monitoring loop for automatic fine-tuning
   */
  private startMonitoring(): void {
    // Check every hour
    setInterval(() => {
      if (this.config.autoFineTune) {
        this.checkFineTuningReadiness();
      }
    }, 3600000); // 1 hour

    // Initial check
    if (this.config.autoFineTune) {
      setTimeout(() => this.checkFineTuningReadiness(), 5000); // Check after 5s
    }

    logger.info('   → Monitoring loop started (checking every hour)');
  }

  /**
   * Check if any category is ready for fine-tuning
   */
  private async checkFineTuningReadiness(): Promise<void> {
    logger.debug('🔍 Checking fine-tuning readiness...');

    const stats = this.fineTuningPlugin.getStats();

    // Check each category
    const categories: TrainingCategory[] = Object.keys(stats.byCategory) as TrainingCategory[];

    for (const category of categories) {
      const categoryCount = stats.byCategory[category] || 0;
      const avgQuality = stats.avgQualityPerCategory[category] || 0;

      // Calculate gold/silver/bronze for this category (approximate)
      const goldRatio = stats.byTier.gold / stats.totalExamples;
      const goldCount = Math.floor(categoryCount * goldRatio);

      // Check thresholds
      if (
        goldCount >= this.config.minGoldExamples &&
        categoryCount >= this.config.minTotalExamples &&
        avgQuality >= this.config.minQualityScore
      ) {
        logger.info(`✅ Category "${category}" ready for fine-tuning!`);
        logger.info(`   → Gold examples: ${goldCount}`);
        logger.info(`   → Total examples: ${categoryCount}`);
        logger.info(`   → Avg quality: ${avgQuality.toFixed(2)}`);

        // Check if already fine-tuning or deployed
        const existingJob = Array.from(this.jobs.values()).find(
          job => job.category === category && (job.stage === 'training' || job.stage === 'testing')
        );

        if (existingJob) {
          logger.debug(`   → Job already in progress: ${existingJob.id}`);
          continue;
        }

        // Create new fine-tuning job
        await this.createFineTuningJob(category);
      }
    }
  }

  /**
   * Create new fine-tuning job
   */
  async createFineTuningJob(category: TrainingCategory): Promise<FineTuningJob> {
    logger.info(`🚀 Creating fine-tuning job for category: ${category}`);

    // Determine base model (category-specific)
    const baseModel = this.getBaseModelForCategory(category);

    // Generate target model name
    const version = this.getNextVersion(category);
    const targetModel = `becas-${baseModel.split(':')[0]}-${category}-v${version}`;

    const job: FineTuningJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      category,
      baseModel,
      targetModel,
      stage: 'collecting',
      createdAt: new Date(),
      updatedAt: new Date(),
      trainingExamples: 0,
      goldExamples: 0,
      silverExamples: 0,
      bronzeExamples: 0,
      abTestsCompleted: 0,
      promoted: false,
      version,
    };

    this.jobs.set(job.id, job);
    await this.saveJob(job);

    // Immediately start fine-tuning
    await this.executeFineTuning(job);

    return job;
  }

  /**
   * Execute fine-tuning process
   */
  private async executeFineTuning(job: FineTuningJob): Promise<void> {
    try {
      logger.info(`🎓 Starting fine-tuning: ${job.id}`);
      logger.info(`   → Category: ${job.category}`);
      logger.info(`   → Base model: ${job.baseModel}`);
      logger.info(`   → Target model: ${job.targetModel}`);

      // Update stage
      job.stage = 'training';
      job.updatedAt = new Date();
      job.fineTuningStarted = new Date();
      await this.saveJob(job);

      // Step 1: Export dataset
      logger.info('   Step 1/4: Exporting training dataset...');
      const datasetPath = await this.fineTuningPlugin.exportDataset(
        `${job.category}_v${job.version}`,
        {
          category: job.category,
          minTier: 'bronze' as QualityTier,
          balance: true,
        }
      );

      job.datasetPath = datasetPath;
      await this.saveJob(job);

      // Step 2: Create Modelfile
      logger.info('   Step 2/4: Creating Modelfile...');
      const modelfilePath = await this.createModelfile(job);
      job.modelfilePath = modelfilePath;
      await this.saveJob(job);

      // Step 3: Run Ollama fine-tuning
      logger.info('   Step 3/4: Running Ollama fine-tuning...');
      await this.runOllamaFineTuning(job);

      // Step 4: Register fine-tuned model for A/B testing
      logger.info('   Step 4/4: Registering model for A/B testing...');
      await this.registerFineTunedModel(job);

      job.fineTuningCompleted = new Date();
      job.stage = 'testing';
      job.updatedAt = new Date();
      await this.saveJob(job);

      logger.info(`✅ Fine-tuning completed: ${job.targetModel}`);

      // Publish event
      await this.kernel.publishEvent(
        new GenericDomainEvent('fine_tuning.completed', {
          jobId: job.id,
          category: job.category,
          targetModel: job.targetModel,
        })
      );
    } catch (error: any) {
      logger.error(`❌ Fine-tuning failed: ${error.message}`);

      job.stage = 'failed';
      job.fineTuningError = error.message;
      job.updatedAt = new Date();
      await this.saveJob(job);

      // Publish failure event
      await this.kernel.publishEvent(
        new GenericDomainEvent('fine_tuning.failed', {
          jobId: job.id,
          category: job.category,
          error: error.message,
        })
      );
    }
  }

  /**
   * Create Modelfile for Ollama fine-tuning
   */
  private async createModelfile(job: FineTuningJob): Promise<string> {
    const modelfile = `# Modelfile for ${job.targetModel}
# Fine-tuned for ${job.category}
# Base model: ${job.baseModel}
# Version: ${job.version}

FROM ${job.baseModel}

# System prompt for ${job.category}
SYSTEM """
You are Becas, an advanced AI moderation assistant specialized in ${job.category}.
You provide accurate, context-aware analysis with high confidence and detailed reasoning.
"""

# Fine-tuning adapter
ADAPTER ${path.basename(job.datasetPath!)}

# Parameters
PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER num_ctx 4096
`;

    const filepath = path.join(this.MODELFILES_DIR, `${job.targetModel}.modelfile`);
    await fs.writeFile(filepath, modelfile);

    logger.info(`   → Modelfile created: ${filepath}`);

    return filepath;
  }

  /**
   * Run Ollama fine-tuning command
   */
  private async runOllamaFineTuning(job: FineTuningJob): Promise<void> {
    try {
      // Copy dataset to Ollama's working directory
      const targetDatasetPath = path.join(this.MODELFILES_DIR, path.basename(job.datasetPath!));
      await fs.copyFile(job.datasetPath!, targetDatasetPath);

      // Run ollama create command
      const command = `ollama create ${job.targetModel} -f "${job.modelfilePath}"`;

      logger.info(`   → Running: ${command}`);

      const { stdout, stderr } = await execAsync(command);

      logger.info('   → Ollama output:', stdout);
      if (stderr) {
        logger.warn('   → Ollama warnings:', stderr);
      }

      logger.info(`   ✅ Model created: ${job.targetModel}`);
    } catch (error: any) {
      logger.error('   ❌ Ollama fine-tuning failed:', error);
      throw new Error(`Ollama fine-tuning failed: ${error.message}`);
    }
  }

  /**
   * Register fine-tuned model for A/B testing
   */
  private async registerFineTunedModel(job: FineTuningJob): Promise<void> {
    const modelConfig: ModelConfig = {
      name: job.targetModel,
      type: 'fine_tuned',
      modelId: job.targetModel,
      description: `Fine-tuned model for ${job.category} (v${job.version})`,
      trainedOn: path.basename(job.datasetPath!),
      fineTunedAt: new Date(),
    };

    // Register in A/B testing plugin
    this.abTestingPlugin.registerModel(modelConfig);

    // Set up A/B test (base model vs fine-tuned model)
    const baseModelName = this.getBaseModelName(job.category);
    const taskType = this.categoryToTaskType(job.category);

    this.abTestingPlugin.setupABTest(taskType, baseModelName, job.targetModel);

    logger.info(`   ✅ A/B test configured: ${baseModelName} vs ${job.targetModel}`);
  }

  /**
   * Handle A/B test completion
   */
  private async handleABTestCompleted(event: any): Promise<void> {
    try {
      const { taskType, modelA, modelB, winner, metrics } = event.payload;

      // Find relevant job
      const job = Array.from(this.jobs.values()).find(
        j => j.targetModel === modelB && j.stage === 'testing'
      );

      if (!job) return;

      job.abTestsCompleted++;
      job.updatedAt = new Date();

      // Update metrics
      if (winner === 'B') {
        // Fine-tuned model won
        job.winRate = ((job.winRate || 0) * (job.abTestsCompleted - 1) + 1) / job.abTestsCompleted;
      } else {
        job.winRate = ((job.winRate || 0) * (job.abTestsCompleted - 1)) / job.abTestsCompleted;
      }

      job.averageQualityImprovement = metrics.qualityScore;

      await this.saveJob(job);

      logger.debug(`A/B test update for ${job.targetModel}: ${job.abTestsCompleted} tests, ${((job.winRate || 0) * 100).toFixed(1)}% win rate`);

      // Check if ready for promotion
      if (
        job.abTestsCompleted >= this.config.minTestsBeforePromotion &&
        (job.winRate || 0) >= this.config.minWinRateForPromotion
      ) {
        logger.info(`🎉 Model ${job.targetModel} ready for promotion!`);

        if (this.config.autoPromote) {
          await this.promoteModel(job);
        } else {
          job.stage = 'evaluating';
          await this.saveJob(job);

          logger.info('   → Manual approval required for promotion');

          // Publish evaluation complete event
          await this.kernel.publishEvent(
            new GenericDomainEvent('fine_tuning.ready_for_promotion', {
              jobId: job.id,
              model: job.targetModel,
              winRate: job.winRate,
              testsCompleted: job.abTestsCompleted,
            })
          );
        }
      }
    } catch (error: any) {
      logger.error('Failed to handle A/B test completion:', error);
    }
  }

  /**
   * Promote model to production
   */
  async promoteModel(job: FineTuningJob): Promise<void> {
    try {
      logger.info(`🚀 Promoting model to production: ${job.targetModel}`);

      const modelConfig: ModelConfig = {
        name: job.targetModel,
        type: 'fine_tuned',
        modelId: job.targetModel,
        description: `Fine-tuned model for ${job.category} (v${job.version})`,
        trainedOn: path.basename(job.datasetPath!),
        fineTunedAt: job.fineTuningCompleted,
      };

      // Get previous model (if any)
      const previousModel = this.deployedModels.get(job.category);
      if (previousModel) {
        job.previousVersion = previousModel.name;
        logger.info(`   → Replacing: ${previousModel.name}`);
      }

      // Deploy new model
      this.deployedModels.set(job.category, modelConfig);

      job.promoted = true;
      job.promotedAt = new Date();
      job.promotionReason = `Win rate: ${((job.winRate || 0) * 100).toFixed(1)}% over ${job.abTestsCompleted} tests`;
      job.stage = 'deployed';
      job.updatedAt = new Date();

      await this.saveJob(job);

      logger.info('   ✅ Model promoted successfully');

      // Publish promotion event
      await this.kernel.publishEvent(
        new GenericDomainEvent('fine_tuning.promoted', {
          jobId: job.id,
          model: job.targetModel,
          category: job.category,
          version: job.version,
          previousModel: previousModel?.name,
          winRate: job.winRate,
        })
      );
    } catch (error: any) {
      logger.error('Failed to promote model:', error);
      throw error;
    }
  }

  /**
   * Rollback to previous model
   */
  async rollbackModel(category: TrainingCategory, reason: string): Promise<void> {
    try {
      logger.warn(`⏪ Rolling back model for category: ${category}`);
      logger.warn(`   → Reason: ${reason}`);

      const currentModel = this.deployedModels.get(category);
      if (!currentModel) {
        throw new Error(`No deployed model for category: ${category}`);
      }

      // Find current job
      const currentJob = Array.from(this.jobs.values()).find(
        j => j.targetModel === currentModel.name && j.promoted
      );

      if (!currentJob || !currentJob.previousVersion) {
        throw new Error('No previous version to rollback to');
      }

      // Find previous job
      const previousJob = Array.from(this.jobs.values()).find(
        j => j.targetModel === currentJob.previousVersion
      );

      if (!previousJob) {
        throw new Error(`Previous job not found: ${currentJob.previousVersion}`);
      }

      // Rollback
      const previousModelConfig: ModelConfig = {
        name: previousJob.targetModel,
        type: 'fine_tuned',
        modelId: previousJob.targetModel,
        description: `Rolled back from ${currentJob.targetModel}`,
      };

      this.deployedModels.set(category, previousModelConfig);

      logger.info(`   ✅ Rolled back to: ${previousJob.targetModel}`);

      // Publish rollback event
      await this.kernel.publishEvent(
        new GenericDomainEvent('fine_tuning.rolled_back', {
          category,
          from: currentJob.targetModel,
          to: previousJob.targetModel,
          reason,
        })
      );
    } catch (error: any) {
      logger.error('Failed to rollback model:', error);
      throw error;
    }
  }

  /**
   * Get base model for category
   */
  private getBaseModelForCategory(category: TrainingCategory): string {
    // Fast categories use Qwen
    if (['violation_detection', 'scam_detection', 'intent_classification', 'sentiment_analysis'].includes(category)) {
      return 'qwen3:1.7b';
    }

    // Reasoning categories use Llama
    if (['tool_selection', 'workflow_parsing', 'policy_interpretation'].includes(category)) {
      return 'llama3.2:3b';
    }

    // Default to Qwen
    return 'qwen3:1.7b';
  }

  /**
   * Get base model name for A/B testing
   */
  private getBaseModelName(category: TrainingCategory): string {
    const baseModel = this.getBaseModelForCategory(category);
    return baseModel.includes('qwen') ? 'qwen3-base' : 'llama-base';
  }

  /**
   * Convert category to task type
   */
  private categoryToTaskType(category: TrainingCategory): TaskType {
    const mapping: Record<string, TaskType> = {
      violation_detection: 'violation_detection',
      scam_detection: 'scam_detection',
      intent_classification: 'intent_classification',
      tool_selection: 'tool_selection',
      sentiment_analysis: 'sentiment_analysis',
      policy_interpretation: 'policy_interpretation',
    };

    return mapping[category] || 'violation_detection';
  }

  /**
   * Get next version number
   */
  private getNextVersion(category: TrainingCategory): number {
    const existingJobs = Array.from(this.jobs.values()).filter(j => j.category === category);

    if (existingJobs.length === 0) return 1;

    const maxVersion = Math.max(...existingJobs.map(j => j.version));
    return maxVersion + 1;
  }

  /**
   * Save job to disk
   */
  private async saveJob(job: FineTuningJob): Promise<void> {
    try {
      const filepath = path.join(this.JOBS_DIR, `${job.id}.json`);
      await fs.writeFile(filepath, JSON.stringify(job, null, 2));
    } catch (error: any) {
      logger.error('Failed to save job:', error);
    }
  }

  /**
   * Load jobs from disk
   */
  private async loadJobs(): Promise<void> {
    try {
      const files = await fs.readdir(this.JOBS_DIR);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filepath = path.join(this.JOBS_DIR, file);
        const content = await fs.readFile(filepath, 'utf-8');
        const job: FineTuningJob = JSON.parse(content);

        this.jobs.set(job.id, job);

        // Restore deployed models
        if (job.promoted && job.stage === 'deployed') {
          const modelConfig: ModelConfig = {
            name: job.targetModel,
            type: 'fine_tuned',
            modelId: job.targetModel,
            description: `Fine-tuned model for ${job.category} (v${job.version})`,
          };
          this.deployedModels.set(job.category, modelConfig);
        }
      }

      logger.info(`   → Loaded ${this.jobs.size} fine-tuning jobs`);
      logger.info(`   → Deployed models: ${this.deployedModels.size}`);
    } catch (error: any) {
      logger.warn('Failed to load jobs:', error);
    }
  }

  /**
   * Ensure directories exist
   */
  private async ensureDirectories(): Promise<void> {
    try {
      await fs.mkdir(this.JOBS_DIR, { recursive: true });
      await fs.mkdir(this.MODELFILES_DIR, { recursive: true });
    } catch (error: any) {
      logger.error('Failed to create directories:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalJobs: number;
    byStage: Record<PipelineStage, number>;
    byCategory: Record<TrainingCategory, number>;
    deployedModels: number;
    averageWinRate: number;
  } {
    const stats = {
      totalJobs: this.jobs.size,
      byStage: {} as Record<PipelineStage, number>,
      byCategory: {} as Record<TrainingCategory, number>,
      deployedModels: this.deployedModels.size,
      averageWinRate: 0,
    };

    let totalWinRate = 0;
    let jobsWithWinRate = 0;

    for (const job of this.jobs.values()) {
      stats.byStage[job.stage] = (stats.byStage[job.stage] || 0) + 1;
      stats.byCategory[job.category] = (stats.byCategory[job.category] || 0) + 1;

      if (job.winRate !== undefined) {
        totalWinRate += job.winRate;
        jobsWithWinRate++;
      }
    }

    if (jobsWithWinRate > 0) {
      stats.averageWinRate = totalWinRate / jobsWithWinRate;
    }

    return stats;
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Fine-Tuning Orchestrator...');

    const stats = this.getStats();
    logger.info(`   → ${stats.totalJobs} fine-tuning jobs managed`);
    logger.info(`   → ${stats.deployedModels} models currently deployed`);

    if (stats.averageWinRate > 0) {
      logger.info(`   → Average win rate: ${(stats.averageWinRate * 100).toFixed(1)}%`);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.fineTuningPlugin !== undefined && this.abTestingPlugin !== undefined;
  }
}
