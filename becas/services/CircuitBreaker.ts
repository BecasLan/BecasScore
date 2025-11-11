import { createLogger } from './Logger';
import { metricsService } from './MetricsService';

const logger = createLogger('CircuitBreaker');

/**
 * CIRCUIT BREAKER PATTERN
 *
 * Prevents cascading failures when Ollama overloads.
 *
 * States:
 * - CLOSED: Normal operation
 * - OPEN: Failures detected, using fallback
 * - HALF_OPEN: Testing if service recovered
 *
 * This is CRITICAL for production reliability.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening circuit
  successThreshold: number;       // Number of successes to close circuit from HALF_OPEN
  timeout: number;                // Time in ms before trying HALF_OPEN
  monitoringWindow: number;       // Time window for counting failures
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  totalRequests: number;
  totalFailures: number;
  totalFallbacks: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttemptTime: Date | null = null;

  // Stats
  private totalRequests = 0;
  private totalFailures = 0;
  private totalFallbacks = 0;

  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      successThreshold: config?.successThreshold ?? 2,
      timeout: config?.timeout ?? 60000,           // 1 minute default
      monitoringWindow: config?.monitoringWindow ?? 120000, // 2 minutes default
    };

    logger.info(`Circuit breaker initialized: ${name}`, this.config);

    // Initialize circuit breaker state metric
    metricsService.updateCircuitBreakerState(name, 'CLOSED');
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback: () => T | Promise<T>,
    options?: { timeout?: number }
  ): Promise<T> {
    this.totalRequests++;

    // Check if circuit is OPEN
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        logger.info(`[${this.name}] Circuit moving to HALF_OPEN - testing recovery`);
        this.state = 'HALF_OPEN';
        metricsService.updateCircuitBreakerState(this.name, 'HALF_OPEN');
      } else {
        logger.warn(`[${this.name}] Circuit OPEN - using fallback`);
        this.totalFallbacks++;
        return await Promise.resolve(fallback());
      }
    }

    // Try executing the function
    try {
      const timeout = options?.timeout ?? 30000; // 30s default timeout
      const result = await this.executeWithTimeout(fn, timeout);
      this.onSuccess();
      return result;
    } catch (error) {
      logger.error(`[${this.name}] Function execution failed:`, error);
      this.onFailure();
      this.totalFallbacks++;
      return await Promise.resolve(fallback());
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      ),
    ]);
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.lastSuccessTime = new Date();
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        logger.info(`[${this.name}] Circuit CLOSED - service recovered`);
        this.state = 'CLOSED';
        this.successCount = 0;
        metricsService.updateCircuitBreakerState(this.name, 'CLOSED');
      }
    }
  }

  /**
   * Handle failed execution
   */
  private onFailure(): void {
    this.lastFailureTime = new Date();
    this.totalFailures++;
    this.failureCount++;
    this.successCount = 0;

    // Clean up old failures outside monitoring window
    this.cleanupOldFailures();

    if (this.failureCount >= this.config.failureThreshold) {
      if (this.state !== 'OPEN') {
        logger.warn(`[${this.name}] Circuit OPEN - too many failures (${this.failureCount}/${this.config.failureThreshold})`);
        this.state = 'OPEN';
        this.nextAttemptTime = new Date(Date.now() + this.config.timeout);
        metricsService.updateCircuitBreakerState(this.name, 'OPEN');
      }
    }

    if (this.state === 'HALF_OPEN') {
      logger.warn(`[${this.name}] Circuit OPEN - recovery failed`);
      this.state = 'OPEN';
      this.nextAttemptTime = new Date(Date.now() + this.config.timeout);
      metricsService.updateCircuitBreakerState(this.name, 'OPEN');
    }
  }

  /**
   * Clean up failures outside monitoring window
   */
  private cleanupOldFailures(): void {
    if (this.lastFailureTime) {
      const age = Date.now() - this.lastFailureTime.getTime();
      if (age > this.config.monitoringWindow) {
        this.failureCount = 1; // Reset to current failure
      }
    }
  }

  /**
   * Check if we should attempt to reset the circuit
   */
  private shouldAttemptReset(): boolean {
    if (!this.nextAttemptTime) return false;
    return Date.now() >= this.nextAttemptTime.getTime();
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalFallbacks: this.totalFallbacks,
    };
  }

  /**
   * Force reset circuit (for testing/admin)
   */
  reset(): void {
    logger.info(`[${this.name}] Circuit manually reset`);
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = null;
    metricsService.updateCircuitBreakerState(this.name, 'CLOSED');
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }
}
