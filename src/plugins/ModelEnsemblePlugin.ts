/**
 * MODEL ENSEMBLE PLUGIN
 *
 * Combines predictions from multiple models for improved accuracy and robustness.
 * Uses voting, averaging, and confidence-weighted strategies.
 *
 * Features:
 * - Multi-model inference (parallel prediction)
 * - Voting strategies (majority, weighted, confidence-based)
 * - Prediction aggregation
 * - Ensemble performance tracking
 * - Dynamic model weighting
 * - Fallback mechanisms
 * - Confidence scoring
 * - Disagreement detection
 *
 * Architecture:
 * EventBus → ModelEnsemblePlugin → Multiple Models → Aggregated Prediction
 *
 * Use Cases:
 * 1. Critical decisions requiring high accuracy
 * 2. Handling edge cases through diverse perspectives
 * 3. Reducing individual model bias
 * 4. Robustness against model failures
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { GenericDomainEvent } from '../domain/events/DomainEvent';
import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('ModelEnsemblePlugin');

export interface EnsembleMember {
  modelName: string;
  weight: number;
  performance: {
    accuracy: number;
    latency: number;
    errorRate: number;
  };
  status: 'active' | 'inactive' | 'degraded';
  specialty?: string; // e.g., 'scam_detection', 'moderation'
}

export interface EnsemblePrediction {
  id: string;
  timestamp: number;
  input: string;
  taskType: string;
  predictions: ModelPrediction[];
  aggregatedResult: any;
  confidence: number;
  strategy: VotingStrategy;
  disagreement: number; // 0-1, how much models disagree
  latency: number;
}

export interface ModelPrediction {
  modelName: string;
  prediction: any;
  confidence: number;
  latency: number;
  error?: string;
}

export type VotingStrategy = 'majority' | 'weighted' | 'confidence_weighted' | 'best_confidence';

export class ModelEnsemblePlugin implements Plugin {
  name = 'model_ensemble';
  version = '1.0.0';
  description = 'Multi-model ensemble for improved accuracy through voting and averaging';
  dependencies = [];

  private kernel?: BecasKernel;
  private ollamaService?: OllamaService;

  private ensembleMembers: Map<string, EnsembleMember> = new Map();
  private predictions: EnsemblePrediction[] = [];
  private defaultStrategy: VotingStrategy = 'confidence_weighted';

  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;
    this.ollamaService = kernel.getService<OllamaService>('ollama');

    // Register default ensemble members
    this.registerDefaultMembers();

    logger.info('✅ ModelEnsemblePlugin initialized');
    logger.info(`   🤖 Ensemble members: ${this.ensembleMembers.size}`);
  }

  private registerDefaultMembers(): void {
    // Base model
    this.registerMember({
      modelName: 'llama3.2:latest',
      weight: 1.0,
      performance: { accuracy: 0.80, latency: 100, errorRate: 0.05 },
      status: 'active',
    });

    logger.debug('Registered default ensemble members');
  }

  /**
   * Register a model in the ensemble
   */
  registerMember(member: EnsembleMember): void {
    this.ensembleMembers.set(member.modelName, member);
    logger.info(`📝 Registered ensemble member: ${member.modelName} (weight: ${member.weight})`);
  }

  /**
   * Run ensemble prediction
   */
  async predict(input: string, taskType: string, options: {
    strategy?: VotingStrategy;
    minModels?: number;
    timeout?: number;
  } = {}): Promise<EnsemblePrediction> {
    const startTime = Date.now();
    const strategy = options.strategy || this.defaultStrategy;
    const minModels = options.minModels || 2;

    logger.debug(`🔮 Running ensemble prediction (strategy: ${strategy})`);

    // Get active members
    const activeMembers = Array.from(this.ensembleMembers.values())
      .filter(m => m.status === 'active');

    if (activeMembers.length < minModels) {
      throw new Error(`Not enough active models (${activeMembers.length}/${minModels})`);
    }

    // Run predictions in parallel
    const predictions = await Promise.all(
      activeMembers.map(member => this.runModelPrediction(member, input, taskType))
    );

    // Filter out failed predictions
    const successfulPredictions = predictions.filter(p => !p.error);

    if (successfulPredictions.length < minModels) {
      throw new Error(`Too many failed predictions (${successfulPredictions.length}/${minModels})`);
    }

    // Aggregate predictions
    const aggregatedResult = this.aggregatePredictions(successfulPredictions, strategy, activeMembers);

    // Calculate disagreement
    const disagreement = this.calculateDisagreement(successfulPredictions);

    // Calculate ensemble confidence
    const confidence = this.calculateEnsembleConfidence(successfulPredictions, disagreement);

    const ensemblePrediction: EnsemblePrediction = {
      id: `ensemble_${Date.now()}`,
      timestamp: Date.now(),
      input,
      taskType,
      predictions: successfulPredictions,
      aggregatedResult,
      confidence,
      strategy,
      disagreement,
      latency: Date.now() - startTime,
    };

    this.predictions.push(ensemblePrediction);

    // Emit event
    await this.kernel?.publishEvent(
      new GenericDomainEvent('model_ensemble.prediction_completed', {
        prediction: ensemblePrediction,
      })
    );

    logger.debug(`✅ Ensemble prediction completed (confidence: ${(confidence * 100).toFixed(1)}%, disagreement: ${(disagreement * 100).toFixed(1)}%)`);

    return ensemblePrediction;
  }

  /**
   * Run prediction on a single model
   */
  private async runModelPrediction(member: EnsembleMember, input: string, taskType: string): Promise<ModelPrediction> {
    const startTime = Date.now();

    try {
      if (!this.ollamaService) {
        throw new Error('OllamaService not available');
      }

      const prompt = this.constructPrompt(input, taskType);
      const response = await this.ollamaService.generate(prompt, member.modelName);

      // Parse prediction and confidence
      const { prediction, confidence } = this.parseModelResponse(response, taskType);

      return {
        modelName: member.modelName,
        prediction,
        confidence,
        latency: Date.now() - startTime,
      };

    } catch (error: any) {
      logger.warn(`❌ Model ${member.modelName} prediction failed: ${error.message}`);

      return {
        modelName: member.modelName,
        prediction: null,
        confidence: 0,
        latency: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Construct prompt for task type
   */
  private constructPrompt(input: string, taskType: string): string {
    switch (taskType) {
      case 'violation_detection':
        return `Analyze if this message violates community guidelines. Respond with YES or NO and confidence 0-1.\n\nMessage: "${input}"\n\nResponse (format: "ANSWER: YES/NO, CONFIDENCE: 0.XX"):`;

      case 'scam_detection':
        return `Determine if this is a scam or phishing attempt. Respond with YES or NO and confidence 0-1.\n\nMessage: "${input}"\n\nResponse (format: "ANSWER: YES/NO, CONFIDENCE: 0.XX"):`;

      case 'sentiment_analysis':
        return `Classify sentiment as POSITIVE, NEGATIVE, or NEUTRAL with confidence 0-1.\n\nMessage: "${input}"\n\nResponse (format: "SENTIMENT: POSITIVE/NEGATIVE/NEUTRAL, CONFIDENCE: 0.XX"):`;

      default:
        return `Analyze: "${input}"\n\nProvide your analysis with confidence 0-1.`;
    }
  }

  /**
   * Parse model response to extract prediction and confidence
   */
  private parseModelResponse(response: string, taskType: string): { prediction: any; confidence: number } {
    // Extract confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*(0?\.\d+|\d+\.?\d*)/i);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

    // Extract prediction based on task type
    let prediction: any;

    if (taskType === 'violation_detection' || taskType === 'scam_detection') {
      const answerMatch = response.match(/ANSWER:\s*(YES|NO)/i);
      prediction = answerMatch ? answerMatch[1].toUpperCase() === 'YES' : false;
    } else if (taskType === 'sentiment_analysis') {
      const sentimentMatch = response.match(/SENTIMENT:\s*(POSITIVE|NEGATIVE|NEUTRAL)/i);
      prediction = sentimentMatch ? sentimentMatch[1].toUpperCase() : 'NEUTRAL';
    } else {
      prediction = response;
    }

    return { prediction, confidence };
  }

  /**
   * Aggregate predictions using specified strategy
   */
  private aggregatePredictions(predictions: ModelPrediction[], strategy: VotingStrategy, members: EnsembleMember[]): any {
    switch (strategy) {
      case 'majority':
        return this.majorityVoting(predictions);

      case 'weighted':
        return this.weightedVoting(predictions, members);

      case 'confidence_weighted':
        return this.confidenceWeightedVoting(predictions, members);

      case 'best_confidence':
        return this.bestConfidenceVoting(predictions);

      default:
        return this.majorityVoting(predictions);
    }
  }

  /**
   * Simple majority voting
   */
  private majorityVoting(predictions: ModelPrediction[]): any {
    const votes = new Map<any, number>();

    for (const pred of predictions) {
      const key = JSON.stringify(pred.prediction);
      votes.set(key, (votes.get(key) || 0) + 1);
    }

    // Find most common prediction
    let maxVotes = 0;
    let winner: any = null;

    for (const [predKey, count] of votes.entries()) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = JSON.parse(predKey);
      }
    }

    return winner;
  }

  /**
   * Weighted voting based on model weights
   */
  private weightedVoting(predictions: ModelPrediction[], members: EnsembleMember[]): any {
    const votes = new Map<any, number>();

    for (const pred of predictions) {
      const member = members.find(m => m.modelName === pred.modelName);
      const weight = member?.weight || 1.0;
      const key = JSON.stringify(pred.prediction);
      votes.set(key, (votes.get(key) || 0) + weight);
    }

    let maxWeight = 0;
    let winner: any = null;

    for (const [predKey, weight] of votes.entries()) {
      if (weight > maxWeight) {
        maxWeight = weight;
        winner = JSON.parse(predKey);
      }
    }

    return winner;
  }

  /**
   * Voting weighted by both model weight and prediction confidence
   */
  private confidenceWeightedVoting(predictions: ModelPrediction[], members: EnsembleMember[]): any {
    const votes = new Map<any, number>();

    for (const pred of predictions) {
      const member = members.find(m => m.modelName === pred.modelName);
      const modelWeight = member?.weight || 1.0;
      const confidenceWeight = pred.confidence;
      const totalWeight = modelWeight * confidenceWeight;

      const key = JSON.stringify(pred.prediction);
      votes.set(key, (votes.get(key) || 0) + totalWeight);
    }

    let maxWeight = 0;
    let winner: any = null;

    for (const [predKey, weight] of votes.entries()) {
      if (weight > maxWeight) {
        maxWeight = weight;
        winner = JSON.parse(predKey);
      }
    }

    return winner;
  }

  /**
   * Take prediction from most confident model
   */
  private bestConfidenceVoting(predictions: ModelPrediction[]): any {
    let maxConfidence = 0;
    let winner: any = null;

    for (const pred of predictions) {
      if (pred.confidence > maxConfidence) {
        maxConfidence = pred.confidence;
        winner = pred.prediction;
      }
    }

    return winner;
  }

  /**
   * Calculate disagreement score (0-1)
   */
  private calculateDisagreement(predictions: ModelPrediction[]): number {
    if (predictions.length < 2) return 0;

    // Count unique predictions
    const uniquePredictions = new Set(
      predictions.map(p => JSON.stringify(p.prediction))
    );

    // Disagreement = ratio of unique predictions to total predictions
    return (uniquePredictions.size - 1) / (predictions.length - 1);
  }

  /**
   * Calculate ensemble confidence
   */
  private calculateEnsembleConfidence(predictions: ModelPrediction[], disagreement: number): number {
    // Average confidence across predictions
    const avgConfidence = predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

    // Reduce confidence if there's high disagreement
    const disagreementPenalty = 1 - (disagreement * 0.5);

    return avgConfidence * disagreementPenalty;
  }

  /**
   * Update model weights based on performance
   */
  async updateWeights(performanceData: Map<string, { accuracy: number; errorRate: number }>): Promise<void> {
    for (const [modelName, perf] of performanceData.entries()) {
      const member = this.ensembleMembers.get(modelName);
      if (!member) continue;

      // Update performance
      member.performance.accuracy = perf.accuracy;
      member.performance.errorRate = perf.errorRate;

      // Recalculate weight based on accuracy
      // Higher accuracy = higher weight
      member.weight = Math.max(0.1, perf.accuracy);

      // Degrade status if error rate too high
      if (perf.errorRate > 0.20) {
        member.status = 'degraded';
      } else {
        member.status = 'active';
      }

      logger.debug(`Updated ${modelName}: weight=${member.weight.toFixed(2)}, status=${member.status}`);
    }
  }

  /**
   * Get ensemble statistics
   */
  async getStatistics(): Promise<{
    totalMembers: number;
    activeMembers: number;
    totalPredictions: number;
    averageConfidence: number;
    averageDisagreement: number;
    averageLatency: number;
  }> {
    const activeMembers = Array.from(this.ensembleMembers.values()).filter(m => m.status === 'active');
    const recentPredictions = this.predictions.slice(-100);

    return {
      totalMembers: this.ensembleMembers.size,
      activeMembers: activeMembers.length,
      totalPredictions: this.predictions.length,
      averageConfidence: recentPredictions.reduce((sum, p) => sum + p.confidence, 0) / (recentPredictions.length || 1),
      averageDisagreement: recentPredictions.reduce((sum, p) => sum + p.disagreement, 0) / (recentPredictions.length || 1),
      averageLatency: recentPredictions.reduce((sum, p) => sum + p.latency, 0) / (recentPredictions.length || 1),
    };
  }

  async healthCheck(): Promise<boolean> {
    const activeMembers = Array.from(this.ensembleMembers.values()).filter(m => m.status === 'active');
    return activeMembers.length >= 1;
  }

  async shutdown(): Promise<void> {
    logger.info('ModelEnsemblePlugin shutdown complete');
  }
}
