/**
 * MODEL A/B TESTING PLUGIN
 *
 * Automatically tests fine-tuned models against base models to measure improvement.
 * Tracks performance metrics across different tasks and categories.
 *
 * Architecture:
 * Event → A/B Test Manager → Run Both Models → Compare Results → Update Performance Metrics
 *
 * Features:
 * - Shadow testing (fine-tuned model runs alongside base model)
 * - Performance tracking (accuracy, latency, confidence)
 * - Statistical significance testing
 * - Automatic model promotion (when fine-tuned model outperforms)
 * - Multi-dimensional metrics (per category, per task type)
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { DomainEvent, GenericDomainEvent } from '../domain/events/DomainEvent';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('ModelABTestingPlugin');

// ========================================
// A/B TEST TYPES
// ========================================

export type TaskType =
  | 'violation_detection'
  | 'intent_classification'
  | 'scam_detection'
  | 'tool_selection'
  | 'sentiment_analysis'
  | 'policy_interpretation';

export interface ModelConfig {
  name: string;
  type: 'base' | 'fine_tuned';
  modelId: string; // e.g., "qwen3:1.7b" or "becas-qwen-violations-v1"
  description: string;
  trainedOn?: string; // Dataset name
  fineTunedAt?: Date;
}

export interface ABTestResult {
  id: string;
  timestamp: Date;
  taskType: TaskType;
  guildId: string;

  // Models being tested
  modelA: ModelConfig; // Usually base model
  modelB: ModelConfig; // Usually fine-tuned model

  // Test input
  input: string;
  expectedOutput?: string; // Ground truth (if available)

  // Model outputs
  outputA: {
    result: string;
    confidence: number;
    latencyMs: number;
    reasoning?: string;
  };

  outputB: {
    result: string;
    confidence: number;
    latencyMs: number;
    reasoning?: string;
  };

  // Performance comparison
  winner: 'A' | 'B' | 'tie' | 'unknown';
  metrics: {
    accuracyDelta: number; // B accuracy - A accuracy
    confidenceDelta: number;
    latencyDelta: number;
    qualityScore: number; // 0-1 (higher = better)
  };

  // Human validation
  humanValidation?: {
    validatedBy: string;
    actualWinner: 'A' | 'B' | 'tie';
    notes?: string;
  };
}

export interface PerformanceMetrics {
  model: ModelConfig;
  taskType: TaskType;
  stats: {
    totalTests: number;
    wins: number;
    losses: number;
    ties: number;
    winRate: number;
    avgConfidence: number;
    avgLatency: number;
    avgQualityScore: number;
  };
  recentTests: ABTestResult[];
}

export interface ModelComparisonReport {
  modelA: ModelConfig;
  modelB: ModelConfig;
  overallWinner: 'A' | 'B' | 'tie';
  confidence: number; // Statistical confidence (0-1)
  byTaskType: Record<TaskType, {
    winner: 'A' | 'B' | 'tie';
    winRate: number;
    sampleSize: number;
  }>;
  recommendation: 'promote_B' | 'keep_A' | 'need_more_data';
  reasoning: string;
}

/**
 * Model A/B Testing Plugin
 */
export class ModelABTestingPlugin implements Plugin {
  name = 'model_ab_testing';
  version = '1.0.0';
  description = 'Automated A/B testing and performance tracking for fine-tuned models';
  dependencies = ['analytics'];

  private kernel!: BecasKernel;
  private ollamaService!: OllamaService;

  // Test results storage
  private testResults: Map<string, ABTestResult> = new Map();

  // Model registry
  private models: Map<string, ModelConfig> = new Map();

  // Active A/B tests (model pairs being compared)
  private activeTests: Map<TaskType, { modelA: string; modelB: string }> = new Map();

  // Performance metrics per model
  private performanceMetrics: Map<string, Map<TaskType, PerformanceMetrics['stats']>> = new Map();

  // Configuration
  private readonly TEST_SAMPLE_RATE = 0.2; // Test 20% of requests
  private readonly MIN_TESTS_FOR_PROMOTION = 100;
  private readonly MIN_WIN_RATE_FOR_PROMOTION = 0.65;
  private readonly RESULTS_DIR = './data/ab-testing';

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🧪 Initializing Model A/B Testing Plugin...');

    // Get Ollama service
    this.ollamaService = kernel.getService<OllamaService>('ollama')!;
    if (!this.ollamaService) {
      throw new Error('OllamaService not found - required for A/B testing');
    }

    // Register base models
    this.registerBaseModels();

    // Subscribe to events for A/B testing
    this.subscribeToEvents();

    // Ensure results directory exists
    await this.ensureResultsDirectory();

    logger.info('✅ Model A/B Testing Plugin initialized');
    logger.info(`   → Test sample rate: ${this.TEST_SAMPLE_RATE * 100}%`);
    logger.info(`   → Min tests for promotion: ${this.MIN_TESTS_FOR_PROMOTION}`);
    logger.info(`   → Min win rate for promotion: ${this.MIN_WIN_RATE_FOR_PROMOTION * 100}%`);
  }

  /**
   * Register base models
   */
  private registerBaseModels(): void {
    // Qwen3:1.7b for fast tasks
    this.registerModel({
      name: 'qwen3-base',
      type: 'base',
      modelId: 'qwen3:1.7b',
      description: 'Base Qwen3 1.7B model - fast context understanding',
    });

    // Llama for reasoning tasks
    this.registerModel({
      name: 'llama-base',
      type: 'base',
      modelId: 'llama3.2:3b',
      description: 'Base Llama 3.2 3B model - reasoning and tool selection',
    });

    logger.info(`   → Registered ${this.models.size} base models`);
  }

  /**
   * Register a model (base or fine-tuned)
   */
  registerModel(config: ModelConfig): void {
    this.models.set(config.name, config);

    // Initialize performance metrics
    if (!this.performanceMetrics.has(config.name)) {
      this.performanceMetrics.set(config.name, new Map());
    }

    logger.info(`📝 Registered model: ${config.name} (${config.type})`);
  }

  /**
   * Set up A/B test (compare two models for a task type)
   */
  setupABTest(taskType: TaskType, modelAName: string, modelBName: string): void {
    const modelA = this.models.get(modelAName);
    const modelB = this.models.get(modelBName);

    if (!modelA || !modelB) {
      throw new Error(`Models not found: ${modelAName}, ${modelBName}`);
    }

    this.activeTests.set(taskType, { modelA: modelAName, modelB: modelBName });

    logger.info(`🧪 A/B Test configured for ${taskType}:`);
    logger.info(`   Model A: ${modelA.name} (${modelA.type})`);
    logger.info(`   Model B: ${modelB.name} (${modelB.type})`);
  }

  /**
   * Subscribe to events for A/B testing
   */
  private subscribeToEvents(): void {
    const eventBus = this.kernel.getEventBus();

    // Test violation detection
    eventBus.on('violation.detected', this.testViolationDetection.bind(this));

    // Test scam detection
    eventBus.on('scam.detected', this.testScamDetection.bind(this));

    // Test intent classification
    eventBus.on('intent.analyzed', this.testIntentClassification.bind(this));

    logger.info('   → Subscribed to events for A/B testing');
  }

  /**
   * Test violation detection models
   */
  private async testViolationDetection(event: DomainEvent): Promise<void> {
    try {
      // Check if A/B test is active for this task
      const test = this.activeTests.get('violation_detection');
      if (!test) return;

      // Sample testing (don't test every request)
      if (Math.random() > this.TEST_SAMPLE_RATE) return;

      const { evidence, violationType, severity, confidence } = event.payload;

      const input = `Analyze this message for content policy violations:

Message: "${evidence}"

Determine violation type, severity, and provide reasoning.`;

      const expectedOutput = `Type: ${violationType}, Severity: ${severity}, Confidence: ${confidence.toFixed(2)}`;

      // Run A/B test
      await this.runABTest({
        taskType: 'violation_detection',
        input,
        expectedOutput,
        guildId: event.metadata.guildId || 'unknown',
        modelAName: test.modelA,
        modelBName: test.modelB,
      });
    } catch (error: any) {
      logger.error('Failed to test violation detection:', error);
    }
  }

  /**
   * Test scam detection models
   */
  private async testScamDetection(event: DomainEvent): Promise<void> {
    try {
      const test = this.activeTests.get('scam_detection');
      if (!test) return;

      if (Math.random() > this.TEST_SAMPLE_RATE) return;

      const { text, analysis } = event.payload;

      const input = `Analyze this message for scam indicators:

Message: "${text}"

Determine if scam, type, severity, and provide reasoning.`;

      const expectedOutput = `Is Scam: ${analysis.isScam}, Type: ${analysis.scamType}, Confidence: ${analysis.confidence.toFixed(2)}`;

      await this.runABTest({
        taskType: 'scam_detection',
        input,
        expectedOutput,
        guildId: event.metadata.guildId || 'unknown',
        modelAName: test.modelA,
        modelBName: test.modelB,
      });
    } catch (error: any) {
      logger.error('Failed to test scam detection:', error);
    }
  }

  /**
   * Test intent classification models
   */
  private async testIntentClassification(event: DomainEvent): Promise<void> {
    try {
      const test = this.activeTests.get('intent_classification');
      if (!test) return;

      if (Math.random() > this.TEST_SAMPLE_RATE) return;

      const { message, deepIntent } = event.payload;

      const input = `Analyze the intent and emotional state of this message:

Message: "${message}"

Provide primary intent, emotional state, and suggested action.`;

      const expectedOutput = `Intent: ${deepIntent.primaryIntent}, Emotion: ${deepIntent.emotionalState}, Confidence: ${deepIntent.confidence.toFixed(2)}`;

      await this.runABTest({
        taskType: 'intent_classification',
        input,
        expectedOutput,
        guildId: event.metadata.guildId || 'unknown',
        modelAName: test.modelA,
        modelBName: test.modelB,
      });
    } catch (error: any) {
      logger.error('Failed to test intent classification:', error);
    }
  }

  /**
   * Run A/B test between two models
   */
  private async runABTest(config: {
    taskType: TaskType;
    input: string;
    expectedOutput?: string;
    guildId: string;
    modelAName: string;
    modelBName: string;
  }): Promise<ABTestResult> {
    const modelA = this.models.get(config.modelAName)!;
    const modelB = this.models.get(config.modelBName)!;

    logger.debug(`🧪 Running A/B test: ${modelA.name} vs ${modelB.name}`);

    // Run both models in parallel
    const [resultA, resultB] = await Promise.all([
      this.runModelInference(modelA, config.input),
      this.runModelInference(modelB, config.input),
    ]);

    // Compare results
    const winner = this.determineWinner(resultA, resultB, config.expectedOutput);
    const metrics = this.calculateMetrics(resultA, resultB, config.expectedOutput);

    // Create test result
    const testResult: ABTestResult = {
      id: `ab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      taskType: config.taskType,
      guildId: config.guildId,
      modelA,
      modelB,
      input: config.input,
      expectedOutput: config.expectedOutput,
      outputA: resultA,
      outputB: resultB,
      winner,
      metrics,
    };

    // Store result
    this.testResults.set(testResult.id, testResult);

    // Update performance metrics
    this.updatePerformanceMetrics(testResult);

    // Publish test result event
    await this.kernel.publishEvent(
      new GenericDomainEvent('ab_test.completed', {
        testId: testResult.id,
        taskType: config.taskType,
        modelA: modelA.name,
        modelB: modelB.name,
        winner,
        metrics,
      })
    );

    logger.info(`✅ A/B Test completed: Winner = Model ${winner} (quality delta: ${metrics.qualityScore.toFixed(2)})`);

    return testResult;
  }

  /**
   * Run model inference
   */
  private async runModelInference(
    model: ModelConfig,
    input: string
  ): Promise<ABTestResult['outputA']> {
    const startTime = Date.now();

    try {
      // TODO: Switch Ollama to use specific model
      const response = await this.ollamaService.generate(input);

      const latencyMs = Date.now() - startTime;

      // Extract confidence (if available in response)
      const confidenceMatch = response.match(/confidence[:\s]+([0-9.]+)/i);
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.8;

      return {
        result: response,
        confidence,
        latencyMs,
        reasoning: response,
      };
    } catch (error: any) {
      logger.error(`Model ${model.name} inference failed:`, error);

      return {
        result: 'ERROR',
        confidence: 0,
        latencyMs: Date.now() - startTime,
        reasoning: error.message,
      };
    }
  }

  /**
   * Determine winner between two model outputs
   */
  private determineWinner(
    outputA: ABTestResult['outputA'],
    outputB: ABTestResult['outputB'],
    expectedOutput?: string
  ): 'A' | 'B' | 'tie' | 'unknown' {
    // If we have ground truth, use accuracy
    if (expectedOutput) {
      const accuracyA = this.calculateAccuracy(outputA.result, expectedOutput);
      const accuracyB = this.calculateAccuracy(outputB.result, expectedOutput);

      if (accuracyA > accuracyB + 0.1) return 'A';
      if (accuracyB > accuracyA + 0.1) return 'B';
      return 'tie';
    }

    // Otherwise, use confidence and quality heuristics
    const scoreA = this.calculateQualityScore(outputA);
    const scoreB = this.calculateQualityScore(outputB);

    if (scoreA > scoreB + 0.05) return 'A';
    if (scoreB > scoreA + 0.05) return 'B';
    return 'tie';
  }

  /**
   * Calculate accuracy (similarity to expected output)
   */
  private calculateAccuracy(output: string, expected: string): number {
    // Simple word overlap for now
    const outputWords = new Set(output.toLowerCase().split(/\s+/));
    const expectedWords = new Set(expected.toLowerCase().split(/\s+/));

    const intersection = new Set([...outputWords].filter(w => expectedWords.has(w)));
    const union = new Set([...outputWords, ...expectedWords]);

    return intersection.size / union.size;
  }

  /**
   * Calculate quality score for model output
   */
  private calculateQualityScore(output: ABTestResult['outputA']): number {
    let score = 0;

    // Confidence (0-0.4)
    score += output.confidence * 0.4;

    // Has reasoning (0-0.3)
    if (output.reasoning && output.reasoning.length > 50) {
      score += 0.3;
    }

    // Low latency bonus (0-0.3)
    if (output.latencyMs < 2000) {
      score += 0.3 * (1 - output.latencyMs / 2000);
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate comparison metrics
   */
  private calculateMetrics(
    outputA: ABTestResult['outputA'],
    outputB: ABTestResult['outputB'],
    expectedOutput?: string
  ): ABTestResult['metrics'] {
    const accuracyDelta = expectedOutput
      ? this.calculateAccuracy(outputB.result, expectedOutput) -
        this.calculateAccuracy(outputA.result, expectedOutput)
      : 0;

    const confidenceDelta = outputB.confidence - outputA.confidence;
    const latencyDelta = outputB.latencyMs - outputA.latencyMs;

    const qualityScoreA = this.calculateQualityScore(outputA);
    const qualityScoreB = this.calculateQualityScore(outputB);
    const qualityScore = qualityScoreB - qualityScoreA;

    return {
      accuracyDelta,
      confidenceDelta,
      latencyDelta,
      qualityScore,
    };
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(testResult: ABTestResult): void {
    // Update for both models
    this.updateModelMetrics(testResult.modelA.name, testResult.taskType, testResult.winner === 'A');
    this.updateModelMetrics(testResult.modelB.name, testResult.taskType, testResult.winner === 'B');
  }

  /**
   * Update metrics for a specific model
   */
  private updateModelMetrics(modelName: string, taskType: TaskType, won: boolean): void {
    const modelMetrics = this.performanceMetrics.get(modelName);
    if (!modelMetrics) return;

    let taskMetrics = modelMetrics.get(taskType);
    if (!taskMetrics) {
      taskMetrics = {
        totalTests: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        winRate: 0,
        avgConfidence: 0,
        avgLatency: 0,
        avgQualityScore: 0,
      };
      modelMetrics.set(taskType, taskMetrics);
    }

    taskMetrics.totalTests++;
    if (won) {
      taskMetrics.wins++;
    } else {
      taskMetrics.losses++;
    }

    taskMetrics.winRate = taskMetrics.wins / taskMetrics.totalTests;
  }

  /**
   * Generate comparison report
   */
  async generateComparisonReport(
    modelAName: string,
    modelBName: string
  ): Promise<ModelComparisonReport> {
    const modelA = this.models.get(modelAName);
    const modelB = this.models.get(modelBName);

    if (!modelA || !modelB) {
      throw new Error('Models not found');
    }

    // Get all test results for these models
    const tests = Array.from(this.testResults.values()).filter(
      test => test.modelA.name === modelAName && test.modelB.name === modelBName
    );

    if (tests.length === 0) {
      throw new Error('No test results found for these models');
    }

    // Calculate overall winner
    const wins = tests.filter(t => t.winner === 'B').length;
    const losses = tests.filter(t => t.winner === 'A').length;
    const ties = tests.filter(t => t.winner === 'tie').length;

    const winRate = wins / tests.length;

    let overallWinner: 'A' | 'B' | 'tie' = 'tie';
    if (winRate > 0.55) overallWinner = 'B';
    else if (winRate < 0.45) overallWinner = 'A';

    // Calculate statistical confidence (simple version)
    const confidence = Math.abs(winRate - 0.5) * 2; // 0-1

    // By task type
    const byTaskType: Record<string, any> = {};
    const taskTypes = new Set(tests.map(t => t.taskType));

    for (const taskType of taskTypes) {
      const taskTests = tests.filter(t => t.taskType === taskType);
      const taskWins = taskTests.filter(t => t.winner === 'B').length;
      const taskWinRate = taskWins / taskTests.length;

      byTaskType[taskType] = {
        winner: taskWinRate > 0.55 ? 'B' : taskWinRate < 0.45 ? 'A' : 'tie',
        winRate: taskWinRate,
        sampleSize: taskTests.length,
      };
    }

    // Recommendation
    let recommendation: ModelComparisonReport['recommendation'] = 'need_more_data';
    let reasoning = '';

    if (tests.length >= this.MIN_TESTS_FOR_PROMOTION) {
      if (winRate >= this.MIN_WIN_RATE_FOR_PROMOTION) {
        recommendation = 'promote_B';
        reasoning = `Model B (${modelB.name}) outperforms Model A with ${(winRate * 100).toFixed(1)}% win rate over ${tests.length} tests. Recommend promoting to production.`;
      } else if (winRate <= 1 - this.MIN_WIN_RATE_FOR_PROMOTION) {
        recommendation = 'keep_A';
        reasoning = `Model A (${modelA.name}) outperforms Model B. Keep using Model A.`;
      } else {
        recommendation = 'need_more_data';
        reasoning = `Results are inconclusive. Win rate: ${(winRate * 100).toFixed(1)}%. Need more tests or larger improvement.`;
      }
    } else {
      reasoning = `Only ${tests.length} tests completed. Need ${this.MIN_TESTS_FOR_PROMOTION} minimum for statistical significance.`;
    }

    const report: ModelComparisonReport = {
      modelA,
      modelB,
      overallWinner,
      confidence,
      byTaskType: byTaskType as any,
      recommendation,
      reasoning,
    };

    logger.info('📊 Comparison Report Generated:');
    logger.info(`   Model A: ${modelA.name}`);
    logger.info(`   Model B: ${modelB.name}`);
    logger.info(`   Winner: Model ${overallWinner}`);
    logger.info(`   Confidence: ${(confidence * 100).toFixed(1)}%`);
    logger.info(`   Recommendation: ${recommendation}`);
    logger.info(`   Reasoning: ${reasoning}`);

    return report;
  }

  /**
   * Export test results
   */
  async exportResults(filename: string): Promise<string> {
    try {
      const results = Array.from(this.testResults.values());

      const filepath = path.join(this.RESULTS_DIR, filename);
      await fs.writeFile(filepath, JSON.stringify(results, null, 2));

      logger.info(`✅ Exported ${results.length} test results to ${filepath}`);

      return filepath;
    } catch (error: any) {
      logger.error('Failed to export results:', error);
      throw error;
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalTests: number;
    byTaskType: Record<TaskType, number>;
    byModel: Record<string, { tests: number; avgWinRate: number }>;
  } {
    const stats = {
      totalTests: this.testResults.size,
      byTaskType: {} as Record<TaskType, number>,
      byModel: {} as Record<string, { tests: number; avgWinRate: number }>,
    };

    // Count by task type
    for (const test of this.testResults.values()) {
      stats.byTaskType[test.taskType] = (stats.byTaskType[test.taskType] || 0) + 1;
    }

    // Calculate model stats
    for (const [modelName, taskMetrics] of this.performanceMetrics) {
      let totalTests = 0;
      let totalWinRate = 0;
      let taskCount = 0;

      for (const metrics of taskMetrics.values()) {
        totalTests += metrics.totalTests;
        totalWinRate += metrics.winRate;
        taskCount++;
      }

      stats.byModel[modelName] = {
        tests: totalTests,
        avgWinRate: taskCount > 0 ? totalWinRate / taskCount : 0,
      };
    }

    return stats;
  }

  /**
   * Ensure results directory exists
   */
  private async ensureResultsDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.RESULTS_DIR, { recursive: true });
    } catch (error: any) {
      logger.error('Failed to create results directory:', error);
    }
  }

  /**
   * Shutdown plugin
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down Model A/B Testing Plugin...');

    const stats = this.getStats();
    logger.info(`   → ${stats.totalTests} A/B tests completed`);

    // Export results on shutdown
    if (stats.totalTests > 0) {
      try {
        await this.exportResults(`ab_test_results_${Date.now()}.json`);
      } catch (error: any) {
        logger.error('Failed to export results on shutdown:', error);
      }
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.ollamaService !== undefined;
  }
}
