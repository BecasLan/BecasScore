import { Server as HTTPServer } from 'http';
import { WebSocketServer as WSServer, WebSocket } from 'ws';
import logger from '../utils/logger';

/**
 * WebSocketServer
 *
 * Real-time communication server for Command Center V3.
 * Pushes live updates to connected clients:
 * - Threat detections
 * - Behavior triggers
 * - Anomalies
 * - Moderator actions
 * - Health changes
 * - Analytics updates
 */

export interface WebSocketMessage {
  type: string;
  data: any;
  timestamp: number;
  serverId?: string;
}

export interface ConnectedClient {
  ws: WebSocket;
  serverId?: string;
  userId?: string;
  subscriptions: Set<string>;
}

export class WebSocketServer {
  private wss: WSServer;
  private clients: Map<WebSocket, ConnectedClient> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(private httpServer: HTTPServer) {
    this.wss = new WSServer({ server: httpServer, path: '/ws' });
    this.setupServer();
  }

  /**
   * Setup WebSocket server
   */
  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Heartbeat to detect dead connections
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) {
          logger.debug('Terminating dead WebSocket connection');
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds

    this.wss.on('close', () => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
    });

    logger.info('✓ WebSocket Server initialized on /ws');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    const client: ConnectedClient = {
      ws,
      subscriptions: new Set()
    };

    this.clients.set(ws, client);

    // Mark as alive
    (ws as any).isAlive = true;

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(ws, message);
      } catch (error) {
        logger.error('Error parsing WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.debug('WebSocket client disconnected');
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
      this.clients.delete(ws);
    });

    // Send welcome message
    this.sendToClient(ws, {
      type: 'connected',
      data: { message: 'Connected to BECAS Command Center' },
      timestamp: Date.now()
    });

    logger.debug('New WebSocket client connected');
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(ws: WebSocket, message: any): void {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        // Subscribe to specific channels
        if (message.channels && Array.isArray(message.channels)) {
          message.channels.forEach((channel: string) => {
            client.subscriptions.add(channel);
          });
          this.sendToClient(ws, {
            type: 'subscribed',
            data: { channels: Array.from(client.subscriptions) },
            timestamp: Date.now()
          });
          logger.debug(`Client subscribed to: ${message.channels.join(', ')}`);
        }
        break;

      case 'unsubscribe':
        // Unsubscribe from channels
        if (message.channels && Array.isArray(message.channels)) {
          message.channels.forEach((channel: string) => {
            client.subscriptions.delete(channel);
          });
        }
        break;

      case 'set_server':
        // Set which server this client is viewing
        client.serverId = message.serverId;
        logger.debug(`Client set server to: ${message.serverId}`);
        break;

      case 'set_user':
        // Set user ID for authentication
        client.userId = message.userId;
        break;

      case 'ping':
        // Respond to ping
        this.sendToClient(ws, {
          type: 'pong',
          data: {},
          timestamp: Date.now()
        });
        break;

      default:
        logger.warn(`Unknown WebSocket message type: ${message.type}`);
    }
  }

  /**
   * Send message to specific client
   */
  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all clients
   */
  broadcast(message: WebSocketMessage): void {
    this.clients.forEach((client, ws) => {
      this.sendToClient(ws, message);
    });
  }

  /**
   * Broadcast to clients viewing specific server
   */
  broadcastToServer(serverId: string, message: WebSocketMessage): void {
    this.clients.forEach((client, ws) => {
      if (client.serverId === serverId) {
        this.sendToClient(ws, { ...message, serverId });
      }
    });
  }

  /**
   * Broadcast to clients subscribed to specific channel
   */
  broadcastToChannel(channel: string, message: WebSocketMessage): void {
    this.clients.forEach((client, ws) => {
      if (client.subscriptions.has(channel)) {
        this.sendToClient(ws, message);
      }
    });
  }

  // ============================================
  // Event Methods (called by other systems)
  // ============================================

  /**
   * Push threat detection
   */
  pushThreatDetection(serverId: string, threat: any): void {
    this.broadcastToServer(serverId, {
      type: 'threat_detected',
      data: threat,
      timestamp: Date.now()
    });

    this.broadcastToChannel('threats', {
      type: 'threat_detected',
      data: { serverId, ...threat },
      timestamp: Date.now()
    });
  }

  /**
   * Push anomaly detection
   */
  pushAnomaly(serverId: string, anomaly: any): void {
    this.broadcastToServer(serverId, {
      type: 'anomaly_detected',
      data: anomaly,
      timestamp: Date.now()
    });

    this.broadcastToChannel('anomalies', {
      type: 'anomaly_detected',
      data: { serverId, ...anomaly },
      timestamp: Date.now()
    });
  }

  /**
   * Push conflict prediction
   */
  pushConflictPrediction(serverId: string, prediction: any): void {
    this.broadcastToServer(serverId, {
      type: 'conflict_predicted',
      data: prediction,
      timestamp: Date.now()
    });

    this.broadcastToChannel('conflicts', {
      type: 'conflict_predicted',
      data: { serverId, ...prediction },
      timestamp: Date.now()
    });
  }

  /**
   * Push behavior trigger
   */
  pushBehaviorTrigger(serverId: string, behavior: any): void {
    this.broadcastToServer(serverId, {
      type: 'behavior_triggered',
      data: behavior,
      timestamp: Date.now()
    });

    this.broadcastToChannel('behaviors', {
      type: 'behavior_triggered',
      data: { serverId, ...behavior },
      timestamp: Date.now()
    });
  }

  /**
   * Push moderator action
   */
  pushModeratorAction(serverId: string, action: any): void {
    this.broadcastToServer(serverId, {
      type: 'moderator_action',
      data: action,
      timestamp: Date.now()
    });

    this.broadcastToChannel('moderation', {
      type: 'moderator_action',
      data: { serverId, ...action },
      timestamp: Date.now()
    });
  }

  /**
   * Push health update
   */
  pushHealthUpdate(serverId: string, health: any): void {
    this.broadcastToServer(serverId, {
      type: 'health_update',
      data: health,
      timestamp: Date.now()
    });

    this.broadcastToChannel('health', {
      type: 'health_update',
      data: { serverId, ...health },
      timestamp: Date.now()
    });
  }

  /**
   * Push analytics update
   */
  pushAnalyticsUpdate(serverId: string, analytics: any): void {
    this.broadcastToServer(serverId, {
      type: 'analytics_update',
      data: analytics,
      timestamp: Date.now()
    });

    this.broadcastToChannel('analytics', {
      type: 'analytics_update',
      data: { serverId, ...analytics },
      timestamp: Date.now()
    });
  }

  /**
   * Push alert
   */
  pushAlert(serverId: string, alert: any): void {
    this.broadcastToServer(serverId, {
      type: 'alert',
      data: alert,
      timestamp: Date.now()
    });

    this.broadcastToChannel('alerts', {
      type: 'alert',
      data: { serverId, ...alert },
      timestamp: Date.now()
    });
  }

  /**
   * Push user update
   */
  pushUserUpdate(serverId: string, userId: string, update: any): void {
    this.broadcastToServer(serverId, {
      type: 'user_update',
      data: { userId, ...update },
      timestamp: Date.now()
    });
  }

  /**
   * Get connection stats
   */
  getStats(): {
    totalClients: number;
    clientsByServer: Record<string, number>;
    subscriptionCounts: Record<string, number>;
  } {
    const clientsByServer: Record<string, number> = {};
    const subscriptionCounts: Record<string, number> = {};

    this.clients.forEach((client) => {
      if (client.serverId) {
        clientsByServer[client.serverId] = (clientsByServer[client.serverId] || 0) + 1;
      }

      client.subscriptions.forEach((channel) => {
        subscriptionCounts[channel] = (subscriptionCounts[channel] || 0) + 1;
      });
    });

    return {
      totalClients: this.clients.size,
      clientsByServer,
      subscriptionCounts
    };
  }

  /**
   * Shutdown WebSocket server
   */
  shutdown(): void {
    logger.info('Shutting down WebSocket Server...');

    // Notify all clients
    this.broadcast({
      type: 'server_shutdown',
      data: { message: 'Server is shutting down' },
      timestamp: Date.now()
    });

    // Close all connections
    this.clients.forEach((client, ws) => {
      ws.close();
    });

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close server
    this.wss.close();

    logger.info('WebSocket Server shut down');
  }
}

/**
 * Example integration:
 *
 * import { WebSocketServer } from './api/WebSocketServer';
 * import { createServer } from 'http';
 *
 * const httpServer = createServer(app);
 * const wsServer = new WebSocketServer(httpServer);
 *
 * // Push updates from other systems
 * anomalyDetector.on('detected', (serverId, anomaly) => {
 *   wsServer.pushAnomaly(serverId, anomaly);
 * });
 *
 * conflictPredictor.on('predicted', (serverId, prediction) => {
 *   wsServer.pushConflictPrediction(serverId, prediction);
 * });
 *
 * alertSystem.on('alert', (serverId, alert) => {
 *   wsServer.pushAlert(serverId, alert);
 * });
 *
 * healthMonitor.on('update', (serverId, health) => {
 *   wsServer.pushHealthUpdate(serverId, health);
 * });
 */
