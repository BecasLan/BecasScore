/**
 * BECAS DATABASE INTEGRATION
 *
 * Main integration layer between BecasCore and Database
 * Handles all database operations for core systems
 */

import { Message } from 'discord.js';
import { AnalyzedMessage } from '../types/Message.types';
import {
  UserRepository,
  ServerRepository,
  SicilRepository,
  ThreatRepository,
  MessageRepository
} from './repositories';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { UserMonitorDB } from '../monitoring/UserMonitorDB';
import { createLogger } from '../services/Logger';
import { TaskManager } from '../advanced/TaskManager';

const logger = createLogger('BecasDatabaseIntegration');

export class BecasDatabaseIntegration {
  // Repositories
  public userRepo: UserRepository;
  public serverRepo: ServerRepository;
  public sicilRepo: SicilRepository;
  public threatRepo: ThreatRepository;
  public messageRepo: MessageRepository;

  // Database-backed engines
  public trustEngine: TrustScoreEngineDB;
  public userMonitor: UserMonitorDB;

  constructor(taskManager: TaskManager) {
    // Initialize repositories
    this.userRepo = new UserRepository();
    this.serverRepo = new ServerRepository();
    this.sicilRepo = new SicilRepository();
    this.threatRepo = new ThreatRepository();
    this.messageRepo = new MessageRepository();

    // Initialize database-backed engines
    this.trustEngine = new TrustScoreEngineDB();
    this.userMonitor = new UserMonitorDB(taskManager);

    logger.info('✓ BECAS Database Integration initialized');
    logger.info('  ✓ 5 Repositories loaded');
    logger.info('  ✓ TrustScoreEngine (DB)');
    logger.info('  ✓ UserMonitor (DB)');
  }

  /**
   * Process Discord message - store and analyze
   */
  async processDiscordMessage(message: Message, analyzed: AnalyzedMessage): Promise<void> {
    // PostgreSQL is dead - skip all database logging for normal messages
    // Trust scores work from memory, website pulls from Supabase
    // Only violations will be saved to Supabase (handled in processModerationAction)
    logger.debug(`Skipping database logging for message from ${message.author.username} (PostgreSQL disabled, trust in memory)`);
  }

  /**
   * Process moderation action
   */
  async processModerationAction(
    serverId: string,
    userId: string,
    action: 'warn' | 'timeout' | 'kick' | 'ban',
    reason: string,
    moderatorId?: string
  ): Promise<void> {
    try {
      // 1. Increment violation in sicil (with built-in Supabase fallback)
      try {
        await this.sicilRepo.incrementViolation(
          serverId,
          userId,
          action === 'warn' ? 'warning' : action,
          this.categorizeThreat(reason)
        );
        logger.debug(`✓ Sicil violation incremented for ${userId}`);
      } catch (error: any) {
        logger.error(`Failed to increment sicil violation: ${error.message}`);
        // Continue - non-critical
      }

      // 2. Increment violation in server member
      try {
        await this.userRepo.incrementViolation(serverId, userId, `${action}s` as any);
        logger.debug(`✓ User violation incremented for ${userId}`);
      } catch (error: any) {
        logger.error(`Failed to increment user violation: ${error.message}`);
        // Continue - non-critical
      }

      // 3. Log the action
      try {
        await this.sicilRepo.logAction({
          server_id: serverId,
          user_id: userId,
          action_type: `moderation_${action}`,
          content: reason,
          triggered_moderation: true,
          moderation_action: action,
          moderator_id: moderatorId
        });
        logger.debug(`✓ Action logged for ${userId}`);
      } catch (error: any) {
        logger.error(`Failed to log action: ${error.message}`);
        // Continue - non-critical
      }

      // 4. Increment server moderation count
      try {
        await this.serverRepo.incrementModerationCount(serverId);
        await this.serverRepo.incrementViolationCount(serverId);
        logger.debug(`✓ Server counts incremented`);
      } catch (error: any) {
        logger.error(`Failed to increment server counts: ${error.message}`);
        // Continue - non-critical
      }

      logger.info(`✅ Moderation action recorded: ${action} for ${userId} in ${serverId}`);
    } catch (error) {
      logger.error('Failed to process moderation action', error);
      // Don't throw - we don't want to break the bot's moderation flow
    }
  }

  /**
   * Process threat detection
   */
  async processThreatDetection(
    serverId: string,
    userId: string,
    messageId: string,
    channelId: string,
    threatType: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    confidence: number,
    evidence: string,
    indicators: string[]
  ): Promise<void> {
    try {
      // 1. Create threat record
      const threat = await this.threatRepo.createThreat({
        server_id: serverId,
        user_id: userId,
        channel_id: channelId,
        message_id: messageId,
        threat_type: threatType,
        severity: severity,
        confidence: confidence,
        evidence_content: evidence,
        detection_method: 'ai_analysis',
        indicators: indicators
      });

      // 2. If critical threat, report globally
      if (severity === 'critical' && confidence >= 90) {
        await this.threatRepo.reportGlobalThreat(
          userId,
          serverId,
          threatType,
          evidence
        );
      }

      logger.warn(`Threat detected: ${threatType} (${severity}) for ${userId}`);
    } catch (error) {
      logger.error('Failed to process threat detection', error);
    }
  }

  /**
   * Get user analytics
   */
  async getUserAnalytics(serverId: string, userId: string): Promise<{
    trustScore: number;
    totalMessages: number;
    totalViolations: number;
    riskCategory: string;
    cleanStreak: number;
    recentActions: number;
  }> {
    try {
      const member = await this.userRepo.getServerMember(serverId, userId);
      const sicil = await this.sicilRepo.getSicilSummary(serverId, userId);

      return {
        trustScore: member?.trust_score || 50,
        totalMessages: member?.total_messages || 0,
        totalViolations: (sicil.total_warnings + sicil.total_timeouts + sicil.total_kicks + sicil.total_bans) || 0,
        riskCategory: sicil.risk_category || 'safe',
        cleanStreak: sicil.clean_streak_days || 0,
        recentActions: 0 // Would need separate query
      };
    } catch (error) {
      logger.error('Failed to get user analytics', error);
      return {
        trustScore: 50,
        totalMessages: 0,
        totalViolations: 0,
        riskCategory: 'safe',
        cleanStreak: 0,
        recentActions: 0
      };
    }
  }

  /**
   * Helper: Categorize threat from reason
   */
  private categorizeThreat(reason: string): 'scam' | 'phishing' | 'toxicity' | 'spam' | 'harassment' | undefined {
    const lower = reason.toLowerCase();
    if (lower.includes('scam')) return 'scam';
    if (lower.includes('phish')) return 'phishing';
    if (lower.includes('toxic')) return 'toxicity';
    if (lower.includes('spam')) return 'spam';
    if (lower.includes('harass')) return 'harassment';
    return undefined;
  }
}
