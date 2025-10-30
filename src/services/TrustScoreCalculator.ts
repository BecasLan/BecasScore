/**
 * TRUST SCORE CALCULATOR - Dynamic Trust Scoring with Profile Integration
 *
 * Calculates trust scores based on:
 * - Violation history (warnings, timeouts, kicks, bans)
 * - Clean streak (days without violations)
 * - Rehabilitation progress (improving behavior)
 * - Helpful actions (positive contributions)
 * - Character profile (personality & risk indicators)
 * - Positive interactions
 *
 * Trust Score Range: 0-100
 * - 85-100: Exemplary (highly trusted)
 * - 65-84: Trusted
 * - 35-64: Neutral
 * - 15-34: Risky (watch closely)
 * - 0-14: Dangerous (high risk)
 */

import { UserCharacterProfile } from './ProfileBuilder';
import { createLogger } from './Logger';

const logger = createLogger('TrustScoreCalculator');

export interface TrustScoreFactors {
  baseScore: number;
  violationPenalty: number;
  cleanStreakBonus: number;
  rehabilitationBonus: number;
  helpfulnessBonus: number;
  personalityModifier: number;
  riskPenalty: number;
  finalScore: number;
}

export class TrustScoreCalculator {
  private readonly DEFAULT_SCORE = 50;
  private readonly MAX_SCORE = 100;
  private readonly MIN_SCORE = 0;

  /**
   * Calculate trust score with profile integration
   */
  calculateTrustScore(
    violations: {
      warnings: number;
      timeouts: number;
      kicks: number;
      bans: number;
    },
    cleanStreak: number, // Days without violation
    helpfulActions: number,
    profile?: UserCharacterProfile
  ): TrustScoreFactors {
    // Start with default score
    let score = this.DEFAULT_SCORE;
    const factors: Partial<TrustScoreFactors> = {
      baseScore: this.DEFAULT_SCORE
    };

    // 1. Violation penalties
    const violationPenalty = this.calculateViolationPenalty(violations);
    score -= violationPenalty;
    factors.violationPenalty = violationPenalty;

    // 2. Clean streak bonus
    const cleanStreakBonus = this.calculateCleanStreakBonus(cleanStreak);
    score += cleanStreakBonus;
    factors.cleanStreakBonus = cleanStreakBonus;

    // 3. Rehabilitation bonus (if improving)
    const rehabilitationBonus = this.calculateRehabilitationBonus(violations, cleanStreak);
    score += rehabilitationBonus;
    factors.rehabilitationBonus = rehabilitationBonus;

    // 4. Helpfulness bonus
    const helpfulnessBonus = Math.min(15, helpfulActions * 0.5);
    score += helpfulnessBonus;
    factors.helpfulnessBonus = helpfulnessBonus;

    // 5. Personality modifier (if profile available)
    let personalityModifier = 0;
    if (profile) {
      personalityModifier = this.calculatePersonalityModifier(profile);
      score += personalityModifier;
    }
    factors.personalityModifier = personalityModifier;

    // 6. Risk penalty (if profile available)
    let riskPenalty = 0;
    if (profile) {
      riskPenalty = this.calculateRiskPenalty(profile);
      score -= riskPenalty;
    }
    factors.riskPenalty = riskPenalty;

    // Clamp to valid range
    score = Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, score));
    factors.finalScore = Math.round(score);

    return factors as TrustScoreFactors;
  }

  /**
   * Calculate violation penalty
   */
  private calculateViolationPenalty(violations: {
    warnings: number;
    timeouts: number;
    kicks: number;
    bans: number;
  }): number {
    let penalty = 0;

    // Violations have different weights
    penalty += violations.warnings * 2;   // -2 per warning
    penalty += violations.timeouts * 5;   // -5 per timeout
    penalty += violations.kicks * 10;     // -10 per kick
    penalty += violations.bans * 50;      // -50 per ban

    // Cap maximum penalty at 50
    return Math.min(50, penalty);
  }

  /**
   * Calculate clean streak bonus
   */
  private calculateCleanStreakBonus(cleanStreakDays: number): number {
    if (cleanStreakDays === 0) return 0;

    // Bonus increases with streak
    // 7 days = +5
    // 30 days = +15
    // 90 days = +25
    // 180+ days = +30 (max)

    if (cleanStreakDays >= 180) return 30;
    if (cleanStreakDays >= 90) return 25;
    if (cleanStreakDays >= 30) return 15;
    if (cleanStreakDays >= 7) return 5;

    return Math.floor(cleanStreakDays / 2); // +0.5 per day for first week
  }

  /**
   * Calculate rehabilitation bonus (if user is improving)
   */
  private calculateRehabilitationBonus(
    violations: any,
    cleanStreak: number
  ): number {
    // If user had violations but now has 30+ day clean streak
    const totalViolations = violations.warnings + violations.timeouts + violations.kicks + violations.bans;

    if (totalViolations > 0 && cleanStreak >= 30) {
      return 10; // Rehabilitation bonus
    }

    if (totalViolations > 0 && cleanStreak >= 14) {
      return 5; // Small rehabilitation bonus
    }

    return 0;
  }

  /**
   * Calculate personality modifier from profile
   */
  private calculatePersonalityModifier(profile: UserCharacterProfile): number {
    let modifier = 0;

    // Positive traits increase trust
    modifier += profile.personality.helpfulness * 5;        // +0-5
    modifier += profile.personality.empathy * 3;            // +0-3
    modifier += profile.personality.stability * 3;          // +0-3
    modifier += profile.social.supportGivingRate * 4;       // +0-4

    // Negative traits decrease trust
    modifier -= profile.personality.aggression * 5;         // -0-5
    modifier -= (1 - profile.personality.formality) * 2;    // -0-2 (informality)

    return Math.round(modifier);
  }

  /**
   * Calculate risk penalty from profile
   */
  private calculateRiskPenalty(profile: UserCharacterProfile): number {
    let penalty = 0;

    // Risk indicators directly reduce trust
    penalty += profile.riskIndicators.impulsivity * 5;       // -0-5
    penalty += profile.riskIndicators.deception * 10;        // -0-10
    penalty += profile.riskIndicators.manipulation * 8;      // -0-8
    penalty += profile.riskIndicators.volatility * 4;        // -0-4
    penalty += profile.riskIndicators.predatoryBehavior * 15;// -0-15

    return Math.round(penalty);
  }

  /**
   * Get trust level category
   */
  getTrustLevel(score: number): 'exemplary' | 'trusted' | 'neutral' | 'cautious' | 'dangerous' {
    if (score >= 85) return 'exemplary';
    if (score >= 65) return 'trusted';
    if (score >= 35) return 'neutral';
    if (score >= 15) return 'cautious';
    return 'dangerous';
  }

  /**
   * Get trust level color for UI
   */
  getTrustLevelColor(score: number): string {
    if (score >= 85) return '#2ecc71'; // Green
    if (score >= 65) return '#3498db'; // Blue
    if (score >= 35) return '#95a5a6'; // Gray
    if (score >= 15) return '#f39c12'; // Orange
    return '#e74c3c'; // Red
  }

  /**
   * Explain trust score (for transparency)
   */
  explainScore(factors: TrustScoreFactors): string {
    const parts: string[] = [];

    parts.push(`Base score: ${factors.baseScore}`);

    if (factors.violationPenalty > 0) {
      parts.push(`Violations: -${factors.violationPenalty}`);
    }

    if (factors.cleanStreakBonus > 0) {
      parts.push(`Clean streak: +${factors.cleanStreakBonus}`);
    }

    if (factors.rehabilitationBonus > 0) {
      parts.push(`Rehabilitation: +${factors.rehabilitationBonus}`);
    }

    if (factors.helpfulnessBonus > 0) {
      parts.push(`Helpful actions: +${factors.helpfulnessBonus}`);
    }

    if (factors.personalityModifier !== 0) {
      const sign = factors.personalityModifier > 0 ? '+' : '';
      parts.push(`Personality: ${sign}${factors.personalityModifier}`);
    }

    if (factors.riskPenalty > 0) {
      parts.push(`Risk indicators: -${factors.riskPenalty}`);
    }

    parts.push(`Final: ${factors.finalScore}`);

    return parts.join(' | ');
  }

  /**
   * Calculate score change after an event
   */
  calculateScoreChange(
    currentScore: number,
    event: {
      type: 'violation' | 'helpful' | 'positive_interaction' | 'negative_interaction';
      severity?: 'minor' | 'moderate' | 'severe';
    }
  ): number {
    let delta = 0;

    switch (event.type) {
      case 'violation':
        switch (event.severity) {
          case 'minor':
            delta = -2;
            break;
          case 'moderate':
            delta = -5;
            break;
          case 'severe':
            delta = -10;
            break;
          default:
            delta = -3;
        }
        break;

      case 'helpful':
        delta = +2;
        break;

      case 'positive_interaction':
        delta = +1;
        break;

      case 'negative_interaction':
        delta = -1;
        break;
    }

    // Apply diminishing returns (harder to gain trust at high scores, easier to lose it)
    if (delta > 0 && currentScore > 80) {
      delta = delta * 0.5; // Half gains above 80
    }

    if (delta < 0 && currentScore < 20) {
      delta = delta * 0.5; // Half losses below 20
    }

    return Math.round(delta);
  }
}
