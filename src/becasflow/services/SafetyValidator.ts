/**
 * SAFETY VALIDATOR
 *
 * Prevents dangerous operations before execution.
 * Checks for mass actions, admin targeting, data destruction, etc.
 */

import { OllamaService } from '../../services/OllamaService';
import { createLogger } from '../../services/Logger';
import { BecasStep, BecasContext } from '../types/BecasFlow.types';

const logger = createLogger('SafetyValidator');

export interface SafetyResult {
  safe: boolean;
  warning?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  requiresConfirmation?: boolean;
}

export class SafetyValidator {
  private ollama: OllamaService;

  constructor() {
    this.ollama = new OllamaService('safetyValidation');
    logger.info('SafetyValidator initialized');
  }

  /**
   * Validate if step is safe to execute
   */
  async validate(step: BecasStep, context: BecasContext): Promise<SafetyResult> {
    try {
      // Quick rule-based checks first
      const ruleCheck = this.performRuleBasedChecks(step, context);
      if (!ruleCheck.safe) {
        return ruleCheck;
      }

      // AI-powered analysis for complex cases
      return await this.performAIAnalysis(step, context);

    } catch (error: any) {
      logger.error('Safety validation error:', error);
      return { safe: true }; // Fail-open (allow if validation fails)
    }
  }

  /**
   * Rule-based safety checks (fast)
   */
  private performRuleBasedChecks(step: BecasStep, context: BecasContext): SafetyResult {
    const params = step.params;

    // Check for mass bans/kicks (>10 users)
    if ((step.toolName === 'ban' || step.toolName === 'kick') && params.userIds?.length > 10) {
      return {
        safe: false,
        warning: `Attempting to ${step.toolName} ${params.userIds.length} users at once`,
        severity: 'critical',
        requiresConfirmation: true,
      };
    }

    // Check for mass message deletion (>100 messages)
    if (step.toolName === 'delete_messages' && params.count > 100) {
      return {
        safe: false,
        warning: `Attempting to delete ${params.count} messages`,
        severity: 'high',
        requiresConfirmation: true,
      };
    }

    // Check for targeting server owner/admins
    if (step.toolName === 'ban' && params.userId) {
      const targetMember = context.guild.members.cache.get(params.userId);
      if (targetMember?.permissions.has('Administrator')) {
        return {
          safe: false,
          warning: 'Attempting to ban an administrator',
          severity: 'critical',
          requiresConfirmation: true,
        };
      }
    }

    return { safe: true };
  }

  /**
   * AI-powered safety analysis (for edge cases)
   */
  private async performAIAnalysis(step: BecasStep, context: BecasContext): Promise<SafetyResult> {
    const systemPrompt = `You are a safety validator for Discord moderation actions.

Analyze if this action is safe to execute.

RESPONSE FORMAT (JSON only):
{
  "safe": true/false,
  "warning": "<warning message if unsafe>",
  "severity": "low" | "medium" | "high" | "critical",
  "requiresConfirmation": true/false
}`;

    const userPrompt = `Action: ${step.toolName}
Parameters: ${JSON.stringify(step.params, null, 2)}
Server: ${context.guild.name}
Executor: ${context.member.user.tag}

Is this safe?`;

    const response = await this.ollama.generate(systemPrompt, userPrompt);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { safe: true }; // Fail-open
    }

    return JSON.parse(jsonMatch[0]);
  }
}
