/**
 * POLICY MANAGEMENT TOOL (BecasFlow)
 *
 * Natural language interface for guild policy management.
 * Users can create, view, update, and delete policies using conversational language.
 *
 * Examples:
 * - "create a policy that bans spam with 1 hour timeout"
 * - "show me all server policies"
 * - "remove the policy about politics"
 * - "update the spam policy to ban instead of timeout"
 */

import { BecasTool, BecasContext, BecasToolResult, BecasMissingParam } from '../types/BecasFlow.types';
import { GuildPolicyEngineDB, GuildPolicy } from '../../intelligence/GuildPolicyEngineDB';
import { OllamaService } from '../../services/OllamaService';
import { createLogger } from '../../services/Logger';

const logger = createLogger('PolicyManagementTool');

// Shared instances
const policyEngine = new GuildPolicyEngineDB();
const ollama = new OllamaService('policyDiscovery');

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export const policyManagementTool: BecasTool = {
  name: 'policy_management',
  description: 'Manage guild-specific policies (LOCAL enforcement only, does NOT affect trust scores)',
  category: 'policy',

  parameters: {
    action: {
      type: 'string',
      description: 'Action to perform: add, list, remove, update',
      required: true,
      enum: ['add', 'list', 'remove', 'update'],
    },
    ruleText: {
      type: 'string',
      description: 'The rule text (for add action)',
      required: false,
    },
    actionType: {
      type: 'string',
      description: 'Punishment type: warn, timeout, ban (for add action)',
      required: false,
      enum: ['warn', 'timeout', 'ban'],
    },
    duration: {
      type: 'number',
      description: 'Duration in seconds for timeout (for add action with timeout)',
      required: false,
    },
    policyId: {
      type: 'string',
      description: 'Policy ID prefix (for remove/update actions)',
      required: false,
    },
    updateField: {
      type: 'string',
      description: 'Field to update: action, severity, active',
      required: false,
      enum: ['action', 'severity', 'active'],
    },
    updateValue: {
      type: 'string',
      description: 'New value for the field',
      required: false,
    },
  },

  detectMissing: (params: any, context: BecasContext): BecasMissingParam | null => {
    if (!params.action) {
      return {
        param: 'action',
        prompt: 'What would you like to do with policies?',
        type: 'button',
        options: [
          { label: 'Add Policy', value: 'add', description: 'Create a new guild policy' },
          { label: 'List Policies', value: 'list', description: 'View all active policies' },
          { label: 'Remove Policy', value: 'remove', description: 'Delete an existing policy' },
          { label: 'Update Policy', value: 'update', description: 'Modify an existing policy' },
        ],
      };
    }

    if (params.action === 'add' && !params.ruleText) {
      return {
        param: 'ruleText',
        prompt: 'What rule would you like to create? (e.g., "No spam", "No politics in #general")',
        type: 'text',
      };
    }

    return null;
  },

  async execute(params: any, context: BecasContext): Promise<BecasToolResult> {
    const startTime = Date.now();

    // Permission check
    if (!context.member.permissions.has('Administrator')) {
      return {
        success: false,
        error: 'Only administrators can manage guild policies.',
      };
    }

    try {
      switch (params.action) {
        case 'add':
          return await addPolicy(params, context, startTime);
        case 'list':
          return await listPolicies(context, startTime);
        case 'remove':
          return await removePolicy(params, context, startTime);
        case 'update':
          return await updatePolicy(params, context, startTime);
        default:
          return {
            success: false,
            error: 'Unknown action. Use: add, list, remove, or update.',
          };
      }
    } catch (error: any) {
      logger.error('Policy management error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

/**
 * Add new policy
 */
async function addPolicy(params: any, context: BecasContext, startTime: number): Promise<BecasToolResult> {
  if (!params.ruleText) {
    return {
      success: false,
      error: 'Please provide a rule text.',
    };
  }

  const ruleText = params.ruleText;
  const actionType = params.actionType || 'warn';
  const duration = params.duration || 3600; // Default 1 hour

  try {
    // Ask AI to interpret the rule
    const systemPrompt = `You are a Discord server policy interpreter. Analyze the rule and provide structured interpretation.

RESPONSE FORMAT (JSON only):
{
  "aiInterpretation": "<clear explanation of what this rule means>",
  "category": "content" | "behavior" | "channel_specific",
  "severity": "low" | "medium" | "high",
  "confidence": 0.0-1.0
}`;

    const userPrompt = `Rule: "${ruleText}"\nAction: ${actionType}\n\nInterpret this rule.`;

    const response = await ollama.generate(userPrompt, systemPrompt, {
      temperature: 0.3,
      maxTokens: 400,
      format: 'json',
    });

    // Parse AI response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: false,
        error: 'Failed to interpret rule. Please try again.',
      };
    }

    const interpretation = JSON.parse(jsonMatch[0]);

    // Create policy
    const policyId = await policyEngine.addPolicy({
      guildId: context.guild.id,
      ruleText,
      aiInterpretation: interpretation.aiInterpretation,
      category: interpretation.category,
      actionType,
      actionParams: {
        duration: actionType === 'timeout' ? duration : undefined,
        reason: `Guild policy: ${ruleText}`,
      },
      severity: interpretation.severity,
      confidence: interpretation.confidence,
      learnedFrom: 'manual',
      isActive: true,
    });

    if (!policyId) {
      return {
        success: false,
        error: 'Failed to create policy. Check logs for details.',
      };
    }

    const durationText = actionType === 'timeout' ? ` (${formatDuration(duration)})` : '';

    return {
      success: true,
      data: `✅ **Guild Policy Created**

**Rule:** ${ruleText}
**Interpretation:** ${interpretation.aiInterpretation}
**Action:** ${actionType}${durationText}
**Severity:** ${interpretation.severity}
**Category:** ${interpretation.category}
**Policy ID:** \`${policyId.substring(0, 8)}...\`

⚠️ This is a LOCAL guild policy. It does NOT affect global trust scores.`,
      metadata: {
        executionTime: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    logger.error('Policy creation error:', error);
    return {
      success: false,
      error: 'Error creating policy: ' + error.message,
    };
  }
}

/**
 * List all policies
 */
async function listPolicies(context: BecasContext, startTime: number): Promise<BecasToolResult> {
  try {
    const policies = await policyEngine.getGuildPolicies(context.guild.id);

    if (policies.length === 0) {
      return {
        success: true,
        data: '📋 No active policies found for this server.\n\nUse the policy management tool to create one.',
        metadata: {
          executionTime: Date.now() - startTime,
        },
      };
    }

    // Group by severity
    const bySeverity: Record<string, GuildPolicy[]> = {
      high: [],
      medium: [],
      low: [],
    };

    policies.forEach(p => {
      bySeverity[p.severity]?.push(p);
    });

    let output = `📋 **Guild Policies (${policies.length} total)**\n\n`;

    // High severity
    if (bySeverity.high.length > 0) {
      output += '🔴 **High Severity**\n';
      bySeverity.high.forEach(p => {
        output += `• **${p.ruleText}** → ${p.actionType}\n`;
        output += `  _${p.aiInterpretation}_\n`;
        output += `  \`ID: ${p.id.substring(0, 8)}...\`\n\n`;
      });
    }

    // Medium severity
    if (bySeverity.medium.length > 0) {
      output += '🟡 **Medium Severity**\n';
      bySeverity.medium.forEach(p => {
        output += `• **${p.ruleText}** → ${p.actionType}\n`;
        output += `  _${p.aiInterpretation}_\n`;
        output += `  \`ID: ${p.id.substring(0, 8)}...\`\n\n`;
      });
    }

    // Low severity
    if (bySeverity.low.length > 0) {
      output += '🟢 **Low Severity**\n';
      bySeverity.low.forEach(p => {
        output += `• **${p.ruleText}** → ${p.actionType}\n`;
        output += `  _${p.aiInterpretation}_\n`;
        output += `  \`ID: ${p.id.substring(0, 8)}...\`\n\n`;
      });
    }

    output += '\n⚠️ These are LOCAL policies. They do NOT affect global trust scores.';

    return {
      success: true,
      data: output,
      metadata: {
        executionTime: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    logger.error('Policy list error:', error);
    return {
      success: false,
      error: 'Error fetching policies: ' + error.message,
    };
  }
}

/**
 * Remove policy
 */
async function removePolicy(params: any, context: BecasContext, startTime: number): Promise<BecasToolResult> {
  if (!params.policyId) {
    return {
      success: false,
      error: 'Please provide a policy ID.',
    };
  }

  try {
    const policies = await policyEngine.getGuildPolicies(context.guild.id);
    const policy = policies.find(p => p.id.startsWith(params.policyId));

    if (!policy) {
      return {
        success: false,
        error: `Policy not found with ID prefix: ${params.policyId}`,
      };
    }

    const success = await policyEngine.deletePolicy(policy.id);

    if (!success) {
      return {
        success: false,
        error: 'Failed to delete policy. Check logs.',
      };
    }

    return {
      success: true,
      data: `🗑️ **Policy Removed**

**Rule:** ${policy.ruleText}
**Action:** ${policy.actionType}`,
      metadata: {
        executionTime: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    logger.error('Policy removal error:', error);
    return {
      success: false,
      error: 'Error removing policy: ' + error.message,
    };
  }
}

/**
 * Update policy
 */
async function updatePolicy(params: any, context: BecasContext, startTime: number): Promise<BecasToolResult> {
  if (!params.policyId || !params.updateField || !params.updateValue) {
    return {
      success: false,
      error: 'Please provide policy ID, field, and value.',
    };
  }

  try {
    const policies = await policyEngine.getGuildPolicies(context.guild.id);
    const policy = policies.find(p => p.id.startsWith(params.policyId));

    if (!policy) {
      return {
        success: false,
        error: `Policy not found with ID prefix: ${params.policyId}`,
      };
    }

    const updates: Partial<GuildPolicy> = {};

    switch (params.updateField) {
      case 'action':
        if (!['warn', 'timeout', 'ban'].includes(params.updateValue.toLowerCase())) {
          return {
            success: false,
            error: 'Action must be: warn, timeout, or ban',
          };
        }
        updates.actionType = params.updateValue.toLowerCase() as 'warn' | 'timeout' | 'ban';
        break;

      case 'severity':
        if (!['low', 'medium', 'high'].includes(params.updateValue.toLowerCase())) {
          return {
            success: false,
            error: 'Severity must be: low, medium, or high',
          };
        }
        updates.severity = params.updateValue.toLowerCase() as 'low' | 'medium' | 'high';
        break;

      case 'active':
        updates.isActive = params.updateValue.toLowerCase() === 'true';
        break;

      default:
        return {
          success: false,
          error: 'Unknown field. Available fields: action, severity, active',
        };
    }

    const success = await policyEngine.updatePolicy(policy.id, updates);

    if (!success) {
      return {
        success: false,
        error: 'Failed to update policy. Check logs.',
      };
    }

    return {
      success: true,
      data: `✏️ **Policy Updated**

**Rule:** ${policy.ruleText}
**Updated Field:** ${params.updateField}
**New Value:** ${params.updateValue}`,
      metadata: {
        executionTime: Date.now() - startTime,
      },
    };
  } catch (error: any) {
    logger.error('Policy update error:', error);
    return {
      success: false,
      error: 'Error updating policy: ' + error.message,
    };
  }
}
