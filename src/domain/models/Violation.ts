/**
 * DOMAIN MODEL: Violation
 *
 * Represents a content moderation violation in the Becas system.
 * Immutable, self-validating, rich domain model.
 *
 * Design Principles:
 * - Value Object pattern (identity = properties)
 * - Domain-driven severity calculation
 * - Type-safe enums for violation types
 */

export enum ViolationType {
  PROFANITY = 'profanity',
  HATE_SPEECH = 'hate_speech',
  HARASSMENT = 'harassment',
  SPAM = 'spam',
  SCAM = 'scam',
  EXPLICIT_CONTENT = 'explicit_content',
  DOXXING = 'doxxing',
  RAIDING = 'raiding',
  IMPERSONATION = 'impersonation',
}

export enum ViolationSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum ModerationAction {
  NONE = 'none',
  WARNING = 'warning',
  TIMEOUT = 'timeout',
  KICK = 'kick',
  BAN = 'ban',
  CROSS_BAN = 'cross_ban', // Ban across all Becas-powered servers
}

export interface ViolationEvidence {
  quotedText: string;
  matchedPattern?: string;
  contextBefore?: string;
  contextAfter?: string;
}

export class Violation {
  readonly type: ViolationType;
  readonly confidence: number; // 0.0-1.0
  readonly severity: ViolationSeverity;
  readonly evidence: ViolationEvidence;
  readonly reasoning: string;
  readonly detectedAt: Date;

  // Derived properties (calculated from severity + type)
  readonly trustPenalty: number;
  readonly recommendedAction: ModerationAction;
  readonly timeoutDuration?: number; // seconds, if action = TIMEOUT

  constructor(
    type: ViolationType,
    confidence: number,
    severity: ViolationSeverity,
    evidence: ViolationEvidence,
    reasoning: string,
    detectedAt: Date = new Date()
  ) {
    this.type = type;
    this.confidence = confidence;
    this.severity = severity;
    this.evidence = evidence;
    this.reasoning = reasoning;
    this.detectedAt = detectedAt;

    // Validate
    this.validate();

    // Calculate derived properties (domain logic)
    this.trustPenalty = this.calculateTrustPenalty();
    this.recommendedAction = this.determineAction();
    this.timeoutDuration = this.calculateTimeoutDuration();
  }

  /**
   * Domain validation
   */
  private validate(): void {
    if (this.confidence < 0.0 || this.confidence > 1.0) {
      throw new Error(`Invalid confidence: ${this.confidence}. Must be 0.0-1.0`);
    }

    if (this.confidence < 0.7) {
      throw new Error(`Confidence too low: ${this.confidence}. Minimum is 0.7 for valid violations`);
    }

    if (!this.evidence.quotedText || this.evidence.quotedText.length === 0) {
      throw new Error('Violation evidence cannot be empty');
    }

    if (!this.reasoning || this.reasoning.length === 0) {
      throw new Error('Violation reasoning cannot be empty');
    }
  }

  /**
   * Domain Logic: Calculate trust score penalty based on type and severity
   */
  private calculateTrustPenalty(): number {
    const basePenalties: Record<ViolationType, Record<ViolationSeverity, number>> = {
      [ViolationType.PROFANITY]: {
        [ViolationSeverity.LOW]: 5,
        [ViolationSeverity.MEDIUM]: 10,
        [ViolationSeverity.HIGH]: 20,
        [ViolationSeverity.CRITICAL]: 30,
      },
      [ViolationType.HATE_SPEECH]: {
        [ViolationSeverity.LOW]: 15,
        [ViolationSeverity.MEDIUM]: 30,
        [ViolationSeverity.HIGH]: 50,
        [ViolationSeverity.CRITICAL]: 80,
      },
      [ViolationType.HARASSMENT]: {
        [ViolationSeverity.LOW]: 10,
        [ViolationSeverity.MEDIUM]: 25,
        [ViolationSeverity.HIGH]: 40,
        [ViolationSeverity.CRITICAL]: 60,
      },
      [ViolationType.SPAM]: {
        [ViolationSeverity.LOW]: 3,
        [ViolationSeverity.MEDIUM]: 7,
        [ViolationSeverity.HIGH]: 15,
        [ViolationSeverity.CRITICAL]: 25,
      },
      [ViolationType.SCAM]: {
        [ViolationSeverity.LOW]: 20,
        [ViolationSeverity.MEDIUM]: 40,
        [ViolationSeverity.HIGH]: 60,
        [ViolationSeverity.CRITICAL]: 90,
      },
      [ViolationType.EXPLICIT_CONTENT]: {
        [ViolationSeverity.LOW]: 15,
        [ViolationSeverity.MEDIUM]: 30,
        [ViolationSeverity.HIGH]: 50,
        [ViolationSeverity.CRITICAL]: 70,
      },
      [ViolationType.DOXXING]: {
        [ViolationSeverity.LOW]: 40,
        [ViolationSeverity.MEDIUM]: 60,
        [ViolationSeverity.HIGH]: 80,
        [ViolationSeverity.CRITICAL]: 100,
      },
      [ViolationType.RAIDING]: {
        [ViolationSeverity.LOW]: 30,
        [ViolationSeverity.MEDIUM]: 50,
        [ViolationSeverity.HIGH]: 70,
        [ViolationSeverity.CRITICAL]: 90,
      },
      [ViolationType.IMPERSONATION]: {
        [ViolationSeverity.LOW]: 10,
        [ViolationSeverity.MEDIUM]: 20,
        [ViolationSeverity.HIGH]: 35,
        [ViolationSeverity.CRITICAL]: 50,
      },
    };

    return basePenalties[this.type][this.severity];
  }

  /**
   * Domain Logic: Determine moderation action based on severity
   */
  private determineAction(): ModerationAction {
    switch (this.severity) {
      case ViolationSeverity.CRITICAL:
        // Critical violations = immediate ban
        return this.type === ViolationType.SCAM || this.type === ViolationType.DOXXING
          ? ModerationAction.CROSS_BAN
          : ModerationAction.BAN;

      case ViolationSeverity.HIGH:
        // High severity = timeout (1 hour)
        return ModerationAction.TIMEOUT;

      case ViolationSeverity.MEDIUM:
        // Medium severity = short timeout (10 minutes)
        return ModerationAction.TIMEOUT;

      case ViolationSeverity.LOW:
        // Low severity = warning only
        return ModerationAction.WARNING;

      default:
        return ModerationAction.NONE;
    }
  }

  /**
   * Domain Logic: Calculate timeout duration (if applicable)
   */
  private calculateTimeoutDuration(): number | undefined {
    if (this.recommendedAction !== ModerationAction.TIMEOUT) {
      return undefined;
    }

    switch (this.severity) {
      case ViolationSeverity.HIGH:
        return 3600; // 1 hour
      case ViolationSeverity.MEDIUM:
        return 600; // 10 minutes
      case ViolationSeverity.LOW:
        return 300; // 5 minutes
      default:
        return undefined;
    }
  }

  /**
   * Business Logic: Check if violation requires immediate action
   */
  isActionable(): boolean {
    return this.recommendedAction !== ModerationAction.NONE;
  }

  /**
   * Business Logic: Check if violation is severe enough to block message
   */
  shouldBlockMessage(): boolean {
    return (
      this.severity === ViolationSeverity.CRITICAL ||
      (this.severity === ViolationSeverity.HIGH && this.confidence >= 0.9)
    );
  }

  /**
   * Business Logic: Get human-readable description
   */
  getDescription(): string {
    const severityEmoji = {
      [ViolationSeverity.LOW]: '⚠️',
      [ViolationSeverity.MEDIUM]: '🚨',
      [ViolationSeverity.HIGH]: '🔴',
      [ViolationSeverity.CRITICAL]: '☠️',
    };

    const typeLabels = {
      [ViolationType.PROFANITY]: 'Profanity',
      [ViolationType.HATE_SPEECH]: 'Hate Speech',
      [ViolationType.HARASSMENT]: 'Harassment',
      [ViolationType.SPAM]: 'Spam',
      [ViolationType.SCAM]: 'Scam/Phishing',
      [ViolationType.EXPLICIT_CONTENT]: 'Explicit Content',
      [ViolationType.DOXXING]: 'Doxxing',
      [ViolationType.RAIDING]: 'Raiding',
      [ViolationType.IMPERSONATION]: 'Impersonation',
    };

    return `${severityEmoji[this.severity]} ${typeLabels[this.type]} (${(this.confidence * 100).toFixed(0)}% confidence)`;
  }

  /**
   * Convert to JSON (for API responses, logging)
   */
  toJSON(): object {
    return {
      type: this.type,
      confidence: this.confidence,
      severity: this.severity,
      evidence: this.evidence,
      reasoning: this.reasoning,
      detectedAt: this.detectedAt.toISOString(),
      trustPenalty: this.trustPenalty,
      recommendedAction: this.recommendedAction,
      timeoutDuration: this.timeoutDuration,
    };
  }

  /**
   * Factory: Create from AI detection result
   */
  static fromAIResult(aiResult: {
    type: string;
    confidence: number;
    severity: string;
    evidence: string;
    reasoning: string;
  }): Violation {
    // Validate and convert type
    const type = Object.values(ViolationType).find(t => t === aiResult.type);
    if (!type) {
      throw new Error(`Invalid violation type: ${aiResult.type}`);
    }

    // Validate and convert severity
    const severity = Object.values(ViolationSeverity).find(s => s === aiResult.severity);
    if (!severity) {
      throw new Error(`Invalid severity: ${aiResult.severity}`);
    }

    return new Violation(
      type,
      aiResult.confidence,
      severity,
      { quotedText: aiResult.evidence },
      aiResult.reasoning
    );
  }

  /**
   * Factory: Batch create from AI results (with filtering)
   */
  static fromAIResults(aiResults: any[]): Violation[] {
    const violations: Violation[] = [];

    for (const result of aiResults) {
      try {
        // Only create violations with sufficient confidence
        if (result.confidence >= 0.7) {
          violations.push(Violation.fromAIResult(result));
        }
      } catch (error) {
        // Skip invalid results
        console.warn(`Skipping invalid AI result: ${error}`);
      }
    }

    return violations;
  }
}
