import { createLogger } from '../services/Logger';
import { StorageService } from '../services/StorageService';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('PolicyEngineV2');

/**
 * POLICY ENGINE V2 - WHAT Becas Enforces
 *
 * Separates ENFORCEMENT from IDENTITY:
 * - PersonaCore: WHO Becas is (personality, values, emotions)
 * - PolicyEngine: WHAT Becas enforces (rules, moderation)
 *
 * This allows:
 * - Consistent enforcement regardless of mood
 * - Clear separation between feelings and rules
 * - Objective decision-making
 */

// ==========================================
// INTERFACES
// ==========================================

export interface Policy {
  id: string;
  name: string;
  description: string;
  severity: number; // 1-10
  category: 'safety' | 'conduct' | 'content' | 'spam' | 'custom';
  conditions: {
    toxicity?: { min: number; max: number };
    manipulation?: { min: number; max: number };
    trustScore?: { min: number; max: number };
    repeatOffenses?: number;
    keywords?: string[];
    patterns?: RegExp[];
  };
  enforcement: {
    action: 'warn' | 'timeout' | 'kick' | 'ban' | 'delete' | 'alert';
    duration?: number; // For timeout (ms)
    escalation?: {
      afterOffenses: number;
      newAction: 'timeout' | 'kick' | 'ban';
      newDuration?: number;
    };
  };
  active: boolean;
  createdAt: number;
  createdBy: string; // 'system' or userId
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  severity: number;
  confidence: number; // 0-1 - how confident we are this violated the policy
  evidence: string[];
  recommendedAction: {
    type: 'warn' | 'timeout' | 'kick' | 'ban' | 'delete' | 'alert';
    duration?: number;
    reason: string;
  };
}

export interface EnforcementDecision {
  shouldEnforce: boolean;
  violations: PolicyViolation[];
  primaryAction?: {
    type: 'warn' | 'timeout' | 'kick' | 'ban' | 'delete' | 'alert';
    duration?: number;
    reason: string;
    policyId: string;
  };
  secondaryActions: {
    type: string;
    reason: string;
  }[];
  transparency: {
    explanation: string;
    policiesChecked: number;
    violationsFound: number;
  };
}

// ==========================================
// POLICY ENGINE V2
// ==========================================

export class PolicyEngineV2 {
  private policies: Map<string, Policy> = new Map();
  private storage: StorageService;
  private violationHistory: Map<string, PolicyViolation[]> = new Map(); // userId -> violations
  private llm: OllamaService;

  constructor(storage: StorageService) {
    this.storage = storage;
    this.llm = new OllamaService('governance'); // AI-driven policy evaluation
    this.initializeDefaultPolicies();
    logger.info('PolicyEngineV2 initialized with default policies');
  }

  /**
   * Initialize async components (call after construction)
   */
  async initialize(): Promise<void> {
    await this.loadPolicies();
    logger.info(`PolicyEngineV2 loaded ${this.policies.size} policies from storage`);
  }

  /**
   * Initialize default safety policies
   */
  private initializeDefaultPolicies(): void {
    const defaultPolicies: Omit<Policy, 'id' | 'createdAt'>[] = [
      {
        name: 'Extreme Toxicity',
        description: 'Hate speech, extreme profanity, or severe harassment',
        severity: 10,
        category: 'safety',
        conditions: {
          toxicity: { min: 0.8, max: 1.0 },
        },
        enforcement: {
          action: 'timeout',
          duration: 3600000, // 1 hour
          escalation: {
            afterOffenses: 2,
            newAction: 'ban',
          },
        },
        active: true,
        createdBy: 'system',
      },
      {
        name: 'High Toxicity',
        description: 'Insulting, aggressive, or disrespectful language',
        severity: 7,
        category: 'conduct',
        conditions: {
          toxicity: { min: 0.6, max: 0.8 },
        },
        enforcement: {
          action: 'timeout',
          duration: 600000, // 10 minutes
          escalation: {
            afterOffenses: 3,
            newAction: 'timeout',
            newDuration: 3600000, // 1 hour
          },
        },
        active: true,
        createdBy: 'system',
      },
      {
        name: 'Scam/Manipulation',
        description: 'Attempting to scam, phish, or manipulate users',
        severity: 10,
        category: 'safety',
        conditions: {
          manipulation: { min: 0.7, max: 1.0 },
        },
        enforcement: {
          action: 'ban',
        },
        active: true,
        createdBy: 'system',
      },
      {
        name: 'Low Trust + Toxic Behavior',
        description: 'User with low trust score engaging in toxic behavior',
        severity: 8,
        category: 'safety',
        conditions: {
          trustScore: { min: 0, max: 30 },
          toxicity: { min: 0.5, max: 1.0 },
        },
        enforcement: {
          action: 'timeout',
          duration: 1800000, // 30 minutes
          escalation: {
            afterOffenses: 1,
            newAction: 'ban',
          },
        },
        active: true,
        createdBy: 'system',
      },
      {
        name: 'Spam Detection',
        description: 'Repetitive or flooding messages',
        severity: 5,
        category: 'spam',
        conditions: {
          keywords: [], // Would be detected by pattern
        },
        enforcement: {
          action: 'delete',
          escalation: {
            afterOffenses: 3,
            newAction: 'timeout',
            newDuration: 300000, // 5 minutes
          },
        },
        active: true,
        createdBy: 'system',
      },
    ];

    for (const policy of defaultPolicies) {
      const fullPolicy: Policy = {
        ...policy,
        id: `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        createdAt: Date.now(),
      };
      this.policies.set(fullPolicy.id, fullPolicy);
    }

    logger.info(`Initialized ${this.policies.size} default policies`);
  }

  /**
   * Check if message violates any policies
   */
  async checkPolicies(context: {
    userId: string;
    guildId: string;
    content: string;
    toxicity: number;
    manipulation: number;
    trustScore: number;
    isRepeatOffender: boolean;
  }): Promise<EnforcementDecision> {
    let violations: PolicyViolation[] = [];
    let policiesChecked = 0;

    // Check each active policy in parallel for speed
    const activePolicies = Array.from(this.policies.values()).filter(p => p.active);
    policiesChecked = activePolicies.length;

    const violationResults = await Promise.all(
      activePolicies.map(policy => this.checkPolicy(policy, context))
    );

    // Collect non-null violations
    violations = violationResults.filter((v): v is PolicyViolation => v !== null);

    // Sort violations by severity
    violations.sort((a, b) => b.severity - a.severity);

    // Determine if we should enforce
    const shouldEnforce = violations.length > 0;

    // Build enforcement decision
    const decision: EnforcementDecision = {
      shouldEnforce,
      violations,
      secondaryActions: [],
      transparency: {
        explanation: this.buildExplanation(violations),
        policiesChecked,
        violationsFound: violations.length,
      },
    };

    // Determine primary action (highest severity violation)
    if (shouldEnforce && violations.length > 0) {
      const primary = violations[0];
      decision.primaryAction = {
        ...primary.recommendedAction,
        policyId: primary.policyId,
      };

      // Add secondary actions (delete message, alert mods, etc.)
      if (primary.severity >= 8) {
        decision.secondaryActions.push({
          type: 'delete_message',
          reason: 'High severity violation',
        });
        decision.secondaryActions.push({
          type: 'alert_moderators',
          reason: `Serious violation: ${primary.policyName}`,
        });
      }

      // Track violation
      this.trackViolation(context.userId, primary);
    }

    logger.debug(`Policy check: ${violations.length} violations found (${policiesChecked} policies checked)`);

    return decision;
  }

  /**
   * Check single policy against context
   */
  private async checkPolicy(policy: Policy, context: any): Promise<PolicyViolation | null> {
    const conditions = policy.conditions;
    const evidence: string[] = [];
    let matches = true;

    // Check toxicity
    if (conditions.toxicity) {
      if (context.toxicity >= conditions.toxicity.min &&
          context.toxicity <= conditions.toxicity.max) {
        evidence.push(`Toxicity: ${(context.toxicity * 100).toFixed(0)}%`);
      } else {
        matches = false;
      }
    }

    // Check manipulation
    if (conditions.manipulation) {
      if (context.manipulation >= conditions.manipulation.min &&
          context.manipulation <= conditions.manipulation.max) {
        evidence.push(`Manipulation: ${(context.manipulation * 100).toFixed(0)}%`);
      } else {
        matches = false;
      }
    }

    // Check trust score
    if (conditions.trustScore) {
      if (context.trustScore >= conditions.trustScore.min &&
          context.trustScore <= conditions.trustScore.max) {
        evidence.push(`Trust score: ${context.trustScore}/100`);
      } else {
        matches = false;
      }
    }

    // Check keywords
    if (conditions.keywords && conditions.keywords.length > 0) {
      const hasKeyword = conditions.keywords.some(kw =>
        context.content.toLowerCase().includes(kw.toLowerCase())
      );
      if (hasKeyword) {
        evidence.push('Keyword match');
      } else {
        matches = false;
      }
    }

    if (!matches) return null;

    // Check for escalation
    const userViolations = this.violationHistory.get(context.userId) || [];
    const policyViolations = userViolations.filter(v => v.policyId === policy.id);
    const shouldEscalate = policy.enforcement.escalation &&
                           policyViolations.length >= policy.enforcement.escalation.afterOffenses;

    let recommendedAction = policy.enforcement.action;
    let duration = policy.enforcement.duration;

    if (shouldEscalate && policy.enforcement.escalation) {
      recommendedAction = policy.enforcement.escalation.newAction;
      duration = policy.enforcement.escalation.newDuration || duration;
      evidence.push(`Escalated (${policyViolations.length + 1} offenses)`);
    }

    // Calculate confidence using AI
    const confidence = await this.calculateConfidence(evidence, policy);

    return {
      policyId: policy.id,
      policyName: policy.name,
      severity: policy.severity,
      confidence,
      evidence,
      recommendedAction: {
        type: recommendedAction,
        duration,
        reason: `${policy.name}: ${policy.description}`,
      },
    };
  }

  /**
   * Calculate confidence in violation using AI reasoning
   */
  private async calculateConfidence(evidence: string[], policy: Policy): Promise<number> {
    // Use AI to evaluate confidence based on evidence quality, not just quantity
    const prompt = `You are evaluating the confidence level of a policy violation.

Policy: ${policy.name}
Description: ${policy.description}
Severity: ${policy.severity}/10
Category: ${policy.category}

Evidence provided:
${evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Analyze the QUALITY and RELEVANCE of the evidence. Consider:
- Is the evidence directly related to the policy?
- How strong is each piece of evidence?
- Is there ambiguity or room for interpretation?
- Does the evidence pattern suggest intentional violation or accident?

Return ONLY a JSON object:
{
  "confidence": <number 0.0-1.0>,
  "reasoning": "<brief explanation>"
}`;

    const systemPrompt = `You are a policy evaluation expert. You assess evidence objectively and return confidence scores based on evidence quality, not quantity. Be precise and fair.`;

    const schema = `{
  "confidence": <number 0.0-1.0>,
  "reasoning": "<brief explanation>"
}`;

    try {
      // Use generateJSON() which uses DeepSeek-R1 for JSON generation
      const result = await this.llm.generateJSON<{ confidence: number; reasoning: string }>(
        prompt,
        systemPrompt,
        schema
      );

      if (result.confidence >= 0 && result.confidence <= 1) {
        logger.info(`AI confidence: ${result.confidence.toFixed(2)} - ${result.reasoning}`);
        return result.confidence;
      }
    } catch (error) {
      logger.error('AI confidence calculation failed, using fallback:', error);
    }

    // Fallback: Use heuristic if AI fails
    let confidence = 0.5;
    confidence += evidence.length * 0.1;
    if (policy.severity >= 9) confidence *= 1.2;
    return Math.min(1.0, confidence);
  }

  /**
   * Track violation history
   */
  private trackViolation(userId: string, violation: PolicyViolation): void {
    if (!this.violationHistory.has(userId)) {
      this.violationHistory.set(userId, []);
    }

    this.violationHistory.get(userId)!.push(violation);

    // Keep last 50 violations per user
    const userViolations = this.violationHistory.get(userId)!;
    if (userViolations.length > 50) {
      this.violationHistory.set(userId, userViolations.slice(-50));
    }
  }

  /**
   * Build explanation of violations
   */
  private buildExplanation(violations: PolicyViolation[]): string {
    if (violations.length === 0) {
      return 'No policy violations detected';
    }

    const primary = violations[0];
    const explanation = `Violated "${primary.policyName}" policy (severity: ${primary.severity}/10). Evidence: ${primary.evidence.join(', ')}.`;

    if (violations.length > 1) {
      return explanation + ` Also violated ${violations.length - 1} other ${violations.length === 2 ? 'policy' : 'policies'}.`;
    }

    return explanation;
  }

  /**
   * Add custom policy
   */
  addPolicy(policy: Omit<Policy, 'id' | 'createdAt'>): Policy {
    const fullPolicy: Policy = {
      ...policy,
      id: `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
    };

    this.policies.set(fullPolicy.id, fullPolicy);
    this.savePolicies();

    logger.info(`Added custom policy: ${fullPolicy.name}`);

    return fullPolicy;
  }

  /**
   * Remove policy
   */
  removePolicy(policyId: string): boolean {
    const deleted = this.policies.delete(policyId);
    if (deleted) {
      this.savePolicies();
      logger.info(`Removed policy: ${policyId}`);
    }
    return deleted;
  }

  /**
   * Get all policies
   */
  getAllPolicies(): Policy[] {
    return Array.from(this.policies.values());
  }

  /**
   * Get violation history for user
   */
  getViolationHistory(userId: string): PolicyViolation[] {
    return this.violationHistory.get(userId) || [];
  }

  /**
   * Save policies to storage
   */
  private async savePolicies(): Promise<void> {
    try {
      const data = Array.from(this.policies.values());
      await this.storage.write('rules', 'policies_v2.json', data);
    } catch (error) {
      logger.error('Failed to save policies:', error);
    }
  }

  /**
   * Load policies from storage
   */
  private async loadPolicies(): Promise<void> {
    try {
      const data = await this.storage.read<Policy[]>('rules', 'policies_v2.json');
      if (data && Array.isArray(data)) {
        for (const policy of data) {
          this.policies.set(policy.id, policy);
        }
        logger.info(`Loaded ${data.length} policies from storage`);
      }
    } catch (error) {
      logger.error('Failed to load policies:', error);
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    totalPolicies: number;
    activePolicies: number;
    totalViolations: number;
    usersWithViolations: number;
  } {
    let totalViolations = 0;
    for (const violations of this.violationHistory.values()) {
      totalViolations += violations.length;
    }

    return {
      totalPolicies: this.policies.size,
      activePolicies: Array.from(this.policies.values()).filter(p => p.active).length,
      totalViolations,
      usersWithViolations: this.violationHistory.size,
    };
  }
}
