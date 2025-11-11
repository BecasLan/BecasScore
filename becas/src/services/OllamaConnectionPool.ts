import axios, { AxiosInstance } from 'axios';
import { createLogger } from './Logger';

const logger = createLogger('OllamaConnectionPool');

export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

interface ConnectionPoolConfig {
  baseURL: string;
  maxConnections: number;
  connectionTimeout: number;
  requestTimeout: number;
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

interface RetryConfig {
  maxRetries: number;
  currentRetry: number;
  delay: number;
}

export class OllamaConnectionPool {
  private config: ConnectionPoolConfig;
  private connections: AxiosInstance[];
  private availableConnections: AxiosInstance[] = [];
  private activeConnections: Set<AxiosInstance> = new Set();

  // Circuit breaker
  private circuitState: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private successCount: number = 0;

  // Metrics
  private totalRequests: number = 0;
  private successfulRequests: number = 0;
  private failedRequests: number = 0;
  private totalRetries: number = 0;

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    this.config = {
      baseURL: config.baseURL || 'http://localhost:11434',
      maxConnections: config.maxConnections || 1, // SERIAL: Only 1 connection to prevent Ollama crash
      connectionTimeout: config.connectionTimeout || 30000, // 30 seconds to establish connection
      requestTimeout: config.requestTimeout || 180000, // 3 MINUTES for qwen3:8b deep thinking
      maxRetries: config.maxRetries || 2, // 2 retries for stability
      retryDelay: config.retryDelay || 3000, // 3 second delay between retries
      circuitBreakerThreshold: config.circuitBreakerThreshold || 10,
      circuitBreakerTimeout: config.circuitBreakerTimeout || 60000,
    };

    // Initialize connection pool
    this.connections = [];
    for (let i = 0; i < this.config.maxConnections; i++) {
      const connection = axios.create({
        baseURL: this.config.baseURL,
        timeout: this.config.requestTimeout,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      this.connections.push(connection);
      this.availableConnections.push(connection);
    }

    logger.info(`Connection pool initialized with ${this.config.maxConnections} connections`);
  }

  /**
   * Get available connection from pool
   */
  private async acquireConnection(): Promise<AxiosInstance> {
    // Check circuit breaker
    if (this.circuitState === CircuitState.OPEN) {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime > this.config.circuitBreakerTimeout) {
        logger.info('Circuit breaker: Transitioning to HALF_OPEN');
        this.circuitState = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    // Wait for available connection
    while (this.availableConnections.length === 0) {
      logger.debug('Waiting for available connection...');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const connection = this.availableConnections.pop()!;
    this.activeConnections.add(connection);
    return connection;
  }

  /**
   * Release connection back to pool
   */
  private releaseConnection(connection: AxiosInstance): void {
    this.activeConnections.delete(connection);
    this.availableConnections.push(connection);
  }

  /**
   * Execute request with retry logic
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryConfig: RetryConfig
  ): Promise<T> {
    try {
      const result = await operation();

      // Success - update circuit breaker
      this.recordSuccess();
      return result;
    } catch (error) {
      // Record failure
      this.recordFailure();

      // Check if we should retry
      if (retryConfig.currentRetry < retryConfig.maxRetries) {
        const delay = retryConfig.delay * Math.pow(2, retryConfig.currentRetry); // Exponential backoff
        logger.warn(`Request failed, retrying in ${delay}ms (attempt ${retryConfig.currentRetry + 1}/${retryConfig.maxRetries})`);

        this.totalRetries++;
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.executeWithRetry(operation, {
          ...retryConfig,
          currentRetry: retryConfig.currentRetry + 1,
        });
      }

      // Max retries exceeded
      logger.error('Max retries exceeded', error);
      throw error;
    }
  }

  /**
   * Record successful request
   */
  private recordSuccess(): void {
    this.successfulRequests++;

    if (this.circuitState === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 3) {
        logger.info('Circuit breaker: Transitioning to CLOSED');
        this.circuitState = CircuitState.CLOSED;
        this.failureCount = 0;
      }
    }
  }

  /**
   * Record failed request
   */
  private recordFailure(): void {
    this.failedRequests++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.circuitState === CircuitState.HALF_OPEN) {
      logger.warn('Circuit breaker: Request failed in HALF_OPEN, transitioning to OPEN');
      this.circuitState = CircuitState.OPEN;
      return;
    }

    if (this.failureCount >= this.config.circuitBreakerThreshold) {
      logger.error(`Circuit breaker: Threshold reached (${this.failureCount} failures), transitioning to OPEN`);
      this.circuitState = CircuitState.OPEN;
    }
  }

  /**
   * Make POST request with connection pooling and retry
   */
  async post<T = any>(path: string, data: any): Promise<T> {
    this.totalRequests++;
    const startTime = Date.now();

    const connection = await this.acquireConnection();

    try {
      const result = await this.executeWithRetry(
        async () => {
          const response = await connection.post(path, data);
          return response.data as T;
        },
        {
          maxRetries: this.config.maxRetries,
          currentRetry: 0,
          delay: this.config.retryDelay,
        }
      );

      const duration = Date.now() - startTime;
      logger.http(`POST ${path} - Success (${duration}ms)`);

      return result;
    } finally {
      this.releaseConnection(connection);
    }
  }

  /**
   * Make GET request with connection pooling and retry
   */
  async get<T = any>(path: string): Promise<T> {
    this.totalRequests++;
    const startTime = Date.now();

    const connection = await this.acquireConnection();

    try {
      const result = await this.executeWithRetry(
        async () => {
          const response = await connection.get(path);
          return response.data as T;
        },
        {
          maxRetries: this.config.maxRetries,
          currentRetry: 0,
          delay: this.config.retryDelay,
        }
      );

      const duration = Date.now() - startTime;
      logger.http(`GET ${path} - Success (${duration}ms)`);

      return result;
    } finally {
      this.releaseConnection(connection);
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.get('/api/tags');
      return true;
    } catch (error) {
      logger.error('Health check failed', error);
      return false;
    }
  }

  /**
   * Get pool metrics
   */
  getMetrics() {
    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      successRate: this.totalRequests > 0 ? (this.successfulRequests / this.totalRequests) * 100 : 0,
      totalRetries: this.totalRetries,
      averageRetriesPerRequest: this.totalRequests > 0 ? this.totalRetries / this.totalRequests : 0,
      circuitState: this.circuitState,
      failureCount: this.failureCount,
      availableConnections: this.availableConnections.length,
      activeConnections: this.activeConnections.size,
      totalConnections: this.connections.length,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.totalRetries = 0;
    logger.info('Metrics reset');
  }

  /**
   * Manually open circuit breaker (for testing/maintenance)
   */
  openCircuit(): void {
    this.circuitState = CircuitState.OPEN;
    logger.warn('Circuit breaker manually opened');
  }

  /**
   * Manually close circuit breaker
   */
  closeCircuit(): void {
    this.circuitState = CircuitState.CLOSED;
    this.failureCount = 0;
    logger.info('Circuit breaker manually closed');
  }
}
