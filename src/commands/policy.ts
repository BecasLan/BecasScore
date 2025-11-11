/**
 * MANUAL GUILD POLICY MANAGEMENT COMMANDS
 *
 * Admin-only commands to manually create, update, delete, and view guild policies.
 *
 * Usage:
 * - becas policy add [rule] [action] [duration]
 * - becas policy list
 * - becas policy remove [id]
 * - becas policy update [id] [field] [value]
 *
 * Examples:
 * - becas policy add "No politics in #general" timeout 1h
 * - becas policy add "No spam" warn
 * - becas policy add "No NSFW content" ban
 * - becas policy list
 * - becas policy remove abc-123-def
 */

import { Message, PermissionFlagsBits } from 'discord.js';
import { GuildPolicyEngineDB, GuildPolicy } from '../intelligence/GuildPolicyEngineDB';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('PolicyCommand');

export class PolicyCommand {
  private policyEngine: GuildPolicyEngineDB;
  private ollama: OllamaService;

  constructor() {
    this.policyEngine = new GuildPolicyEngineDB();
    this.ollama = new OllamaService('policyDiscovery');
  }

  /**
   * Main command handler
   */
  async execute(message: Message, args: string[]): Promise<void> {
    // Admin-only check
    if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply('❌ Only administrators can manage guild policies.');
      return;
    }

    if (!message.guild) {
      await message.reply('❌ This command can only be used in a server.');
      return;
    }

    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'add':
        await this.addPolicy(message, args.slice(1));
        break;

      case 'list':
        await this.listPolicies(message);
        break;

      case 'remove':
      case 'delete':
        await this.removePolicy(message, args.slice(1));
        break;

      case 'update':
        await this.updatePolicy(message, args.slice(1));
        break;

      case 'help':
      default:
        await this.showHelp(message);
        break;
    }
  }

  /**
   * Add new policy manually
   * Usage: becas policy add "No politics" timeout 1h
   */
  private async addPolicy(message: Message, args: string[]): Promise<void> {
    try {
      // Parse rule text (everything in quotes or until action keyword)
      const fullText = args.join(' ');
      const ruleTextMatch = fullText.match(/"([^"]+)"/) || fullText.match(/^([^"]+?)(?:\s+(?:warn|timeout|ban))/);

      if (!ruleTextMatch) {
        await message.reply('❌ Please provide a rule in quotes: `becas policy add "No spam" timeout 1h`');
        return;
      }

      const ruleText = ruleTextMatch[1].trim();

      // Parse action type
      const actionMatch = fullText.match(/\b(warn|timeout|ban)\b/i);
      const actionType = (actionMatch?.[1].toLowerCase() as 'warn' | 'timeout' | 'ban') || 'warn';

      // Parse duration (if timeout)
      let duration = 3600; // Default 1 hour
      if (actionType === 'timeout') {
        const durationMatch = fullText.match(/(\d+)\s*(s|m|h|d)/i);
        if (durationMatch) {
          const value = parseInt(durationMatch[1]);
          const unit = durationMatch[2].toLowerCase();

          switch (unit) {
            case 's': duration = value; break;
            case 'm': duration = value * 60; break;
            case 'h': duration = value * 3600; break;
            case 'd': duration = value * 86400; break;
          }
        }
      }

      // Ask AI to interpret the rule
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
      }

      const systemPrompt = `You are a Discord server policy interpreter. Analyze the rule and provide structured interpretation.

RESPONSE FORMAT (JSON only):
{
  "aiInterpretation": "<clear explanation of what this rule means>",
  "category": "content" | "behavior" | "channel_specific",
  "severity": "low" | "medium" | "high",
  "confidence": 0.0-1.0
}

Example:
Rule: "No politics in #general"
Response:
{
  "aiInterpretation": "Users should not discuss political topics in the #general channel",
  "category": "channel_specific",
  "severity": "medium",
  "confidence": 0.95
}`;

      const userPrompt = `Rule: "${ruleText}"\nAction: ${actionType}\n\nInterpret this rule.`;

      const response = await this.ollama.generate(userPrompt, systemPrompt, {
        temperature: 0.3,
        maxTokens: 400,
        format: 'json',
      });

      // Parse AI response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        await message.reply('❌ Failed to interpret rule. Please try again.');
        return;
      }

      const interpretation = JSON.parse(jsonMatch[0]);

      // Create policy
      const policyId = await this.policyEngine.addPolicy({
        guildId: message.guild!.id,
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
        await message.reply('❌ Failed to create policy. Check logs for details.');
        return;
      }

      // Success message
      const durationText = actionType === 'timeout' ? ` (${this.formatDuration(duration)})` : '';

      await message.reply({
        embeds: [{
          title: '✅ Guild Policy Created',
          color: 0x00ff00,
          fields: [
            { name: 'Rule', value: ruleText },
            { name: 'Interpretation', value: interpretation.aiInterpretation },
            { name: 'Action', value: `${actionType}${durationText}`, inline: true },
            { name: 'Severity', value: interpretation.severity, inline: true },
            { name: 'Category', value: interpretation.category, inline: true },
            { name: 'Policy ID', value: policyId.substring(0, 8) + '...' },
          ],
          footer: { text: '⚠️ This is a LOCAL guild policy. It does NOT affect global trust scores.' },
        }],
      });

      logger.info(`Policy created manually: "${ruleText}" in guild ${message.guild!.id}`);

    } catch (error: any) {
      logger.error('Policy creation error:', error);
      await message.reply('❌ Error creating policy: ' + error.message);
    }
  }

  /**
   * List all active policies for this guild
   */
  private async listPolicies(message: Message): Promise<void> {
    try {
      const policies = await this.policyEngine.getGuildPolicies(message.guild!.id);

      if (policies.length === 0) {
        await message.reply('📋 No active policies found for this server.\n\nUse `becas policy add "rule" action` to create one.');
        return;
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

      const fields: any[] = [];

      // High severity
      if (bySeverity.high.length > 0) {
        fields.push({
          name: '🔴 High Severity',
          value: bySeverity.high.map(p =>
            `• **${p.ruleText}** → ${p.actionType}\n  _${p.aiInterpretation}_\n  \`ID: ${p.id.substring(0, 8)}...\``
          ).join('\n\n'),
        });
      }

      // Medium severity
      if (bySeverity.medium.length > 0) {
        fields.push({
          name: '🟡 Medium Severity',
          value: bySeverity.medium.map(p =>
            `• **${p.ruleText}** → ${p.actionType}\n  _${p.aiInterpretation}_\n  \`ID: ${p.id.substring(0, 8)}...\``
          ).join('\n\n'),
        });
      }

      // Low severity
      if (bySeverity.low.length > 0) {
        fields.push({
          name: '🟢 Low Severity',
          value: bySeverity.low.map(p =>
            `• **${p.ruleText}** → ${p.actionType}\n  _${p.aiInterpretation}_\n  \`ID: ${p.id.substring(0, 8)}...\``
          ).join('\n\n'),
        });
      }

      await message.reply({
        embeds: [{
          title: `📋 Guild Policies (${policies.length} total)`,
          color: 0x3498db,
          fields,
          footer: {
            text: '⚠️ These are LOCAL policies. Use "becas policy remove [ID]" to delete.'
          },
        }],
      });

    } catch (error: any) {
      logger.error('Policy list error:', error);
      await message.reply('❌ Error fetching policies: ' + error.message);
    }
  }

  /**
   * Remove policy by ID
   * Usage: becas policy remove abc12345
   */
  private async removePolicy(message: Message, args: string[]): Promise<void> {
    try {
      const policyIdPrefix = args[0];

      if (!policyIdPrefix) {
        await message.reply('❌ Please provide a policy ID: `becas policy remove abc12345`');
        return;
      }

      // Find policy by ID prefix
      const policies = await this.policyEngine.getGuildPolicies(message.guild!.id);
      const policy = policies.find(p => p.id.startsWith(policyIdPrefix));

      if (!policy) {
        await message.reply(`❌ Policy not found with ID prefix: ${policyIdPrefix}`);
        return;
      }

      // Delete policy
      const success = await this.policyEngine.deletePolicy(policy.id);

      if (!success) {
        await message.reply('❌ Failed to delete policy. Check logs.');
        return;
      }

      await message.reply({
        embeds: [{
          title: '🗑️ Policy Removed',
          color: 0xff0000,
          fields: [
            { name: 'Rule', value: policy.ruleText },
            { name: 'Action', value: policy.actionType },
          ],
        }],
      });

      logger.info(`Policy removed: ${policy.id} from guild ${message.guild!.id}`);

    } catch (error: any) {
      logger.error('Policy removal error:', error);
      await message.reply('❌ Error removing policy: ' + error.message);
    }
  }

  /**
   * Update existing policy
   * Usage: becas policy update abc12345 action ban
   */
  private async updatePolicy(message: Message, args: string[]): Promise<void> {
    try {
      const policyIdPrefix = args[0];
      const field = args[1]?.toLowerCase();
      const value = args.slice(2).join(' ');

      if (!policyIdPrefix || !field || !value) {
        await message.reply('❌ Usage: `becas policy update [ID] [field] [value]`\n\nFields: action, severity, active');
        return;
      }

      // Find policy
      const policies = await this.policyEngine.getGuildPolicies(message.guild!.id);
      const policy = policies.find(p => p.id.startsWith(policyIdPrefix));

      if (!policy) {
        await message.reply(`❌ Policy not found with ID prefix: ${policyIdPrefix}`);
        return;
      }

      // Update based on field
      const updates: Partial<GuildPolicy> = {};

      switch (field) {
        case 'action':
          if (!['warn', 'timeout', 'ban'].includes(value.toLowerCase())) {
            await message.reply('❌ Action must be: warn, timeout, or ban');
            return;
          }
          updates.actionType = value.toLowerCase() as 'warn' | 'timeout' | 'ban';
          break;

        case 'severity':
          if (!['low', 'medium', 'high'].includes(value.toLowerCase())) {
            await message.reply('❌ Severity must be: low, medium, or high');
            return;
          }
          updates.severity = value.toLowerCase() as 'low' | 'medium' | 'high';
          break;

        case 'active':
          updates.isActive = value.toLowerCase() === 'true';
          break;

        default:
          await message.reply('❌ Unknown field. Available fields: action, severity, active');
          return;
      }

      const success = await this.policyEngine.updatePolicy(policy.id, updates);

      if (!success) {
        await message.reply('❌ Failed to update policy. Check logs.');
        return;
      }

      await message.reply({
        embeds: [{
          title: '✏️ Policy Updated',
          color: 0xffa500,
          fields: [
            { name: 'Rule', value: policy.ruleText },
            { name: 'Updated Field', value: field, inline: true },
            { name: 'New Value', value: value, inline: true },
          ],
        }],
      });

      logger.info(`Policy updated: ${policy.id} in guild ${message.guild!.id}`);

    } catch (error: any) {
      logger.error('Policy update error:', error);
      await message.reply('❌ Error updating policy: ' + error.message);
    }
  }

  /**
   * Show help message
   */
  private async showHelp(message: Message): Promise<void> {
    await message.reply({
      embeds: [{
        title: '📖 Guild Policy Management',
        color: 0x3498db,
        description: 'Manage guild-specific policies (LOCAL enforcement only)',
        fields: [
          {
            name: 'Add Policy',
            value: '`becas policy add "rule" [action] [duration]`\n\nExamples:\n• `becas policy add "No politics" timeout 1h`\n• `becas policy add "No spam" warn`\n• `becas policy add "No NSFW" ban`',
          },
          {
            name: 'List Policies',
            value: '`becas policy list`\n\nShows all active policies for this server',
          },
          {
            name: 'Remove Policy',
            value: '`becas policy remove [ID]`\n\nExample:\n• `becas policy remove abc12345`',
          },
          {
            name: 'Update Policy',
            value: '`becas policy update [ID] [field] [value]`\n\nExample:\n• `becas policy update abc12345 action ban`\n• `becas policy update abc12345 severity high`',
          },
          {
            name: 'Duration Format',
            value: '• `30s` = 30 seconds\n• `10m` = 10 minutes\n• `1h` = 1 hour\n• `2d` = 2 days',
          },
        ],
        footer: {
          text: '⚠️ Guild policies are LOCAL only and do NOT affect global trust scores.',
        },
      }],
    });
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }
}
