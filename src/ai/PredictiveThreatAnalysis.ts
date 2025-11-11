/**
 * PREDICTIVE THREAT ANALYSIS - Proactive Threat Detection
 *
 * Predicts threats BEFORE they happen by analyzing:
 * - User behavior trends
 * - Escalation patterns
 * - Risk indicator changes
 * - Historical patterns
 *
 * Predictions:
 * - "User X likely to violate rules in next 24h" (based on behavior changes)
 * - "Channel Y escalating toward conflict" (based on conversation mood)
 * - "Raid likely at time Z" (based on historical patterns)
 * - "User A may be alt of banned User B" (based on behavior similarity)
 *
 * Enables proactive moderation: warn users before they act, not after.
 */

import { Client, User as DiscordUser } from 'discord.js';
import { UserCharacterProfile } from '../services/ProfileBuilder';
import { TrustScore } from '../types/Trust.types';
import { PatternRecognition } from './PatternRecognition';
import { ThreatDatabase } from '../database/ThreatDatabase';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('PredictiveThreatAnalysis');

export interface ThreatPrediction {
  type: 'user_violation' | 'channel_escalation' | 'raid' | 'alt_account' | 'emerging_threat';
  probability: number; // 0-1
  timeframe: string; // "next 1h", "next 24h", "next 7d"

  // Target
  userId?: string;
  channelId?: string;

  // Prediction details
  reasoning: string;
  indicators: string[];
  riskFactors: Array<{
    factor: string;
    weight: number; // How much this contributes
  }>;

  // Recommendations
  recommendations: string[];
  preventiveActions: Array<{
    action: string; // warn, watch, restrict
    priority: 'low' | 'medium' | 'high';
  }>;

  // Metadata
  confidence: number; // How confident in this prediction
  createdAt: Date;
  expiresAt: Date;
}

export class PredictiveThreatAnalysis {
  private ollama: OllamaService;
  private predictions: Map<string, ThreatPrediction[]> = new Map(); // userId/channelId → predictions

  constructor(
    private client: Client,
    private patternRecognition: PatternRecognition,
    private threatDatabase: ThreatDatabase,
    private messageRepo: MessageRepository
  ) {
    this.ollama = new OllamaService('analysis'); // Qwen3:8b
    logger.info('PredictiveThreatAnalysis initialized');
  }

  /**
   * Predict if user is likely to violate rules
   */
  async predictUserViolation(
    userId: string,
    serverId: string,
    profile: UserCharacterProfile,
    trustScore: TrustScore
  ): Promise<ThreatPrediction | null> {
    try {
      const riskFactors: ThreatPrediction['riskFactors'] = [];
      let totalRisk = 0;

      // Factor 1: Profile risk indicators
      const deceptionRisk = profile.riskIndicators.deception;
      if (deceptionRisk > 0.6) {
        riskFactors.push({ factor: 'High deception risk', weight: deceptionRisk * 0.3 });
        totalRisk += deceptionRisk * 0.3;
      }

      const manipulationRisk = profile.riskIndicators.manipulation;
      if (manipulationRisk > 0.6) {
        riskFactors.push({ factor: 'High manipulation risk', weight: manipulationRisk * 0.25 });
        totalRisk += manipulationRisk * 0.25;
      }

      const impulsivityRisk = profile.riskIndicators.impulsivity;
      if (impulsivityRisk > 0.7) {
        riskFactors.push({ factor: 'High impulsivity', weight: impulsivityRisk * 0.2 });
        totalRisk += impulsivityRisk * 0.2;
      }

      // Factor 2: Trust score trend
      const recentNegativeEvents = trustScore.history.slice(-5).filter(e => e.delta < 0).length;
      if (recentNegativeEvents >= 3) {
        const trendRisk = recentNegativeEvents * 0.15;
        riskFactors.push({ factor: 'Declining trust score', weight: trendRisk });
        totalRisk += trendRisk;
      }

      // Factor 3: Low trust score
      if (trustScore.score < 30) {
        const lowTrustRisk = (30 - trustScore.score) / 100;
        riskFactors.push({ factor: `Low trust score (${trustScore.score})`, weight: lowTrustRisk });
        totalRisk += lowTrustRisk;
      }

      // Factor 4: Behavioral instability
      if (profile.personality.stability < 0.3) {
        riskFactors.push({ factor: 'Unstable behavior patterns', weight: 0.15 });
        totalRisk += 0.15;
      }

      // Factor 5: High aggression
      if (profile.personality.aggression > 0.7) {
        riskFactors.push({ factor: 'High aggression', weight: 0.2 });
        totalRisk += 0.2;
      }

      // If total risk is low, no prediction
      if (totalRisk < 0.4) {
        return null;
      }

      // Calculate probability
      const probability = Math.min(0.95, totalRisk);

      // Determine timeframe
      let timeframe = 'next 7d';
      if (probability > 0.8) {
        timeframe = 'next 24h';
      } else if (probability > 0.6) {
        timeframe = 'next 3d';
      }

      // Generate recommendations
      const recommendations = this.generateUserRecommendations(probability, profile, trustScore);

      const prediction: ThreatPrediction = {
        type: 'user_violation',
        probability,
        timeframe,
        userId,
        reasoning: `User shows ${riskFactors.length} risk factors with ${(probability * 100).toFixed(0)}% probability of violation`,
        indicators: riskFactors.map(f => f.factor),
        riskFactors,
        recommendations,
        preventiveActions: this.generatePreventiveActions(probability),
        confidence: probability > 0.7 ? 0.8 : 0.6,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };

      // Store prediction
      if (!this.predictions.has(userId)) {
        this.predictions.set(userId, []);
      }
      this.predictions.get(userId)!.push(prediction);

      logger.info(`Predicted user violation: ${userId} (${(probability * 100).toFixed(0)}% probability)`);

      return prediction;

    } catch (error) {
      logger.error('Failed to predict user violation', error);
      return null;
    }
  }

  /**
   * Predict channel escalation toward conflict
   */
  async predictChannelEscalation(
    channelId: string,
    serverId: string,
    recentMessages: Array<{ userId: string; content: string; toxicity: number; timestamp: Date }>
  ): Promise<ThreatPrediction | null> {
    if (recentMessages.length < 5) return null;

    try {
      const riskFactors: ThreatPrediction['riskFactors'] = [];
      let totalRisk = 0;

      // Factor 1: Toxicity trend
      const recent5 = recentMessages.slice(-5);
      const avgRecentToxicity = recent5.reduce((sum, m) => sum + (m.toxicity || 0), 0) / 5;

      if (avgRecentToxicity > 0.5) {
        riskFactors.push({ factor: 'Elevated toxicity', weight: avgRecentToxicity * 0.4 });
        totalRisk += avgRecentToxicity * 0.4;
      }

      // Factor 2: Toxicity increasing
      const older5 = recentMessages.slice(-10, -5);
      if (older5.length >= 5) {
        const avgOlderToxicity = older5.reduce((sum, m) => sum + (m.toxicity || 0), 0) / 5;
        const increase = avgRecentToxicity - avgOlderToxicity;

        if (increase > 0.2) {
          riskFactors.push({ factor: 'Toxicity rising', weight: increase * 0.5 });
          totalRisk += increase * 0.5;
        }
      }

      // Factor 3: Message frequency
      const timeSpan = (recentMessages[recentMessages.length - 1].timestamp.getTime() -
                       recentMessages[0].timestamp.getTime()) / 60000; // minutes
      const messagesPerMinute = recentMessages.length / timeSpan;

      if (messagesPerMinute > 5) {
        riskFactors.push({ factor: 'High message rate', weight: 0.2 });
        totalRisk += 0.2;
      }

      // Factor 4: Multiple participants
      const uniqueUsers = new Set(recentMessages.map(m => m.userId)).size;
      if (uniqueUsers >= 3) {
        riskFactors.push({ factor: 'Multi-party argument', weight: 0.25 });
        totalRisk += 0.25;
      }

      if (totalRisk < 0.4) {
        return null;
      }

      const probability = Math.min(0.95, totalRisk);

      const prediction: ThreatPrediction = {
        type: 'channel_escalation',
        probability,
        timeframe: probability > 0.7 ? 'next 10m' : 'next 30m',
        channelId,
        reasoning: `Channel showing escalation patterns with ${(probability * 100).toFixed(0)}% probability of conflict`,
        indicators: riskFactors.map(f => f.factor),
        riskFactors,
        recommendations: [
          'Monitor channel closely',
          'Consider activating slowmode',
          'Prepare to intervene if toxicity continues',
        ],
        preventiveActions: [
          { action: 'Enable slowmode', priority: probability > 0.7 ? 'high' : 'medium' },
          { action: 'Send calming message', priority: 'medium' },
        ],
        confidence: 0.7,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      };

      if (!this.predictions.has(channelId)) {
        this.predictions.set(channelId, []);
      }
      this.predictions.get(channelId)!.push(prediction);

      logger.info(`Predicted channel escalation: ${channelId} (${(probability * 100).toFixed(0)}% probability)`);

      return prediction;

    } catch (error) {
      logger.error('Failed to predict channel escalation', error);
      return null;
    }
  }

  /**
   * Detect potential alt accounts
   */
  async detectAltAccount(
    userId: string,
    serverId: string,
    profile: UserCharacterProfile
  ): Promise<ThreatPrediction | null> {
    try {
      // Check for banned users with similar profiles
      // TODO: Query database for banned users, compare profiles

      // Check for suspicious patterns (new account, similar name, etc.)
      // This is simplified - real implementation would be more sophisticated

      return null; // Placeholder

    } catch (error) {
      logger.error('Failed to detect alt account', error);
      return null;
    }
  }

  /**
   * Get active predictions for user/channel
   */
  getPredictions(targetId: string): ThreatPrediction[] {
    return this.predictions.get(targetId) || [];
  }

  /**
   * Get all active predictions
   */
  getAllPredictions(): ThreatPrediction[] {
    const all: ThreatPrediction[] = [];
    for (const predictions of this.predictions.values()) {
      all.push(...predictions);
    }
    return all.filter(p => p.expiresAt > new Date());
  }

  /**
   * Clear expired predictions
   */
  cleanupPredictions(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [key, predictions] of this.predictions) {
      const active = predictions.filter(p => p.expiresAt > now);
      if (active.length === 0) {
        this.predictions.delete(key);
      } else if (active.length < predictions.length) {
        this.predictions.set(key, active);
        cleaned += predictions.length - active.length;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired predictions`);
    }

    return cleaned;
  }

  /**
   * Generate recommendations based on prediction
   */
  private generateUserRecommendations(
    probability: number,
    profile: UserCharacterProfile,
    trustScore: TrustScore
  ): string[] {
    const recommendations: string[] = [];

    if (probability > 0.8) {
      recommendations.push('⚠️ HIGH RISK: Monitor this user closely');
      recommendations.push('Consider proactive warning message');
    }

    if (profile.riskIndicators.impulsivity > 0.7) {
      recommendations.push('User shows high impulsivity - may react emotionally');
    }

    if (trustScore.score < 20) {
      recommendations.push('Very low trust score - consider restrictions');
    }

    if (profile.personality.aggression > 0.7) {
      recommendations.push('High aggression detected - watch for conflicts');
    }

    return recommendations;
  }

  /**
   * Generate preventive actions
   */
  private generatePreventiveActions(probability: number): ThreatPrediction['preventiveActions'] {
    const actions: ThreatPrediction['preventiveActions'] = [];

    if (probability > 0.8) {
      actions.push({ action: 'Send warning DM', priority: 'high' });
      actions.push({ action: 'Add to watch list', priority: 'high' });
    } else if (probability > 0.6) {
      actions.push({ action: 'Monitor activity', priority: 'medium' });
    } else {
      actions.push({ action: 'Track behavior changes', priority: 'low' });
    }

    return actions;
  }

  /**
   * Get prediction statistics
   */
  getStats(): {
    totalPredictions: number;
    byType: Record<ThreatPrediction['type'], number>;
    highProbability: number;
    avgConfidence: number;
  } {
    const all = this.getAllPredictions();

    const byType: Record<string, number> = {};
    all.forEach(p => {
      byType[p.type] = (byType[p.type] || 0) + 1;
    });

    const highProbability = all.filter(p => p.probability > 0.7).length;
    const avgConfidence = all.length > 0
      ? all.reduce((sum, p) => sum + p.confidence, 0) / all.length
      : 0;

    return {
      totalPredictions: all.length,
      byType: byType as any,
      highProbability,
      avgConfidence,
    };
  }
}
