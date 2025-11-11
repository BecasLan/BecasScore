import { Pool } from 'pg';
import * as cron from 'node-cron';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { QueryParser, QueryContext } from './QueryParser';
import { QueryExecutor } from './QueryExecutor';
import { ResultFormatter } from './ResultFormatter';
import { SavedQueriesManager } from './SavedQueriesManager';
import logger from '../utils/logger';

/**
 * ReportScheduler
 *
 * Automatically runs saved queries on a schedule and sends results to Discord.
 *
 * Features:
 * - Daily, weekly, monthly reports
 * - Cron-based scheduling
 * - Send to channel or DM
 * - Combine multiple queries into one report
 * - Conditional reports (only send if results meet criteria)
 */

export interface ScheduledReport {
  id: string;
  serverId: string;
  createdBy: string;
  name: string;
  description?: string;
  schedule: string; // Cron expression
  queries: string[]; // Saved query IDs
  destination: {
    type: 'channel' | 'dm';
    channelId?: string;
    userId?: string;
  };
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  createdAt: Date;
}

export class ReportScheduler {
  private db: Pool;
  private discordClient: Client;
  private queryParser: QueryParser;
  private queryExecutor: QueryExecutor;
  private resultFormatter: ResultFormatter;
  private savedQueries: SavedQueriesManager;

  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private reports: Map<string, ScheduledReport> = new Map();

  constructor(
    db: Pool,
    discordClient: Client,
    queryParser: QueryParser,
    queryExecutor: QueryExecutor,
    resultFormatter: ResultFormatter,
    savedQueries: SavedQueriesManager
  ) {
    this.db = db;
    this.discordClient = discordClient;
    this.queryParser = queryParser;
    this.queryExecutor = queryExecutor;
    this.resultFormatter = resultFormatter;
    this.savedQueries = savedQueries;
  }

  /**
   * Initialize database and load scheduled reports
   */
  async initialize(): Promise<void> {
    await this.createTables();
    await this.loadReports();
    logger.info('ReportScheduler initialized');
  }

  /**
   * Create scheduled reports table
   */
  private async createTables(): Promise<void> {
    const createScheduledReportsTable = `
      CREATE TABLE IF NOT EXISTS scheduled_reports (
        id VARCHAR(255) PRIMARY KEY,
        server_id VARCHAR(255) NOT NULL,
        created_by VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        schedule VARCHAR(100) NOT NULL,
        queries JSONB NOT NULL,
        destination JSONB NOT NULL,
        enabled BOOLEAN DEFAULT true,
        last_run TIMESTAMP,
        next_run TIMESTAMP,
        run_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_server_reports (server_id, enabled)
      );
    `;

    await this.db.query(createScheduledReportsTable);
    logger.info('Scheduled reports table created');
  }

  /**
   * Create a new scheduled report
   */
  async createReport(
    serverId: string,
    userId: string,
    name: string,
    schedule: string,
    queries: string[],
    destination: { type: 'channel' | 'dm'; channelId?: string; userId?: string },
    options?: { description?: string }
  ): Promise<ScheduledReport> {
    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error('Invalid cron schedule expression');
    }

    const id = `report-${serverId}-${Date.now()}`;

    const query = `
      INSERT INTO scheduled_reports
      (id, server_id, created_by, name, description, schedule, queries, destination, enabled, run_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await this.db.query(query, [
      id,
      serverId,
      userId,
      name,
      options?.description || null,
      schedule,
      JSON.stringify(queries),
      JSON.stringify(destination),
      true,
      0
    ]);

    const report = this.rowToReport(result.rows[0]);
    this.reports.set(id, report);

    // Schedule the job
    this.scheduleJob(report);

    logger.info(`Created scheduled report "${name}" (${id})`);

    return report;
  }

  /**
   * Load all scheduled reports from database
   */
  private async loadReports(): Promise<void> {
    const query = 'SELECT * FROM scheduled_reports WHERE enabled = true';
    const result = await this.db.query(query);

    for (const row of result.rows) {
      const report = this.rowToReport(row);
      this.reports.set(report.id, report);
      this.scheduleJob(report);
    }

    logger.info(`Loaded ${this.reports.size} scheduled reports`);
  }

  /**
   * Schedule a cron job for a report
   */
  private scheduleJob(report: ScheduledReport): void {
    if (!report.enabled) return;

    try {
      const task = cron.schedule(report.schedule, async () => {
        await this.runReport(report.id);
      });

      this.scheduledJobs.set(report.id, task);
      logger.info(`Scheduled report "${report.name}" with cron: ${report.schedule}`);

    } catch (error) {
      logger.error(`Failed to schedule report ${report.id}:`, error);
    }
  }

  /**
   * Run a scheduled report
   */
  async runReport(reportId: string): Promise<void> {
    const report = this.reports.get(reportId);
    if (!report) {
      logger.error(`Report not found: ${reportId}`);
      return;
    }

    logger.info(`Running scheduled report: ${report.name}`);

    try {
      // Execute all queries
      const results: { question: string; result: any; formatted: any }[] = [];

      for (const queryId of report.queries) {
        const savedQuery = await this.savedQueries.getQuery(queryId, report.serverId);
        if (!savedQuery) {
          logger.warn(`Saved query not found: ${queryId}`);
          continue;
        }

        // Parse and execute
        const context: QueryContext = {
          serverId: report.serverId,
          userId: report.createdBy,
          userRole: 'moderator',
          language: 'en'
        };

        const parsedQuery = await this.queryParser.parseQuery(savedQuery.question, context);
        const executionResult = await this.queryExecutor.executeQuery(
          parsedQuery,
          report.serverId,
          report.createdBy,
          savedQuery.question
        );

        const formatted = this.resultFormatter.format(executionResult, parsedQuery, savedQuery.name);

        results.push({
          question: savedQuery.name,
          result: executionResult,
          formatted
        });

        // Increment saved query usage
        await this.savedQueries.incrementUsage(queryId);
      }

      // Create combined report
      const reportEmbed = this.createReportEmbed(report, results);

      // Send to destination
      await this.sendReport(report, reportEmbed);

      // Update last run
      await this.updateLastRun(reportId);

      logger.info(`Successfully ran report: ${report.name}`);

    } catch (error) {
      logger.error(`Failed to run report ${reportId}:`, error);
    }
  }

  /**
   * Create report embed
   */
  private createReportEmbed(report: ScheduledReport, results: any[]): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${report.name}`)
      .setDescription(report.description || 'Scheduled Report')
      .setColor(0x00AE86)
      .setTimestamp();

    // Add results
    for (const { question, result, formatted } of results) {
      if (result.success && result.rowCount > 0) {
        let value = '';

        if (result.rowCount === 1) {
          // Single row - show as key: value
          const row = result.rows[0];
          const keys = Object.keys(row);
          value = keys.map(k => `**${k}:** ${row[k]}`).join('\n');
        } else {
          // Multiple rows - show count
          value = `${result.rowCount} results`;
        }

        embed.addFields({
          name: question,
          value: value.substring(0, 1024), // Discord limit
          inline: false
        });
      } else if (!result.success) {
        embed.addFields({
          name: question,
          value: `❌ Error: ${result.error}`,
          inline: false
        });
      } else {
        embed.addFields({
          name: question,
          value: 'No results',
          inline: false
        });
      }
    }

    embed.setFooter({ text: `Report ID: ${report.id}` });

    return embed;
  }

  /**
   * Send report to destination
   */
  private async sendReport(report: ScheduledReport, embed: EmbedBuilder): Promise<void> {
    try {
      if (report.destination.type === 'channel' && report.destination.channelId) {
        const channel = await this.discordClient.channels.fetch(report.destination.channelId);
        if (channel instanceof TextChannel) {
          await channel.send({ embeds: [embed] });
        }
      } else if (report.destination.type === 'dm' && report.destination.userId) {
        const user = await this.discordClient.users.fetch(report.destination.userId);
        await user.send({ embeds: [embed] });
      }
    } catch (error) {
      logger.error(`Failed to send report ${report.id}:`, error);
    }
  }

  /**
   * Update last run timestamp
   */
  private async updateLastRun(reportId: string): Promise<void> {
    const query = `
      UPDATE scheduled_reports
      SET last_run = CURRENT_TIMESTAMP,
          run_count = run_count + 1
      WHERE id = $1
    `;

    await this.db.query(query, [reportId]);

    // Update in-memory
    const report = this.reports.get(reportId);
    if (report) {
      report.lastRun = new Date();
      report.runCount++;
    }
  }

  /**
   * Get all reports for a server
   */
  async getServerReports(serverId: string): Promise<ScheduledReport[]> {
    const query = 'SELECT * FROM scheduled_reports WHERE server_id = $1 ORDER BY created_at DESC';
    const result = await this.db.query(query, [serverId]);

    return result.rows.map(row => this.rowToReport(row));
  }

  /**
   * Get report by ID
   */
  async getReport(reportId: string): Promise<ScheduledReport | null> {
    return this.reports.get(reportId) || null;
  }

  /**
   * Enable/disable report
   */
  async setReportEnabled(reportId: string, enabled: boolean): Promise<void> {
    const query = 'UPDATE scheduled_reports SET enabled = $1 WHERE id = $2';
    await this.db.query(query, [enabled, reportId]);

    const report = this.reports.get(reportId);
    if (report) {
      report.enabled = enabled;

      if (enabled) {
        this.scheduleJob(report);
      } else {
        const job = this.scheduledJobs.get(reportId);
        if (job) {
          job.stop();
          this.scheduledJobs.delete(reportId);
        }
      }
    }

    logger.info(`Report ${reportId} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Delete report
   */
  async deleteReport(reportId: string): Promise<boolean> {
    // Stop scheduled job
    const job = this.scheduledJobs.get(reportId);
    if (job) {
      job.stop();
      this.scheduledJobs.delete(reportId);
    }

    // Remove from memory
    this.reports.delete(reportId);

    // Delete from database
    const query = 'DELETE FROM scheduled_reports WHERE id = $1';
    const result = await this.db.query(query, [reportId]);

    logger.info(`Deleted report ${reportId}`);

    return (result.rowCount || 0) > 0;
  }

  /**
   * Convert database row to ScheduledReport
   */
  private rowToReport(row: any): ScheduledReport {
    return {
      id: row.id,
      serverId: row.server_id,
      createdBy: row.created_by,
      name: row.name,
      description: row.description,
      schedule: row.schedule,
      queries: JSON.parse(row.queries),
      destination: JSON.parse(row.destination),
      enabled: row.enabled,
      lastRun: row.last_run ? new Date(row.last_run) : undefined,
      nextRun: row.next_run ? new Date(row.next_run) : undefined,
      runCount: row.run_count,
      createdAt: new Date(row.created_at)
    };
  }

  /**
   * Get common cron schedules
   */
  static getCommonSchedules(): { name: string; cron: string; description: string }[] {
    return [
      { name: 'Daily at 9 AM', cron: '0 9 * * *', description: 'Runs every day at 9:00 AM' },
      { name: 'Weekly on Monday', cron: '0 9 * * 1', description: 'Runs every Monday at 9:00 AM' },
      { name: 'Monthly on 1st', cron: '0 9 1 * *', description: 'Runs on the 1st of each month at 9:00 AM' },
      { name: 'Every Hour', cron: '0 * * * *', description: 'Runs at the start of every hour' },
      { name: 'Every 6 Hours', cron: '0 */6 * * *', description: 'Runs every 6 hours' },
      { name: 'Weekdays at 5 PM', cron: '0 17 * * 1-5', description: 'Runs Monday-Friday at 5:00 PM' }
    ];
  }
}

/**
 * Example usage:
 *
 * const scheduler = new ReportScheduler(
 *   db,
 *   discordClient,
 *   queryParser,
 *   queryExecutor,
 *   resultFormatter,
 *   savedQueries
 * );
 *
 * await scheduler.initialize();
 *
 * // Create a daily report
 * const report = await scheduler.createReport(
 *   serverId,
 *   userId,
 *   'Daily Moderation Summary',
 *   '0 9 * * *', // 9 AM daily
 *   [savedQuery1.id, savedQuery2.id],
 *   { type: 'channel', channelId: '123456789' },
 *   { description: 'Daily summary of bans, warnings, and violations' }
 * );
 *
 * // Run report manually
 * await scheduler.runReport(report.id);
 *
 * // Disable report
 * await scheduler.setReportEnabled(report.id, false);
 *
 * // Delete report
 * await scheduler.deleteReport(report.id);
 */
