/**
 * ADVANCED FINE-TUNING PLUGIN
 *
 * Comprehensive training data collection across ALL system capabilities:
 * - Intent classification (deep intent, emotional state, conversational context)
 * - Scam detection (phishing, social engineering, malicious links)
 * - Tool selection and parameter inference
 * - Trust score prediction
 * - Moderation decision-making
 * - Policy interpretation
 * - Sentiment analysis
 * - Language detection
 * - Network analysis (raid detection, bot patterns)
 * - User profiling and behavior prediction
 * - Workflow parsing and execution
 * - AI learning from human corrections
 *
 * Architecture:
 * ALL Events → AdvancedFineTuningPlugin → Multi-Model Collectors → Quality Filtering →
 * → Dataset Balancing → Export Pipeline → A/B Testing → Human Feedback Loop
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { DomainEvent, GenericDomainEvent } from '../domain/events/DomainEvent';
import { createLogger } from '../services/Logger';
import fs from 'fs/promises';
import path from 'path';

const logger = createLogger('AdvancedFineTuningPlugin');

// ========================================
// TRAINING EXAMPLE TYPES
// ========================================

export type TrainingCategory =
  | 'intent_classification'       // Intent analysis training
  | 'scam_detection'              // Scam/phishing detection
  | 'tool_selection'              // Tool use decision-making
  | 'trust_prediction'            // Trust score prediction
  | 'moderation_decision'         // Moderation action selection
  | 'policy_interpretation'       // Policy rule understanding
  | 'sentiment_analysis'          // Emotional state detection
  | 'language_detection'          // Language identification
  | 'network_analysis'            // Raid/bot pattern detection
  | 'user_profiling'              // User behavior prediction
  | 'workflow_parsing'            // Workflow interpretation
  | 'human_correction'            // Learning from moderator feedback
  | 'rag_context_enhancement'     // RAG-enhanced decisions
  | 'violation_detection';        // Content violation detection

export type QualityTier = 'gold' | 'silver' | 'bronze' | 'reject';

export interface AdvancedTrainingExample {
  id: string;
  timestamp: Date;
  category: TrainingCategory;

  // Model-specific fields
  modelTarget: 'qwen' | 'llama' | 'general';

  // Input/Output
  input: string;
  output: string;
  systemPrompt?: string;

  // Context enrichment
  metadata: {
    guildId: string;
    userId?: string;
    confidence?: number;
    outcome?: 'success' | 'failure' | 'uncertain' | 'corrected';
    humanFeedback?: boolean;
    correctionType?: 'false_positive' | 'false_negative' | 'severity_mismatch' | 'context_missed';
    ragEnhanced?: boolean;
    precedents?: number;

    // Tool-specific metadata
    toolName?: string;
    toolCategory?: string;

    // Intent-specific metadata
    intentType?: string;
    emotionalState?: string;

    // Scam-specific metadata
    scamType?: string;
    severity?: string;

    // Trust-specific metadata
    trustScoreBefore?: number;
    trustScoreAfter?: number;
  };

  // Quality assessment
  quality: {
    tier: QualityTier;
    score: number; // 0-1
    factors: {
      confidenceScore: number;
      hasDetailedReasoning: boolean;
      hasHumanValidation: boolean;
      hasContextualData: boolean;
      isRagEnhanced: boolean;
      hasMultiplePrecedents: boolean;
      hasClearOutcome: boolean;
      isEdgeCase: boolean;
      isCommonPattern: boolean;
    };
    reasons: string[];
  };

  // A/B testing
  abTest?: {
    model: string;
    performance: number;
    comparisonModel?: string;
  };
}

export interface FineTuningDataset {
  name: string;
  description: string;
  category: TrainingCategory;
  modelTarget: 'qwen' | 'llama' | 'general';
  examples: AdvancedTrainingExample[];
  stats: {
    total: number;
    gold: number;
    silver: number;
    bronze: number;
    byCategory: Record<TrainingCategory, number>;
    byOutcome: Record<string, number>;
    avgQuality: number;
  };
  balancing: {
    isBalanced: boolean;
    targetDistribution: Record<string, number>;
    actualDistribution: Record<string, number>;
  };
  createdAt: Date;
  version: string;
}

/**
 * Advanced Fine-Tuning Plugin with comprehensive collection strategies
 */
export class AdvancedFineTuningPlugin implements Plugin {
  name = 'advanced_fine_tuning';
  version = '2.0.0';
  description = 'Comprehensive multi-model training data collection with A/B testing and feedback loops';
  dependencies = ['analytics', 'vector_store', 'rag'];

  private kernel!: BecasKernel;

  // Training example storage (per category for better organization)
  private examplesByCategory: Map<TrainingCategory, Map<string, AdvancedTrainingExample>> = new Map();

  // Human feedback queue
  private feedbackQueue: Map<string, { example: AdvancedTrainingExample; feedback: any }> = new Map();

  // A/B testing results
  private abTestResults: Map<string, { modelA: string; modelB: string; winner: string; confidence: number }> = new Map();

  // Configuration
  private readonly MIN_CONFIDENCE_FOR_TRAINING = 0.80;
  private readonly MAX_EXAMPLES_PER_CATEGORY = 50000;
  private readonly DATA_DIR = './data/fine-tuning';
  private readonly GOLD_THRESHOLD = 0.90;
  private readonly SILVER_THRESHOLD = 0.75;
  private readonly BRONZE_THRESHOLD = 0.60;

  /**
   * Initialize plugin
   */
  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;

    logger.info('🎓 Initializing Advanced Fine-Tuning Plugin...');

    // Initialize category maps
    this.initializeCategoryMaps();

    // Subscribe to ALL relevant events
    this.subscribeToEvents();

    // Ensure data directory exists
    await this.ensureDataDirectory();

    logger.info('✅ Advanced Fine-Tuning Plugin initialized');
    logger.info(`   → ${this.examplesByCategory.size} training categories active`);
    logger.info(`   → Min confidence: ${this.MIN_CONFIDENCE_FOR_TRAINING}`);
    logger.info(`   → Quality tiers: Gold (${this.GOLD_THRESHOLD}+), Silver (${this.SILVER_THRESHOLD}+), Bronze (${this.BRONZE_THRESHOLD}+)`);
  }

  /**
   * Initialize category storage maps
   */
  private initializeCategoryMaps(): void {
    const categories: TrainingCategory[] = [
      'intent_classification',
      'scam_detection',
      'tool_selection',
      'trust_prediction',
      'moderation_decision',
      'policy_interpretation',
      'sentiment_analysis',
      'language_detection',
      'network_analysis',
      'user_profiling',
      'workflow_parsing',
      'human_correction',
      'rag_context_enhancement',
      'violation_detection',
    ];

    categories.forEach(category => {
      this.examplesByCategory.set(category, new Map());
    });
  }

  /**
   * Subscribe to all relevant events
   */
  private subscribeToEvents(): void {
    const eventBus = this.kernel.getEventBus();

    // Violation detection
    eventBus.on('violation.detected', this.collectViolationExample.bind(this));

    // Moderation actions
    eventBus.on('moderation.action_executed', this.collectModerationExample.bind(this));

    // Trust score changes
    eventBus.on('trust_score.changed', this.collectTrustExample.bind(this));

    // RAG enhancements
    eventBus.on('rag.context_enhanced', this.collectRAGExample.bind(this));
    eventBus.on('rag.suspicious_similarity', this.collectSuspiciousPatternExample.bind(this));

    // Intent analysis
    eventBus.on('intent.analyzed', this.collectIntentExample.bind(this));

    // Scam detection
    eventBus.on('scam.detected', this.collectScamExample.bind(this));

    // Tool execution
    eventBus.on('tool.executed', this.collectToolExample.bind(this));

    // Human corrections (AI learning)
    eventBus.on('ai.correction', this.collectCorrectionExample.bind(this));

    // Policy events
    eventBus.on('policy.evaluated', this.collectPolicyExample.bind(this));

    // Sentiment analysis
    eventBus.on('sentiment.analyzed', this.collectSentimentExample.bind(this));

    // Network events
    eventBus.on('network.raid_detected', this.collectNetworkExample.bind(this));
    eventBus.on('network.bot_pattern', this.collectNetworkExample.bind(this));

    // User profiling
    eventBus.on('user.profile_updated', this.collectUserProfileExample.bind(this));

    // Workflow events
    eventBus.on('workflow.parsed', this.collectWorkflowExample.bind(this));

    logger.info('   → Subscribed to 15+ event types for comprehensive training data collection');
  }

  // ========================================
  // COLLECTION METHODS (ONE PER CATEGORY)
  // ========================================

  /**
   * Collect violation detection examples
   */
  private async collectViolationExample(event: DomainEvent): Promise<void> {
    try {
      const { violationType, severity, confidence, evidence, reasoning } = event.payload;

      if (confidence < this.MIN_CONFIDENCE_FOR_TRAINING) return;

      const input = `Analyze this message for content policy violations:

Message: "${evidence}"

Determine if this violates content policies and provide:
1. Violation type (if any)
2. Severity level (critical, high, medium, low, none)
3. Confidence score (0-1)
4. Detailed reasoning`;

      const output = `Violation Analysis:
Type: ${violationType}
Severity: ${severity}
Confidence: ${confidence.toFixed(2)}
Reasoning: ${reasoning}`;

      const example = this.createTrainingExample({
        category: 'violation_detection',
        modelTarget: 'qwen', // Qwen for fast context understanding
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          confidence,
          outcome: 'success',
        },
        baseQualityFactors: {
          confidenceScore: confidence,
          hasDetailedReasoning: reasoning.length > 50,
          hasClearOutcome: true,
        },
      });

      this.addExample('violation_detection', example);
      logger.debug(`Collected violation example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect violation example:', error);
    }
  }

  /**
   * Collect intent classification examples
   */
  private async collectIntentExample(event: DomainEvent): Promise<void> {
    try {
      const { message, surfaceIntent, deepIntent, conversationalContext } = event.payload;

      const input = `Analyze the intent and emotional state of this message:

Message: "${message}"

Provide:
1. Primary intent type
2. Secondary intent (if any)
3. Emotional state
4. Suggested moderation action
5. Detailed reasoning`;

      const output = `Intent Analysis:
Primary Intent: ${deepIntent.primaryIntent}
Secondary Intent: ${deepIntent.secondaryIntent || 'none'}
Emotional State: ${deepIntent.emotionalState}
Suggested Action: ${deepIntent.suggestedAction}
Confidence: ${deepIntent.confidence.toFixed(2)}
Reasoning: ${deepIntent.reasoning}`;

      const example = this.createTrainingExample({
        category: 'intent_classification',
        modelTarget: 'qwen',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          userId: event.metadata.userId,
          confidence: deepIntent.confidence,
          intentType: deepIntent.primaryIntent,
          emotionalState: deepIntent.emotionalState,
        },
        baseQualityFactors: {
          confidenceScore: deepIntent.confidence,
          hasDetailedReasoning: deepIntent.reasoning.length > 50,
          hasClearOutcome: true,
          hasContextualData: !!conversationalContext,
        },
      });

      this.addExample('intent_classification', example);
      logger.debug(`Collected intent example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect intent example:', error);
    }
  }

  /**
   * Collect scam detection examples
   */
  private async collectScamExample(event: DomainEvent): Promise<void> {
    try {
      const { text, analysis } = event.payload;

      const input = `Analyze this message for scam indicators:

Message: "${text}"

Determine:
1. Is this a scam? (yes/no)
2. Scam type (if applicable)
3. Severity level
4. Confidence score
5. Specific indicators
6. Detailed reasoning`;

      const output = `Scam Analysis:
Is Scam: ${analysis.isScam ? 'YES' : 'NO'}
Type: ${analysis.scamType}
Severity: ${analysis.severity}
Confidence: ${analysis.confidence.toFixed(2)}
Indicators: ${analysis.indicators.join(', ')}
Reasoning: ${analysis.reasoning}
Permanent Ban Recommended: ${analysis.shouldBanPermanently ? 'YES' : 'NO'}`;

      const example = this.createTrainingExample({
        category: 'scam_detection',
        modelTarget: 'qwen', // Qwen excels at contextual scam detection
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          confidence: analysis.confidence,
          outcome: analysis.isScam ? 'success' : 'uncertain',
          scamType: analysis.scamType,
          severity: analysis.severity,
        },
        baseQualityFactors: {
          confidenceScore: analysis.confidence,
          hasDetailedReasoning: analysis.reasoning.length > 50,
          hasClearOutcome: analysis.isScam,
          isEdgeCase: analysis.scamType === 'social_engineering', // Edge cases are valuable
        },
      });

      this.addExample('scam_detection', example);
      logger.debug(`Collected scam example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect scam example:', error);
    }
  }

  /**
   * Collect tool selection examples
   */
  private async collectToolExample(event: DomainEvent): Promise<void> {
    try {
      const { toolName, toolCategory, input, output, success } = event.payload;

      const exampleInput = `Given this user request, select the appropriate tool and parameters:

Request: "${input}"

Available tool categories: moderation, trust, analytics, data, intelligence

Provide:
1. Tool name
2. Tool category
3. Required parameters
4. Reasoning for selection`;

      const exampleOutput = `Tool Selection:
Tool: ${toolName}
Category: ${toolCategory}
Result: ${success ? 'SUCCESS' : 'FAILURE'}
Output: ${JSON.stringify(output)}`;

      const example = this.createTrainingExample({
        category: 'tool_selection',
        modelTarget: 'llama', // Llama for reasoning about tool selection
        input: exampleInput,
        output: exampleOutput,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          outcome: success ? 'success' : 'failure',
          toolName,
          toolCategory,
        },
        baseQualityFactors: {
          confidenceScore: success ? 0.95 : 0.70,
          hasClearOutcome: true,
          hasContextualData: true,
        },
      });

      this.addExample('tool_selection', example);
      logger.debug(`Collected tool example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect tool example:', error);
    }
  }

  /**
   * Collect trust score prediction examples
   */
  private async collectTrustExample(event: DomainEvent): Promise<void> {
    try {
      const { userId, guildId, oldScore, newScore, delta, reason } = event.payload;

      const input = `Predict the trust score change for this moderation event:

User: ${userId}
Current Trust Score: ${oldScore}
Event: ${reason}

Predict:
1. New trust score
2. Delta (change amount)
3. Reasoning for change`;

      const output = `Trust Score Prediction:
Previous Score: ${oldScore}
New Score: ${newScore}
Delta: ${delta > 0 ? '+' : ''}${delta}
Reasoning: ${reason}`;

      const example = this.createTrainingExample({
        category: 'trust_prediction',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId,
          userId,
          trustScoreBefore: oldScore,
          trustScoreAfter: newScore,
          outcome: 'success',
        },
        baseQualityFactors: {
          confidenceScore: 0.90,
          hasClearOutcome: true,
          hasContextualData: true,
          isCommonPattern: Math.abs(delta) <= 10,
        },
      });

      this.addExample('trust_prediction', example);
      logger.debug(`Collected trust example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect trust example:', error);
    }
  }

  /**
   * Collect moderation decision examples
   */
  private async collectModerationExample(event: DomainEvent): Promise<void> {
    try {
      const { actionType, targetUserId, reason, guildId, duration } = event.payload;

      const input = `Determine the appropriate moderation action:

Violation: "${reason}"
User: ${targetUserId}
Context: Standard community guidelines

What action should be taken?`;

      const output = `Moderation Decision:
Action: ${actionType}
Duration: ${duration ? `${duration}ms` : 'N/A'}
Justification: ${reason}`;

      const example = this.createTrainingExample({
        category: 'moderation_decision',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId,
          userId: targetUserId,
          outcome: 'success',
        },
        baseQualityFactors: {
          confidenceScore: 0.90,
          hasClearOutcome: true,
          hasDetailedReasoning: reason.length > 20,
        },
      });

      this.addExample('moderation_decision', example);
      logger.debug(`Collected moderation example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect moderation example:', error);
    }
  }

  /**
   * Collect RAG-enhanced examples (HIGHEST QUALITY)
   */
  private async collectRAGExample(event: DomainEvent): Promise<void> {
    try {
      const { messageId, guildId, originalConfidence, enhancedConfidence, precedents, enhancedReasoning } = event.payload;

      const input = `Analyze this content with historical context:

[${precedents} similar past cases available]

Current case analysis needed.

Provide enhanced decision using historical precedents.`;

      const output = `RAG-Enhanced Analysis:
Original Confidence: ${originalConfidence.toFixed(2)}
Enhanced Confidence: ${enhancedConfidence.toFixed(2)}
Precedents Considered: ${precedents}
Enhanced Reasoning: ${enhancedReasoning}`;

      const example = this.createTrainingExample({
        category: 'rag_context_enhancement',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId,
          confidence: enhancedConfidence,
          outcome: 'success',
          ragEnhanced: true,
          precedents,
        },
        baseQualityFactors: {
          confidenceScore: enhancedConfidence,
          hasDetailedReasoning: true,
          hasClearOutcome: true,
          isRagEnhanced: true,
          hasMultiplePrecedents: precedents > 2,
          hasContextualData: true,
        },
      });

      this.addExample('rag_context_enhancement', example);
      logger.debug(`Collected RAG example: ${example.id} (${example.quality.tier}) - GOLD TIER`);
    } catch (error: any) {
      logger.error('Failed to collect RAG example:', error);
    }
  }

  /**
   * Collect human correction examples (CRITICAL FOR LEARNING)
   */
  private async collectCorrectionExample(event: DomainEvent): Promise<void> {
    try {
      const { correction } = event.payload;

      const input = `Review this AI decision:

AI Decision: ${correction.aiDecision.action}
Target: ${correction.aiDecision.target}
Reason: ${correction.aiDecision.reason}
Confidence: ${correction.aiDecision.confidence}

Context: ${correction.aiDecision.context}

What is the correct action?`;

      const output = `Corrected Decision:
AI was WRONG - ${correction.category}
Mistake: ${correction.aiMistake}
Lesson Learned: ${correction.lesson}
Moderator's Action: ${correction.moderatorAction.type}
${correction.moderatorAction.reason ? `Moderator Reasoning: ${correction.moderatorAction.reason}` : ''}`;

      const example = this.createTrainingExample({
        category: 'human_correction',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId: correction.guildId,
          outcome: 'corrected',
          humanFeedback: true,
          correctionType: correction.category,
          confidence: correction.aiDecision.confidence,
        },
        baseQualityFactors: {
          confidenceScore: 1.0, // Human corrections are ALWAYS high quality
          hasDetailedReasoning: true,
          hasHumanValidation: true,
          hasClearOutcome: true,
          isEdgeCase: true, // Corrections often involve edge cases
        },
      });

      this.addExample('human_correction', example);

      // Also add to feedback queue for analysis
      this.feedbackQueue.set(example.id, { example, feedback: correction.moderatorAction });

      logger.info(`🎓 Collected HUMAN CORRECTION example: ${example.id} (${example.quality.tier}) - HIGH VALUE`);
    } catch (error: any) {
      logger.error('Failed to collect correction example:', error);
    }
  }

  /**
   * Collect policy interpretation examples
   */
  private async collectPolicyExample(event: DomainEvent): Promise<void> {
    try {
      const { policy, evaluation, message } = event.payload;

      const input = `Evaluate if this message violates the policy:

Policy: "${policy.description}"
Threshold: ${policy.threshold}

Message: "${message}"

Does this violate the policy?`;

      const output = `Policy Evaluation:
Violates: ${evaluation.violates ? 'YES' : 'NO'}
Confidence: ${evaluation.confidence.toFixed(2)}
Reasoning: ${evaluation.reasoning}`;

      const example = this.createTrainingExample({
        category: 'policy_interpretation',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          confidence: evaluation.confidence,
          outcome: evaluation.violates ? 'success' : 'uncertain',
        },
        baseQualityFactors: {
          confidenceScore: evaluation.confidence,
          hasDetailedReasoning: evaluation.reasoning.length > 30,
          hasClearOutcome: evaluation.violates,
        },
      });

      this.addExample('policy_interpretation', example);
      logger.debug(`Collected policy example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect policy example:', error);
    }
  }

  /**
   * Collect sentiment analysis examples
   */
  private async collectSentimentExample(event: DomainEvent): Promise<void> {
    try {
      const { message, sentiment, score, emotion } = event.payload;

      const input = `Analyze the sentiment and emotion of this message:

Message: "${message}"

Provide:
1. Overall sentiment (positive, negative, neutral)
2. Sentiment score (-1 to 1)
3. Primary emotion`;

      const output = `Sentiment Analysis:
Sentiment: ${sentiment}
Score: ${score.toFixed(2)}
Emotion: ${emotion}`;

      const example = this.createTrainingExample({
        category: 'sentiment_analysis',
        modelTarget: 'qwen',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          emotionalState: emotion,
          confidence: Math.abs(score),
        },
        baseQualityFactors: {
          confidenceScore: Math.abs(score),
          hasClearOutcome: Math.abs(score) > 0.5,
        },
      });

      this.addExample('sentiment_analysis', example);
      logger.debug(`Collected sentiment example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect sentiment example:', error);
    }
  }

  /**
   * Collect network analysis examples (raid detection, bot patterns)
   */
  private async collectNetworkExample(event: DomainEvent): Promise<void> {
    try {
      const { pattern, users, confidence, indicators } = event.payload;

      const input = `Analyze this network activity pattern:

Users involved: ${users.length}
Activity indicators: ${indicators.join(', ')}

Is this a coordinated attack or bot activity?`;

      const output = `Network Analysis:
Pattern Detected: ${pattern}
Confidence: ${confidence.toFixed(2)}
Users Involved: ${users.length}
Indicators: ${indicators.join(', ')}
Assessment: ${confidence > 0.8 ? 'LIKELY COORDINATED ATTACK' : 'Suspicious but uncertain'}`;

      const example = this.createTrainingExample({
        category: 'network_analysis',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          confidence,
          outcome: confidence > 0.8 ? 'success' : 'uncertain',
        },
        baseQualityFactors: {
          confidenceScore: confidence,
          hasClearOutcome: confidence > 0.8,
          hasContextualData: users.length > 3,
        },
      });

      this.addExample('network_analysis', example);
      logger.debug(`Collected network example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect network example:', error);
    }
  }

  /**
   * Collect user profiling examples
   */
  private async collectUserProfileExample(event: DomainEvent): Promise<void> {
    try {
      const { userId, profile, updates } = event.payload;

      const input = `Predict user behavior based on profile:

User ID: ${userId}
Activity level: ${profile.activityLevel}
Trust score: ${profile.trustScore}
Recent violations: ${profile.violations}

What is the likely behavior pattern?`;

      const output = `User Profile Analysis:
Behavior Pattern: ${profile.behaviorPattern}
Risk Level: ${profile.riskLevel}
Predictions: ${updates.join(', ')}`;

      const example = this.createTrainingExample({
        category: 'user_profiling',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          userId,
          trustScoreBefore: profile.trustScore,
        },
        baseQualityFactors: {
          confidenceScore: 0.85,
          hasContextualData: true,
          hasDetailedReasoning: updates.length > 0,
        },
      });

      this.addExample('user_profiling', example);
      logger.debug(`Collected user profile example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect user profile example:', error);
    }
  }

  /**
   * Collect workflow parsing examples
   */
  private async collectWorkflowExample(event: DomainEvent): Promise<void> {
    try {
      const { workflowText, parsed, steps } = event.payload;

      const input = `Parse this workflow into actionable steps:

Workflow: "${workflowText}"

Provide:
1. Parsed steps
2. Dependencies
3. Execution order`;

      const output = `Workflow Parsing:
Steps: ${steps.join(' → ')}
Parsed Structure: ${JSON.stringify(parsed, null, 2)}`;

      const example = this.createTrainingExample({
        category: 'workflow_parsing',
        modelTarget: 'llama',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          outcome: parsed ? 'success' : 'failure',
        },
        baseQualityFactors: {
          confidenceScore: parsed ? 0.90 : 0.50,
          hasClearOutcome: !!parsed,
          hasDetailedReasoning: steps.length > 1,
        },
      });

      this.addExample('workflow_parsing', example);
      logger.debug(`Collected workflow example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect workflow example:', error);
    }
  }

  /**
   * Collect suspicious pattern examples from RAG
   */
  private async collectSuspiciousPatternExample(event: DomainEvent): Promise<void> {
    try {
      const { messageId, guildId, similarViolations, avgSimilarity, examples } = event.payload;

      const input = `This message is similar to ${similarViolations} past violations:

Average similarity: ${avgSimilarity.toFixed(2)}
Past violation types: ${examples.map((e: any) => e.violationType).join(', ')}

Should this be flagged as suspicious?`;

      const output = `Proactive Pattern Detection:
Similar Violations: ${similarViolations}
Avg Similarity: ${avgSimilarity.toFixed(2)}
Assessment: ${avgSimilarity > 0.85 ? 'HIGH RISK - Monitor closely' : 'Medium risk - Watch for patterns'}
Past Examples: ${JSON.stringify(examples, null, 2)}`;

      const example = this.createTrainingExample({
        category: 'violation_detection',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId,
          confidence: avgSimilarity,
          outcome: 'uncertain',
          ragEnhanced: true,
          precedents: similarViolations,
        },
        baseQualityFactors: {
          confidenceScore: avgSimilarity,
          hasContextualData: true,
          isRagEnhanced: true,
          hasMultiplePrecedents: similarViolations > 2,
        },
      });

      this.addExample('violation_detection', example);
      logger.debug(`Collected suspicious pattern example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect suspicious pattern example:', error);
    }
  }

  /**
   * Collect language detection examples
   */
  private async collectLanguageExample(event: DomainEvent): Promise<void> {
    try {
      const { text, detectedLanguage, confidence } = event.payload;

      const input = `Detect the language of this text:

Text: "${text}"

What language is this?`;

      const output = `Language Detection:
Language: ${detectedLanguage}
Confidence: ${confidence.toFixed(2)}`;

      const example = this.createTrainingExample({
        category: 'language_detection',
        modelTarget: 'general',
        input,
        output,
        metadata: {
          guildId: event.metadata.guildId || 'unknown',
          confidence,
          outcome: confidence > 0.8 ? 'success' : 'uncertain',
        },
        baseQualityFactors: {
          confidenceScore: confidence,
          hasClearOutcome: confidence > 0.8,
        },
      });

      this.addExample('language_detection', example);
      logger.debug(`Collected language example: ${example.id} (${example.quality.tier})`);
    } catch (error: any) {
      logger.error('Failed to collect language example:', error);
    }
  }

  // ========================================
  // HELPER METHODS
  // ========================================

  /**
   * Create training example with quality assessment
   */
  private createTrainingExample(config: {
    category: TrainingCategory;
    modelTarget: 'qwen' | 'llama' | 'general';
    input: string;
    output: string;
    systemPrompt?: string;
    metadata: any;
    baseQualityFactors: Partial<AdvancedTrainingExample['quality']['factors']>;
  }): AdvancedTrainingExample {
    const id = `${config.category}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Calculate quality
    const qualityFactors: AdvancedTrainingExample['quality']['factors'] = {
      confidenceScore: config.baseQualityFactors.confidenceScore || 0.5,
      hasDetailedReasoning: config.baseQualityFactors.hasDetailedReasoning || false,
      hasHumanValidation: config.baseQualityFactors.hasHumanValidation || false,
      hasContextualData: config.baseQualityFactors.hasContextualData || false,
      isRagEnhanced: config.baseQualityFactors.isRagEnhanced || false,
      hasMultiplePrecedents: config.baseQualityFactors.hasMultiplePrecedents || false,
      hasClearOutcome: config.baseQualityFactors.hasClearOutcome || false,
      isEdgeCase: config.baseQualityFactors.isEdgeCase || false,
      isCommonPattern: config.baseQualityFactors.isCommonPattern || false,
    };

    const qualityScore = this.calculateQualityScore(qualityFactors);
    const qualityTier = this.determineQualityTier(qualityScore);
    const qualityReasons = this.getQualityReasons(qualityScore, qualityFactors);

    return {
      id,
      timestamp: new Date(),
      category: config.category,
      modelTarget: config.modelTarget,
      input: config.input,
      output: config.output,
      systemPrompt: config.systemPrompt,
      metadata: config.metadata,
      quality: {
        tier: qualityTier,
        score: qualityScore,
        factors: qualityFactors,
        reasons: qualityReasons,
      },
    };
  }

  /**
   * Calculate comprehensive quality score
   */
  private calculateQualityScore(factors: AdvancedTrainingExample['quality']['factors']): number {
    let score = 0;

    // Base confidence (0-0.35)
    score += factors.confidenceScore * 0.35;

    // Detailed reasoning (+0.15)
    if (factors.hasDetailedReasoning) score += 0.15;

    // Clear outcome (+0.15)
    if (factors.hasClearOutcome) score += 0.15;

    // Human validation (HUGE BOOST +0.20)
    if (factors.hasHumanValidation) score += 0.20;

    // RAG enhancement (+0.10)
    if (factors.isRagEnhanced) score += 0.10;

    // Multiple precedents (+0.05)
    if (factors.hasMultiplePrecedents) score += 0.05;

    // Contextual data (+0.10)
    if (factors.hasContextualData) score += 0.10;

    // Edge case (valuable +0.10)
    if (factors.isEdgeCase) score += 0.10;

    // Common pattern (also valuable +0.05)
    if (factors.isCommonPattern) score += 0.05;

    return Math.min(1.0, score);
  }

  /**
   * Determine quality tier
   */
  private determineQualityTier(score: number): QualityTier {
    if (score >= this.GOLD_THRESHOLD) return 'gold';
    if (score >= this.SILVER_THRESHOLD) return 'silver';
    if (score >= this.BRONZE_THRESHOLD) return 'bronze';
    return 'reject';
  }

  /**
   * Get quality reasons
   */
  private getQualityReasons(
    score: number,
    factors: AdvancedTrainingExample['quality']['factors']
  ): string[] {
    const reasons: string[] = [];

    // Tier assessment
    if (score >= this.GOLD_THRESHOLD) {
      reasons.push('🏆 GOLD TIER - Excellent quality for fine-tuning');
    } else if (score >= this.SILVER_THRESHOLD) {
      reasons.push('🥈 SILVER TIER - Good quality training example');
    } else if (score >= this.BRONZE_THRESHOLD) {
      reasons.push('🥉 BRONZE TIER - Acceptable quality with limitations');
    } else {
      reasons.push('❌ REJECT - Quality too low for training');
    }

    // Positive factors
    if (factors.confidenceScore >= 0.9) reasons.push('Very high confidence (>= 0.9)');
    if (factors.hasDetailedReasoning) reasons.push('Detailed reasoning provided');
    if (factors.hasHumanValidation) reasons.push('Human validated - HIGHEST VALUE');
    if (factors.isRagEnhanced) reasons.push('RAG-enhanced with historical context');
    if (factors.hasMultiplePrecedents) reasons.push('Multiple precedents available');
    if (factors.hasContextualData) reasons.push('Rich contextual data');
    if (factors.hasClearOutcome) reasons.push('Clear, unambiguous outcome');
    if (factors.isEdgeCase) reasons.push('Edge case - high learning value');
    if (factors.isCommonPattern) reasons.push('Common pattern - good for coverage');

    // Negative factors
    if (factors.confidenceScore < 0.7) reasons.push('⚠️ Low confidence score');
    if (!factors.hasDetailedReasoning) reasons.push('⚠️ Lacks detailed reasoning');
    if (!factors.hasClearOutcome) reasons.push('⚠️ Ambiguous outcome');

    return reasons;
  }

  /**
   * Add example to category storage
   */
  private addExample(category: TrainingCategory, example: AdvancedTrainingExample): void {
    const categoryMap = this.examplesByCategory.get(category);
    if (!categoryMap) return;

    // Check capacity
    if (categoryMap.size >= this.MAX_EXAMPLES_PER_CATEGORY) {
      logger.warn(`Category ${category} at max capacity (${this.MAX_EXAMPLES_PER_CATEGORY})`);
      return;
    }

    // Only store bronze tier or better
    if (example.quality.tier === 'reject') {
      logger.debug(`Rejecting low-quality example: ${example.id} (score: ${example.quality.score.toFixed(2)})`);
      return;
    }

    categoryMap.set(example.id, example);
  }

  /**
   * Export dataset with balancing and filtering
   */
  async exportDataset(
    name: string,
    options: {
      category?: TrainingCategory;
      modelTarget?: 'qwen' | 'llama' | 'general';
      minQuality?: number;
      minTier?: QualityTier;
      maxExamples?: number;
      balance?: boolean;
    } = {}
  ): Promise<string> {
    try {
      const minQuality = options.minQuality || 0.75;
      const minTier = options.minTier || 'bronze';
      const tierOrder: QualityTier[] = ['gold', 'silver', 'bronze', 'reject'];
      const minTierIndex = tierOrder.indexOf(minTier);

      // Collect examples from relevant categories
      let examples: AdvancedTrainingExample[] = [];

      if (options.category) {
        const categoryMap = this.examplesByCategory.get(options.category);
        if (categoryMap) {
          examples = Array.from(categoryMap.values());
        }
      } else {
        // All categories
        for (const categoryMap of this.examplesByCategory.values()) {
          examples.push(...Array.from(categoryMap.values()));
        }
      }

      // Filter by quality
      examples = examples.filter(ex =>
        ex.quality.score >= minQuality &&
        tierOrder.indexOf(ex.quality.tier) <= minTierIndex
      );

      // Filter by model target
      if (options.modelTarget) {
        examples = examples.filter(ex =>
          ex.modelTarget === options.modelTarget || ex.modelTarget === 'general'
        );
      }

      // Balance dataset if requested
      if (options.balance) {
        examples = this.balanceDataset(examples, options.category);
      }

      // Limit examples
      if (options.maxExamples) {
        // Prioritize gold tier examples
        examples = examples
          .sort((a, b) => tierOrder.indexOf(a.quality.tier) - tierOrder.indexOf(b.quality.tier))
          .slice(0, options.maxExamples);
      }

      // Create dataset
      const dataset: FineTuningDataset = {
        name,
        description: `Fine-tuning dataset for ${options.category || 'all categories'} (min quality: ${minQuality})`,
        category: options.category || 'violation_detection',
        modelTarget: options.modelTarget || 'general',
        examples,
        stats: this.calculateDatasetStats(examples),
        balancing: this.getBalancingInfo(examples, options.category),
        createdAt: new Date(),
        version: '2.0.0',
      };

      // Export as JSONL
      const jsonlLines = examples.map(ex =>
        JSON.stringify({
          input: ex.input,
          output: ex.output,
          system: ex.systemPrompt,
          metadata: ex.metadata,
          quality: ex.quality.tier,
        })
      );

      const filename = `${name}_${Date.now()}.jsonl`;
      const filepath = path.join(this.DATA_DIR, filename);

      await fs.writeFile(filepath, jsonlLines.join('\n'));

      logger.info(`✅ Exported ${examples.length} training examples to ${filepath}`);
      logger.info(`   → Gold: ${dataset.stats.gold}, Silver: ${dataset.stats.silver}, Bronze: ${dataset.stats.bronze}`);
      logger.info(`   → Avg Quality: ${dataset.stats.avgQuality.toFixed(2)}`);
      logger.info(`   → Balanced: ${dataset.balancing.isBalanced ? 'YES' : 'NO'}`);

      return filepath;
    } catch (error: any) {
      logger.error('Failed to export dataset:', error);
      throw error;
    }
  }

  /**
   * Balance dataset across categories/outcomes
   */
  private balanceDataset(
    examples: AdvancedTrainingExample[],
    category?: TrainingCategory
  ): AdvancedTrainingExample[] {
    // Group by outcome
    const byOutcome = new Map<string, AdvancedTrainingExample[]>();

    for (const example of examples) {
      const outcome = example.metadata.outcome || 'unknown';
      if (!byOutcome.has(outcome)) {
        byOutcome.set(outcome, []);
      }
      byOutcome.get(outcome)!.push(example);
    }

    // Find minimum group size
    let minSize = Infinity;
    for (const group of byOutcome.values()) {
      if (group.length < minSize) {
        minSize = group.length;
      }
    }

    // Sample equally from each group
    const balanced: AdvancedTrainingExample[] = [];
    for (const group of byOutcome.values()) {
      // Shuffle and take minSize examples
      const shuffled = group.sort(() => Math.random() - 0.5);
      balanced.push(...shuffled.slice(0, minSize));
    }

    logger.info(`📊 Balanced dataset: ${examples.length} → ${balanced.length} examples`);
    return balanced;
  }

  /**
   * Calculate dataset statistics
   */
  private calculateDatasetStats(examples: AdvancedTrainingExample[]): FineTuningDataset['stats'] {
    const stats = {
      total: examples.length,
      gold: examples.filter(ex => ex.quality.tier === 'gold').length,
      silver: examples.filter(ex => ex.quality.tier === 'silver').length,
      bronze: examples.filter(ex => ex.quality.tier === 'bronze').length,
      byCategory: {} as Record<TrainingCategory, number>,
      byOutcome: {} as Record<string, number>,
      avgQuality: 0,
    };

    // Count by category
    for (const example of examples) {
      stats.byCategory[example.category] = (stats.byCategory[example.category] || 0) + 1;

      const outcome = example.metadata.outcome || 'unknown';
      stats.byOutcome[outcome] = (stats.byOutcome[outcome] || 0) + 1;
    }

    // Calculate average quality
    if (examples.length > 0) {
      stats.avgQuality = examples.reduce((sum, ex) => sum + ex.quality.score, 0) / examples.length;
    }

    return stats;
  }

  /**
   * Get balancing information
   */
  private getBalancingInfo(
    examples: AdvancedTrainingExample[],
    category?: TrainingCategory
  ): FineTuningDataset['balancing'] {
    const byOutcome = new Map<string, number>();

    for (const example of examples) {
      const outcome = example.metadata.outcome || 'unknown';
      byOutcome.set(outcome, (byOutcome.get(outcome) || 0) + 1);
    }

    const distribution: Record<string, number> = {};
    for (const [outcome, count] of byOutcome) {
      distribution[outcome] = count;
    }

    // Check if balanced (max difference < 20%)
    const values = Array.from(byOutcome.values());
    const min = Math.min(...values);
    const max = Math.max(...values);
    const isBalanced = values.length === 0 || (max - min) / max < 0.2;

    return {
      isBalanced,
      targetDistribution: distribution, // For now, actual = target
      actualDistribution: distribution,
    };
  }

  /**
   * Get comprehensive statistics
   */
  getStats(): {
    totalExamples: number;
    byCategory: Record<TrainingCategory, number>;
    byTier: Record<QualityTier, number>;
    byModel: Record<string, number>;
    avgQualityPerCategory: Record<TrainingCategory, number>;
    humanCorrectionCount: number;
    ragEnhancedCount: number;
  } {
    let totalExamples = 0;
    const byCategory: Record<string, number> = {};
    const byTier: Record<QualityTier, number> = { gold: 0, silver: 0, bronze: 0, reject: 0 };
    const byModel: Record<string, number> = {};
    const avgQualityPerCategory: Record<string, number> = {};
    let humanCorrectionCount = 0;
    let ragEnhancedCount = 0;

    for (const [category, categoryMap] of this.examplesByCategory) {
      const examples = Array.from(categoryMap.values());
      totalExamples += examples.length;
      byCategory[category] = examples.length;

      // Quality per category
      if (examples.length > 0) {
        avgQualityPerCategory[category] =
          examples.reduce((sum, ex) => sum + ex.quality.score, 0) / examples.length;
      }

      // Count by tier and model
      for (const example of examples) {
        byTier[example.quality.tier]++;
        byModel[example.modelTarget] = (byModel[example.modelTarget] || 0) + 1;

        if (example.metadata.humanFeedback) humanCorrectionCount++;
        if (example.metadata.ragEnhanced) ragEnhancedCount++;
      }
    }

    return {
      totalExamples,
      byCategory: byCategory as Record<TrainingCategory, number>,
      byTier,
      byModel,
      avgQualityPerCategory: avgQualityPerCategory as Record<TrainingCategory, number>,
      humanCorrectionCount,
      ragEnhancedCount,
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
    logger.info('🛑 Shutting down Advanced Fine-Tuning Plugin...');

    const stats = this.getStats();
    logger.info(`   → ${stats.totalExamples} training examples collected`);
    logger.info(`   → Gold: ${stats.byTier.gold}, Silver: ${stats.byTier.silver}, Bronze: ${stats.byTier.bronze}`);
    logger.info(`   → Human corrections: ${stats.humanCorrectionCount}`);
    logger.info(`   → RAG-enhanced: ${stats.ragEnhancedCount}`);

    // Auto-export high-quality examples
    if (stats.byTier.gold >= 100) {
      logger.info('Auto-exporting GOLD tier examples...');
      try {
        await this.exportDataset('auto_export_gold', { minTier: 'gold' });
      } catch (error: any) {
        logger.error('Failed to auto-export:', error);
      }
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }
}
