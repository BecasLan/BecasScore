/**
 * POLICY DISCOVERY ENGINE
 *
 * Automatically scans Discord server rules channel and converts rules to policies.
 * Runs daily via cron job to keep policies in sync with server rules.
 *
 * Features:
 * - Scans #rules or designated rules channel
 * - Extracts rules using AI
 * - Creates structured guild policies in database
 * - Updates existing policies if rules change
 * - Logs all discovery operations
 *
 * CRITICAL: This creates GUILD policies (LOCAL enforcement only).
 * These do NOT affect trust score or cross-guild status.
 */

import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';
import { getDatabaseService } from '../database/DatabaseService';
import { Client, Guild, TextChannel } from 'discord.js';
import * as cron from 'node-cron';

const logger = createLogger('PolicyDiscoveryEngine');

export interface DiscoveredRule {
  ruleText: string;
  aiInterpretation: string;
  category: 'content' | 'behavior' | 'channel_specific';
  severity: 'low' | 'medium' | 'high';
  actionType: 'warn' | 'timeout' | 'ban';
  actionParams: {
    duration?: number; // seconds
    reason?: string;
  };
  sourceChannelId?: string;
  confidence: number;
}

export interface DiscoveryScanResult {
  guildId: string;
  scanType: 'daily' | 'manual' | 'initial';
  rulesFound: number;
  policiesCreated: number;
  policiesUpdated: number;
  status: 'success' | 'failed' | 'partial';
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
}

export class PolicyDiscoveryEngine {
  private ollama: OllamaService;
  private db: ReturnType<typeof getDatabaseService>;
  private client: Client | null = null;
  private cronJob: any | null = null;

  constructor() {
    this.ollama = new OllamaService('policyDiscovery');
    this.db = getDatabaseService();
    logger.info('PolicyDiscoveryEngine initialized');
  }

  /**
   * Initialize with Discord client and start daily cron job
   */
  initialize(client: Client): void {
    this.client = client;
    logger.info('PolicyDiscoveryEngine attached to Discord client');

    // Run daily at 3 AM UTC
    this.cronJob = cron.schedule('0 3 * * *', async () => {
      logger.info('Daily policy discovery scan started');
      await this.scanAllGuilds('daily');
    });

    logger.info('Daily policy discovery cron job scheduled (3 AM UTC)');
  }

  /**
   * Scan all guilds for rule updates (called by cron)
   */
  async scanAllGuilds(scanType: 'daily' | 'manual' = 'daily'): Promise<DiscoveryScanResult[]> {
    if (!this.client) {
      logger.error('Discord client not initialized');
      return [];
    }

    const results: DiscoveryScanResult[] = [];

    for (const guild of this.client.guilds.cache.values()) {
      try {
        const result = await this.scanGuildRules(guild, scanType);
        results.push(result);
      } catch (error: any) {
        logger.error(`Failed to scan guild ${guild.id}:`, error);
        results.push({
          guildId: guild.id,
          scanType,
          rulesFound: 0,
          policiesCreated: 0,
          policiesUpdated: 0,
          status: 'failed',
          errorMessage: error.message,
          startedAt: new Date(),
          completedAt: new Date(),
        });
      }
    }

    return results;
  }

  /**
   * Scan a specific guild's rules channel
   */
  async scanGuildRules(
    guild: Guild,
    scanType: 'daily' | 'manual' | 'initial' = 'manual'
  ): Promise<DiscoveryScanResult> {
    const startedAt = new Date();
    const result: DiscoveryScanResult = {
      guildId: guild.id,
      scanType,
      rulesFound: 0,
      policiesCreated: 0,
      policiesUpdated: 0,
      status: 'success',
      startedAt,
    };

    try {
      // Find rules channel
      const rulesChannel = await this.findRulesChannel(guild);
      if (!rulesChannel) {
        logger.warn(`No rules channel found for guild ${guild.id} (${guild.name})`);
        result.status = 'failed';
        result.errorMessage = 'No rules channel found';
        result.completedAt = new Date();
        await this.logScanResult(result);
        return result;
      }

      // Fetch messages from rules channel (last 100)
      const messages = await rulesChannel.messages.fetch({ limit: 100 });
      const rulesText = messages
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .map(m => m.content)
        .filter(c => c && c.length > 10)
        .join('\n\n');

      if (!rulesText || rulesText.length < 50) {
        logger.warn(`No rules text found in channel ${rulesChannel.id} for guild ${guild.id}`);
        result.status = 'failed';
        result.errorMessage = 'No rules text found in channel';
        result.completedAt = new Date();
        await this.logScanResult(result);
        return result;
      }

      logger.info(`Found ${rulesText.length} chars of rules text for guild ${guild.id}`);

      // Extract rules using AI
      const discoveredRules = await this.extractRulesFromText(rulesText, rulesChannel.id);
      result.rulesFound = discoveredRules.length;

      // Create or update policies in database
      for (const rule of discoveredRules) {
        const existingPolicy = await this.findExistingPolicy(guild.id, rule.ruleText);

        if (existingPolicy) {
          // Update existing policy
          await this.updatePolicy(existingPolicy.id, rule);
          result.policiesUpdated++;
        } else {
          // Create new policy
          await this.createPolicy(guild.id, rule);
          result.policiesCreated++;
        }
      }

      result.completedAt = new Date();
      result.status = 'success';
      logger.info(
        `Policy discovery complete for guild ${guild.id}: ` +
        `${result.rulesFound} rules found, ` +
        `${result.policiesCreated} created, ` +
        `${result.policiesUpdated} updated`
      );

    } catch (error: any) {
      logger.error(`Policy discovery failed for guild ${guild.id}:`, error);
      result.status = 'failed';
      result.errorMessage = error.message;
      result.completedAt = new Date();
    }

    // Log scan result
    await this.logScanResult(result);

    return result;
  }

  /**
   * Find the rules channel in a guild
   */
  private async findRulesChannel(guild: Guild): Promise<TextChannel | null> {
    try {
      const channels = await guild.channels.fetch();

      // Look for common rule channel names
      const ruleChannelNames = ['rules', 'rule', 'server-rules', 'guidelines', 'info'];

      for (const [, channel] of channels) {
        if (!channel || channel.type !== 0) continue; // 0 = GUILD_TEXT

        const textChannel = channel as TextChannel;
        const lowerName = textChannel.name.toLowerCase();

        if (ruleChannelNames.some(name => lowerName.includes(name))) {
          logger.info(`Found rules channel: #${textChannel.name} (${textChannel.id})`);
          return textChannel;
        }
      }

      // If no dedicated rules channel, look for system channel
      if (guild.systemChannel) {
        logger.info(`Using system channel as fallback: #${guild.systemChannel.name}`);
        return guild.systemChannel;
      }

      return null;
    } catch (error: any) {
      logger.error('Error finding rules channel:', error);
      return null;
    }
  }

  /**
   * Extract rules from text using AI
   */
  private async extractRulesFromText(
    rulesText: string,
    channelId: string
  ): Promise<DiscoveredRule[]> {
    try {
      const systemPrompt = `You are a server rules analyzer. Extract all rules from the provided text and convert them to structured policies.

For each rule, provide:
- ruleText: The original rule text
- aiInterpretation: A clear interpretation of what the rule means
- category: "content" (what users can say), "behavior" (how users act), or "channel_specific" (channel rules)
- severity: "low" (minor), "medium" (moderate), or "high" (serious)
- actionType: "warn" (first offense), "timeout" (temporary mute), or "ban" (permanent)
- actionParams: { duration: <seconds for timeout>, reason: "<rule violation>" }
- confidence: 0.0-1.0 (how confident you are this is a rule)

RESPONSE FORMAT (JSON array):
[
  {
    "ruleText": "No spam or flooding",
    "aiInterpretation": "Users should not send repetitive messages or flood channels",
    "category": "behavior",
    "severity": "medium",
    "actionType": "timeout",
    "actionParams": { "duration": 3600, "reason": "Spam/flooding" },
    "confidence": 0.95
  }
]

Only extract clear, enforceable rules. Skip welcome messages, channel descriptions, etc.`;

      const userPrompt = `Extract all rules from this server rules text:\n\n${rulesText}`;

      const response = await this.ollama.generate(userPrompt, systemPrompt, {
        temperature: 0.3,
        maxTokens: 800,
        format: 'json',
      });

      // Parse JSON response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn('No JSON array found in AI response');
        return [];
      }

      const rules = JSON.parse(jsonMatch[0]) as DiscoveredRule[];

      // Filter by confidence (>= 0.7)
      const validRules = rules.filter(r => r.confidence >= 0.7);

      // Add source channel ID
      validRules.forEach(r => {
        r.sourceChannelId = channelId;
      });

      logger.info(`Extracted ${validRules.length} valid rules from text`);
      return validRules;

    } catch (error: any) {
      logger.error('Failed to extract rules from text:', error);
      return [];
    }
  }

  /**
   * Find existing policy by rule text (fuzzy match)
   */
  private async findExistingPolicy(
    guildId: string,
    ruleText: string
  ): Promise<{ id: string } | null> {
    try {
      const result = await this.db.queryOne<{ id: string }>(
        `
        SELECT id FROM guild_policies
        WHERE guild_id = $1
          AND is_active = true
          AND similarity(rule_text, $2) > 0.7
        ORDER BY similarity(rule_text, $2) DESC
        LIMIT 1
      `,
        [guildId, ruleText]
      );

      return result;
    } catch (error: any) {
      // If similarity function doesn't exist, use exact match
      try {
        const result = await this.db.queryOne<{ id: string }>(
          `
          SELECT id FROM guild_policies
          WHERE guild_id = $1
            AND is_active = true
            AND rule_text = $2
          LIMIT 1
        `,
          [guildId, ruleText]
        );
        return result;
      } catch (fallbackError: any) {
        logger.error('Failed to find existing policy:', fallbackError);
        return null;
      }
    }
  }

  /**
   * Create new policy in database
   */
  private async createPolicy(guildId: string, rule: DiscoveredRule): Promise<void> {
    try {
      await this.db.insert('guild_policies', {
        guild_id: guildId,
        rule_text: rule.ruleText,
        ai_interpretation: rule.aiInterpretation,
        category: rule.category,
        action_type: rule.actionType,
        action_params: JSON.stringify(rule.actionParams),
        severity: rule.severity,
        confidence: rule.confidence,
        learned_from: 'server_rules',
        source_channel_id: rule.sourceChannelId || null,
        is_active: true,
      });

      logger.info(`Created new policy: ${rule.ruleText.substring(0, 50)}...`);
    } catch (error: any) {
      logger.error('Failed to create policy:', error);
    }
  }

  /**
   * Update existing policy
   */
  private async updatePolicy(policyId: string, rule: DiscoveredRule): Promise<void> {
    try {
      await this.db.update(
        'guild_policies',
        {
          ai_interpretation: rule.aiInterpretation,
          category: rule.category,
          action_type: rule.actionType,
          action_params: JSON.stringify(rule.actionParams),
          severity: rule.severity,
          confidence: rule.confidence,
          source_channel_id: rule.sourceChannelId || null,
          updated_at: new Date().toISOString(),
        },
        { id: policyId }
      );

      logger.info(`Updated policy ${policyId}`);
    } catch (error: any) {
      logger.error('Failed to update policy:', error);
    }
  }

  /**
   * Log scan result to database
   */
  private async logScanResult(result: DiscoveryScanResult): Promise<void> {
    try {
      await this.db.insert('guild_policy_sync_log', {
        guild_id: result.guildId,
        scan_type: result.scanType,
        rules_found: result.rulesFound,
        policies_created: result.policiesCreated,
        policies_updated: result.policiesUpdated,
        status: result.status,
        error_message: result.errorMessage || null,
        started_at: result.startedAt.toISOString(),
        completed_at: result.completedAt?.toISOString() || null,
      });
    } catch (error: any) {
      logger.error('Failed to log scan result:', error);
    }
  }

  /**
   * Stop the cron job (cleanup)
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Policy discovery cron job stopped');
    }
  }

  /**
   * Manually trigger scan for a specific guild
   */
  async manualScan(guildId: string): Promise<DiscoveryScanResult> {
    if (!this.client) {
      throw new Error('Discord client not initialized');
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Guild ${guildId} not found`);
    }

    return await this.scanGuildRules(guild, 'manual');
  }
}
