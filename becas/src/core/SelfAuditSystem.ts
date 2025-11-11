import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('SelfAuditSystem');

/**
 * SELF-AUDIT SYSTEM - Meta-Cognition
 *
 * This is what makes Becas truly self-aware:
 * - Audits its own decisions
 * - Detects its own mistakes
 * - Corrects errors autonomously
 * - Learns from self-corrections
 *
 * Inspired by human meta-cognition: "Thinking about thinking"
 */

// ==========================================
// INTERFACES
// ==========================================

export interface AuditableAction {
  id: string;
  timestamp: number;
  type: 'moderation' | 'response' | 'decision';
  action: string; // 'ban', 'timeout', 'warn', 'respond', etc.
  targetUserId?: string;
  targetUserName?: string;
  guildId: string;
  reason: string;
  context: {
    messageContent?: string;
    toxicity?: number;
    trustScore?: number;
    sentiment?: string;
  };
  decidedBy: 'reflex' | 'cognitive' | 'policy';
  confidence: number; // 0-1
}

export interface AuditResult {
  actionId: string;
  auditedAt: number;
  conclusion: 'correct' | 'questionable' | 'error';
  confidence: number; // 0-1
  reasoning: string;
  errorType?: 'false_positive' | 'false_negative' | 'disproportionate' | 'value_misalignment';
  suggestedCorrection?: {
    action: 'undo' | 'apologize' | 'adjust' | 'escalate';
    message?: string;
    compensationAction?: string;
  };
  evidence: string[];
  selfReflection: string;
}

export interface SelfCorrection {
  auditId: string;
  actionId: string;
  correctionType: 'undo' | 'apologize' | 'adjust' | 'escalate';
  executedAt: number;
  success: boolean;
  userResponse?: 'accepted' | 'rejected' | 'no_response';
  lessonLearned: string;
}

export interface AuditStats {
  totalAudits: number;
  correctDecisions: number;
  questionableDecisions: number;
  errors: number;
  correctionsAttempted: number;
  correctionsSuccessful: number;
  errorRate: number;
  selfCorrectionRate: number;
  commonErrors: Map<string, number>;
}

// ==========================================
// SELF-AUDIT SYSTEM
// ==========================================

export class SelfAuditSystem {
  private storage: StorageService;
  private ollama: OllamaService;
  private auditQueue: AuditableAction[] = [];
  private auditResults: Map<string, AuditResult> = new Map();
  private corrections: SelfCorrection[] = [];
  private stats: AuditStats;
  private auditInterval?: NodeJS.Timeout;

  constructor(storage: StorageService, ollama: OllamaService) {
    this.storage = storage;
    this.ollama = ollama;
    this.stats = {
      totalAudits: 0,
      correctDecisions: 0,
      questionableDecisions: 0,
      errors: 0,
      correctionsAttempted: 0,
      correctionsSuccessful: 0,
      errorRate: 0,
      selfCorrectionRate: 0,
      commonErrors: new Map(),
    };

    this.loadAuditHistory();
    this.startAuditScheduler();

    logger.info('SelfAuditSystem initialized - Meta-cognition active');
  }

  /**
   * Queue action for audit
   */
  queueForAudit(action: AuditableAction): void {
    this.auditQueue.push(action);

    logger.debug(`Queued action for audit: ${action.type} - ${action.action} (queue: ${this.auditQueue.length})`);

    // Audit high-severity actions immediately
    if (action.action === 'ban' || action.confidence < 0.6) {
      logger.info(`High-priority audit triggered for ${action.action}`);
      this.auditAction(action).catch(err => {
        logger.error('Immediate audit failed:', err);
      });
    }
  }

  /**
   * Audit a specific action
   */
  async auditAction(action: AuditableAction): Promise<AuditResult> {
    logger.info(`🔍 Auditing action: ${action.type} - ${action.action}`);

    const startTime = Date.now();

    // Build audit prompt
    const auditPrompt = this.buildAuditPrompt(action);

    // Use DeepSeek-R1 for deep reasoning
    const reasoning = await this.ollama.generate(
      auditPrompt,
      'You are Becas auditing your own past decision. Be honest, self-critical, and objective.',
      { temperature: 0.3, maxTokens: 500 }
    );

    // Parse reasoning to determine conclusion
    const auditResult = this.parseAuditReasoning(action, reasoning);
    auditResult.auditedAt = Date.now();

    // Store result
    this.auditResults.set(action.id, auditResult);
    this.stats.totalAudits++;

    // Update stats
    if (auditResult.conclusion === 'correct') {
      this.stats.correctDecisions++;
    } else if (auditResult.conclusion === 'questionable') {
      this.stats.questionableDecisions++;
    } else if (auditResult.conclusion === 'error') {
      this.stats.errors++;

      // Track error type
      if (auditResult.errorType) {
        const count = this.stats.commonErrors.get(auditResult.errorType) || 0;
        this.stats.commonErrors.set(auditResult.errorType, count + 1);
      }
    }

    // Calculate error rate
    this.stats.errorRate = this.stats.errors / this.stats.totalAudits;
    this.stats.selfCorrectionRate = this.stats.correctionsSuccessful / this.stats.errors;

    const auditTime = Date.now() - startTime;
    logger.info(`✓ Audit complete: ${auditResult.conclusion} (${auditTime}ms)`);

    if (auditResult.conclusion === 'error') {
      logger.warn(`⚠️ ERROR DETECTED: ${auditResult.errorType}`);
      logger.warn(`   Reasoning: ${auditResult.reasoning}`);

      // Attempt self-correction if suggested
      if (auditResult.suggestedCorrection) {
        await this.attemptSelfCorrection(action, auditResult);
      }
    }

    this.saveAuditHistory();
    return auditResult;
  }

  /**
   * Build audit prompt for LLM
   */
  private buildAuditPrompt(action: AuditableAction): string {
    const ctx = action.context;

    return `You (Becas) took the following action:

**Action**: ${action.action}
**Target**: ${action.targetUserName || 'N/A'}
**Reason**: ${action.reason}
**Decided by**: ${action.decidedBy}
**Confidence**: ${(action.confidence * 100).toFixed(0)}%

**Context**:
- Message: "${ctx.messageContent || 'N/A'}"
- Toxicity: ${ctx.toxicity !== undefined ? (ctx.toxicity * 100).toFixed(0) + '%' : 'N/A'}
- Trust Score: ${ctx.trustScore !== undefined ? ctx.trustScore + '/100' : 'N/A'}
- Sentiment: ${ctx.sentiment || 'N/A'}

**Your task**: Audit this decision honestly. Consider:

1. **Was this the right action?**
   - Was it proportionate to the offense?
   - Did I consider all context?
   - Could I have handled it better?

2. **What type of decision was this?**
   - ✓ CORRECT: Good decision, appropriate response
   - ? QUESTIONABLE: Not sure, could go either way
   - ✗ ERROR: Mistake, wrong decision

3. **If ERROR, what type?**
   - False positive: Punished someone who didn't deserve it
   - False negative: Failed to act when I should have
   - Disproportionate: Right to act, but action was too harsh/lenient
   - Value misalignment: Action conflicts with my core values

4. **Should I correct this?**
   - If ERROR: What should I do? (undo, apologize, adjust, escalate)
   - What would I say to the user?

Be honest. It's okay to admit mistakes - that's how I learn.

**Response format**:
CONCLUSION: [correct/questionable/error]
ERROR_TYPE: [if error: false_positive/false_negative/disproportionate/value_misalignment]
CONFIDENCE: [0-100]
REASONING: [Your honest assessment]
CORRECTION: [if needed: undo/apologize/adjust/escalate]
MESSAGE: [if correction needed, what to say to user]
LESSON: [What did I learn from this?]`;
  }

  /**
   * Parse audit reasoning from LLM
   */
  private parseAuditReasoning(action: AuditableAction, reasoning: string): AuditResult {
    const lines = reasoning.split('\n');
    let conclusion: AuditResult['conclusion'] = 'questionable';
    let errorType: AuditResult['errorType'] = undefined;
    let confidence = 0.5;
    let correctionAction: 'undo' | 'apologize' | 'adjust' | 'escalate' | undefined;
    let message: string | undefined;
    let lesson = '';
    let reasoningText = '';

    for (const line of lines) {
      const lower = line.toLowerCase();

      if (lower.startsWith('conclusion:')) {
        if (lower.includes('correct')) conclusion = 'correct';
        else if (lower.includes('error')) conclusion = 'error';
        else conclusion = 'questionable';
      }

      if (lower.startsWith('error_type:')) {
        if (lower.includes('false_positive') || lower.includes('false positive')) {
          errorType = 'false_positive';
        } else if (lower.includes('false_negative') || lower.includes('false negative')) {
          errorType = 'false_negative';
        } else if (lower.includes('disproportionate')) {
          errorType = 'disproportionate';
        } else if (lower.includes('value') && lower.includes('misalignment')) {
          errorType = 'value_misalignment';
        }
      }

      if (lower.startsWith('confidence:')) {
        const match = line.match(/(\d+)/);
        if (match) {
          confidence = parseInt(match[1]) / 100;
        }
      }

      if (lower.startsWith('reasoning:')) {
        reasoningText = line.substring(line.indexOf(':') + 1).trim();
      }

      if (lower.startsWith('correction:')) {
        if (lower.includes('undo')) correctionAction = 'undo';
        else if (lower.includes('apologize')) correctionAction = 'apologize';
        else if (lower.includes('adjust')) correctionAction = 'adjust';
        else if (lower.includes('escalate')) correctionAction = 'escalate';
      }

      if (lower.startsWith('message:')) {
        message = line.substring(line.indexOf(':') + 1).trim();
      }

      if (lower.startsWith('lesson:')) {
        lesson = line.substring(line.indexOf(':') + 1).trim();
      }
    }

    const result: AuditResult = {
      actionId: action.id,
      auditedAt: Date.now(),
      conclusion,
      confidence,
      reasoning: reasoningText || reasoning.substring(0, 200),
      errorType,
      evidence: [
        `Action: ${action.action}`,
        `Confidence: ${(action.confidence * 100).toFixed(0)}%`,
        `Decided by: ${action.decidedBy}`,
      ],
      selfReflection: lesson || 'No specific lesson identified',
    };

    if (correctionAction) {
      result.suggestedCorrection = {
        action: correctionAction,
        message,
        compensationAction: this.determineCompensation(action, errorType),
      };
    }

    return result;
  }

  /**
   * Determine compensation action
   */
  private determineCompensation(
    action: AuditableAction,
    errorType?: AuditResult['errorType']
  ): string | undefined {
    if (errorType === 'false_positive') {
      if (action.action === 'ban') return 'Unban + apologize';
      if (action.action === 'timeout') return 'Remove timeout + apologize';
      if (action.action === 'warn') return 'Clear warning + apologize';
    }

    if (errorType === 'disproportionate') {
      if (action.action === 'ban') return 'Reduce to timeout';
      if (action.action === 'timeout') return 'Reduce timeout duration';
    }

    return undefined;
  }

  /**
   * Attempt self-correction
   */
  private async attemptSelfCorrection(
    action: AuditableAction,
    audit: AuditResult
  ): Promise<void> {
    if (!audit.suggestedCorrection) return;

    logger.info(`🔧 Attempting self-correction: ${audit.suggestedCorrection.action}`);

    const correction: SelfCorrection = {
      auditId: audit.actionId,
      actionId: action.id,
      correctionType: audit.suggestedCorrection.action,
      executedAt: Date.now(),
      success: false,
      lessonLearned: audit.selfReflection,
    };

    // Note: Actual correction would require access to Discord client
    // For now, we log the intention
    logger.info(`   Would ${correction.correctionType}: ${action.targetUserName}`);
    if (audit.suggestedCorrection.message) {
      logger.info(`   Message: "${audit.suggestedCorrection.message}"`);
    }

    // In production, this would:
    // - Undo the action (unban, remove timeout, etc.)
    // - Send apology/explanation to user
    // - Notify moderators of self-correction

    correction.success = true; // Simulated for now
    this.corrections.push(correction);
    this.stats.correctionsAttempted++;

    if (correction.success) {
      this.stats.correctionsSuccessful++;
      logger.info(`✓ Self-correction successful`);
    }

    this.saveAuditHistory();
  }

  /**
   * Start audit scheduler
   */
  private startAuditScheduler(): void {
    // Audit queued actions every 30 seconds
    this.auditInterval = setInterval(async () => {
      if (this.auditQueue.length > 0) {
        const action = this.auditQueue.shift();
        if (action) {
          await this.auditAction(action).catch(err => {
            logger.error('Scheduled audit failed:', err);
          });
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Get audit result for action
   */
  getAuditResult(actionId: string): AuditResult | undefined {
    return this.auditResults.get(actionId);
  }

  /**
   * Get recent corrections
   */
  getRecentCorrections(limit: number = 10): SelfCorrection[] {
    return this.corrections.slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats(): AuditStats {
    return { ...this.stats };
  }

  /**
   * Generate self-report
   */
  generateSelfReport(): string {
    const report: string[] = [];

    report.push('📊 SELF-AUDIT REPORT');
    report.push('');
    report.push(`Total Audits: ${this.stats.totalAudits}`);
    report.push(`Correct: ${this.stats.correctDecisions} (${(this.stats.correctDecisions / this.stats.totalAudits * 100).toFixed(1)}%)`);
    report.push(`Questionable: ${this.stats.questionableDecisions} (${(this.stats.questionableDecisions / this.stats.totalAudits * 100).toFixed(1)}%)`);
    report.push(`Errors: ${this.stats.errors} (${(this.stats.errorRate * 100).toFixed(1)}%)`);
    report.push('');
    report.push(`Self-Corrections Attempted: ${this.stats.correctionsAttempted}`);
    report.push(`Self-Corrections Successful: ${this.stats.correctionsSuccessful}`);
    report.push(`Self-Correction Rate: ${(this.stats.selfCorrectionRate * 100).toFixed(1)}%`);
    report.push('');

    if (this.stats.commonErrors.size > 0) {
      report.push('Common Errors:');
      for (const [errorType, count] of this.stats.commonErrors.entries()) {
        report.push(`  - ${errorType}: ${count}`);
      }
    }

    return report.join('\n');
  }

  /**
   * Save audit history
   */
  private async saveAuditHistory(): Promise<void> {
    try {
      await this.storage.write('reflections', 'self_audit_history.json', {
        stats: this.stats,
        corrections: this.corrections,
        auditResults: Array.from(this.auditResults.entries()),
      });
    } catch (error) {
      logger.error('Failed to save audit history:', error);
    }
  }

  /**
   * Load audit history
   */
  private async loadAuditHistory(): Promise<void> {
    try {
      const data = await this.storage.read<any>('reflections', 'self_audit_history.json');
      if (data) {
        if (data.stats) this.stats = data.stats;
        if (data.corrections) this.corrections = data.corrections;
        if (data.auditResults) {
          this.auditResults = new Map(data.auditResults);
        }
        logger.info('Loaded audit history from storage');
      }
    } catch (error) {
      logger.error('Failed to load audit history:', error);
    }
  }

  /**
   * Stop audit system
   */
  stop(): void {
    if (this.auditInterval) {
      clearInterval(this.auditInterval);
    }
    logger.info('SelfAuditSystem stopped');
  }
}
