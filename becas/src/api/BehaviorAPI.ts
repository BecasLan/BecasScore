import express, { Request, Response, Router } from 'express';
import { Pool } from 'pg';
import { BehaviorParser, BDLBehavior } from '../services/BehaviorParser';
import { BehaviorTemplates } from '../templates/BehaviorTemplates';
import { BehaviorEngine } from '../core/BehaviorEngine';
import logger from '../utils/logger';

/**
 * BehaviorAPI
 *
 * REST API for managing dynamic behaviors.
 * Allows creating, updating, deleting behaviors via HTTP.
 */

export class BehaviorAPI {
  private router: Router;
  private db: Pool;
  private parser: BehaviorParser;
  private engine: BehaviorEngine;

  constructor(db: Pool, parser: BehaviorParser, engine: BehaviorEngine) {
    this.router = express.Router();
    this.db = db;
    this.parser = parser;
    this.engine = engine;

    this.setupRoutes();
  }

  /**
   * Setup all API routes
   */
  private setupRoutes(): void {
    // Behaviors CRUD
    this.router.post('/behaviors', this.createBehavior.bind(this));
    this.router.get('/behaviors/:serverId', this.getBehaviors.bind(this));
    this.router.get('/behaviors/:serverId/:behaviorId', this.getBehavior.bind(this));
    this.router.put('/behaviors/:behaviorId', this.updateBehavior.bind(this));
    this.router.delete('/behaviors/:behaviorId', this.deleteBehavior.bind(this));

    // Enable/Disable
    this.router.post('/behaviors/:behaviorId/enable', this.enableBehavior.bind(this));
    this.router.post('/behaviors/:behaviorId/disable', this.disableBehavior.bind(this));

    // Executions
    this.router.get('/behaviors/:behaviorId/executions', this.getExecutions.bind(this));

    // Templates
    this.router.get('/templates', this.getTemplates.bind(this));
    this.router.get('/templates/:templateId', this.getTemplate.bind(this));
    this.router.post('/templates/:templateId/instantiate', this.instantiateTemplate.bind(this));

    // Statistics
    this.router.get('/stats/:serverId', this.getStats.bind(this));
  }

  /**
   * POST /api/behaviors
   * Create behavior from natural language or BDL
   */
  private async createBehavior(req: Request, res: Response): Promise<void> {
    try {
      const { serverId, userId, description, bdl } = req.body;

      if (!serverId || !userId) {
        res.status(400).json({ error: 'serverId and userId required' });
        return;
      }

      let behavior: BDLBehavior;

      if (bdl) {
        // BDL provided directly
        behavior = bdl;
      } else if (description) {
        // Parse natural language
        behavior = await this.parser.parse(description, serverId);
      } else {
        res.status(400).json({ error: 'Either description or bdl required' });
        return;
      }

      // Generate ID
      const id = `behavior-${serverId}-${Date.now()}`;
      behavior.id = id;

      // Save to database
      const query = `
        INSERT INTO dynamic_behaviors
        (id, server_id, created_by, name, description, enabled, trigger, tracking, analysis, actions, safety)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      await this.db.query(query, [
        id,
        serverId,
        userId,
        behavior.name,
        behavior.description,
        behavior.enabled,
        JSON.stringify(behavior.trigger),
        behavior.tracking ? JSON.stringify(behavior.tracking) : null,
        behavior.analysis ? JSON.stringify(behavior.analysis) : null,
        JSON.stringify(behavior.actions),
        JSON.stringify(behavior.safety)
      ]);

      // Reload behaviors in engine
      await this.engine.reload();

      logger.info(`Created behavior: ${behavior.name} (${id})`);

      res.json({
        success: true,
        behavior,
        message: `Behavior "${behavior.name}" created successfully`
      });

    } catch (error) {
      logger.error('Error creating behavior:', error);
      res.status(500).json({
        error: 'Failed to create behavior',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * GET /api/behaviors/:serverId
   * Get all behaviors for a server
   */
  private async getBehaviors(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const { enabled } = req.query;

      let query = 'SELECT * FROM dynamic_behaviors WHERE server_id = $1';
      const params: any[] = [serverId];

      if (enabled !== undefined) {
        query += ' AND enabled = $2';
        params.push(enabled === 'true');
      }

      query += ' ORDER BY created_at DESC';

      const result = await this.db.query(query, params);

      const behaviors = result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        trigger: row.trigger,
        tracking: row.tracking,
        analysis: row.analysis,
        actions: row.actions,
        safety: row.safety,
        executionCount: row.execution_count,
        lastExecuted: row.last_executed,
        errorCount: row.error_count,
        createdAt: row.created_at
      }));

      res.json({ behaviors });

    } catch (error) {
      logger.error('Error getting behaviors:', error);
      res.status(500).json({ error: 'Failed to get behaviors' });
    }
  }

  /**
   * GET /api/behaviors/:serverId/:behaviorId
   * Get single behavior
   */
  private async getBehavior(req: Request, res: Response): Promise<void> {
    try {
      const { behaviorId } = req.params;

      const query = 'SELECT * FROM dynamic_behaviors WHERE id = $1';
      const result = await this.db.query(query, [behaviorId]);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Behavior not found' });
        return;
      }

      const row = result.rows[0];
      const behavior = {
        id: row.id,
        name: row.name,
        description: row.description,
        enabled: row.enabled,
        trigger: row.trigger,
        tracking: row.tracking,
        analysis: row.analysis,
        actions: row.actions,
        safety: row.safety,
        executionCount: row.execution_count,
        lastExecuted: row.last_executed,
        errorCount: row.error_count,
        createdAt: row.created_at
      };

      res.json({ behavior });

    } catch (error) {
      logger.error('Error getting behavior:', error);
      res.status(500).json({ error: 'Failed to get behavior' });
    }
  }

  /**
   * PUT /api/behaviors/:behaviorId
   * Update behavior
   */
  private async updateBehavior(req: Request, res: Response): Promise<void> {
    try {
      const { behaviorId } = req.params;
      const updates = req.body;

      const fields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.name) {
        fields.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }

      if (updates.description) {
        fields.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }

      if (updates.trigger) {
        fields.push(`trigger = $${paramIndex++}`);
        values.push(JSON.stringify(updates.trigger));
      }

      if (updates.actions) {
        fields.push(`actions = $${paramIndex++}`);
        values.push(JSON.stringify(updates.actions));
      }

      if (fields.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(behaviorId);

      const query = `
        UPDATE dynamic_behaviors
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const result = await this.db.query(query, values);

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Behavior not found' });
        return;
      }

      await this.engine.reload();

      logger.info(`Updated behavior ${behaviorId}`);

      res.json({
        success: true,
        message: 'Behavior updated successfully'
      });

    } catch (error) {
      logger.error('Error updating behavior:', error);
      res.status(500).json({ error: 'Failed to update behavior' });
    }
  }

  /**
   * DELETE /api/behaviors/:behaviorId
   * Delete behavior
   */
  private async deleteBehavior(req: Request, res: Response): Promise<void> {
    try {
      const { behaviorId } = req.params;

      const query = 'DELETE FROM dynamic_behaviors WHERE id = $1';
      const result = await this.db.query(query, [behaviorId]);

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Behavior not found' });
        return;
      }

      await this.engine.reload();

      logger.info(`Deleted behavior ${behaviorId}`);

      res.json({
        success: true,
        message: 'Behavior deleted successfully'
      });

    } catch (error) {
      logger.error('Error deleting behavior:', error);
      res.status(500).json({ error: 'Failed to delete behavior' });
    }
  }

  /**
   * POST /api/behaviors/:behaviorId/enable
   * Enable behavior
   */
  private async enableBehavior(req: Request, res: Response): Promise<void> {
    await this.toggleBehavior(req, res, true);
  }

  /**
   * POST /api/behaviors/:behaviorId/disable
   * Disable behavior
   */
  private async disableBehavior(req: Request, res: Response): Promise<void> {
    await this.toggleBehavior(req, res, false);
  }

  /**
   * Toggle behavior enabled state
   */
  private async toggleBehavior(req: Request, res: Response, enabled: boolean): Promise<void> {
    try {
      const { behaviorId } = req.params;

      const query = `
        UPDATE dynamic_behaviors
        SET enabled = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `;

      const result = await this.db.query(query, [enabled, behaviorId]);

      if (result.rowCount === 0) {
        res.status(404).json({ error: 'Behavior not found' });
        return;
      }

      await this.engine.reload();

      logger.info(`${enabled ? 'Enabled' : 'Disabled'} behavior ${behaviorId}`);

      res.json({
        success: true,
        message: `Behavior ${enabled ? 'enabled' : 'disabled'} successfully`
      });

    } catch (error) {
      logger.error('Error toggling behavior:', error);
      res.status(500).json({ error: 'Failed to toggle behavior' });
    }
  }

  /**
   * GET /api/behaviors/:behaviorId/executions
   * Get execution history
   */
  private async getExecutions(req: Request, res: Response): Promise<void> {
    try {
      const { behaviorId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      const query = `
        SELECT * FROM behavior_executions
        WHERE behavior_id = $1
        ORDER BY started_at DESC
        LIMIT $2
      `;

      const result = await this.db.query(query, [behaviorId, limit]);

      const executions = result.rows.map(row => ({
        id: row.id,
        triggeredBy: row.triggered_by,
        triggerEvent: row.trigger_event,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        status: row.status,
        actionsExecuted: row.actions_executed,
        analysisResult: row.analysis_result,
        error: row.error,
        executionTimeMs: row.execution_time_ms
      }));

      res.json({ executions });

    } catch (error) {
      logger.error('Error getting executions:', error);
      res.status(500).json({ error: 'Failed to get executions' });
    }
  }

  /**
   * GET /api/templates
   * Get all templates
   */
  private getTemplates(req: Request, res: Response): void {
    const { category, difficulty, tag } = req.query;

    let templates = BehaviorTemplates.getAll();

    if (category) {
      templates = BehaviorTemplates.getByCategory(category as string);
    }

    if (difficulty) {
      templates = BehaviorTemplates.getByDifficulty(difficulty as any);
    }

    if (tag) {
      templates = BehaviorTemplates.searchByTag(tag as string);
    }

    res.json({
      templates,
      categories: BehaviorTemplates.getCategories(),
      tags: BehaviorTemplates.getAllTags()
    });
  }

  /**
   * GET /api/templates/:templateId
   * Get single template
   */
  private getTemplate(req: Request, res: Response): void {
    const { templateId } = req.params;

    const template = BehaviorTemplates.getById(templateId);

    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }

    res.json({ template });
  }

  /**
   * POST /api/templates/:templateId/instantiate
   * Create behavior from template
   */
  private async instantiateTemplate(req: Request, res: Response): Promise<void> {
    try {
      const { templateId } = req.params;
      const { serverId, userId, placeholders } = req.body;

      if (!serverId || !userId) {
        res.status(400).json({ error: 'serverId and userId required' });
        return;
      }

      const bdl = BehaviorTemplates.instantiate(templateId, placeholders || {});
      bdl.id = `behavior-${serverId}-${Date.now()}`;

      // Save to database
      const query = `
        INSERT INTO dynamic_behaviors
        (id, server_id, created_by, name, description, enabled, trigger, tracking, analysis, actions, safety)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      await this.db.query(query, [
        bdl.id,
        serverId,
        userId,
        bdl.name,
        bdl.description,
        bdl.enabled,
        JSON.stringify(bdl.trigger),
        bdl.tracking ? JSON.stringify(bdl.tracking) : null,
        bdl.analysis ? JSON.stringify(bdl.analysis) : null,
        JSON.stringify(bdl.actions),
        JSON.stringify(bdl.safety)
      ]);

      await this.engine.reload();

      logger.info(`Created behavior from template ${templateId}`);

      res.json({
        success: true,
        behavior: bdl,
        message: 'Behavior created from template'
      });

    } catch (error) {
      logger.error('Error instantiating template:', error);
      res.status(500).json({ error: 'Failed to instantiate template' });
    }
  }

  /**
   * GET /api/stats/:serverId
   * Get behavior statistics
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const { serverId } = req.params;
      const days = parseInt(req.query.days as string) || 7;

      const result = await this.db.query('SELECT * FROM get_behavior_stats($1, $2)', [serverId, days]);

      res.json(result.rows[0]);

    } catch (error) {
      logger.error('Error getting stats:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  }

  /**
   * Get Express router
   */
  getRouter(): Router {
    return this.router;
  }
}
