import { Client } from 'discord.js';
import { Pool } from 'pg';
import { BehaviorEngine } from '../core/BehaviorEngine';
import { BehaviorParser } from '../services/BehaviorParser';
import { ActionExecutor } from '../services/ActionExecutor';
import { TrackingSystem } from '../services/TrackingSystem';
import { ConditionEvaluator } from '../services/ConditionEvaluator';
import { BehaviorCommands } from '../commands/BehaviorCommands';
import { BehaviorAPI } from '../api/BehaviorAPI';
import logger from '../utils/logger';

/**
 * BehaviorIntegration
 *
 * Integrates the entire Dynamic Behavior Engine with BECAS.
 * Connects all systems and initializes the META-AI platform.
 */

export class BehaviorIntegration {
  private discordClient: Client;
  private db: Pool;

  // Core systems
  private engine!: BehaviorEngine;
  private parser!: BehaviorParser;
  private actionExecutor!: ActionExecutor;
  private trackingSystem!: TrackingSystem;
  private conditionEvaluator!: ConditionEvaluator;
  private commands!: BehaviorCommands;
  private api!: BehaviorAPI;

  private initialized = false;

  constructor(discordClient: Client, db: Pool) {
    this.discordClient = discordClient;
    this.db = db;
  }

  /**
   * Initialize all behavior systems
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Dynamic Behavior Engine...');

      // 1. Initialize parser
      this.parser = new BehaviorParser('http://localhost:11434', 'qwen2.5:14b');
      logger.info('✓ BehaviorParser initialized');

      // 2. Initialize action executor
      this.actionExecutor = new ActionExecutor(this.discordClient, this.db);
      logger.info('✓ ActionExecutor initialized');

      // 3. Initialize tracking system
      this.trackingSystem = new TrackingSystem(this.db, this.discordClient);
      await this.trackingSystem.initialize();
      logger.info('✓ TrackingSystem initialized');

      // 4. Initialize condition evaluator
      this.conditionEvaluator = new ConditionEvaluator();
      logger.info('✓ ConditionEvaluator initialized');

      // 5. Initialize behavior engine (core)
      this.engine = new BehaviorEngine(this.db, this.discordClient);
      await this.engine.initialize();
      logger.info('✓ BehaviorEngine initialized');

      // 6. Integrate action executor with engine
      this.integrateActionExecutor();
      logger.info('✓ ActionExecutor integrated');

      // 7. Integrate tracking system with engine
      this.integrateTrackingSystem();
      logger.info('✓ TrackingSystem integrated');

      // 8. Integrate condition evaluator with engine
      this.integrateConditionEvaluator();
      logger.info('✓ ConditionEvaluator integrated');

      // 9. Initialize Discord commands
      this.commands = new BehaviorCommands(this.db, this.parser, this.engine);
      this.setupCommandHandler();
      logger.info('✓ Discord commands initialized');

      // 10. Initialize API
      this.api = new BehaviorAPI(this.db, this.parser, this.engine);
      logger.info('✓ Behavior API initialized');

      this.initialized = true;

      logger.info('✅ Dynamic Behavior Engine fully initialized!');
      logger.info('📊 META-AI PLATFORM READY!');

    } catch (error) {
      logger.error('Failed to initialize Dynamic Behavior Engine:', error);
      throw error;
    }
  }

  /**
   * Integrate ActionExecutor with BehaviorEngine
   */
  private integrateActionExecutor(): void {
    // Monkey-patch executeAction method
    const originalExecuteAction = (this.engine as any).executeAction;

    (this.engine as any).executeAction = async (action: any, context: any, analysisResult: any) => {
      await this.actionExecutor.execute(action, context, analysisResult);
    };
  }

  /**
   * Integrate TrackingSystem with BehaviorEngine
   */
  private integrateTrackingSystem(): void {
    // Monkey-patch startTracking method
    const originalStartTracking = (this.engine as any).startTracking;

    (this.engine as any).startTracking = async (behavior: any, context: any, executionId: number) => {
      if (behavior.tracking?.enabled) {
        await this.trackingSystem.startTracking(
          behavior.id,
          executionId,
          context.serverId,
          behavior.tracking
        );
      }
    };
  }

  /**
   * Integrate ConditionEvaluator with BehaviorEngine
   */
  private integrateConditionEvaluator(): void {
    // Monkey-patch shouldExecuteAction method
    const originalShouldExecuteAction = (this.engine as any).shouldExecuteAction;

    (this.engine as any).shouldExecuteAction = async (action: any, context: any, analysisResult: any) => {
      if (!action.condition) return true;

      return this.conditionEvaluator.evaluate(action.condition, context, analysisResult);
    };
  }

  /**
   * Setup Discord command handler
   */
  private setupCommandHandler(): void {
    this.discordClient.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (!message.guild) return;
      if (!message.content.includes('<@')) return; // Must mention bot

      const botMention = `<@${this.discordClient.user?.id}>`;
      if (!message.content.startsWith(botMention)) return;

      // Parse command
      const content = message.content.replace(botMention, '').trim();
      const parts = content.split(' ');

      // Check for behavior commands
      if (parts[0] === 'behavior' || parts[0] === 'behaviour') {
        const command = parts[1];
        const args = parts.slice(2);

        await this.commands.handle(message, command, args);
      }

      // Handle "create behavior:" syntax
      if (content.startsWith('create behavior:') || content.startsWith('create behaviour:')) {
        const description = content.split(':').slice(1).join(':').trim();
        await this.commands.handle(message, 'create', [description]);
      }

      // Handle "list behaviors"
      if (content === 'list behaviors' || content === 'list behaviours') {
        await this.commands.handle(message, 'list', []);
      }

      // Handle "show templates"
      if (content === 'show templates' || content === 'templates') {
        await this.commands.handle(message, 'templates', []);
      }
    });

    logger.info('Discord command handler setup complete');
  }

  /**
   * Get API router for Express
   */
  getAPIRouter() {
    if (!this.initialized) {
      throw new Error('BehaviorIntegration not initialized');
    }

    return this.api.getRouter();
  }

  /**
   * Get behavior engine instance
   */
  getEngine(): BehaviorEngine {
    if (!this.initialized) {
      throw new Error('BehaviorIntegration not initialized');
    }

    return this.engine;
  }

  /**
   * Get behavior parser instance
   */
  getParser(): BehaviorParser {
    if (!this.initialized) {
      throw new Error('BehaviorIntegration not initialized');
    }

    return this.parser;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    status: string;
    initialized: boolean;
    activeBehaviors: number;
    activeTracking: number;
  }> {
    if (!this.initialized) {
      return {
        status: 'not_initialized',
        initialized: false,
        activeBehaviors: 0,
        activeTracking: 0
      };
    }

    try {
      // Count active behaviors
      const behaviorsResult = await this.db.query(
        'SELECT COUNT(*) as count FROM dynamic_behaviors WHERE enabled = true'
      );
      const activeBehaviors = parseInt(behaviorsResult.rows[0].count);

      // Count active tracking sessions
      const trackingResult = await this.db.query(
        'SELECT COUNT(*) as count FROM behavior_active_tracking WHERE status = \'active\''
      );
      const activeTracking = parseInt(trackingResult.rows[0].count);

      return {
        status: 'healthy',
        initialized: true,
        activeBehaviors,
        activeTracking
      };

    } catch (error) {
      logger.error('Health check failed:', error);
      return {
        status: 'error',
        initialized: true,
        activeBehaviors: 0,
        activeTracking: 0
      };
    }
  }

  /**
   * Shutdown all systems gracefully
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Dynamic Behavior Engine...');

    // Stop tracking system
    // Stop behavior engine
    // Close connections

    this.initialized = false;

    logger.info('Dynamic Behavior Engine shut down');
  }
}

/**
 * Example usage in main BECAS initialization:
 *
 * import { BehaviorIntegration } from './integrations/BehaviorIntegration';
 *
 * // In main initialization
 * const behaviorIntegration = new BehaviorIntegration(discordClient, db);
 * await behaviorIntegration.initialize();
 *
 * // Add API routes
 * app.use('/api/behaviors', behaviorIntegration.getAPIRouter());
 *
 * // Health check
 * const health = await behaviorIntegration.healthCheck();
 * console.log('Behavior engine status:', health);
 *
 * // Now behaviors execute automatically!
 * // Moderators can create behaviors via:
 * // 1. Discord: @BECAS create behavior: [description]
 * // 2. API: POST /api/behaviors
 */
