/**
 * A/B TESTING FRAMEWORK - Test Algorithm Improvements
 *
 * Tests new algorithms against current ones to ensure improvements:
 * - Split users into test groups (A vs B)
 * - Run different algorithms on each group
 * - Track which gets fewer overrides
 * - Auto-promote winning algorithm
 *
 * Use Cases:
 * - Test new severity calculation
 * - Test adjusted confidence thresholds
 * - Test improved context awareness
 * - Test different trust score formulas
 */

import { Pool } from 'pg';
import { FeedbackCollector } from './FeedbackCollector';
import { createLogger } from './Logger';

const logger = createLogger('ABTesting');

export interface ABTest {
  id: string;
  serverId: string;
  name: string;
  description: string;

  // Test Configuration
  variantA: {
    name: string; // e.g., "Current Algorithm"
    config: any;  // Algorithm configuration
  };
  variantB: {
    name: string; // e.g., "New Severity Calculation"
    config: any;
  };

  // User Assignment
  splitPercentage: number; // % of users in variant B (default: 50%)
  userAssignments: Map<string, 'A' | 'B'>; // userId → variant

  // Metrics
  metrics: {
    variantA: TestMetrics;
    variantB: TestMetrics;
  };

  // Status
  status: 'draft' | 'running' | 'completed' | 'cancelled';
  startDate?: Date;
  endDate?: Date;
  winner?: 'A' | 'B' | 'tie';

  // Auto-promotion
  autoPromote: boolean; // Automatically promote winner
  minSampleSize: number; // Minimum decisions before declaring winner

  createdAt: Date;
}

export interface TestMetrics {
  totalDecisions: number;
  overrides: number;       // Moderator chose different action
  corrections: number;     // Moderator reversed action
  confirmations: number;   // Moderator agreed
  falsePositives: number;
  falseNegatives: number;
  avgConfidence: number;
  overrideRate: number;    // % (lower is better)
  accuracy: number;        // % (higher is better)
}

export class ABTesting {
  private activeTests: Map<string, ABTest> = new Map(); // testId → test

  constructor(
    private pool: Pool,
    private feedbackCollector: FeedbackCollector
  ) {
    logger.info('ABTesting initialized');
    this.createTables();
    this.loadActiveTests();
  }

  /**
   * Create A/B testing tables
   */
  private async createTables(): Promise<void> {
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ab_tests (
          id VARCHAR(255) PRIMARY KEY,
          server_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,

          variant_a_name VARCHAR(255),
          variant_a_config JSONB,

          variant_b_name VARCHAR(255),
          variant_b_config JSONB,

          split_percentage INTEGER DEFAULT 50,
          user_assignments JSONB,

          metrics_a JSONB,
          metrics_b JSONB,

          status VARCHAR(20) DEFAULT 'draft',
          start_date TIMESTAMP,
          end_date TIMESTAMP,
          winner VARCHAR(10),

          auto_promote BOOLEAN DEFAULT FALSE,
          min_sample_size INTEGER DEFAULT 100,

          created_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS ab_test_events (
          id SERIAL PRIMARY KEY,
          test_id VARCHAR(255) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          variant VARCHAR(1) NOT NULL,
          decision_type VARCHAR(50),
          becas_action VARCHAR(50),
          moderator_action VARCHAR(50),
          was_correct BOOLEAN,
          timestamp TIMESTAMP DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_ab_tests_server ON ab_tests(server_id);
        CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
        CREATE INDEX IF NOT EXISTS idx_ab_events_test ON ab_test_events(test_id);
      `);

      logger.info('A/B testing tables created/verified');
    } catch (error) {
      logger.error('Failed to create A/B testing tables', error);
    }
  }

  /**
   * Load active tests from database
   */
  private async loadActiveTests(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM ab_tests
        WHERE status = 'running'
      `);

      for (const row of result.rows) {
        const test = this.rowToTest(row);
        this.activeTests.set(test.id, test);
      }

      logger.info(`Loaded ${this.activeTests.size} active A/B tests`);
    } catch (error) {
      logger.error('Failed to load active tests', error);
    }
  }

  /**
   * Create new A/B test
   */
  async createTest(
    serverId: string,
    name: string,
    description: string,
    variantA: { name: string; config: any },
    variantB: { name: string; config: any },
    options?: {
      splitPercentage?: number;
      autoPromote?: boolean;
      minSampleSize?: number;
    }
  ): Promise<ABTest> {
    const test: ABTest = {
      id: this.generateId(),
      serverId,
      name,
      description,
      variantA,
      variantB,
      splitPercentage: options?.splitPercentage || 50,
      userAssignments: new Map(),
      metrics: {
        variantA: this.getEmptyMetrics(),
        variantB: this.getEmptyMetrics(),
      },
      status: 'draft',
      autoPromote: options?.autoPromote || false,
      minSampleSize: options?.minSampleSize || 100,
      createdAt: new Date(),
    };

    await this.saveTest(test);

    logger.info(`Created A/B test: ${name} (${variantA.name} vs ${variantB.name})`);

    return test;
  }

  /**
   * Start A/B test
   */
  async startTest(testId: string): Promise<void> {
    const test = this.activeTests.get(testId) || await this.getTest(testId);
    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    test.status = 'running';
    test.startDate = new Date();

    this.activeTests.set(testId, test);
    await this.saveTest(test);

    logger.info(`Started A/B test: ${test.name}`);
  }

  /**
   * Get variant for user (assigns if not assigned)
   */
  getVariantForUser(testId: string, userId: string): 'A' | 'B' | null {
    const test = this.activeTests.get(testId);
    if (!test || test.status !== 'running') {
      return null;
    }

    // Check if already assigned
    if (test.userAssignments.has(userId)) {
      return test.userAssignments.get(userId)!;
    }

    // Assign variant (deterministic based on userId hash)
    const hash = this.hashString(userId);
    const variant = (hash % 100) < test.splitPercentage ? 'B' : 'A';

    test.userAssignments.set(userId, variant);

    // Save assignment asynchronously
    this.saveTest(test).catch(err => logger.error('Failed to save test assignment', err));

    return variant;
  }

  /**
   * Record test event (decision made)
   */
  async recordEvent(
    testId: string,
    userId: string,
    variant: 'A' | 'B',
    decisionType: 'decision' | 'override' | 'correction' | 'confirmation',
    becasAction: string,
    moderatorAction?: string,
    wasCorrect?: boolean
  ): Promise<void> {
    const test = this.activeTests.get(testId);
    if (!test) return;

    // Update metrics
    const metrics = variant === 'A' ? test.metrics.variantA : test.metrics.variantB;

    metrics.totalDecisions++;

    if (decisionType === 'override') metrics.overrides++;
    if (decisionType === 'correction') metrics.corrections++;
    if (decisionType === 'confirmation') metrics.confirmations++;

    if (wasCorrect === false) {
      if (moderatorAction && moderatorAction !== 'none') {
        metrics.falseNegatives++; // BECAS missed a threat
      } else {
        metrics.falsePositives++; // BECAS flagged incorrectly
      }
    }

    // Recalculate rates
    metrics.overrideRate = (metrics.overrides / metrics.totalDecisions) * 100;
    metrics.accuracy = ((metrics.confirmations + (metrics.totalDecisions - metrics.overrides - metrics.corrections)) / metrics.totalDecisions) * 100;

    // Store event
    try {
      await this.pool.query(`
        INSERT INTO ab_test_events (
          test_id, user_id, variant, decision_type,
          becas_action, moderator_action, was_correct
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [testId, userId, variant, decisionType, becasAction, moderatorAction, wasCorrect]);
    } catch (error) {
      logger.error('Failed to record A/B test event', error);
    }

    // Save updated metrics
    await this.saveTest(test);

    // Check if test should end
    await this.checkTestCompletion(test);
  }

  /**
   * Check if test has enough data to declare winner
   */
  private async checkTestCompletion(test: ABTest): Promise<void> {
    const metricsA = test.metrics.variantA;
    const metricsB = test.metrics.variantB;

    // Need minimum sample size in BOTH variants
    if (metricsA.totalDecisions < test.minSampleSize || metricsB.totalDecisions < test.minSampleSize) {
      return;
    }

    // Calculate statistical significance (simplified)
    const overrideRateDiff = Math.abs(metricsA.overrideRate - metricsB.overrideRate);

    // If difference is < 5%, it's a tie
    if (overrideRateDiff < 5) {
      test.winner = 'tie';
      logger.info(`A/B test ${test.name}: TIE (difference < 5%)`);
    } else if (metricsB.overrideRate < metricsA.overrideRate) {
      test.winner = 'B';
      logger.info(`A/B test ${test.name}: WINNER is B (override rate: ${metricsB.overrideRate.toFixed(1)}% vs ${metricsA.overrideRate.toFixed(1)}%)`);
    } else {
      test.winner = 'A';
      logger.info(`A/B test ${test.name}: WINNER is A (override rate: ${metricsA.overrideRate.toFixed(1)}% vs ${metricsB.overrideRate.toFixed(1)}%)`);
    }

    // End test
    test.status = 'completed';
    test.endDate = new Date();

    await this.saveTest(test);
    this.activeTests.delete(test.id);

    // Auto-promote winner
    if (test.autoPromote && test.winner === 'B') {
      await this.promoteVariant(test, 'B');
    }
  }

  /**
   * Promote winning variant to production
   */
  private async promoteVariant(test: ABTest, variant: 'A' | 'B'): Promise<void> {
    const config = variant === 'A' ? test.variantA.config : test.variantB.config;

    // TODO: Apply config to production
    // This would update the server's learning profile or algorithm parameters

    logger.info(`✅ Promoted variant ${variant} to production for server ${test.serverId}`);
  }

  /**
   * Get test results
   */
  async getTestResults(testId: string): Promise<{
    test: ABTest;
    comparison: {
      metric: string;
      variantA: number;
      variantB: number;
      difference: number;
      winner: 'A' | 'B' | 'tie';
    }[];
    recommendation: string;
  } | null> {
    const test = await this.getTest(testId);
    if (!test) return null;

    const metricsA = test.metrics.variantA;
    const metricsB = test.metrics.variantB;

    const comparison: Array<{ metric: string; variantA: number; variantB: number; difference: number; winner: 'A' | 'B' | 'tie' }> = [
      {
        metric: 'Override Rate',
        variantA: metricsA.overrideRate,
        variantB: metricsB.overrideRate,
        difference: metricsB.overrideRate - metricsA.overrideRate,
        winner: (metricsB.overrideRate < metricsA.overrideRate ? 'B' : (metricsB.overrideRate > metricsA.overrideRate ? 'A' : 'tie')) as 'A' | 'B' | 'tie',
      },
      {
        metric: 'Accuracy',
        variantA: metricsA.accuracy,
        variantB: metricsB.accuracy,
        difference: metricsB.accuracy - metricsA.accuracy,
        winner: (metricsB.accuracy > metricsA.accuracy ? 'B' : (metricsB.accuracy < metricsA.accuracy ? 'A' : 'tie')) as 'A' | 'B' | 'tie',
      },
      {
        metric: 'False Positives',
        variantA: metricsA.falsePositives,
        variantB: metricsB.falsePositives,
        difference: metricsB.falsePositives - metricsA.falsePositives,
        winner: (metricsB.falsePositives < metricsA.falsePositives ? 'B' : (metricsB.falsePositives > metricsA.falsePositives ? 'A' : 'tie')) as 'A' | 'B' | 'tie',
      },
    ];

    // Generate recommendation
    let recommendation = '';
    if (test.winner === 'B') {
      recommendation = `Variant B (${test.variantB.name}) is the clear winner with ${metricsB.overrideRate.toFixed(1)}% override rate vs ${metricsA.overrideRate.toFixed(1)}%. Recommend promoting to production.`;
    } else if (test.winner === 'A') {
      recommendation = `Variant A (${test.variantA.name}) performs better. Keep current algorithm.`;
    } else {
      recommendation = `Results are too close to call. Consider longer test or larger sample size.`;
    }

    return {
      test,
      comparison,
      recommendation,
    };
  }

  /**
   * Get all tests for server
   */
  async getServerTests(serverId: string): Promise<ABTest[]> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM ab_tests
        WHERE server_id = $1
        ORDER BY created_at DESC
      `, [serverId]);

      return result.rows.map(row => this.rowToTest(row));
    } catch (error) {
      logger.error('Failed to get server tests', error);
      return [];
    }
  }

  /**
   * Get test by ID
   */
  private async getTest(testId: string): Promise<ABTest | null> {
    try {
      const result = await this.pool.query(`
        SELECT * FROM ab_tests WHERE id = $1
      `, [testId]);

      if (result.rows.length === 0) return null;

      return this.rowToTest(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get test', error);
      return null;
    }
  }

  /**
   * Save test to database
   */
  private async saveTest(test: ABTest): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO ab_tests (
          id, server_id, name, description,
          variant_a_name, variant_a_config,
          variant_b_name, variant_b_config,
          split_percentage, user_assignments,
          metrics_a, metrics_b,
          status, start_date, end_date, winner,
          auto_promote, min_sample_size
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET
          status = $13,
          start_date = $14,
          end_date = $15,
          winner = $16,
          user_assignments = $10,
          metrics_a = $11,
          metrics_b = $12
      `, [
        test.id,
        test.serverId,
        test.name,
        test.description,
        test.variantA.name,
        JSON.stringify(test.variantA.config),
        test.variantB.name,
        JSON.stringify(test.variantB.config),
        test.splitPercentage,
        JSON.stringify(Array.from(test.userAssignments.entries())),
        JSON.stringify(test.metrics.variantA),
        JSON.stringify(test.metrics.variantB),
        test.status,
        test.startDate,
        test.endDate,
        test.winner,
        test.autoPromote,
        test.minSampleSize,
      ]);
    } catch (error) {
      logger.error('Failed to save test', error);
    }
  }

  /**
   * Convert database row to ABTest
   */
  private rowToTest(row: any): ABTest {
    const userAssignments = new Map<string, 'A' | 'B'>();
    if (row.user_assignments) {
      const entries = JSON.parse(row.user_assignments);
      entries.forEach(([userId, variant]: [string, 'A' | 'B']) => {
        userAssignments.set(userId, variant);
      });
    }

    return {
      id: row.id,
      serverId: row.server_id,
      name: row.name,
      description: row.description,
      variantA: {
        name: row.variant_a_name,
        config: row.variant_a_config,
      },
      variantB: {
        name: row.variant_b_name,
        config: row.variant_b_config,
      },
      splitPercentage: row.split_percentage,
      userAssignments,
      metrics: {
        variantA: row.metrics_a || this.getEmptyMetrics(),
        variantB: row.metrics_b || this.getEmptyMetrics(),
      },
      status: row.status,
      startDate: row.start_date ? new Date(row.start_date) : undefined,
      endDate: row.end_date ? new Date(row.end_date) : undefined,
      winner: row.winner,
      autoPromote: row.auto_promote,
      minSampleSize: row.min_sample_size,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Get empty metrics object
   */
  private getEmptyMetrics(): TestMetrics {
    return {
      totalDecisions: 0,
      overrides: 0,
      corrections: 0,
      confirmations: 0,
      falsePositives: 0,
      falseNegatives: 0,
      avgConfidence: 0,
      overrideRate: 0,
      accuracy: 0,
    };
  }

  /**
   * Hash string to number (deterministic)
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cancel test
   */
  async cancelTest(testId: string): Promise<void> {
    const test = await this.getTest(testId);
    if (!test) return;

    test.status = 'cancelled';
    test.endDate = new Date();

    await this.saveTest(test);
    this.activeTests.delete(testId);

    logger.info(`Cancelled A/B test: ${test.name}`);
  }
}
