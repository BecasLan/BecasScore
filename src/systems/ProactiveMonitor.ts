// ProactiveMonitor.ts - Proactive Pattern Detection & Auto-Action System
// AI actively monitors for patterns instead of just reacting to messages

import { Message, GuildMember, TextChannel, Collection } from 'discord.js';
import { createLogger } from '../services/Logger';
import { ToolUseEngine } from './ToolUseEngine';
import { OllamaService } from '../services/OllamaService';

const logger = createLogger('ProactiveMonitor');

// ============================================
// PROACTIVE RULE DEFINITIONS
// ============================================

export interface ProactiveRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number; // 1-10 (10 = highest)

  // Pattern matching
  keywords?: string[];
  regex?: RegExp;
  messageCount?: {
    threshold: number;
    timeWindow: number; // milliseconds
  };
  userCount?: {
    threshold: number;
    timeWindow: number;
  };

  // Action to take
  autoAction?: {
    actionId: string;
    parameters: Record<string, any>;
  };
  alertModerators?: boolean;
  aiDecision?: boolean; // Let AI decide the action

  // Metadata
  createdBy: string;
  createdAt: Date;
  lastTriggered?: Date;
  triggerCount: number;
}

export interface PatternDetection {
  ruleId: string;
  ruleName: string;
  confidence: number; // 0-1
  evidence: string[];
  affectedMessages: string[];
  affectedUsers: string[];
  shouldTakeAction: boolean;
  recommendedAction?: string;
}

// ============================================
// PROACTIVE MONITOR
// ============================================

export class ProactiveMonitor {
  private rules: Map<string, ProactiveRule> = new Map();
  private messageCache: Map<string, Message[]> = new Map(); // guildId -> recent messages
  private patternCache: Map<string, PatternDetection[]> = new Map(); // guildId -> recent patterns
  private toolUseEngine: ToolUseEngine;
  private ollama: OllamaService;

  private readonly MAX_CACHE_SIZE = 100;
  private readonly CACHE_EXPIRY = 10 * 60 * 1000; // 10 minutes

  // Background monitoring interval
  private monitorInterval?: NodeJS.Timeout;
  private readonly MONITOR_FREQUENCY = 30 * 1000; // 30 seconds

  constructor(toolUseEngine: ToolUseEngine, ollama: OllamaService) {
    this.toolUseEngine = toolUseEngine;
    this.ollama = ollama;
    this.loadDefaultRules();
    logger.info('ProactiveMonitor initialized - AI will actively monitor patterns');
  }

  /**
   * Load default proactive rules
   */
  private loadDefaultRules(): void {
    const defaultRules: ProactiveRule[] = [
      {
        id: 'scam_detection',
        name: 'Scam Link Detection',
        description: 'Detects potential scam messages with crypto/airdrop/free money keywords',
        enabled: true,
        priority: 10,
        keywords: ['crypto', 'airdrop', 'free money', 'click here', 'dm me', 'investment opportunity'],
        autoAction: {
          actionId: 'delete_message',
          parameters: { reason: 'Potential scam detected' },
        },
        alertModerators: true,
        createdBy: 'system',
        createdAt: new Date(),
        triggerCount: 0,
      },
      {
        id: 'raid_detection',
        name: 'Raid Attack Detection',
        description: 'Detects coordinated raid attacks (many users, same message)',
        enabled: true,
        priority: 10,
        userCount: {
          threshold: 5,
          timeWindow: 60 * 1000, // 1 minute
        },
        messageCount: {
          threshold: 10,
          timeWindow: 60 * 1000,
        },
        aiDecision: true, // Let AI decide action (lockdown, mass timeout, etc.)
        alertModerators: true,
        createdBy: 'system',
        createdAt: new Date(),
        triggerCount: 0,
      },
      {
        id: 'spam_pattern',
        name: 'Spam Pattern Detection',
        description: 'Detects users sending same message repeatedly',
        enabled: true,
        priority: 8,
        messageCount: {
          threshold: 5,
          timeWindow: 30 * 1000, // 30 seconds
        },
        autoAction: {
          actionId: 'timeout',
          parameters: { duration: 300000, reason: 'Spam detected' }, // 5 min timeout
        },
        createdBy: 'system',
        createdAt: new Date(),
        triggerCount: 0,
      },
      {
        id: 'mass_mention',
        name: 'Mass Mention Detection',
        description: 'Detects messages with many user mentions (potential harassment)',
        enabled: true,
        priority: 9,
        aiDecision: true,
        alertModerators: true,
        createdBy: 'system',
        createdAt: new Date(),
        triggerCount: 0,
      },
      {
        id: 'toxicity_spike',
        name: 'Toxicity Spike Detection',
        description: 'Detects sudden increase in toxic messages (heated argument)',
        enabled: true,
        priority: 7,
        messageCount: {
          threshold: 3,
          timeWindow: 60 * 1000,
        },
        aiDecision: true, // AI analyzes if intervention needed
        alertModerators: false,
        createdBy: 'system',
        createdAt: new Date(),
        triggerCount: 0,
      },
    ];

    for (const rule of defaultRules) {
      this.rules.set(rule.id, rule);
    }

    logger.info(`Loaded ${defaultRules.length} default proactive rules`);
  }

  /**
   * Add custom rule (from moderators)
   */
  addRule(rule: ProactiveRule): void {
    this.rules.set(rule.id, rule);
    logger.info(`Added custom rule: ${rule.name} (priority: ${rule.priority})`);
  }

  /**
   * Remove rule
   */
  removeRule(ruleId: string): boolean {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      logger.info(`Removed rule: ${ruleId}`);
    }
    return deleted;
  }

  /**
   * Get all rules
   */
  getRules(): ProactiveRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Start background monitoring
   * Periodically analyzes message cache for patterns
   */
  startMonitoring(): void {
    if (this.monitorInterval) {
      logger.warn('Monitoring already started');
      return;
    }

    logger.info(`Starting proactive monitoring (every ${this.MONITOR_FREQUENCY / 1000}s)`);

    this.monitorInterval = setInterval(async () => {
      await this.runPatternAnalysis();
    }, this.MONITOR_FREQUENCY);
  }

  /**
   * Stop background monitoring
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
      logger.info('Stopped proactive monitoring');
    }
  }

  /**
   * Track message for pattern analysis
   */
  trackMessage(message: Message): void {
    if (!message.guild) return;

    const guildId = message.guild.id;

    if (!this.messageCache.has(guildId)) {
      this.messageCache.set(guildId, []);
    }

    const cache = this.messageCache.get(guildId)!;
    cache.push(message);

    // Limit cache size
    if (cache.length > this.MAX_CACHE_SIZE) {
      cache.shift(); // Remove oldest
    }

    // Immediate pattern check for high-priority rules
    this.checkImmediatePatterns(message);
  }

  /**
   * Immediate pattern check (for high-priority rules like scam detection)
   */
  private async checkImmediatePatterns(message: Message): Promise<void> {
    const highPriorityRules = Array.from(this.rules.values())
      .filter(r => r.enabled && r.priority >= 9)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of highPriorityRules) {
      const detection = await this.checkRule(rule, [message]);

      if (detection && detection.shouldTakeAction) {
        logger.warn(`🚨 IMMEDIATE PATTERN DETECTED: ${rule.name} (priority ${rule.priority})`);
        await this.handleDetection(detection, message);
      }
    }
  }

  /**
   * Background pattern analysis (runs periodically)
   */
  private async runPatternAnalysis(): Promise<void> {
    logger.info('Running proactive pattern analysis...');

    for (const [guildId, messages] of this.messageCache.entries()) {
      if (messages.length === 0) continue;

      // Filter recent messages (within cache expiry)
      const now = Date.now();
      const recentMessages = messages.filter(
        m => now - m.createdTimestamp < this.CACHE_EXPIRY
      );

      // Update cache
      this.messageCache.set(guildId, recentMessages);

      // Check all enabled rules
      const enabledRules = Array.from(this.rules.values())
        .filter(r => r.enabled)
        .sort((a, b) => b.priority - a.priority);

      for (const rule of enabledRules) {
        const detection = await this.checkRule(rule, recentMessages);

        if (detection && detection.shouldTakeAction) {
          logger.warn(`🚨 PATTERN DETECTED: ${rule.name} (confidence: ${detection.confidence})`);

          // Use first message as context (could be improved)
          const contextMessage = recentMessages[recentMessages.length - 1];
          await this.handleDetection(detection, contextMessage);

          // Update rule stats
          rule.lastTriggered = new Date();
          rule.triggerCount++;
        }
      }
    }
  }

  /**
   * Check if a rule's pattern is detected
   */
  private async checkRule(rule: ProactiveRule, messages: Message[]): Promise<PatternDetection | null> {
    const evidence: string[] = [];
    const affectedMessages: string[] = [];
    const affectedUsers: string[] = [];
    let confidence = 0;

    // Keyword matching
    if (rule.keywords && rule.keywords.length > 0) {
      for (const message of messages) {
        const content = message.content.toLowerCase();
        const matches = rule.keywords.filter(kw => content.includes(kw.toLowerCase()));

        if (matches.length > 0) {
          evidence.push(`Message contains: ${matches.join(', ')}`);
          affectedMessages.push(message.id);
          affectedUsers.push(message.author.id);
          confidence += 0.3 * (matches.length / rule.keywords.length);
        }
      }
    }

    // Regex matching
    if (rule.regex) {
      for (const message of messages) {
        if (rule.regex.test(message.content)) {
          evidence.push(`Message matches pattern: ${rule.regex.source}`);
          affectedMessages.push(message.id);
          affectedUsers.push(message.author.id);
          confidence += 0.4;
        }
      }
    }

    // Message count threshold
    if (rule.messageCount) {
      const recentMessages = messages.filter(
        m => Date.now() - m.createdTimestamp < rule.messageCount!.timeWindow
      );

      if (recentMessages.length >= rule.messageCount.threshold) {
        evidence.push(`${recentMessages.length} messages in ${rule.messageCount.timeWindow / 1000}s`);
        confidence += 0.3;
      }
    }

    // User count threshold
    if (rule.userCount) {
      const recentMessages = messages.filter(
        m => Date.now() - m.createdTimestamp < rule.userCount!.timeWindow
      );

      const uniqueUsers = new Set(recentMessages.map(m => m.author.id));

      if (uniqueUsers.size >= rule.userCount.threshold) {
        evidence.push(`${uniqueUsers.size} unique users in ${rule.userCount.timeWindow / 1000}s`);
        confidence += 0.4;
      }
    }

    // No pattern detected
    if (confidence < 0.3) {
      return null;
    }

    // Pattern detected!
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      confidence: Math.min(confidence, 1),
      evidence,
      affectedMessages: Array.from(new Set(affectedMessages)),
      affectedUsers: Array.from(new Set(affectedUsers)),
      shouldTakeAction: confidence >= 0.5, // Require 50% confidence
      recommendedAction: rule.autoAction?.actionId,
    };
  }

  /**
   * Handle pattern detection - take action or alert moderators
   */
  private async handleDetection(detection: PatternDetection, contextMessage: Message): Promise<void> {
    const rule = this.rules.get(detection.ruleId);
    if (!rule) return;

    logger.info(`Handling detection: ${rule.name}`);
    logger.info(`Evidence: ${detection.evidence.join('; ')}`);

    // Option 1: Auto-action (if configured)
    if (rule.autoAction && !rule.aiDecision) {
      logger.info(`Auto-action: ${rule.autoAction.actionId}`);

      try {
        const executor = contextMessage.guild!.members.me!;
        await this.toolUseEngine.executeToolCalls(
          contextMessage,
          executor,
          {
            should_use_tools: true,
            reasoning: `Proactive rule triggered: ${rule.name}`,
            tool_calls: [
              {
                tool_name: rule.autoAction.actionId,
                parameters: rule.autoAction.parameters,
                reason: `Pattern detected: ${detection.evidence.join(', ')}`,
              },
            ],
          }
        );
      } catch (error: any) {
        logger.error(`Auto-action failed: ${error.message}`);
      }
    }

    // Option 2: AI Decision (let AI analyze and decide)
    if (rule.aiDecision) {
      logger.info('Requesting AI decision...');

      const aiContext = `
PROACTIVE PATTERN DETECTED: ${rule.name}
Confidence: ${(detection.confidence * 100).toFixed(0)}%
Evidence: ${detection.evidence.join('; ')}
Affected users: ${detection.affectedUsers.length}
Affected messages: ${detection.affectedMessages.length}

Should you take action? If yes, what action?
`;

      try {
        const executor = contextMessage.guild!.members.me!;
        const result = await this.toolUseEngine.processMessage(
          contextMessage,
          executor,
          aiContext
        );

        logger.info(`AI decision: ${result.used_tools ? 'TOOK ACTION' : 'NO ACTION'} - ${result.response}`);
      } catch (error: any) {
        logger.error(`AI decision failed: ${error.message}`);
      }
    }

    // Option 3: Alert moderators (if configured)
    if (rule.alertModerators) {
      logger.info('Alerting moderators (TODO: implement notification channel)');
      // TODO: Send alert to moderator channel
    }
  }

  /**
   * Get detection statistics
   */
  getStats(): {
    total_rules: number;
    enabled_rules: number;
    total_detections: number;
    most_triggered: { ruleId: string; count: number }[];
  } {
    const rules = Array.from(this.rules.values());
    const enabled = rules.filter(r => r.enabled);
    const totalDetections = rules.reduce((sum, r) => sum + r.triggerCount, 0);
    const mostTriggered = rules
      .filter(r => r.triggerCount > 0)
      .sort((a, b) => b.triggerCount - a.triggerCount)
      .slice(0, 5)
      .map(r => ({ ruleId: r.id, count: r.triggerCount }));

    return {
      total_rules: rules.length,
      enabled_rules: enabled.length,
      total_detections: totalDetections,
      most_triggered: mostTriggered,
    };
  }
}
