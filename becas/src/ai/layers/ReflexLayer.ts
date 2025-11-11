/**
 * REFLEX LAYER - Fast Threat Triage (System 1 Thinking)
 *
 * Ultra-fast threat classification (<50ms) without heavy AI processing.
 * Uses pattern matching, heuristics, and lightweight rules.
 *
 * Purpose:
 * - Filter out obviously safe messages instantly
 * - Catch obvious threats immediately (spam, known scam patterns)
 * - Bypass for trusted users (trust > 85)
 * - Reduce load on slower AI layers
 *
 * Classification:
 * - CLEAN: Safe message, no further processing needed
 * - SPAM: Repetitive/promotional content
 * - SCAM: Known scam patterns (crypto, phishing, etc.)
 * - TOXIC: Obvious toxicity (slurs, threats, etc.)
 * - SUSPICIOUS: Needs deeper analysis by Semantic Layer
 */

import { Message } from 'discord.js';
import { TrustScore } from '../../types/Trust.types';
import { createLogger } from '../../services/Logger';

const logger = createLogger('ReflexLayer');

export type ReflexClassification = 'CLEAN' | 'SPAM' | 'SCAM' | 'TOXIC' | 'SUSPICIOUS';

export interface ReflexResult {
  classification: ReflexClassification;
  confidence: number; // 0-1
  reason: string;
  patterns: string[]; // Matched patterns
  bypassReason?: string; // If bypassed due to trust
  processingTime: number; // Milliseconds
}

export class ReflexLayer {
  // Known scam patterns (ultra-fast regex matching)
  private scamPatterns = [
    /free\s+(nitro|discord|steam|robux)/i,
    /(click|visit|check)\s+https?:\/\/\S+/i,
    /dm\s+me\s+for\s+(free|cheap|buy)/i,
    /crypto\s+(giveaway|airdrop|investment)/i,
    /double\s+your\s+(money|crypto|btc|eth)/i,
    /@everyone.*?(free|win|claim|gift)/i,
    /limited\s+time\s+offer/i,
    /act\s+now|hurry\s+up|dont\s+miss/i,
  ];

  // Known toxic patterns
  private toxicPatterns = [
    /\b(kys|kill yourself|neck yourself)\b/i,
    /\b(n[i1]gg[e3]r|f[a4]gg[o0]t|r[e3]t[a4]rd)\b/i, // Slurs (censored)
    /\b(die|death threat|kill you)\b/i,
    /\b(hate you|wish you were dead)\b/i,
  ];

  // Spam indicators
  private spamPatterns = [
    /(.)\1{10,}/, // Character repeated 10+ times
    /^[A-Z\s!]+$/, // ALL CAPS MESSAGE
    /(https?:\/\/\S+.*){3,}/, // 3+ links in one message
  ];

  // Suspicious patterns (need deeper analysis)
  private suspiciousPatterns = [
    /password|login|account|verify/i,
    /paypal|venmo|cashapp|zelle/i,
    /credit\s+card|bank\s+account/i,
    /social\s+security|ssn|driver.*license/i,
    /(send|give)\s+me.*?(money|\$|€|£)/i,
  ];

  constructor() {
    logger.info('ReflexLayer initialized - fast threat triage ready');
  }

  /**
   * Analyze message with ultra-fast pattern matching
   */
  async analyze(
    message: Message,
    trustScore?: TrustScore
  ): Promise<ReflexResult> {
    const startTime = Date.now();
    const content = message.content.toLowerCase();
    const patterns: string[] = [];

    // ==========================================
    // BYPASS: Trusted Users
    // ==========================================
    if (trustScore && trustScore.score >= 85) {
      return {
        classification: 'CLEAN',
        confidence: 1.0,
        reason: 'Trusted user bypass',
        patterns: [],
        bypassReason: `Trust score ${trustScore.score} (exemplary)`,
        processingTime: Date.now() - startTime,
      };
    }

    // ==========================================
    // CHECK 1: SCAM PATTERNS
    // ==========================================
    for (const pattern of this.scamPatterns) {
      if (pattern.test(message.content)) {
        patterns.push(pattern.source);
      }
    }

    if (patterns.length > 0) {
      return {
        classification: 'SCAM',
        confidence: 0.8 + (patterns.length * 0.05), // More patterns = higher confidence
        reason: `Matched ${patterns.length} scam pattern(s)`,
        patterns,
        processingTime: Date.now() - startTime,
      };
    }

    // ==========================================
    // CHECK 2: TOXIC PATTERNS
    // ==========================================
    for (const pattern of this.toxicPatterns) {
      if (pattern.test(message.content)) {
        patterns.push(pattern.source);
      }
    }

    if (patterns.length > 0) {
      return {
        classification: 'TOXIC',
        confidence: 0.9, // High confidence for known slurs/threats
        reason: `Matched ${patterns.length} toxic pattern(s)`,
        patterns,
        processingTime: Date.now() - startTime,
      };
    }

    // ==========================================
    // CHECK 3: SPAM PATTERNS
    // ==========================================
    const spamMatches: string[] = [];
    for (const pattern of this.spamPatterns) {
      if (pattern.test(message.content)) {
        spamMatches.push(pattern.source);
      }
    }

    // Additional spam checks
    if (message.content.length > 1000) {
      spamMatches.push('message_too_long');
    }

    if (message.mentions.users.size > 5) {
      spamMatches.push('excessive_mentions');
    }

    if (spamMatches.length >= 2) {
      return {
        classification: 'SPAM',
        confidence: 0.7,
        reason: `Matched ${spamMatches.length} spam indicator(s)`,
        patterns: spamMatches,
        processingTime: Date.now() - startTime,
      };
    }

    // ==========================================
    // CHECK 4: SUSPICIOUS PATTERNS
    // ==========================================
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(message.content)) {
        patterns.push(pattern.source);
      }
    }

    if (patterns.length > 0) {
      return {
        classification: 'SUSPICIOUS',
        confidence: 0.5,
        reason: `Matched ${patterns.length} suspicious pattern(s) - needs deeper analysis`,
        patterns,
        processingTime: Date.now() - startTime,
      };
    }

    // ==========================================
    // DEFAULT: CLEAN
    // ==========================================
    return {
      classification: 'CLEAN',
      confidence: 0.6,
      reason: 'No threat patterns detected',
      patterns: [],
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * Quick check if message should skip all AI processing
   */
  shouldBypass(trustScore?: TrustScore): boolean {
    return trustScore !== undefined && trustScore.score >= 85;
  }

  /**
   * Check if message needs immediate action (scam/toxic)
   */
  needsImmediateAction(result: ReflexResult): boolean {
    return (
      (result.classification === 'SCAM' && result.confidence >= 0.8) ||
      (result.classification === 'TOXIC' && result.confidence >= 0.9)
    );
  }

  /**
   * Add custom scam pattern (for learning)
   */
  addScamPattern(pattern: RegExp): void {
    this.scamPatterns.push(pattern);
    logger.info(`Added custom scam pattern: ${pattern.source}`);
  }

  /**
   * Add custom toxic pattern
   */
  addToxicPattern(pattern: RegExp): void {
    this.toxicPatterns.push(pattern);
    logger.info(`Added custom toxic pattern: ${pattern.source}`);
  }

  /**
   * Get statistics
   */
  getStats(): {
    scamPatterns: number;
    toxicPatterns: number;
    spamPatterns: number;
    suspiciousPatterns: number;
  } {
    return {
      scamPatterns: this.scamPatterns.length,
      toxicPatterns: this.toxicPatterns.length,
      spamPatterns: this.spamPatterns.length,
      suspiciousPatterns: this.suspiciousPatterns.length,
    };
  }
}
