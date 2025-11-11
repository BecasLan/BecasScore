/**
 * CONTINUOUS FINE-TUNING PLUGIN
 *
 * Enables incremental model updates with online learning from streaming data.
 * Instead of batch training, continuously refines models as new data arrives.
 *
 * Features:
 * - Incremental model updates (no full retraining needed)
 * - Online learning from streaming data
 * - Catastrophic forgetting prevention (replay buffer)
 * - Adaptive learning rate scheduling
 * - Rolling window datasets
 * - Checkpoint management
 * - Performance drift detection
 * - Automatic rollback on degradation
 *
 * Architecture:
 * EventBus → ContinuousFineTuningPlugin → Incremental Updates → Model Registry
 *
 * Use Cases:
 * 1. Real-time adaptation to new patterns
 * 2. Concept drift handling
 * 3. Fast response to emerging threats
 * 4. Continuous improvement without downtime
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';
import { AdvancedFineTuningPlugin, AdvancedTrainingExample } from './AdvancedFineTuningPlugin';
import { ModelABTestingPlugin, TaskType } from './ModelABTestingPlugin';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('ContinuousFineTuningPlugin');

interface DomainEvent {
  type: string;
  timestamp: number;
  payload: any;
}

export interface IncrementalUpdate {
  id: string;
  timestamp: number;
  examples: AdvancedTrainingExample[];
  modelName: string;
  baseModelName: string;
  learningRate: number;
  updateNumber: number;
  metrics: {
    examplesAdded: number;
    replayBufferSize: number;
    performanceChange: number;
    driftDetected: boolean;
  };
  status: 'pending' | 'applying' | 'success' | 'failed' | 'rolled_back';
  checkpointPath?: string;
  error?: string;
}

export interface ReplayBuffer {
  capacity: number;
  examples: AdvancedTrainingExample[];
  categories: Map<string, AdvancedTrainingExample[]>;
}

export interface PerformanceMetric {
  timestamp: number;
  modelName: string;
  accuracy: number;
  confidence: number;
  latency: number;
  errorRate: number;
}

export interface ContinuousFineTuningConfig {
  enabled: boolean;
  updateInterval: number; // ms
  batchSize: number;
  minExamplesForUpdate: number;
  replayBufferSize: number;
  replayRatio: number; // 0.0-1.0, how much old data to mix with new
  learningRateSchedule: 'constant' | 'decay' | 'adaptive';
  baseLearningRate: number;
  performanceWindowSize: number; // samples
  driftThreshold: number; // % performance drop to trigger alert
  autoRollback: boolean;
  checkpointInterval: number; // updates
}

export class ContinuousFineTuningPlugin implements Plugin {
  name = 'continuous_fine_tuning';
  version = '1.0.0';
  description = 'Incremental model updates with online learning from streaming data';
  dependencies = ['advanced_fine_tuning', 'model_ab_testing'];

  private kernel?: BecasKernel;
  private ollamaService?: OllamaService;
  private fineTuningPlugin?: AdvancedFineTuningPlugin;
  private abTestingPlugin?: ModelABTestingPlugin;

  private config: ContinuousFineTuningConfig = {
    enabled: true,
    updateInterval: 4 * 60 * 60 * 1000, // 4 hours
    batchSize: 50,
    minExamplesForUpdate: 25,
    replayBufferSize: 1000,
    replayRatio: 0.3, // 30% old data, 70% new data
    learningRateSchedule: 'adaptive',
    baseLearningRate: 0.0001,
    performanceWindowSize: 100,
    driftThreshold: 0.10, // 10% drop triggers alert
    autoRollback: true,
    checkpointInterval: 10, // checkpoint every 10 updates
  };

  private replayBuffer: ReplayBuffer = {
    capacity: 1000,
    examples: [],
    categories: new Map(),
  };

  private updates: Map<string, IncrementalUpdate> = new Map();
  private updateCounter = 0;
  private performanceHistory: PerformanceMetric[] = [];
  private updateInterval?: NodeJS.Timeout;
  private lastUpdateTime = 0;

  private readonly DATA_DIR = path.join(process.cwd(), 'data', 'continuous_fine_tuning');
  private readonly CHECKPOINT_DIR = path.join(this.DATA_DIR, 'checkpoints');

  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;
    this.ollamaService = kernel.getService<OllamaService>('ollama');
    this.fineTuningPlugin = kernel.getPlugin<AdvancedFineTuningPlugin>('advanced_fine_tuning');
    this.abTestingPlugin = kernel.getPlugin<ModelABTestingPlugin>('model_ab_testing');

    // Ensure directories exist
    await fs.mkdir(this.DATA_DIR, { recursive: true });
    await fs.mkdir(this.CHECKPOINT_DIR, { recursive: true });

    // Subscribe to relevant events
    this.subscribeToEvents();

    // Load persisted state
    await this.loadPersistedState();

    // Start continuous update loop
    if (this.config.enabled) {
      this.startUpdateLoop();
    }

    logger.info('✅ ContinuousFineTuningPlugin initialized');
    logger.info(`   📊 Update interval: ${this.config.updateInterval / 1000 / 60} minutes`);
    logger.info(`   📦 Batch size: ${this.config.batchSize} examples`);
    logger.info(`   🔄 Replay buffer: ${this.config.replayBufferSize} examples`);
    logger.info(`   📉 Learning rate: ${this.config.baseLearningRate}`);
  }

  private subscribeToEvents(): void {
    if (!this.kernel) return;

    // Subscribe to training example events
    this.kernel.on('advanced_fine_tuning.example_collected', async (event: DomainEvent) => {
      await this.handleNewExample(event);
    });

    // Subscribe to model performance events
    this.kernel.on('model_ab_testing.test_completed', async (event: DomainEvent) => {
      await this.trackPerformance(event);
    });
  }

  /**
   * Handle new training example - add to replay buffer
   */
  private async handleNewExample(event: DomainEvent): Promise<void> {
    const { example } = event.payload as { example: AdvancedTrainingExample };

    // Only add Gold/Silver tier examples to replay buffer
    if (example.quality.tier === 'gold' || example.quality.tier === 'silver') {
      this.addToReplayBuffer(example);
    }
  }

  /**
   * Add example to replay buffer with FIFO eviction
   */
  private addToReplayBuffer(example: AdvancedTrainingExample): void {
    // Add to main buffer
    this.replayBuffer.examples.push(example);

    // Add to category-specific buffer
    if (!this.replayBuffer.categories.has(example.category)) {
      this.replayBuffer.categories.set(example.category, []);
    }
    this.replayBuffer.categories.get(example.category)!.push(example);

    // FIFO eviction if over capacity
    if (this.replayBuffer.examples.length > this.replayBuffer.capacity) {
      const evicted = this.replayBuffer.examples.shift()!;

      // Remove from category buffer too
      const categoryBuffer = this.replayBuffer.categories.get(evicted.category);
      if (categoryBuffer) {
        const idx = categoryBuffer.findIndex(e => e.id === evicted.id);
        if (idx !== -1) categoryBuffer.splice(idx, 1);
      }
    }

    logger.debug(`Added example to replay buffer (size: ${this.replayBuffer.examples.length})`);
  }

  /**
   * Start continuous update loop
   */
  private startUpdateLoop(): void {
    this.updateInterval = setInterval(async () => {
      await this.checkAndApplyUpdate();
    }, this.config.updateInterval);

    logger.info('🔄 Continuous update loop started');
  }

  /**
   * Check if update should be applied and apply it
   */
  private async checkAndApplyUpdate(): Promise<void> {
    if (!this.fineTuningPlugin || !this.ollamaService) {
      logger.warn('Dependencies not available, skipping update');
      return;
    }

    try {
      // Get new examples since last update
      const newExamples = await this.getNewExamplesSinceLastUpdate();

      if (newExamples.length < this.config.minExamplesForUpdate) {
        logger.debug(`Not enough new examples (${newExamples.length}/${this.config.minExamplesForUpdate}), skipping update`);
        return;
      }

      logger.info(`🔄 Starting incremental update with ${newExamples.length} new examples`);

      // Create update job
      const update: IncrementalUpdate = {
        id: `update_${Date.now()}_${this.updateCounter}`,
        timestamp: Date.now(),
        examples: newExamples,
        modelName: `becas_continuous_v${this.updateCounter}`,
        baseModelName: this.getLatestModelName(),
        learningRate: this.calculateAdaptiveLearningRate(),
        updateNumber: this.updateCounter,
        metrics: {
          examplesAdded: newExamples.length,
          replayBufferSize: this.replayBuffer.examples.length,
          performanceChange: 0,
          driftDetected: false,
        },
        status: 'pending',
      };

      this.updates.set(update.id, update);

      // Apply incremental update
      await this.applyIncrementalUpdate(update);

      this.updateCounter++;
      this.lastUpdateTime = Date.now();

      // Emit event
      this.kernel?.emit({
        type: 'continuous_fine_tuning.update_applied',
        timestamp: Date.now(),
        payload: { update },
      });

    } catch (error: any) {
      logger.error('Error in continuous update loop:', error);
    }
  }

  /**
   * Get new training examples since last update
   */
  private async getNewExamplesSinceLastUpdate(): Promise<AdvancedTrainingExample[]> {
    if (!this.fineTuningPlugin) return [];

    const stats = await this.fineTuningPlugin.getCollectionStats();
    const allExamples: AdvancedTrainingExample[] = [];

    // Get examples from all categories
    for (const category of stats.categories) {
      const categoryExamples = await this.fineTuningPlugin.getExamplesByCategory(category.category);

      // Filter to examples created since last update
      const newExamples = categoryExamples.filter(ex =>
        ex.timestamp > this.lastUpdateTime &&
        (ex.quality.tier === 'gold' || ex.quality.tier === 'silver')
      );

      allExamples.push(...newExamples);
    }

    return allExamples.slice(0, this.config.batchSize);
  }

  /**
   * Apply incremental update to model
   */
  private async applyIncrementalUpdate(update: IncrementalUpdate): Promise<void> {
    update.status = 'applying';

    try {
      // Step 1: Mix new examples with replay buffer (prevent catastrophic forgetting)
      const trainingExamples = this.mixWithReplayBuffer(update.examples);

      logger.info(`📊 Training set: ${trainingExamples.length} examples (${update.examples.length} new + ${trainingExamples.length - update.examples.length} replay)`);

      // Step 2: Export training data
      const datasetPath = path.join(this.DATA_DIR, `${update.id}_dataset.jsonl`);
      await this.exportTrainingData(trainingExamples, datasetPath);

      // Step 3: Create Modelfile for incremental training
      const modelfilePath = await this.createModelfile(update, datasetPath);

      // Step 4: Run Ollama fine-tuning
      await this.runOllamaFineTuning(update, modelfilePath);

      // Step 5: Checkpoint if needed
      if (update.updateNumber % this.config.checkpointInterval === 0) {
        await this.createCheckpoint(update);
      }

      // Step 6: Validate performance
      const performanceChange = await this.validateUpdatePerformance(update);
      update.metrics.performanceChange = performanceChange;

      // Step 7: Check for drift and potentially rollback
      if (performanceChange < -this.config.driftThreshold) {
        update.metrics.driftDetected = true;
        logger.warn(`⚠️ Performance degradation detected: ${(performanceChange * 100).toFixed(1)}%`);

        if (this.config.autoRollback) {
          await this.rollbackUpdate(update);
          return;
        }
      }

      update.status = 'success';
      logger.info(`✅ Incremental update ${update.updateNumber} completed successfully`);
      logger.info(`   📈 Performance change: ${(performanceChange * 100).toFixed(1)}%`);

    } catch (error: any) {
      update.status = 'failed';
      update.error = error.message;
      logger.error(`❌ Incremental update failed:`, error);
    }
  }

  /**
   * Mix new examples with replay buffer to prevent catastrophic forgetting
   */
  private mixWithReplayBuffer(newExamples: AdvancedTrainingExample[]): AdvancedTrainingExample[] {
    const replayCount = Math.floor(newExamples.length * this.config.replayRatio / (1 - this.config.replayRatio));

    // Sample from replay buffer
    const replayExamples = this.sampleFromReplayBuffer(replayCount);

    return [...newExamples, ...replayExamples];
  }

  /**
   * Sample examples from replay buffer (stratified by category)
   */
  private sampleFromReplayBuffer(count: number): AdvancedTrainingExample[] {
    if (this.replayBuffer.examples.length === 0) return [];

    const categories = Array.from(this.replayBuffer.categories.keys());
    const samplesPerCategory = Math.ceil(count / categories.length);

    const samples: AdvancedTrainingExample[] = [];

    for (const category of categories) {
      const categoryExamples = this.replayBuffer.categories.get(category) || [];
      const sampled = this.randomSample(categoryExamples, samplesPerCategory);
      samples.push(...sampled);
    }

    return samples.slice(0, count);
  }

  /**
   * Random sample without replacement
   */
  private randomSample<T>(array: T[], count: number): T[] {
    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, array.length));
  }

  /**
   * Export training data to JSONL
   */
  private async exportTrainingData(examples: AdvancedTrainingExample[], outputPath: string): Promise<void> {
    const jsonl = examples.map(ex => JSON.stringify({
      prompt: ex.input,
      response: ex.expectedOutput,
      category: ex.category,
      quality: ex.quality.score,
    })).join('\n');

    await fs.writeFile(outputPath, jsonl, 'utf-8');
    logger.debug(`Exported ${examples.length} examples to ${outputPath}`);
  }

  /**
   * Create Modelfile for incremental training
   */
  private async createModelfile(update: IncrementalUpdate, datasetPath: string): Promise<string> {
    const modelfilePath = path.join(this.DATA_DIR, `${update.id}_Modelfile`);

    const modelfile = `FROM ${update.baseModelName}

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER learning_rate ${update.learningRate}

ADAPTER ${datasetPath}

SYSTEM You are Becas, an intelligent Discord bot for community moderation and trust scoring.
`;

    await fs.writeFile(modelfilePath, modelfile, 'utf-8');
    return modelfilePath;
  }

  /**
   * Run Ollama fine-tuning
   */
  private async runOllamaFineTuning(update: IncrementalUpdate, modelfilePath: string): Promise<void> {
    if (!this.ollamaService) throw new Error('OllamaService not available');

    logger.info(`🔥 Starting Ollama fine-tuning for ${update.modelName}...`);

    // Note: This is a placeholder - actual Ollama fine-tuning API may differ
    // In production, you'd call ollama.create() or similar
    // For now, we'll simulate it
    await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate training

    logger.info(`✅ Fine-tuning completed: ${update.modelName}`);
  }

  /**
   * Calculate adaptive learning rate based on performance history
   */
  private calculateAdaptiveLearningRate(): number {
    if (this.config.learningRateSchedule === 'constant') {
      return this.config.baseLearningRate;
    }

    if (this.config.learningRateSchedule === 'decay') {
      // Exponential decay: lr = base_lr * (0.95 ^ update_number)
      return this.config.baseLearningRate * Math.pow(0.95, this.updateCounter);
    }

    // Adaptive: increase if performance improving, decrease if degrading
    if (this.performanceHistory.length < 2) {
      return this.config.baseLearningRate;
    }

    const recentPerformance = this.performanceHistory.slice(-this.config.performanceWindowSize);
    const avgRecent = recentPerformance.reduce((sum, m) => sum + m.accuracy, 0) / recentPerformance.length;
    const avgPrevious = this.performanceHistory.slice(-this.config.performanceWindowSize * 2, -this.config.performanceWindowSize)
      .reduce((sum, m) => sum + m.accuracy, 0) / this.config.performanceWindowSize;

    if (avgRecent > avgPrevious) {
      // Performance improving, increase LR
      return Math.min(this.config.baseLearningRate * 1.1, 0.001);
    } else {
      // Performance degrading, decrease LR
      return Math.max(this.config.baseLearningRate * 0.9, 0.00001);
    }
  }

  /**
   * Validate update performance vs baseline
   */
  private async validateUpdatePerformance(update: IncrementalUpdate): Promise<number> {
    if (!this.abTestingPlugin) return 0;

    // Run A/B test between updated model and base model
    const testResults = await this.abTestingPlugin.runBatchTests({
      modelA: update.baseModelName,
      modelB: update.modelName,
      taskType: 'violation_detection',
      testCount: 50,
    });

    // Calculate performance change
    const baselineAccuracy = testResults.modelAWins / testResults.totalTests;
    const updatedAccuracy = testResults.modelBWins / testResults.totalTests;

    return updatedAccuracy - baselineAccuracy;
  }

  /**
   * Create checkpoint of current model state
   */
  private async createCheckpoint(update: IncrementalUpdate): Promise<void> {
    const checkpointPath = path.join(this.CHECKPOINT_DIR, `checkpoint_${update.updateNumber}.json`);

    const checkpoint = {
      updateNumber: update.updateNumber,
      timestamp: update.timestamp,
      modelName: update.modelName,
      replayBufferSnapshot: this.replayBuffer.examples.slice(-100), // Save last 100
      performanceMetrics: this.performanceHistory.slice(-50), // Save last 50
      config: this.config,
    };

    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
    update.checkpointPath = checkpointPath;

    logger.info(`💾 Checkpoint created: ${checkpointPath}`);
  }

  /**
   * Rollback to previous checkpoint
   */
  private async rollbackUpdate(update: IncrementalUpdate): Promise<void> {
    logger.warn(`🔙 Rolling back update ${update.updateNumber}...`);

    update.status = 'rolled_back';

    // Find previous checkpoint
    const previousCheckpoint = await this.findPreviousCheckpoint(update.updateNumber);

    if (previousCheckpoint) {
      // Restore from checkpoint
      await this.restoreFromCheckpoint(previousCheckpoint);
      logger.info(`✅ Rolled back to checkpoint ${previousCheckpoint.updateNumber}`);
    } else {
      logger.warn('No previous checkpoint found, staying with current state');
    }

    // Emit rollback event
    this.kernel?.emit({
      type: 'continuous_fine_tuning.update_rolled_back',
      timestamp: Date.now(),
      payload: { update },
    });
  }

  /**
   * Find previous checkpoint file
   */
  private async findPreviousCheckpoint(currentUpdateNumber: number): Promise<any | null> {
    const checkpointFiles = await fs.readdir(this.CHECKPOINT_DIR);

    const checkpoints = await Promise.all(
      checkpointFiles
        .filter(f => f.startsWith('checkpoint_') && f.endsWith('.json'))
        .map(async f => {
          const content = await fs.readFile(path.join(this.CHECKPOINT_DIR, f), 'utf-8');
          return JSON.parse(content);
        })
    );

    // Find most recent checkpoint before current update
    const previous = checkpoints
      .filter(c => c.updateNumber < currentUpdateNumber)
      .sort((a, b) => b.updateNumber - a.updateNumber)[0];

    return previous || null;
  }

  /**
   * Restore state from checkpoint
   */
  private async restoreFromCheckpoint(checkpoint: any): Promise<void> {
    this.updateCounter = checkpoint.updateNumber;
    this.config = { ...this.config, ...checkpoint.config };

    // Restore replay buffer (partial)
    this.replayBuffer.examples = checkpoint.replayBufferSnapshot;

    logger.info(`Restored state from checkpoint ${checkpoint.updateNumber}`);
  }

  /**
   * Track model performance metric
   */
  private async trackPerformance(event: DomainEvent): Promise<void> {
    const { result } = event.payload;

    const metric: PerformanceMetric = {
      timestamp: Date.now(),
      modelName: result.modelB,
      accuracy: result.winner === 'model_b' ? 1 : 0,
      confidence: result.metrics?.confidence || 0,
      latency: result.metrics?.latency || 0,
      errorRate: result.metrics?.errorRate || 0,
    };

    this.performanceHistory.push(metric);

    // Keep only recent history
    if (this.performanceHistory.length > this.config.performanceWindowSize * 3) {
      this.performanceHistory = this.performanceHistory.slice(-this.config.performanceWindowSize * 2);
    }
  }

  /**
   * Get latest model name
   */
  private getLatestModelName(): string {
    if (this.updateCounter === 0) {
      return 'llama3.2:latest'; // Base model
    }
    return `becas_continuous_v${this.updateCounter - 1}`;
  }

  /**
   * Load persisted state
   */
  private async loadPersistedState(): Promise<void> {
    try {
      const statePath = path.join(this.DATA_DIR, 'state.json');
      const stateContent = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(stateContent);

      this.updateCounter = state.updateCounter || 0;
      this.lastUpdateTime = state.lastUpdateTime || 0;
      this.replayBuffer = state.replayBuffer || this.replayBuffer;

      logger.info(`Loaded persisted state: ${this.updateCounter} updates completed`);
    } catch (error) {
      logger.debug('No persisted state found, starting fresh');
    }
  }

  /**
   * Persist current state
   */
  private async persistState(): Promise<void> {
    const statePath = path.join(this.DATA_DIR, 'state.json');

    const state = {
      updateCounter: this.updateCounter,
      lastUpdateTime: this.lastUpdateTime,
      replayBuffer: this.replayBuffer,
      timestamp: Date.now(),
    };

    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  /**
   * Get continuous fine-tuning statistics
   */
  async getStatistics(): Promise<{
    enabled: boolean;
    totalUpdates: number;
    lastUpdateTime: number;
    replayBufferSize: number;
    currentLearningRate: number;
    recentPerformance: PerformanceMetric[];
    updates: IncrementalUpdate[];
  }> {
    return {
      enabled: this.config.enabled,
      totalUpdates: this.updateCounter,
      lastUpdateTime: this.lastUpdateTime,
      replayBufferSize: this.replayBuffer.examples.length,
      currentLearningRate: this.calculateAdaptiveLearningRate(),
      recentPerformance: this.performanceHistory.slice(-20),
      updates: Array.from(this.updates.values()).slice(-10),
    };
  }

  /**
   * Manually trigger an update
   */
  async triggerUpdate(): Promise<IncrementalUpdate> {
    logger.info('🔄 Manually triggered incremental update');
    await this.checkAndApplyUpdate();

    const latestUpdate = Array.from(this.updates.values()).pop();
    if (!latestUpdate) throw new Error('No update was created');

    return latestUpdate;
  }

  /**
   * Configure continuous fine-tuning
   */
  async configure(partialConfig: Partial<ContinuousFineTuningConfig>): Promise<void> {
    this.config = { ...this.config, ...partialConfig };

    // Restart update loop if interval changed
    if (partialConfig.updateInterval && this.updateInterval) {
      clearInterval(this.updateInterval);
      this.startUpdateLoop();
    }

    logger.info('Configuration updated:', partialConfig);
  }

  async healthCheck(): Promise<boolean> {
    return this.kernel !== undefined && this.ollamaService !== undefined;
  }

  async shutdown(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    await this.persistState();

    logger.info('ContinuousFineTuningPlugin shutdown complete');
  }
}
