// WorkflowManager.ts - Manage workflow templates, queries, and scheduling
// Features: Save templates, natural language queries, scheduled workflows

import { Guild, Message } from 'discord.js';
import { StorageService } from '../services/StorageService';
import { WatchSystem, WatchConfig } from './WatchSystem';
import { WorkflowParser, WorkflowCommand } from './WorkflowParser';
import { OllamaService } from '../services/OllamaService';
import { createLogger } from '../services/Logger';

const logger = createLogger('WorkflowManager');

// ============================================
// WORKFLOW TEMPLATE
// ============================================

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  author: string;
  guildId: string;
  createdAt: Date;
  usageCount: number;

  // Template configuration
  config: {
    duration_hours: number;
    filter?: any;
    conditions: any[];
    actions: any[];
    escalation?: any;
    announceChannel?: string;
  };

  // Template variables (can be customized when used)
  variables?: {
    name: string;
    defaultValue: any;
    description: string;
  }[];
}

// ============================================
// SCHEDULED WORKFLOW
// ============================================

export interface ScheduledWorkflow {
  id: string;
  guildId: string;
  createdBy: string;

  // Schedule configuration
  schedule: {
    type: 'once' | 'daily' | 'weekly' | 'cron';
    time?: string; // HH:MM format
    dayOfWeek?: number; // 0-6 (Sunday-Saturday)
    cronExpression?: string;
    nextRun: Date;
  };

  // Workflow to execute
  workflowCommand: string;
  active: boolean;
}

// ============================================
// WORKFLOW MANAGER
// ============================================

export class WorkflowManager {
  private storage: StorageService;
  private watchSystem: WatchSystem;
  private workflowParser: WorkflowParser;
  private ollama: OllamaService;

  private templates: Map<string, WorkflowTemplate> = new Map();
  private scheduledWorkflows: Map<string, ScheduledWorkflow> = new Map();
  private scheduleInterval: NodeJS.Timeout;

  constructor(
    storage: StorageService,
    watchSystem: WatchSystem,
    workflowParser: WorkflowParser,
    ollama: OllamaService
  ) {
    this.storage = storage;
    this.watchSystem = watchSystem;
    this.workflowParser = workflowParser;
    this.ollama = ollama;

    // Check scheduled workflows every minute
    this.scheduleInterval = setInterval(() => this.checkSchedules(), 60000);

    logger.info('WorkflowManager initialized');
  }

  /**
   * 🔥 FEATURE #15: Save workflow as template
   */
  async saveTemplate(
    name: string,
    description: string,
    watchConfig: WatchConfig,
    author: string,
    guildId: string
  ): Promise<string> {
    const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const template: WorkflowTemplate = {
      id: templateId,
      name,
      description,
      author,
      guildId,
      createdAt: new Date(),
      usageCount: 0,
      config: {
        duration_hours: (watchConfig.expiresAt.getTime() - watchConfig.createdAt.getTime()) / (1000 * 60 * 60),
        filter: watchConfig.filter,
        conditions: watchConfig.conditions,
        actions: watchConfig.actions,
        escalation: watchConfig.escalation,
        announceChannel: watchConfig.announceChannel
      }
    };

    this.templates.set(templateId, template);
    await this.storage.write('workflows', `template_${templateId}`, template);

    logger.info(`Saved workflow template: ${name} (${templateId})`);
    return templateId;
  }

  /**
   * 🔥 FEATURE #15: Load and use template
   */
  async useTemplate(templateId: string, message: Message): Promise<string | null> {
    const template = this.templates.get(templateId);
    if (!template) {
      logger.warn(`Template not found: ${templateId}`);
      return null;
    }

    template.usageCount++;
    await this.storage.write('workflows', `template_${templateId}`, template);

    // Create watch from template
    const expiresAt = new Date(Date.now() + template.config.duration_hours * 60 * 60 * 1000);

    const watchId = await this.watchSystem.createWatch({
      guildId: message.guild!.id,
      createdBy: message.author.id,
      expiresAt,
      userIds: [],
      filter: template.config.filter,
      conditions: template.config.conditions,
      actions: template.config.actions,
      escalation: template.config.escalation,
      announceChannel: template.config.announceChannel
    });

    logger.info(`Used template ${template.name} to create watch ${watchId}`);
    return watchId;
  }

  /**
   * 🔥 FEATURE #19: Natural language query for watches
   */
  async queryWatches(query: string, guildId: string): Promise<string> {
    const activeWatches = this.watchSystem.getActiveWatches(guildId);

    // Build context about active watches
    const watchesContext = activeWatches.map(w => ({
      id: w.id,
      created: w.createdAt.toISOString(),
      expires: w.expiresAt.toISOString(),
      userCount: w.userIds.length || 'filtered',
      filter: w.filter,
      conditions: w.conditions.map(c => c.type),
      actions: w.actions.map(a => a.action_id),
      triggerCount: w.triggerCount,
      escalation: w.escalation?.enabled ? 'yes' : 'no'
    }));

    const prompt = `You are a workflow query assistant. Answer this question about active watches:

QUERY: "${query}"

ACTIVE WATCHES:
${JSON.stringify(watchesContext, null, 2)}

Provide a natural, conversational answer about the watches. Be specific and helpful.`;

    try {
      const response = await this.ollama.generate(prompt, 'You are a helpful assistant.');
      return response;
    } catch (error) {
      logger.error('Query failed:', error);
      return `Error processing query: ${error}`;
    }
  }

  /**
   * 🔥 FEATURE #20: Schedule a workflow
   */
  async scheduleWorkflow(
    guildId: string,
    createdBy: string,
    workflowCommand: string,
    schedule: ScheduledWorkflow['schedule']
  ): Promise<string> {
    const scheduleId = `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const scheduled: ScheduledWorkflow = {
      id: scheduleId,
      guildId,
      createdBy,
      schedule: {
        ...schedule,
        nextRun: this.calculateNextRun(schedule)
      },
      workflowCommand,
      active: true
    };

    this.scheduledWorkflows.set(scheduleId, scheduled);
    await this.storage.write('workflows', `schedule_${scheduleId}`, scheduled);

    logger.info(`Scheduled workflow: ${scheduleId} - next run at ${scheduled.schedule.nextRun}`);
    return scheduleId;
  }

  /**
   * Check and execute scheduled workflows
   */
  private async checkSchedules(): Promise<void> {
    const now = new Date();

    for (const [id, scheduled] of this.scheduledWorkflows.entries()) {
      if (!scheduled.active) continue;

      if (scheduled.schedule.nextRun <= now) {
        logger.info(`Executing scheduled workflow: ${id}`);

        // TODO: Execute the workflow command
        // This would require access to a Message context or creating a synthetic one

        // Calculate next run
        scheduled.schedule.nextRun = this.calculateNextRun(scheduled.schedule);
        await this.storage.write('workflows', `schedule_${id}`, scheduled);

        logger.info(`Next run scheduled for: ${scheduled.schedule.nextRun}`);
      }
    }
  }

  /**
   * Calculate next run time for a schedule
   */
  private calculateNextRun(schedule: ScheduledWorkflow['schedule']): Date {
    const now = new Date();

    switch (schedule.type) {
      case 'once':
        return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // Far future

      case 'daily':
        const [hours, minutes] = schedule.time!.split(':').map(Number);
        const next = new Date(now);
        next.setHours(hours, minutes, 0, 0);

        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }

        return next;

      case 'weekly':
        const targetDay = schedule.dayOfWeek!;
        const currentDay = now.getDay();
        let daysUntilTarget = targetDay - currentDay;

        if (daysUntilTarget <= 0) {
          daysUntilTarget += 7;
        }

        const [wh, wm] = schedule.time!.split(':').map(Number);
        const nextWeekly = new Date(now);
        nextWeekly.setDate(now.getDate() + daysUntilTarget);
        nextWeekly.setHours(wh, wm, 0, 0);

        return nextWeekly;

      case 'cron':
        // Simplified cron - just add 1 hour for now
        return new Date(now.getTime() + 60 * 60 * 1000);

      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Get all templates for a guild
   */
  getTemplates(guildId: string): WorkflowTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.guildId === guildId);
  }

  /**
   * Get all scheduled workflows for a guild
   */
  getScheduledWorkflows(guildId: string): ScheduledWorkflow[] {
    return Array.from(this.scheduledWorkflows.values()).filter(s => s.guildId === guildId);
  }

  /**
   * Cancel scheduled workflow
   */
  async cancelSchedule(scheduleId: string): Promise<boolean> {
    const scheduled = this.scheduledWorkflows.get(scheduleId);
    if (!scheduled) return false;

    scheduled.active = false;
    await this.storage.write('workflows', `schedule_${scheduleId}`, scheduled);

    logger.info(`Cancelled scheduled workflow: ${scheduleId}`);
    return true;
  }

  /**
   * Shutdown
   */
  shutdown(): void {
    clearInterval(this.scheduleInterval);
    logger.info('WorkflowManager shutdown');
  }
}
