/**
 * SeverityCalculator.ts
 *
 * Calculates appropriate moderation action severity based on:
 * - Threat type and confidence
 * - User trust score and history
 * - Context and patterns
 *
 * This is the CRITICAL decision engine that determines:
 * - SCAM 95%+ confidence → PERMA BAN (not timeout!)
 * - Severity modifiers based on trust score
 * - Redemption considerations
 */

import { TrustScore } from '../types/Trust.types';
import { AnalyzedMessage } from '../types/Message.types';
import { ScamAnalysis } from '../analyzers/ScamDetector';
import { UserCharacterProfile } from './ProfileBuilder';

export interface SeverityResult {
  action: 'none' | 'warn' | 'delete' | 'timeout' | 'kick' | 'ban';
  duration?: number; // in minutes (for timeout)
  confidence: number;
  reason: string;
  severity: number; // 0-10 scale
  modifiers: {
    trustScoreModifier: number;
    historyModifier: number;
    redemptionModifier: number;
    contextModifier: number;
    profileModifier?: number; // NEW: Character profile modifier
    total: number;
  };
}

export interface SeverityInput {
  message: AnalyzedMessage;
  trustScore: TrustScore;
  scamAnalysis?: ScamAnalysis;
  isProvoked?: boolean;
  recentViolations?: number; // violations in last 7 days
  profile?: UserCharacterProfile; // NEW: User's character profile for modifier
}

export class SeverityCalculator {
  /**
   * MASTER FUNCTION: Calculate severity and determine action
   */
  calculateSeverity(input: SeverityInput): SeverityResult {
    // 🚨 CRITICAL RULE #1: SCAM = PERMA BAN (NO EXCEPTIONS!)
    if (input.scamAnalysis?.shouldBanPermanently) {
      return {
        action: 'ban',
        confidence: input.scamAnalysis.confidence,
        reason: `🚫 SCAM DETECTED: ${input.scamAnalysis.scamType} (${(input.scamAnalysis.confidence * 100).toFixed(0)}% confidence) - ${input.scamAnalysis.reasoning}`,
        severity: 10,
        modifiers: {
          trustScoreModifier: 0,
          historyModifier: 0,
          redemptionModifier: 0,
          contextModifier: 0,
          total: 0,
        },
      };
    }

    // Calculate base severity from message content
    const baseSeverity = this.calculateBaseSeverity(input.message, input.scamAnalysis);

    // Calculate modifiers
    const modifiers = this.calculateModifiers(input);

    // Apply modifiers to base severity
    const finalSeverity = Math.max(0, Math.min(10, baseSeverity + modifiers.total));

    // Determine action based on final severity
    const action = this.determineAction(finalSeverity, input);

    // Build comprehensive reason
    const reason = this.buildReason(input, baseSeverity, finalSeverity, modifiers);

    return {
      action: action.type,
      duration: action.duration,
      confidence: this.calculateConfidence(input),
      reason,
      severity: finalSeverity,
      modifiers,
    };
  }

  /**
   * Calculate base severity from message content (0-10 scale)
   */
  private calculateBaseSeverity(message: AnalyzedMessage, scamAnalysis?: ScamAnalysis): number {
    let severity = 0;

    // SCAM (high but not perma-ban level)
    if (scamAnalysis?.isScam && scamAnalysis.confidence >= 0.65 && scamAnalysis.confidence < 0.75) {
      severity = Math.max(severity, 7); // High severity, but allow trust score to modify
    }

    // TOXICITY
    if (message.toxicity >= 0.9) {
      severity = Math.max(severity, 9); // Extreme toxicity
    } else if (message.toxicity >= 0.8) {
      severity = Math.max(severity, 7); // Severe toxicity
    } else if (message.toxicity >= 0.6) {
      severity = Math.max(severity, 5); // Moderate toxicity
    } else if (message.toxicity >= 0.4) {
      severity = Math.max(severity, 3); // Mild toxicity
    }

    // MANIPULATION / PHISHING
    if (message.manipulation >= 0.8) {
      severity = Math.max(severity, 8); // Severe manipulation
    } else if (message.manipulation >= 0.6) {
      severity = Math.max(severity, 6); // Moderate manipulation
    }

    // SPAM - check if action or type contains spam indicators
    if (message.intent?.action?.toLowerCase().includes('spam') ||
        message.intent?.type === 'statement' && message.toxicity < 0.3 && message.content.length < 50) {
      severity = Math.max(severity, 4); // Spam is annoying but not critical
    }

    return severity;
  }

  /**
   * Calculate all modifiers based on user history and context
   */
  private calculateModifiers(input: SeverityInput): SeverityResult['modifiers'] {
    let trustScoreModifier = 0;
    let historyModifier = 0;
    let redemptionModifier = 0;
    let contextModifier = 0;
    let profileModifier = 0;

    // 🎯 TRUST SCORE MODIFIER (CRITICAL!)
    // Trust score heavily influences severity
    const trustScore = input.trustScore.score;

    if (trustScore <= 10) {
      // DANGEROUS users (0-10): +3 severity (much stricter)
      trustScoreModifier = +3;
    } else if (trustScore <= 30) {
      // RISKY users (11-30): +2 severity (stricter)
      trustScoreModifier = +2;
    } else if (trustScore <= 40) {
      // CAUTIOUS users (31-40): +1 severity (slightly stricter)
      trustScoreModifier = +1;
    } else if (trustScore >= 80) {
      // TRUSTED users (80-100): -1 severity (more lenient)
      trustScoreModifier = -1;
    } else if (trustScore >= 90) {
      // EXEMPLARY users (90-100): -2 severity (very lenient)
      trustScoreModifier = -2;
    }
    // NEUTRAL users (41-79): No modifier (0)

    // 📊 HISTORY MODIFIER
    // Recent violations increase severity
    if (input.recentViolations) {
      if (input.recentViolations >= 3) {
        historyModifier = +2; // Repeat offender
      } else if (input.recentViolations >= 1) {
        historyModifier = +1; // Recent violation
      }
    }

    // Check trust history for patterns
    const recentNegativeEvents = input.trustScore.history
      .slice(-10)
      .filter(e => e.delta < 0).length;

    if (recentNegativeEvents >= 5) {
      historyModifier += 1; // Pattern of bad behavior
    }

    // ✨ REDEMPTION MODIFIER
    // Users actively improving get leniency
    const recentPositiveEvents = input.trustScore.history
      .slice(-10)
      .filter(e => e.delta > 0 && e.reason.includes('Redemption')).length;

    if (recentPositiveEvents >= 3 && trustScore < 60) {
      redemptionModifier = -1; // Actively improving
    }

    // Check for long clean streak
    const daysSinceLastViolation = this.getDaysSinceLastViolation(input.trustScore);
    if (daysSinceLastViolation >= 30 && trustScore < 70) {
      redemptionModifier -= 1; // 30+ days clean = second chance
    }

    // 🎭 CONTEXT MODIFIER
    // Provocation reduces severity
    if (input.isProvoked) {
      contextModifier = -1; // User was provoked, be lenient
    }

    // 🧠 PROFILE MODIFIER (Character-based adjustment)
    // Use personality and risk indicators if profile available
    if (input.profile) {
      profileModifier = this.calculateProfileModifier(input.profile);
    }

    // Calculate total modifier
    const total = trustScoreModifier + historyModifier + redemptionModifier + contextModifier + profileModifier;

    return {
      trustScoreModifier,
      historyModifier,
      redemptionModifier,
      contextModifier,
      profileModifier,
      total,
    };
  }

  /**
   * Calculate profile-based modifier using personality and risk indicators
   */
  private calculateProfileModifier(profile: UserCharacterProfile): number {
    let modifier = 0;

    // 🚨 RISK INDICATORS (increase severity)
    // These directly indicate dangerous behavior patterns
    modifier += profile.riskIndicators.impulsivity * 2;       // +0-2 (quick reactions)
    modifier += profile.riskIndicators.deception * 3;         // +0-3 (lying patterns)
    modifier += profile.riskIndicators.manipulation * 2;      // +0-2 (manipulative)
    modifier += profile.riskIndicators.volatility * 1.5;      // +0-1.5 (unstable)
    modifier += profile.riskIndicators.predatoryBehavior * 4; // +0-4 (VERY dangerous)

    // ⚠️ NEGATIVE PERSONALITY TRAITS (increase severity)
    if (profile.personality.aggression > 0.7) {
      modifier += 1; // High aggression = stricter
    }
    if (profile.personality.stability < 0.3) {
      modifier += 0.5; // Low stability = slightly stricter
    }

    // ✨ POSITIVE PERSONALITY TRAITS (decrease severity)
    if (profile.personality.helpfulness > 0.7) {
      modifier -= 1; // Very helpful = more lenient
    }
    if (profile.personality.empathy > 0.7) {
      modifier -= 0.5; // High empathy = slightly more lenient
    }
    if (profile.personality.stability > 0.8) {
      modifier -= 0.5; // Very stable = slightly more lenient
    }

    // 🤝 SOCIAL BEHAVIOR (slight adjustments)
    if (profile.social.supportGivingRate > 0.5) {
      modifier -= 0.5; // Supportive users get leniency
    }
    if (profile.social.conflictInvolvementRate > 0.3) {
      modifier += 0.5; // Conflict-prone users get stricter treatment
    }

    // Cap modifier to reasonable range (-2 to +5)
    return Math.max(-2, Math.min(5, Math.round(modifier * 10) / 10));
  }

  /**
   * Determine action type and duration based on final severity
   */
  private determineAction(
    severity: number,
    input: SeverityInput
  ): { type: SeverityResult['action']; duration?: number } {
    const trustScore = input.trustScore.score;

    // 🚨 CRITICAL SEVERITY (9-10): BAN or LONG TIMEOUT
    if (severity >= 9) {
      // Only trusted users avoid ban
      if (trustScore >= 80) {
        return { type: 'timeout', duration: 10080 }; // 7 days timeout for trusted users
      }
      return { type: 'ban' }; // Everyone else gets banned
    }

    // ⚠️ SEVERE (7-8): TIMEOUT (duration varies by trust)
    if (severity >= 7) {
      if (trustScore >= 70) {
        return { type: 'timeout', duration: 1440 }; // 1 day for trusted
      } else if (trustScore >= 50) {
        return { type: 'timeout', duration: 4320 }; // 3 days for neutral
      } else {
        return { type: 'timeout', duration: 10080 }; // 7 days for low trust
      }
    }

    // 🟡 MODERATE (5-6): TIMEOUT (shorter) or KICK
    if (severity >= 5) {
      if (trustScore >= 60) {
        return { type: 'timeout', duration: 60 }; // 1 hour for decent trust
      } else if (trustScore >= 40) {
        return { type: 'timeout', duration: 360 }; // 6 hours for cautious
      } else {
        return { type: 'timeout', duration: 1440 }; // 1 day for low trust
      }
    }

    // 🟢 MILD (3-4): WARN or SHORT TIMEOUT
    if (severity >= 3) {
      if (trustScore >= 50) {
        return { type: 'warn' }; // Just warning for decent users
      } else {
        return { type: 'timeout', duration: 10 }; // 10 min timeout for low trust
      }
    }

    // 🟢 LOW (1-2): DELETE or WARN
    if (severity >= 1) {
      if (trustScore >= 40) {
        return { type: 'delete' }; // Just delete message
      } else {
        return { type: 'warn' }; // Warn low trust users even for minor issues
      }
    }

    // No action needed
    return { type: 'none' };
  }

  /**
   * Calculate confidence in the decision
   */
  private calculateConfidence(input: SeverityInput): number {
    let confidence = 0.5; // Base confidence

    // High trust score = higher confidence in leniency
    if (input.trustScore.score >= 80) {
      confidence += 0.2;
    }

    // Low trust score = higher confidence in strict action
    if (input.trustScore.score <= 30) {
      confidence += 0.3;
    }

    // Clear violation = higher confidence
    if (input.message.toxicity >= 0.8 || input.message.manipulation >= 0.7) {
      confidence += 0.2;
    }

    // Scam analysis confidence
    if (input.scamAnalysis?.isScam) {
      confidence = Math.max(confidence, input.scamAnalysis.confidence);
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Build comprehensive reason string
   */
  private buildReason(
    input: SeverityInput,
    baseSeverity: number,
    finalSeverity: number,
    modifiers: SeverityResult['modifiers']
  ): string {
    const parts: string[] = [];

    // Base violation
    if (input.scamAnalysis?.isScam) {
      parts.push(`🚨 Scam detected: ${input.scamAnalysis.scamType} (${(input.scamAnalysis.confidence * 100).toFixed(0)}% confidence)`);
    } else if (input.message.toxicity >= 0.6) {
      parts.push(`⚠️ Toxic content (${(input.message.toxicity * 100).toFixed(0)}% toxicity)`);
    } else if (input.message.manipulation >= 0.6) {
      parts.push(`⚠️ Manipulative behavior (${(input.message.manipulation * 100).toFixed(0)}% manipulation)`);
    }

    // Trust score impact
    const trustScore = input.trustScore.score;
    if (modifiers.trustScoreModifier > 0) {
      parts.push(`📉 Low trust score (${trustScore}/100) increased severity`);
    } else if (modifiers.trustScoreModifier < 0) {
      parts.push(`📈 High trust score (${trustScore}/100) reduced severity`);
    }

    // History impact
    if (modifiers.historyModifier > 0) {
      parts.push(`📊 Recent violations increased severity`);
    }

    // Redemption impact
    if (modifiers.redemptionModifier < 0) {
      parts.push(`✨ Actively improving behavior - leniency applied`);
    }

    // Context impact
    if (modifiers.contextModifier < 0) {
      parts.push(`🎭 Context considered (provoked/responding)`);
    }

    // Profile impact
    if (modifiers.profileModifier && modifiers.profileModifier !== 0) {
      if (modifiers.profileModifier > 0) {
        parts.push(`🧠 Character profile indicates higher risk (+${modifiers.profileModifier})`);
      } else {
        parts.push(`🧠 Character profile indicates trustworthy behavior (${modifiers.profileModifier})`);
      }
    }

    // Severity summary
    parts.push(`Severity: ${baseSeverity} → ${finalSeverity} (base + modifiers: ${modifiers.total >= 0 ? '+' : ''}${modifiers.total})`);

    return parts.join(' | ');
  }

  /**
   * Get days since last violation
   */
  private getDaysSinceLastViolation(trustScore: TrustScore): number {
    const lastNegativeEvent = trustScore.history
      .slice()
      .reverse()
      .find(e => e.delta < 0);

    if (!lastNegativeEvent) {
      return 999; // No violations found
    }

    const daysSince = (Date.now() - lastNegativeEvent.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    return Math.floor(daysSince);
  }

  /**
   * Check if user should get special consideration
   */
  isRedemptionCandidate(trustScore: TrustScore): boolean {
    // Low trust but actively improving
    if (trustScore.score < 50) {
      const recentPositive = trustScore.history
        .slice(-10)
        .filter(e => e.delta > 0).length;

      return recentPositive >= 5; // 5+ positive events in last 10
    }

    return false;
  }
}
