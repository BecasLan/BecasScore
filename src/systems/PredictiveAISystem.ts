import { Guild, TextChannel, Message, GuildMember } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { DeepRelationshipTracker } from './DeepRelationshipTracker';

const logger = createLogger('PredictiveAI');

export interface Prediction {
  id: string;
  type: 'conflict' | 'emotional_crisis' | 'scam' | 'toxicity' | 'spam' | 'user_churn' | 'opportunity' | 'improvement';
  severity: number; // 1-10
  confidence: number; // 0-1
  timestamp: Date;

  // What is predicted
  prediction: string;
  evidence: string[];
  indicators: string[];

  // Who/what it involves
  involvedUsers?: string[];
  involvedChannels?: string[];

  // Recommendations
  suggestedActions: string[];
  preventionStrategies: string[];

  // Outcome tracking
  actuallyHappened?: boolean;
  preventionAttempted?: boolean;
  outcome?: string;
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  category: 'behavioral' | 'temporal' | 'social' | 'linguistic' | 'emotional';
  frequency: number; // How often this pattern occurs
  lastOccurrence: Date;
  associatedOutcomes: string[]; // What usually happens after this pattern
  reliability: number; // 0-1, how reliable is this pattern as a predictor
}

export interface TrendAnalysis {
  metric: string;
  timeframe: string; // "hourly", "daily", "weekly"
  currentValue: number;
  trend: 'rising' | 'falling' | 'stable' | 'volatile';
  trendStrength: number; // 0-1
  prediction: {
    nextValue: number;
    confidence: number;
    timeframe: string;
  };
  anomalies: {
    timestamp: Date;
    value: number;
    deviation: number;
  }[];
}

export class PredictiveAISystem {
  private ollama: OllamaService;
  private relationshipTracker: DeepRelationshipTracker;
  private predictions: Map<string, Prediction> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private enabled: boolean = true;

  constructor(ollama: OllamaService, relationshipTracker: DeepRelationshipTracker) {
    this.ollama = ollama;
    this.relationshipTracker = relationshipTracker;
  }

  /**
   * Start predictive analysis loop
   */
  start(): void {
    logger.info('Starting Predictive AI System');
    this.enabled = true;

    // Run conflict prediction every 15 minutes
    setInterval(() => {
      this.predictConflicts().catch(error => {
        logger.error('Error in conflict prediction', error);
      });
    }, 15 * 60 * 1000);

    // Check for emotional crises every 30 minutes
    setInterval(() => {
      this.predictEmotionalCrises().catch(error => {
        logger.error('Error in emotional crisis prediction', error);
      });
    }, 30 * 60 * 1000);

    // Analyze patterns daily
    setInterval(() => {
      this.analyzePatterns().catch(error => {
        logger.error('Error in pattern analysis', error);
      });
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Analyze a conversation for potential issues
   */
  async analyzeConversation(messages: Message[], channel: TextChannel): Promise<Prediction[]> {
    if (messages.length < 3) return [];

    try {
      const conversation = messages
        .slice(0, 20)
        .reverse()
        .map(m => `${m.author.username}: ${m.content}`)
        .join('\n');

      const prompt = `Analyze this Discord conversation for potential issues or opportunities:

${conversation}

Predict:
1. **Conflicts**: Are people arguing? Is tension rising? Will it escalate?
2. **Emotional Issues**: Is anyone showing signs of distress, sadness, anger?
3. **Toxicity**: Any toxic behavior, bullying, or harassment forming?
4. **Scams**: Any suspicious links, offers, or phishing attempts?
5. **Opportunities**: Chances to help, connect people, or improve community?

For each prediction:
- Type: conflict, emotional_crisis, scam, toxicity, spam, opportunity, improvement
- Severity: 1-10
- Confidence: 0-1
- What you predict will happen
- Evidence supporting prediction
- Early warning indicators
- Suggested actions to prevent/capitalize

Only predict things that are LIKELY to happen. Don't over-predict.

Respond ONLY with valid JSON:
{
  "predictions": [
    {
      "type": "conflict",
      "severity": 7,
      "confidence": 0.8,
      "prediction": "Argument about X will escalate",
      "evidence": ["user A said Y", "user B responded aggressively"],
      "indicators": ["raised voices", "personal attacks", "topic Z is sensitive"],
      "involvedUsers": ["user-a-id", "user-b-id"],
      "suggestedActions": ["intervene gently", "redirect conversation"],
      "preventionStrategies": ["suggest taking a break", "acknowledge both perspectives"]
    }
  ]
}`;

      const systemPrompt = `You are Becas's predictive AI. You anticipate problems before they happen and spot opportunities. Be accurate, not alarmist. Respond ONLY with JSON.`;

      const result = await this.ollama.generateJSON<{ predictions: any[] }>(prompt, systemPrompt);

      const predictions: Prediction[] = result.predictions.map(p => ({
        id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: p.type,
        severity: p.severity,
        confidence: p.confidence,
        timestamp: new Date(),
        prediction: p.prediction,
        evidence: p.evidence || [],
        indicators: p.indicators || [],
        involvedUsers: p.involvedUsers || [],
        involvedChannels: [channel.id],
        suggestedActions: p.suggestedActions || [],
        preventionStrategies: p.preventionStrategies || [],
      }));

      // Store high-confidence predictions
      predictions
        .filter(p => p.confidence > 0.6)
        .forEach(p => this.predictions.set(p.id, p));

      logger.info(`Analyzed conversation: ${predictions.length} predictions made`, {
        channel: channel.name,
        highSeverity: predictions.filter(p => p.severity >= 7).length,
      });

      return predictions;
    } catch (error) {
      logger.error('Error analyzing conversation', error);
      return [];
    }
  }

  /**
   * Predict potential conflicts across the server
   */
  private async predictConflicts(): Promise<void> {
    logger.info('Running conflict prediction analysis');

    // This would analyze relationship tensions, recent arguments, etc.
    // For now, logging placeholder
    logger.debug('Conflict prediction complete');
  }

  /**
   * Predict emotional crises from user profiles
   */
  private async predictEmotionalCrises(): Promise<Prediction[]> {
    logger.info('Checking for potential emotional crises');

    const predictions: Prediction[] = [];

    try {
      const profiles = this.relationshipTracker.getAllProfiles();

      for (const profile of profiles) {
        const support = await this.relationshipTracker.needsEmotionalSupport(profile.userId, profile.guildId);

        if (support.needs && support.severity >= 6) {
          const prediction: Prediction = {
            id: `pred-crisis-${profile.userId}-${Date.now()}`,
            type: 'emotional_crisis',
            severity: support.severity,
            confidence: 0.75,
            timestamp: new Date(),
            prediction: `${profile.username} may be experiencing emotional distress`,
            evidence: [support.reason],
            indicators: profile.emotionalHistory.slice(-3).map(e => `${e.emotion} (intensity ${e.intensity})`),
            involvedUsers: [profile.userId],
            suggestedActions: [
              'Check in on them privately',
              'Offer support or resources',
              'Monitor their messages closely',
            ],
            preventionStrategies: [
              'Create a safe space for them to talk',
              'Show you care and remember previous conversations',
              'Connect them with others who might help',
            ],
          };

          predictions.push(prediction);
          this.predictions.set(prediction.id, prediction);

          logger.warn(`Predicted emotional crisis for user ${profile.username}`, {
            severity: support.severity,
            reason: support.reason,
          });
        }
      }

      return predictions;
    } catch (error) {
      logger.error('Error predicting emotional crises', error);
      return [];
    }
  }

  /**
   * Predict user churn (who might leave the server)
   */
  async predictUserChurn(guild: Guild): Promise<Prediction[]> {
    logger.info('Analyzing user churn risk');

    const predictions: Prediction[] = [];

    try {
      const profiles = this.relationshipTracker.getAllProfiles().filter(p => p.guildId === guild.id);

      for (const profile of profiles) {
        // Calculate churn risk factors
        const daysSinceActive = profile.updatedAt
          ? (Date.now() - profile.updatedAt.getTime()) / (1000 * 60 * 60 * 24)
          : 999;

        const trustLevel = profile.becasRelationship.trustLevel;
        const intimacy = profile.becasRelationship.intimacy;
        const recentNegativeEmotions = profile.emotionalHistory
          .slice(-5)
          .filter(e => ['sad', 'frustrated', 'angry', 'disappointed'].includes(e.emotion))
          .length;

        // Churn risk score
        let riskScore = 0;
        const riskFactors: string[] = [];

        if (daysSinceActive > 7) {
          riskScore += 3;
          riskFactors.push(`Inactive for ${Math.floor(daysSinceActive)} days`);
        }
        if (trustLevel < 4) {
          riskScore += 2;
          riskFactors.push('Low trust level');
        }
        if (intimacy < 3) {
          riskScore += 2;
          riskFactors.push('Low intimacy/connection');
        }
        if (recentNegativeEmotions >= 3) {
          riskScore += 3;
          riskFactors.push('Recent negative emotions');
        }
        if (profile.relationships.length < 2) {
          riskScore += 1;
          riskFactors.push('Few relationships in server');
        }

        if (riskScore >= 5) {
          const prediction: Prediction = {
            id: `pred-churn-${profile.userId}-${Date.now()}`,
            type: 'user_churn',
            severity: riskScore,
            confidence: 0.7,
            timestamp: new Date(),
            prediction: `${profile.username} is at risk of leaving the server`,
            evidence: riskFactors,
            indicators: [
              `Inactive for ${Math.floor(daysSinceActive)} days`,
              `Trust: ${trustLevel}/10`,
              `Intimacy: ${intimacy}/10`,
            ],
            involvedUsers: [profile.userId],
            suggestedActions: [
              'Reach out and check in',
              'Invite them to participate in something interesting',
              'Show you value their presence',
            ],
            preventionStrategies: [
              'Build stronger connection',
              'Find what interests them',
              'Make them feel valued and included',
            ],
          };

          predictions.push(prediction);
          this.predictions.set(prediction.id, prediction);
        }
      }

      logger.info(`User churn analysis complete: ${predictions.length} at-risk users identified`);
      return predictions;
    } catch (error) {
      logger.error('Error predicting user churn', error);
      return [];
    }
  }

  /**
   * Analyze patterns in community behavior
   */
  private async analyzePatterns(): Promise<void> {
    logger.info('Analyzing behavioral patterns');

    // This would look for recurring patterns that predict outcomes
    // E.g., "when topic X comes up, users Y and Z always argue"
    // E.g., "channel activity drops 30% on weekends"
    // E.g., "spam increases after 10pm"

    logger.debug('Pattern analysis complete');
  }

  /**
   * Predict best time to post/act
   */
  async predictBestTimeToAct(guild: Guild, action: string): Promise<{
    bestTime: Date;
    reasoning: string;
    confidence: number;
  }> {
    try {
      // Analyze historical activity patterns
      const prompt = `Based on typical Discord server patterns, when is the best time to: "${action}"?

Consider:
- Peak activity hours
- When people are most receptive
- When action would have maximum impact

Respond ONLY with JSON:
{
  "hoursFromNow": 2,
  "reasoning": "peak activity time, users most receptive",
  "confidence": 0.8
}`;

      const result = await this.ollama.generateJSON<{
        hoursFromNow: number;
        reasoning: string;
        confidence: number;
      }>(prompt, 'You predict optimal timing. Respond ONLY with JSON.');

      return {
        bestTime: new Date(Date.now() + result.hoursFromNow * 60 * 60 * 1000),
        reasoning: result.reasoning,
        confidence: result.confidence,
      };
    } catch (error) {
      logger.error('Error predicting best time', error);
      return {
        bestTime: new Date(),
        reasoning: 'Unable to predict',
        confidence: 0,
      };
    }
  }

  /**
   * Suggest community improvements
   */
  async suggestImprovements(guild: Guild): Promise<Prediction[]> {
    logger.info('Generating community improvement suggestions');

    try {
      // Analyze server structure, activity, relationships
      const prompt = `Analyze this Discord server and suggest improvements:

Server: ${guild.name}
Members: ${guild.memberCount}
Channels: ${guild.channels.cache.size}

Based on best practices, what improvements would help this community?

Consider:
- Engagement opportunities
- New channels/roles that would help
- Events or activities
- Moderation improvements
- Community building ideas

Respond ONLY with JSON:
{
  "suggestions": [
    {
      "type": "improvement",
      "severity": 5,
      "confidence": 0.8,
      "prediction": "Creating a voice-chat-text channel would increase engagement",
      "evidence": ["no dedicated space for voice chat planning", "users often ask where to coordinate"],
      "suggestedActions": ["create #voice-chat channel", "announce it to community"],
      "expectedImpact": "20% increase in voice chat participation"
    }
  ]
}`;

      const systemPrompt = `You suggest community improvements. Be practical and specific. Respond ONLY with JSON.`;

      const result = await this.ollama.generateJSON<{ suggestions: any[] }>(prompt, systemPrompt);

      const predictions: Prediction[] = result.suggestions.map(s => ({
        id: `pred-improvement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'improvement' as const,
        severity: s.severity || 5,
        confidence: s.confidence || 0.7,
        timestamp: new Date(),
        prediction: s.prediction,
        evidence: s.evidence || [],
        indicators: [],
        suggestedActions: s.suggestedActions || [],
        preventionStrategies: [],
      }));

      predictions.forEach(p => this.predictions.set(p.id, p));

      logger.info(`Generated ${predictions.length} improvement suggestions`);
      return predictions;
    } catch (error) {
      logger.error('Error suggesting improvements', error);
      return [];
    }
  }

  /**
   * Predict outcome of a potential action
   */
  async predictActionOutcome(action: string, context: string): Promise<{
    likelyOutcome: string;
    confidence: number;
    risks: string[];
    benefits: string[];
    recommendation: 'do_it' | 'dont_do_it' | 'do_with_caution';
  }> {
    try {
      const prompt = `Predict the outcome of this action:

Action: "${action}"
Context: ${context}

Analyze:
1. What is the most likely outcome?
2. What are the risks?
3. What are the benefits?
4. Should Becas do this?

Respond ONLY with JSON:
{
  "likelyOutcome": "Users will respond positively and engage more",
  "confidence": 0.75,
  "risks": ["might seem pushy", "could backfire if timing is wrong"],
  "benefits": ["increased engagement", "shows proactive care"],
  "recommendation": "do_with_caution"
}`;

      const result = await this.ollama.generateJSON<{
        likelyOutcome: string;
        confidence: number;
        risks: string[];
        benefits: string[];
        recommendation: 'do_it' | 'dont_do_it' | 'do_with_caution';
      }>(prompt, 'You predict action outcomes. Respond ONLY with JSON.');

      return result;
    } catch (error) {
      logger.error('Error predicting action outcome', error);
      return {
        likelyOutcome: 'Unknown',
        confidence: 0,
        risks: ['Unable to predict'],
        benefits: [],
        recommendation: 'dont_do_it',
      };
    }
  }

  /**
   * Record prediction outcome (for learning)
   */
  recordPredictionOutcome(predictionId: string, actuallyHappened: boolean, outcome: string): void {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) return;

    prediction.actuallyHappened = actuallyHappened;
    prediction.outcome = outcome;

    logger.info('Prediction outcome recorded', {
      type: prediction.type,
      correct: actuallyHappened,
      confidence: prediction.confidence,
    });

    // Could use this to improve future predictions
  }

  /**
   * Get high-priority predictions
   */
  getActivePredictions(minSeverity: number = 5): Prediction[] {
    return Array.from(this.predictions.values())
      .filter(p => p.severity >= minSeverity && !p.actuallyHappened)
      .sort((a, b) => b.severity - a.severity);
  }

  /**
   * Get predictions for specific user
   */
  getUserPredictions(userId: string): Prediction[] {
    return Array.from(this.predictions.values()).filter(p =>
      p.involvedUsers?.includes(userId)
    );
  }

  /**
   * Clear old predictions
   */
  clearOldPredictions(daysOld: number = 7): void {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    let cleared = 0;

    for (const [id, prediction] of this.predictions) {
      if (prediction.timestamp.getTime() < cutoff) {
        this.predictions.delete(id);
        cleared++;
      }
    }

    logger.info(`Cleared ${cleared} old predictions`);
  }

  /**
   * Get system state
   */
  getState(): any {
    const predictions = Array.from(this.predictions.values());

    return {
      enabled: this.enabled,
      totalPredictions: predictions.length,
      activePredictions: predictions.filter(p => !p.actuallyHappened).length,
      predictionsByType: {
        conflict: predictions.filter(p => p.type === 'conflict').length,
        emotional_crisis: predictions.filter(p => p.type === 'emotional_crisis').length,
        opportunity: predictions.filter(p => p.type === 'opportunity').length,
        improvement: predictions.filter(p => p.type === 'improvement').length,
      },
      highSeverity: predictions.filter(p => p.severity >= 7 && !p.actuallyHappened).length,
    };
  }
}
