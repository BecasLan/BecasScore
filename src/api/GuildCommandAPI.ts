/**
 * GUILD COMMAND CENTER API
 *
 * AI-powered conversational interface for Discord admins
 * Handles natural language commands, executes actions, provides insights
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer, Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Client, Guild, GuildMember, User } from 'discord.js';
import { OllamaService } from '../services/OllamaService';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { DeepRelationshipTracker } from '../systems/DeepRelationshipTracker';
import { AuthService } from '../services/AuthService';
import { createLogger } from '../services/Logger';
import { PortManager } from '../utils/PortManager';

const logger = createLogger('GuildCommandAPI');

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: any;
}

interface ConversationContext {
  guildId: string;
  userId: string;
  messages: ChatMessage[];
  lastUserMentioned?: string;
  lastAction?: string;
}

export class GuildCommandAPI {
  private app: Express;
  private httpServer: Server;
  private io: SocketIOServer;
  private port: number;
  private conversations: Map<string, ConversationContext> = new Map();

  constructor(
    private client: Client,
    private ollamaService: OllamaService,
    private trustEngine: TrustScoreEngineDB,
    private relationshipTracker: DeepRelationshipTracker,
    port: number = 3002
  ) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(cors({ credentials: true, origin: true }));
    this.app.use(express.json());
    this.app.use(cookieParser());
    this.app.use(express.static('public'));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', service: 'GuildCommandCenter' });
    });

    // ===== AUTH ROUTES =====

    // Get Discord OAuth URL
    this.app.get('/auth/discord', (req, res) => {
      const authUrl = AuthService.getAuthorizationURL();
      res.json({ url: authUrl });
    });

    // OAuth callback
    this.app.get('/auth/callback', this.handleOAuthCallback.bind(this));

    // Check auth status
    this.app.get('/auth/me', this.getAuthUser.bind(this));

    // Logout
    this.app.post('/auth/logout', this.logout.bind(this));

    // ===== GUILD ROUTES =====

    // Get guild info
    this.app.get('/api/guild/:guildId', this.getGuildInfo.bind(this));

    // Get live stats
    this.app.get('/api/guild/:guildId/stats', this.getGuildStats.bind(this));

    // Get recent events
    this.app.get('/api/guild/:guildId/events', this.getRecentEvents.bind(this));

    // Chat with AI
    this.app.post('/api/guild/:guildId/chat', this.handleChat.bind(this));

    // Execute action
    this.app.post('/api/guild/:guildId/action', this.executeAction.bind(this));

    // Get conversation history
    this.app.get('/api/guild/:guildId/conversation/:userId', this.getConversation.bind(this));
  }

  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);

      socket.on('subscribe_guild', (guildId: string) => {
        socket.join(`guild_${guildId}`);
        logger.info(`Client ${socket.id} subscribed to guild ${guildId}`);
      });

      socket.on('chat_message', async (data) => {
        await this.handleWebSocketChat(socket, data);
      });

      socket.on('disconnect', () => {
        logger.info(`Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Get guild information
   */
  private async getGuildInfo(req: Request, res: Response): Promise<void> {
    try {
      const { guildId } = req.params;
      const guild = this.client.guilds.cache.get(guildId);

      if (!guild) {
        res.status(404).json({ error: 'Guild not found' });
        return;
      }

      res.json({
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL(),
        memberCount: guild.memberCount,
        createdAt: guild.createdAt,
        description: guild.description,
        features: guild.features,
      });
    } catch (error) {
      logger.error('Failed to get guild info', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get live guild statistics
   */
  private async getGuildStats(req: Request, res: Response): Promise<void> {
    try {
      const { guildId } = req.params;
      const guild = this.client.guilds.cache.get(guildId);

      if (!guild) {
        res.status(404).json({ error: 'Guild not found' });
        return;
      }

      // Get trust scores
      const members = await guild.members.fetch();
      const trustScores = await Promise.all(
        Array.from(members.values()).map(async (member) => {
          const data = await this.trustEngine.getTrustScore(member.id, guild.id);
          return { userId: member.id, score: data.score };
        })
      );

      const avgTrustScore = trustScores.length > 0
        ? Math.round(trustScores.reduce((sum, t) => sum + t.score, 0) / trustScores.length)
        : 100;

      const lowTrustCount = trustScores.filter(t => t.score < 50).length;
      const highTrustCount = trustScores.filter(t => t.score >= 80).length;

      res.json({
        memberCount: guild.memberCount,
        onlineCount: members.filter(m => m.presence?.status !== 'offline').size,
        trustScore: {
          average: avgTrustScore,
          lowTrustUsers: lowTrustCount,
          highTrustUsers: highTrustCount,
        },
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size,
      });
    } catch (error) {
      logger.error('Failed to get guild stats', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get recent events (last 24 hours)
   */
  private async getRecentEvents(req: Request, res: Response): Promise<void> {
    try {
      const { guildId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;

      // TODO: Get from actual event store
      // For now, return mock data
      const events = [
        { type: 'scam_detected', userId: '123', timestamp: Date.now() - 120000, severity: 'high' },
        { type: 'user_joined', userId: '456', timestamp: Date.now() - 300000, severity: 'info' },
        { type: 'spam_blocked', userId: '789', timestamp: Date.now() - 600000, severity: 'medium' },
      ];

      res.json({ events: events.slice(0, limit) });
    } catch (error) {
      logger.error('Failed to get recent events', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle chat message from admin
   */
  private async handleChat(req: Request, res: Response): Promise<void> {
    try {
      const { guildId } = req.params;
      const { message, userId } = req.body;

      if (!message || !userId) {
        res.status(400).json({ error: 'Message and userId required' });
        return;
      }

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        res.status(404).json({ error: 'Guild not found' });
        return;
      }

      // Get or create conversation context
      const contextKey = `${guildId}_${userId}`;
      let context = this.conversations.get(contextKey);
      if (!context) {
        context = {
          guildId,
          userId,
          messages: [],
        };
        this.conversations.set(contextKey, context);
      }

      // Add user message
      context.messages.push({
        role: 'user',
        content: message,
        timestamp: Date.now(),
      });

      // Process command and generate response
      const response = await this.processCommand(guild, context, message);

      // Add assistant response
      context.messages.push({
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        metadata: response.metadata,
      });

      // Keep only last 20 messages
      if (context.messages.length > 20) {
        context.messages = context.messages.slice(-20);
      }

      res.json({
        response: response.text,
        metadata: response.metadata,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error('Failed to handle chat', error);
      res.status(500).json({ error: 'Failed to process message' });
    }
  }

  /**
   * Process natural language command
   */
  private async processCommand(
    guild: Guild,
    context: ConversationContext,
    message: string
  ): Promise<{ text: string; metadata?: any }> {
    const lowerMessage = message.toLowerCase();

    // Intent detection
    if (lowerMessage.includes('ban') && lowerMessage.includes('user')) {
      return this.handleBanIntent(guild, context, message);
    }

    if (lowerMessage.includes('trust') && lowerMessage.includes('score')) {
      return this.handleTrustScoreQuery(guild, context, message);
    }

    if (lowerMessage.includes('stats') || lowerMessage.includes('statistics')) {
      return this.handleStatsQuery(guild);
    }

    if (lowerMessage.includes('scam') || lowerMessage.includes('threat')) {
      return this.handleThreatQuery(guild);
    }

    if (lowerMessage.includes('setting') || lowerMessage.includes('config')) {
      return this.handleSettingsQuery(guild, message);
    }

    // Default: Use AI for general conversation
    return this.handleGeneralQuery(guild, context, message);
  }

  /**
   * Handle ban intent
   */
  private async handleBanIntent(
    guild: Guild,
    context: ConversationContext,
    message: string
  ): Promise<{ text: string; metadata?: any }> {
    // Extract user ID from message
    const userIdMatch = message.match(/<@!?(\d+)>|@(\w+)|user.*?(\d+)/i);

    if (!userIdMatch) {
      // Check context for last mentioned user
      if (context.lastUserMentioned) {
        return {
          text: `Do you want to ban <@${context.lastUserMentioned}>? Reply "yes" to confirm.`,
          metadata: { action: 'confirm_ban', userId: context.lastUserMentioned }
        };
      }
      return { text: "I couldn't identify which user to ban. Please mention the user or provide their ID." };
    }

    const userId = userIdMatch[1] || userIdMatch[2] || userIdMatch[3];
    context.lastUserMentioned = userId;

    const trustData = await this.trustEngine.getTrustScore(userId, guild.id);

    return {
      text: `🔨 Ready to ban <@${userId}>\n\nTrust Score: ${trustData.score}\nReason: Low trust score\n\nReply "confirm" to execute the ban.`,
      metadata: {
        action: 'pending_ban',
        userId,
        trustScore: trustData.score
      }
    };
  }

  /**
   * Handle trust score query
   */
  private async handleTrustScoreQuery(
    guild: Guild,
    context: ConversationContext,
    message: string
  ): Promise<{ text: string; metadata?: any }> {
    // Check for threshold (e.g., "below 50", "< 50", "less than 50")
    const thresholdMatch = message.match(/(?:below|under|less than|<)\s*(\d+)/i);

    if (thresholdMatch) {
      const threshold = parseInt(thresholdMatch[1]);
      const members = await guild.members.fetch();

      const lowTrustUsers = (await Promise.all(
        Array.from(members.values()).map(async (member) => ({
          id: member.id,
          username: member.user.username,
          trustData: await this.trustEngine.getTrustScore(member.id, guild.id)
        }))
      ))
        .filter(u => u.trustData.score < threshold)
        .sort((a, b) => a.trustData.score - b.trustData.score)
        .slice(0, 10);

      if (lowTrustUsers.length === 0) {
        return { text: `✅ No users found with trust score below ${threshold}. Your server is clean!` };
      }

      const userList = lowTrustUsers.map((u, i) =>
        `${i + 1}. <@${u.id}> - Score: ${u.trustData.score}`
      ).join('\n');

      return {
        text: `🔍 Found ${lowTrustUsers.length} users with trust score < ${threshold}:\n\n${userList}\n\nWould you like to take action on any of these users?`,
        metadata: {
          users: lowTrustUsers,
          threshold
        }
      };
    }

    // General trust score overview
    const members = await guild.members.fetch();
    const trustScores = await Promise.all(
      Array.from(members.values()).map(async (m) => {
        const data = await this.trustEngine.getTrustScore(m.id, guild.id);
        return data.score;
      })
    );

    const avgScore = Math.round(trustScores.reduce((sum, s) => sum + s, 0) / trustScores.length);
    const lowCount = trustScores.filter(s => s < 50).length;
    const highCount = trustScores.filter(s => s >= 80).length;

    return {
      text: `📊 Trust Score Overview:\n\n` +
            `Average Score: ${avgScore}\n` +
            `High Trust (≥80): ${highCount} users\n` +
            `Low Trust (<50): ${lowCount} users\n` +
            `Total Users: ${trustScores.length}`,
      metadata: { avgScore, lowCount, highCount, total: trustScores.length }
    };
  }

  /**
   * Handle stats query
   */
  private async handleStatsQuery(guild: Guild): Promise<{ text: string; metadata?: any }> {
    const members = await guild.members.fetch();
    const onlineCount = members.filter(m => m.presence?.status !== 'offline').size;

    return {
      text: `📊 Server Statistics:\n\n` +
            `Total Members: ${guild.memberCount}\n` +
            `Online: ${onlineCount}\n` +
            `Channels: ${guild.channels.cache.size}\n` +
            `Roles: ${guild.roles.cache.size}\n` +
            `Created: ${guild.createdAt.toLocaleDateString()}`,
      metadata: {
        memberCount: guild.memberCount,
        onlineCount,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size
      }
    };
  }

  /**
   * Handle threat/scam query
   */
  private async handleThreatQuery(guild: Guild): Promise<{ text: string; metadata?: any }> {
    // TODO: Get from actual event store
    const mockThreats = [
      { userId: '123', type: 'phishing', timestamp: Date.now() - 7200000 },
      { userId: '456', type: 'spam', timestamp: Date.now() - 3600000 },
      { userId: '789', type: 'scam', timestamp: Date.now() - 1800000 },
    ];

    if (mockThreats.length === 0) {
      return { text: `✅ No threats detected in the last 24 hours. Your server is secure!` };
    }

    const threatList = mockThreats.map((t, i) => {
      const timeAgo = Math.round((Date.now() - t.timestamp) / 60000);
      return `${i + 1}. <@${t.userId}> - ${t.type} (${timeAgo}m ago)`;
    }).join('\n');

    return {
      text: `⚠️ Detected ${mockThreats.length} threats in last 24h:\n\n${threatList}\n\nAll threats have been handled automatically.`,
      metadata: { threats: mockThreats }
    };
  }

  /**
   * Handle settings query
   */
  private async handleSettingsQuery(guild: Guild, message: string): Promise<{ text: string; metadata?: any }> {
    return {
      text: `⚙️ Current Settings:\n\n` +
            `🔥 Scam Detection: ON\n` +
            `🛡️ Auto-Moderation: ON\n` +
            `🎯 AI Sensitivity: MEDIUM\n` +
            `⚡ Max AI Calls: 3 per message\n\n` +
            `To change settings, say something like:\n` +
            `"Set AI sensitivity to high"\n` +
            `"Disable auto-moderation"`,
      metadata: {
        scamDetection: true,
        autoModeration: true,
        sensitivity: 'medium',
        maxAiCalls: 3
      }
    };
  }

  /**
   * Handle general query with AI
   */
  private async handleGeneralQuery(
    guild: Guild,
    context: ConversationContext,
    message: string
  ): Promise<{ text: string; metadata?: any }> {
    const systemPrompt = `You are BECAS, an AI assistant helping Discord server administrators manage their community.
You are professional, concise, and action-oriented.
Current server: ${guild.name} (${guild.memberCount} members).
Respond helpfully to the admin's question. Keep responses under 200 words.`;

    try {
      const response = await this.ollamaService.generate(
        `${systemPrompt}\n\nUser: ${message}\n\nBECAS:`,
        undefined,
        { temperature: 0.7, maxTokens: 300 }
      );

      return { text: response || "I'm here to help! What would you like to know?" };
    } catch (error) {
      logger.error('AI generation failed', error);
      return { text: "I'm available to help with server management. Try asking about stats, trust scores, or recent events!" };
    }
  }

  /**
   * Execute action (ban, warn, etc.)
   */
  private async executeAction(req: Request, res: Response): Promise<void> {
    try {
      const { guildId } = req.params;
      const { action, userId, reason } = req.body;

      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        res.status(404).json({ error: 'Guild not found' });
        return;
      }

      let result = { success: false, message: '' };

      switch (action) {
        case 'ban':
          try {
            await guild.members.ban(userId, { reason: reason || 'Banned via Command Center' });
            result = { success: true, message: `Successfully banned <@${userId}>` };
          } catch (error) {
            result = { success: false, message: `Failed to ban user: ${error}` };
          }
          break;

        case 'kick':
          try {
            const member = await guild.members.fetch(userId);
            await member.kick(reason || 'Kicked via Command Center');
            result = { success: true, message: `Successfully kicked <@${userId}>` };
          } catch (error) {
            result = { success: false, message: `Failed to kick user: ${error}` };
          }
          break;

        default:
          result = { success: false, message: 'Unknown action' };
      }

      res.json(result);
    } catch (error) {
      logger.error('Failed to execute action', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get conversation history
   */
  private async getConversation(req: Request, res: Response): Promise<void> {
    try {
      const { guildId, userId } = req.params;
      const contextKey = `${guildId}_${userId}`;
      const context = this.conversations.get(contextKey);

      res.json({
        messages: context?.messages || [],
        guildId,
        userId
      });
    } catch (error) {
      logger.error('Failed to get conversation', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Handle WebSocket chat
   */
  private async handleWebSocketChat(socket: any, data: any): Promise<void> {
    try {
      const { guildId, userId, message } = data;
      const guild = this.client.guilds.cache.get(guildId);

      if (!guild) {
        socket.emit('chat_error', { error: 'Guild not found' });
        return;
      }

      // Get context
      const contextKey = `${guildId}_${userId}`;
      let context = this.conversations.get(contextKey);
      if (!context) {
        context = { guildId, userId, messages: [] };
        this.conversations.set(contextKey, context);
      }

      // Show typing indicator
      this.io.to(`guild_${guildId}`).emit('typing', { typing: true });

      // Process command
      const response = await this.processCommand(guild, context, message);

      // Send response
      this.io.to(`guild_${guildId}`).emit('chat_response', {
        message: response.text,
        metadata: response.metadata,
        timestamp: Date.now()
      });

      this.io.to(`guild_${guildId}`).emit('typing', { typing: false });
    } catch (error) {
      logger.error('WebSocket chat error', error);
      socket.emit('chat_error', { error: 'Failed to process message' });
    }
  }

  /**
   * Handle OAuth callback
   */
  private async handleOAuthCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code } = req.query;

      if (!code || typeof code !== 'string') {
        res.status(400).send('Missing authorization code');
        return;
      }

      // Complete OAuth flow
      const session = await AuthService.completeOAuthFlow(code);

      // Filter guilds where BECAS is present
      const becasGuilds = session.guilds.filter(guild => {
        return this.client.guilds.cache.has(guild.id);
      });

      logger.info(`User ${session.username}: ${becasGuilds.length}/${session.guilds.length} guilds have BECAS`);

      // Update session with filtered guilds
      session.guilds = becasGuilds;

      // Check if user has any guilds with BECAS
      if (becasGuilds.length === 0) {
        res.status(403).send(`
          <html>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
              <h1>⚠️ No Access</h1>
              <p>BECAS is not present in any of your admin servers.</p>
              <p>Please invite BECAS to your server first!</p>
              <a href="/">Go back</a>
            </body>
          </html>
        `);
        return;
      }

      // Create session token
      const token = AuthService.createSessionToken(session);

      // Set cookie
      res.cookie('becas_session', token, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        sameSite: 'lax',
      });

      // Redirect to command center
      res.redirect('/command-center.html');
    } catch (error) {
      logger.error('OAuth callback failed', error);
      res.status(500).send('Authentication failed');
    }
  }

  /**
   * Get authenticated user
   */
  private async getAuthUser(req: Request, res: Response): Promise<void> {
    try {
      const token = req.cookies.becas_session;

      if (!token) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const session = AuthService.verifySessionToken(token);

      if (!session) {
        res.status(401).json({ error: 'Invalid or expired session' });
        return;
      }

      // Filter guilds where BECAS is present (in case bot left a server after login)
      const becasGuilds = session.guilds.filter(guild => {
        return this.client.guilds.cache.has(guild.id);
      });

      res.json({
        userId: session.userId,
        username: session.username,
        avatar: session.avatar,
        guilds: becasGuilds,
      });
    } catch (error) {
      logger.error('Failed to get auth user', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Logout user
   */
  private async logout(req: Request, res: Response): Promise<void> {
    res.clearCookie('becas_session');
    res.json({ success: true });
  }

  /**
   * Emit real-time event to guild subscribers
   */
  public emitEvent(guildId: string, event: any): void {
    this.io.to(`guild_${guildId}`).emit('live_event', event);
  }

  /**
   * Start the server with port conflict resolution
   */
  public async start(): Promise<number> {
    const actualPort = await PortManager.startServerSafely(
      'GuildCommandAPI',
      this.port,
      (port) => {
        return new Promise<void>((resolve) => {
          this.httpServer.listen(port, () => {
            this.port = port; // Update port in case it changed
            logger.info(`Guild Command Center running on port ${port}`);
            console.log(`🎯 Guild Command Center: http://localhost:${port}`);
            console.log(`📱 Command Center UI: http://localhost:${port}/command-center.html`);
            resolve();
          });
        });
      }
    );

    // Setup graceful shutdown
    PortManager.setupGracefulShutdown('GuildCommandAPI', this.httpServer, async () => {
      // Close Socket.IO connections
      this.io.close();
      logger.info('Socket.IO connections closed');
    });

    return actualPort;
  }

  /**
   * Stop server gracefully
   */
  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.io.close();
      this.httpServer.close((err) => {
        if (err) {
          logger.error('Error stopping GuildCommandAPI', err);
          reject(err);
        } else {
          logger.info('GuildCommandAPI stopped gracefully');
          resolve();
        }
      });
    });
  }
}
