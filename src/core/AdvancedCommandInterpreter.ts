import { Guild, GuildMember } from 'discord.js';
import { createLogger } from '../services/Logger';
import { OllamaService } from '../services/OllamaService';
import { UserProfileBadgeSystem } from './UserProfileBadges';
import { BulkActionSystem } from '../systems/BulkActionSystem';
import { AuditLogger } from '../systems/AuditLogger';

const logger = createLogger('AdvancedCommandInterpreter');

/**
 * ADVANCED AI COMMAND INTERPRETER
 *
 * This is NOT pattern matching. This is TRUE AI understanding.
 *
 * The AI reads your natural language command and:
 * 1. Understands the INTENT (what you want to achieve)
 * 2. Identifies the TARGETS (who/what to act on)
 * 3. Extracts CRITERIA (conditions, filters, ranges)
 * 4. Determines ACTIONS (what to do)
 * 5. Plans EXECUTION (step-by-step breakdown)
 *
 * Examples it can handle:
 * - "Ban everyone whose trust score is between 10 and 30"
 * - "Timeout all users with 'toxic' badge for 1 hour"
 * - "Show me users who joined in the last week and have negative badges"
 * - "Remove 'helpful' badge from users who haven't posted in 30 days"
 * - "Analyze behavior patterns of users with trust score below 50"
 */

// ==========================================
// INTERFACES
// ==========================================

export interface CommandIntent {
  action: 'ban' | 'timeout' | 'kick' | 'warn' | 'analyze' | 'show' | 'filter' | 'modify' | 'query' | 'mass_action';
  targets: {
    type: 'users' | 'channels' | 'roles' | 'server';
    criteria: FilterCriteria[];
    count?: number; // How many targets match
  };
  parameters: {
    duration?: number; // For timeout (in milliseconds)
    reason?: string;
    preventRejoin?: boolean; // For bans
    conditions?: string[];
  };
  complexity: 'simple' | 'moderate' | 'complex';
  confidence: number; // 0-1, how confident AI is about understanding
  reasoning: string; // AI's explanation of what it understood
  executionPlan: ExecutionStep[];
}

export interface FilterCriteria {
  field: 'trustScore' | 'badge' | 'joinDate' | 'messageCount' | 'lastActive' | 'role' | 'custom';
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=' | 'between' | 'contains' | 'matches';
  value: any;
  value2?: any; // For 'between' operator
}

export interface ExecutionStep {
  step: number;
  description: string;
  action: string;
  estimatedTargets?: number;
  requiresConfirmation: boolean;
  reversible: boolean;
}

export interface CommandResult {
  success: boolean;
  intent: CommandIntent;
  executed: boolean;
  affected: number; // How many users/items affected
  details: string[];
  errors: string[];
}

// ==========================================
// ADVANCED COMMAND INTERPRETER
// ==========================================

export class AdvancedCommandInterpreter {
  private llm: OllamaService;
  private badgeSystem: UserProfileBadgeSystem;
  private bulkActions: BulkActionSystem;
  private auditLogger: AuditLogger;

  constructor(llm: OllamaService, badgeSystem: UserProfileBadgeSystem, bulkActions: BulkActionSystem, auditLogger: AuditLogger) {
    this.llm = llm;
    this.badgeSystem = badgeSystem;
    this.bulkActions = bulkActions;
    this.auditLogger = auditLogger;
    logger.info('AdvancedCommandInterpreter initialized - AI can now understand ANY command with Super AI bulk actions');
  }

  /**
   * Parse natural language command into structured intent
   * This is TRUE AI understanding, not pattern matching
   */
  async parseCommand(command: string, guild: Guild): Promise<CommandIntent> {
    logger.info(`🧠 AI parsing command: "${command}"`);

    const prompt = `You are an advanced AI command interpreter for a Discord server moderation system.

USER COMMAND: "${command}"

Your task is to understand this command and extract:
1. What ACTION the user wants (ban, timeout, analyze, show, filter, etc.)
2. WHO/WHAT are the TARGETS (specific users, groups, criteria)
3. Any CRITERIA/FILTERS (trust score ranges, badges, time periods)
4. PARAMETERS (duration, reason, conditions)

Available data you can filter by:
- Trust Score: 0-100 (numerical)
- Badges: "Toxic", "Helpful", "Profanity", "Scammer", "Trusted", etc.
- Join Date: When user joined server
- Message Count: How many messages posted
- Last Active: When user was last active
- Roles: Server roles

CRITICAL: If the command involves MASS ACTIONS (affecting multiple users), you MUST:
- Identify ALL criteria clearly
- Estimate how many users will be affected
- Mark as requiring confirmation if irreversible (like bans)

Return ONLY a JSON object:
{
  "action": "ban|timeout|kick|warn|analyze|show|filter|modify|query|mass_action",
  "targets": {
    "type": "users|channels|roles|server",
    "criteria": [
      {
        "field": "trustScore|badge|joinDate|messageCount|lastActive|role",
        "operator": ">|<|>=|<=|==|!=|between|contains|matches",
        "value": <value>,
        "value2": <optional second value for 'between'>
      }
    ]
  },
  "parameters": {
    "duration": <milliseconds, if timeout>,
    "reason": "<extracted reason>",
    "preventRejoin": <true/false, for bans>,
    "conditions": ["<list of conditions>"]
  },
  "complexity": "simple|moderate|complex",
  "confidence": 0.95,
  "reasoning": "<explain what you understood>",
  "executionPlan": [
    {
      "step": 1,
      "description": "Fetch all users in server",
      "action": "query",
      "requiresConfirmation": false,
      "reversible": true
    },
    {
      "step": 2,
      "description": "Filter users with trust score between X and Y",
      "action": "filter",
      "estimatedTargets": 0,
      "requiresConfirmation": false,
      "reversible": true
    },
    {
      "step": 3,
      "description": "Ban filtered users and prevent rejoin",
      "action": "ban",
      "requiresConfirmation": true,
      "reversible": false
    }
  ]
}

IMPORTANT:
- For "ban everyone whose score is between X and Y", action is "mass_action" with criteria trustScore between X and Y
- For "show me users with...", action is "show" or "query"
- For "analyze behavior of...", action is "analyze"
- Always provide step-by-step execution plan
- Mark irreversible actions as requiring confirmation`;

    const systemPrompt = `You are an expert at understanding natural language commands and converting them to structured actions. Be precise and thorough.`;

    try {
      const response = await this.llm.generate(prompt, systemPrompt);

      // Clean response - handle multiple formats
      let cleaned = response.trim();

      // Remove markdown code blocks
      cleaned = cleaned.replace(/```json\s*/g, '');
      cleaned = cleaned.replace(/```\s*/g, '');
      cleaned = cleaned.trim();

      // Extract JSON object (greedy match to get complete object)
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      }

      // Fix common LLM JSON errors
      // 1. Remove trailing commas before closing braces/brackets
      cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

      // 2. Fix unescaped quotes in strings (basic fix)
      // This is tricky - we'll try to parse and if it fails, log the raw response

      let intent: CommandIntent;
      try {
        intent = JSON.parse(cleaned);
      } catch (parseError) {
        // Log the problematic JSON for debugging
        logger.error('JSON parse error. Raw cleaned JSON:', cleaned.substring(0, 500));
        throw parseError;
      }

      logger.info(`✅ Command parsed successfully:`);
      logger.info(`   Action: ${intent.action}`);
      logger.info(`   Complexity: ${intent.complexity}`);
      logger.info(`   Confidence: ${(intent.confidence * 100).toFixed(0)}%`);
      logger.info(`   Reasoning: ${intent.reasoning}`);

      return intent;

    } catch (error) {
      logger.error('Command parsing failed:', error);

      // Fallback: Return basic intent
      return {
        action: 'query',
        targets: {
          type: 'users',
          criteria: [],
        },
        parameters: {},
        complexity: 'simple',
        confidence: 0.3,
        reasoning: 'Failed to parse command, using fallback',
        executionPlan: [],
      };
    }
  }

  /**
   * Execute the parsed command
   */
  async executeCommand(
    intent: CommandIntent,
    guild: Guild,
    trustEngine: any,
    requireConfirmation: boolean = true,
    moderatorId?: string
  ): Promise<CommandResult> {
    logger.info(`⚡ Executing command: ${intent.action}`);

    const result: CommandResult = {
      success: false,
      intent,
      executed: false,
      affected: 0,
      details: [],
      errors: [],
    };

    try {
      // 🔥 SUPER AI: Use BulkActionSystem for mass actions
      if (intent.action === 'mass_action' || intent.targets.criteria.length > 0) {
        return await this.executeBulkAction(intent, guild, trustEngine, requireConfirmation, moderatorId || 'system');
      }

      // Step 1: Find targets based on criteria
      const targets = await this.findTargets(intent, guild, trustEngine);

      logger.info(`🎯 Found ${targets.length} targets matching criteria`);

      result.details.push(`Found ${targets.length} users matching criteria`);

      // Step 2: Check if confirmation is needed
      if (requireConfirmation && this.needsConfirmation(intent)) {
        result.details.push('⚠️ This action requires confirmation due to its impact');
        result.details.push(`Execution plan:`);
        intent.executionPlan.forEach((step, i) => {
          const emoji = step.requiresConfirmation ? '🔒' : '✅';
          result.details.push(`  ${emoji} Step ${step.step}: ${step.description}`);
        });
        return result; // Return without executing, waiting for confirmation
      }

      // Step 3: Execute action on each target
      result.executed = true;

      for (const target of targets) {
        try {
          const actionResult = await this.executeActionOnTarget(
            intent.action,
            target,
            intent.parameters,
            guild
          );

          if (actionResult.success) {
            result.affected++;
            result.details.push(`✓ ${actionResult.message}`);
          } else {
            result.errors.push(`✗ ${actionResult.message}`);
          }
        } catch (error) {
          result.errors.push(`✗ Failed to act on ${target.id}: ${error}`);
        }
      }

      result.success = result.affected > 0;
      logger.info(`✅ Command executed: ${result.affected}/${targets.length} successful`);

    } catch (error) {
      logger.error('Command execution failed:', error);
      result.errors.push(`Execution failed: ${error}`);
    }

    return result;
  }

  /**
   * 🔥 SUPER AI: Execute bulk actions using BulkActionSystem
   * Integrates with trust score updates and audit logging
   */
  private async executeBulkAction(
    intent: CommandIntent,
    guild: Guild,
    trustEngine: any,
    requireConfirmation: boolean,
    moderatorId: string
  ): Promise<CommandResult> {
    logger.info(`🔥 Executing BULK ACTION with Super AI system`);

    const result: CommandResult = {
      success: false,
      intent,
      executed: false,
      affected: 0,
      details: [],
      errors: [],
    };

    // Convert intent criteria to BulkActionCriteria
    const criteria: any = {};

    for (const filter of intent.targets.criteria) {
      if (filter.field === 'trustScore') {
        if (filter.operator === '<') criteria.trustScoreMax = filter.value;
        if (filter.operator === '>') criteria.trustScoreMin = filter.value;
        if (filter.operator === '<=') criteria.trustScoreMax = filter.value;
        if (filter.operator === '>=') criteria.trustScoreMin = filter.value;
        if (filter.operator === 'between') {
          criteria.trustScoreMin = filter.value;
          criteria.trustScoreMax = filter.value2;
        }
      } else if (filter.field === 'role') {
        if (filter.operator === '==') criteria.hasRole = filter.value;
        if (filter.operator === '!=') criteria.lacksRole = filter.value;
      } else if (filter.field === 'joinDate') {
        // Convert join date to "days since joined"
        const now = Date.now();
        const daysSinceJoin = (now - filter.value) / (1000 * 60 * 60 * 24);
        criteria.joinedWithinDays = Math.floor(daysSinceJoin);
      }
    }

    // Preview first if confirmation needed
    if (requireConfirmation) {
      const preview = await this.bulkActions.preview(guild, criteria, moderatorId);
      result.details.push(`⚠️ BULK ACTION PREVIEW`);
      result.details.push(`   Found ${preview.count} users matching criteria`);
      result.details.push(`   Action: ${intent.action}`);
      result.details.push(`   Reason: ${intent.parameters.reason || 'No reason provided'}`);
      result.details.push(`\n🔒 This requires confirmation. Reply with "yes" to proceed.`);
      return result;
    }

    // Execute bulk action
    let bulkResult;
    const reason = intent.parameters.reason || 'Bulk moderation action';

    try {
      if (intent.action === 'timeout') {
        const durationMinutes = intent.parameters.duration ? intent.parameters.duration / 60000 : 10;
        bulkResult = await this.bulkActions.bulkTimeout(guild, criteria, durationMinutes, reason, moderatorId);
      } else if (intent.action === 'kick') {
        bulkResult = await this.bulkActions.bulkKick(guild, criteria, reason, moderatorId);
      } else if (intent.action === 'ban') {
        bulkResult = await this.bulkActions.bulkBan(guild, criteria, reason, moderatorId);
      } else {
        result.errors.push(`Bulk action type '${intent.action}' not supported`);
        return result;
      }

      // Log to audit system
      await this.auditLogger.log({
        type: 'bulk_action',
        guildId: guild.id,
        guildName: guild.name,
        actorId: moderatorId,
        actorName: 'AI Moderator',
        actorType: 'moderator',
        action: `bulk_${intent.action}`,
        details: {
          criteria,
          affected: bulkResult.affected,
          failed: bulkResult.failed,
          reason,
        },
        success: bulkResult.affected > 0,
      });

      result.executed = true;
      result.success = bulkResult.affected > 0;
      result.affected = bulkResult.affected;
      result.details.push(`✅ BULK ACTION COMPLETED`);
      result.details.push(`   Successful: ${bulkResult.affected}`);
      result.details.push(`   Failed: ${bulkResult.failed}`);

      if (bulkResult.errors.length > 0) {
        result.details.push(`\n⚠️ Errors:`);
        bulkResult.errors.forEach(err => result.errors.push(`${err.userId}: ${err.error}`));
      }

      logger.info(`🔥 Bulk action complete: ${bulkResult.affected} successful, ${bulkResult.failed} failed`);

    } catch (error) {
      logger.error('Bulk action failed:', error);
      result.errors.push(`Bulk action execution failed: ${error}`);
    }

    return result;
  }

  /**
   * Find targets based on filter criteria
   */
  private async findTargets(
    intent: CommandIntent,
    guild: Guild,
    trustEngine: any
  ): Promise<GuildMember[]> {
    logger.info(`🔍 Finding targets with ${intent.targets.criteria.length} criteria`);

    // Fetch all members
    await guild.members.fetch();
    let targets = Array.from(guild.members.cache.values());

    logger.info(`   Starting with ${targets.length} total members`);

    // Apply each filter criteria
    for (const criteria of intent.targets.criteria) {
      targets = this.applyFilter(targets, criteria, guild, trustEngine);
      logger.info(`   After filter '${criteria.field} ${criteria.operator} ${criteria.value}': ${targets.length} remaining`);
    }

    return targets;
  }

  /**
   * Apply a single filter criteria
   */
  private applyFilter(
    members: GuildMember[],
    criteria: FilterCriteria,
    guild: Guild,
    trustEngine: any
  ): GuildMember[] {
    return members.filter(member => {
      switch (criteria.field) {
        case 'trustScore': {
          const trust = trustEngine.getTrustScore(member.id, guild.id);
          return this.compareValues(trust.score, criteria.operator, criteria.value, criteria.value2);
        }

        case 'badge': {
          const profile = this.badgeSystem.getProfile(member.id, guild.id);
          if (!profile) return false;

          const hasBadge = profile.badges.some(b =>
            b.label.toLowerCase().includes(criteria.value.toLowerCase())
          );

          return criteria.operator === '==' ? hasBadge : !hasBadge;
        }

        case 'joinDate': {
          if (!member.joinedAt) return false;
          const joinTime = member.joinedAt.getTime();
          return this.compareValues(joinTime, criteria.operator, criteria.value, criteria.value2);
        }

        case 'role': {
          const hasRole = member.roles.cache.some(r =>
            r.name.toLowerCase().includes(criteria.value.toLowerCase())
          );
          return criteria.operator === '==' ? hasRole : !hasRole;
        }

        default:
          return true;
      }
    });
  }

  /**
   * Compare values based on operator
   */
  private compareValues(value: number, operator: string, target: any, target2?: any): boolean {
    switch (operator) {
      case '>': return value > target;
      case '<': return value < target;
      case '>=': return value >= target;
      case '<=': return value <= target;
      case '==': return value === target;
      case '!=': return value !== target;
      case 'between': return target2 !== undefined && value >= target && value <= target2;
      default: return false;
    }
  }

  /**
   * Check if command needs confirmation
   */
  private needsConfirmation(intent: CommandIntent): boolean {
    // Mass actions that are irreversible need confirmation
    if (intent.action === 'ban' || intent.action === 'kick' || intent.action === 'mass_action') {
      return true;
    }

    // Complex commands need confirmation
    if (intent.complexity === 'complex') {
      return true;
    }

    // Check execution plan
    return intent.executionPlan.some(step => step.requiresConfirmation);
  }

  /**
   * Execute action on a single target
   */
  private async executeActionOnTarget(
    action: string,
    target: GuildMember,
    parameters: any,
    guild: Guild
  ): Promise<{ success: boolean; message: string }> {
    try {
      switch (action) {
        case 'ban':
        case 'mass_action': // Mass ban
          await target.ban({
            reason: parameters.reason || 'Mass action by AI',
            deleteMessageSeconds: parameters.preventRejoin ? 604800 : 0, // Delete 7 days of messages if prevent rejoin
          });
          return {
            success: true,
            message: `Banned ${target.user.username} (${target.id})`,
          };

        case 'timeout':
          const duration = parameters.duration || 600000; // Default 10 minutes
          await target.timeout(duration, parameters.reason || 'AI timeout');
          return {
            success: true,
            message: `Timed out ${target.user.username} for ${(duration / 60000).toFixed(0)} minutes`,
          };

        case 'kick':
          await target.kick(parameters.reason || 'AI kick');
          return {
            success: true,
            message: `Kicked ${target.user.username}`,
          };

        default:
          return {
            success: false,
            message: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed on ${target.user.username}: ${error}`,
      };
    }
  }

  /**
   * Format command result for Discord
   */
  formatResult(result: CommandResult): string {
    const lines: string[] = [];

    if (result.executed) {
      lines.push(`**✅ Command Executed**`);
      lines.push(`Action: ${result.intent.action}`);
      lines.push(`Affected: ${result.affected} users`);
      lines.push('');
    } else if (result.details.length > 0) {
      lines.push(`**⚠️ Confirmation Required**`);
      lines.push('');
    }

    // Add details
    if (result.details.length > 0) {
      result.details.forEach(detail => lines.push(detail));
      lines.push('');
    }

    // Add errors
    if (result.errors.length > 0) {
      lines.push(`**Errors (${result.errors.length}):**`);
      result.errors.slice(0, 5).forEach(error => lines.push(`- ${error}`));
      if (result.errors.length > 5) {
        lines.push(`... and ${result.errors.length - 5} more errors`);
      }
    }

    return lines.join('\n');
  }
}
