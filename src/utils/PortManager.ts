/**
 * PORT MANAGER - Clean Port Handling & Conflict Resolution
 *
 * Prevents EADDRINUSE errors by checking port availability
 * and providing graceful shutdown capabilities.
 */

import { createServer, Server } from 'net';
import { createLogger } from '../services/Logger';

const logger = createLogger('PortManager');

export class PortManager {
  /**
   * Check if a port is available
   */
  static async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();

      server.once('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          resolve(false);
        }
      });

      server.once('listening', () => {
        server.close();
        resolve(true);
      });

      server.listen(port);
    });
  }

  /**
   * Find next available port starting from given port
   */
  static async findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      const available = await this.isPortAvailable(port);

      if (available) {
        return port;
      }

      logger.warn(`Port ${port} is in use, trying ${port + 1}...`);
    }

    throw new Error(`No available ports found in range ${startPort}-${startPort + maxAttempts - 1}`);
  }

  /**
   * Setup graceful shutdown for a server
   */
  static setupGracefulShutdown(
    serverName: string,
    httpServer: any,
    cleanupCallback?: () => Promise<void>
  ): void {
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received - shutting down ${serverName} gracefully...`);

      // Close server to stop accepting new connections
      httpServer.close(async () => {
        logger.info(`${serverName} closed all connections`);

        // Run cleanup callback if provided
        if (cleanupCallback) {
          try {
            await cleanupCallback();
            logger.info(`${serverName} cleanup completed`);
          } catch (error) {
            logger.error(`${serverName} cleanup failed`, error);
          }
        }

        process.exit(0);
      });

      // Force shutdown if graceful shutdown takes too long
      setTimeout(() => {
        logger.error(`${serverName} forced shutdown (timeout)`);
        process.exit(1);
      }, 10000); // 10 second timeout
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info(`✓ Graceful shutdown handlers registered for ${serverName}`);
  }

  /**
   * Kill processes using a specific port (Windows only)
   */
  static async killPortProcessWindows(port: number): Promise<boolean> {
    if (process.platform !== 'win32') {
      logger.warn('killPortProcessWindows only works on Windows');
      return false;
    }

    try {
      const { execSync } = await import('child_process');

      // Find PID using port
      const netstatOutput = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8' });

      if (!netstatOutput) {
        logger.info(`No process found using port ${port}`);
        return true;
      }

      // Extract PIDs
      const lines = netstatOutput.split('\n').filter(line => line.includes('LISTENING'));
      const pids = new Set<string>();

      for (const line of lines) {
        const match = line.trim().match(/\s+(\d+)\s*$/);
        if (match) {
          pids.add(match[1]);
        }
      }

      if (pids.size === 0) {
        logger.info(`No listening process found on port ${port}`);
        return true;
      }

      // Kill each PID
      pids.forEach((pid) => {
        logger.info(`Killing process ${pid} using port ${port}...`);
        execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8' });
      });

      logger.info(`✓ Successfully killed ${pids.size} process(es) on port ${port}`);
      return true;
    } catch (error) {
      logger.error(`Failed to kill port ${port} processes`, error);
      return false;
    }
  }

  /**
   * Start server with automatic port conflict resolution
   */
  static async startServerSafely(
    serverName: string,
    preferredPort: number,
    startFn: (port: number) => Promise<void> | void,
    cleanupCallback?: () => Promise<void>
  ): Promise<number> {
    logger.info(`Starting ${serverName} on port ${preferredPort}...`);

    // Check if port is available
    const isAvailable = await this.isPortAvailable(preferredPort);

    if (!isAvailable) {
      logger.warn(`Port ${preferredPort} is in use`);

      // On Windows, offer to kill conflicting process
      if (process.platform === 'win32') {
        logger.info(`Attempting to free port ${preferredPort}...`);
        const killed = await this.killPortProcessWindows(preferredPort);

        if (killed) {
          // Wait a bit for port to be released
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Check again
          const nowAvailable = await this.isPortAvailable(preferredPort);
          if (nowAvailable) {
            logger.info(`✓ Port ${preferredPort} is now available`);
          } else {
            // Find alternative port
            logger.warn(`Port ${preferredPort} still in use, finding alternative...`);
            const altPort = await this.findAvailablePort(preferredPort + 1);
            logger.info(`Using alternative port ${altPort}`);
            await startFn(altPort);
            return altPort;
          }
        } else {
          // Find alternative port
          const altPort = await this.findAvailablePort(preferredPort + 1);
          logger.info(`Using alternative port ${altPort}`);
          await startFn(altPort);
          return altPort;
        }
      } else {
        // On non-Windows, just find alternative port
        const altPort = await this.findAvailablePort(preferredPort + 1);
        logger.info(`Using alternative port ${altPort}`);
        await startFn(altPort);
        return altPort;
      }
    }

    // Port is available, start normally
    await startFn(preferredPort);
    logger.info(`✓ ${serverName} started successfully on port ${preferredPort}`);

    return preferredPort;
  }
}
