/**
 * DASHBOARD WEB API
 *
 * Serves Becas data to the web frontend (checkscore.html)
 * Provides trust scores, profiles, leaderboards, and violation history
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { TrustScoreEngineDB } from '../systems/TrustScoreEngineDB';
import { DeepRelationshipTracker } from '../systems/DeepRelationshipTracker';
import { UnifiedMemoryStore } from '../persistence/UnifiedMemoryStore';
import { SafeLearningEngine } from '../intelligence/SafeLearningEngine';
import { SicilRepository } from '../database/repositories/SicilRepository';
import { UserRepository } from '../database/repositories/UserRepository';
import { Client } from 'discord.js';
import { createLogger } from '../services/Logger';

const logger = createLogger('DashboardAPI');

export class DashboardAPI {
  private app: Express;
  private httpServer: any;
  private io: SocketIOServer;
  private port: number;
  private sicilRepo: SicilRepository;
  private userRepo: UserRepository;

  constructor(
    private client: Client,
    private trustEngine: TrustScoreEngineDB,
    private profiler: DeepRelationshipTracker,
    private memory: UnifiedMemoryStore,
    private learningEngine: SafeLearningEngine,
    port: number = 3000
  ) {
    this.sicilRepo = new SicilRepository();
    this.userRepo = new UserRepository();
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    this.port = port;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    // Enable CORS for frontend access
    this.app.use(cors());

    // Parse JSON bodies
    this.app.use(express.json());

    // Serve static files (checkscore.html) from project root
    // __dirname is in dist/api/, so go up 2 levels to project root
    const projectRoot = path.resolve(__dirname, '..', '..');
    logger.info(`Serving static files from: ${projectRoot}`);
    this.app.use(express.static(projectRoot));

    // Log all requests
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        botReady: this.client.isReady()
      });
    });

    // Get user trust score and basic info
    this.app.get('/api/user/:id', this.getUserScore.bind(this));

    // Get detailed user profile with deep analysis
    this.app.get('/api/profile/:id', this.getUserProfile.bind(this));

    // Get leaderboard (worst trust scores)
    this.app.get('/api/leaderboard', this.getLeaderboard.bind(this));

    // Get violation history for a user
    this.app.get('/api/violations/:userId', this.getViolations.bind(this));

    // Get global statistics
    this.app.get('/api/stats', this.getStats.bind(this));

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
  }

  /**
   * GET /api/user/:id
   * Returns trust score and basic user info FROM DATABASE
   */
  private async getUserScore(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.id;

      // Get user from DATABASE (users table)
      const dbUser = await this.userRepo.getUserById(userId);

      if (!dbUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const trustScore = dbUser.global_trust_score; // From database

      logger.info(`📊 API getUserScore: userId=${userId}, score=${trustScore} (from DB)`);

      // Try to get Discord user for avatar
      let avatar = '';
      try {
        const discordUser = await this.client.users.fetch(userId);
        avatar = discordUser.displayAvatarURL();
      } catch (e) {
        avatar = dbUser.avatar_url || '';
      }

      res.json({
        userId: dbUser.id,
        username: dbUser.username,
        trustScore: Math.round(trustScore),
        avatar: avatar,
        serverCount: 0, // Can be calculated if needed
        joinedAt: dbUser.first_seen_at,
        status: this.getScoreStatus(trustScore)
      });
    } catch (error) {
      logger.error('Error fetching user score:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/profile/:id
   * Returns detailed user profile with deep analysis
   */
  private async getUserProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.id;
      const user = await this.findUser(userId);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Get trust score
      const guildId = this.client.guilds.cache.first()?.id || 'global';
      const trustScoreObj = await this.trustEngine.getTrustScore(userId, guildId);
      const trustScore = trustScoreObj.score; // Already in 0-100 range

      // Get deep profile
      const profile = await this.profiler.getProfile(userId, guildId, user.tag);

      // Get recent actions from memory
      const actions = await this.memory.query({
        type: 'action',
        tags: [userId],
        limit: 10
      });

      res.json({
        userId: user.id,
        username: user.tag,
        avatar: user.displayAvatarURL(),
        trustScore: Math.round(trustScore),
        status: this.getScoreStatus(trustScore),
        profile: profile ? {
          interests: profile.personality.interests,
          expertise: Array.from(profile.topicsDiscussed.entries()).map(([topic, count]) => ({
            topic,
            score: count
          })),
          personalityTraits: profile.personality.traits,
          activityPattern: {
            activeHours: profile.personality.activityPattern.mostActiveHours,
            messageFrequency: profile.personality.activityPattern.averageMessagesPerDay,
            lastSeen: profile.updatedAt
          },
          messageStats: {
            totalMessages: 0,
            averageLength: 0,
            codeSnippets: 0
          }
        } : null,
        recentActions: actions.map(a => ({
          id: a.id,
          type: a.data.type,
          reason: a.data.reason,
          timestamp: a.metadata.createdAt,
          guildId: a.guildId
        }))
      });
    } catch (error) {
      logger.error('Error fetching user profile:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/leaderboard
   * Returns users with lowest trust scores (scammers/troublemakers) from SICIL DATABASE
   */
  private async getLeaderboard(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const page = parseInt(req.query.page as string) || 1;
      const type = (req.query.type as string) || 'all'; // 'all', 'violations', 'risky'
      const guildId = this.client.guilds.cache.first()?.id;

      if (!guildId) {
        logger.warn('No guild found for leaderboard');
        res.json({ total: 0, page, limit, leaderboard: [] });
        return;
      }

      // Get all guild members from Discord (fetch if not cached)
      const guild = this.client.guilds.cache.first();
      if (!guild) {
        res.json({ total: 0, page, limit, leaderboard: [] });
        return;
      }

      // Fetch all members if cache is empty or small
      if (guild.members.cache.size < 10) {
        logger.info(`[Leaderboard] Fetching all guild members (cache size: ${guild.members.cache.size})...`);
        try {
          await guild.members.fetch({ limit: 1000 });
          logger.info(`[Leaderboard] Fetched ${guild.members.cache.size} members`);
        } catch (error) {
          logger.error('[Leaderboard] Failed to fetch guild members:', error);
        }
      }

      // Get all members with their trust scores
      const allMembers = Array.from(guild.members.cache.values()).filter(m => !m.user.bot);
      logger.info(`[Leaderboard] Found ${allMembers.length} members (excluding bots)`);

      // Build leaderboard from in-memory trust engine (faster, no database required)
      let leaderboardData = await Promise.all(
        allMembers.map(async (member) => {
          const userId = member.user.id;

          // Get trust score from trust engine
          const trustScoreObj = await this.trustEngine.getTrustScore(userId, guildId);
          const trustScore = trustScoreObj.score;

          // Try to get sicil data if available
          let sicilRecord = null;
          let violations: string[] = [];
          let totalViolations = 0;
          let riskCategory = 'safe';
          let lastViolation = null;

          try {
            sicilRecord = await this.sicilRepo.getSicilSummary(guildId, userId);

            if (sicilRecord) {
              // Determine violation types from sicil
              if (sicilRecord.total_bans > 0) violations.push('ban');
              if (sicilRecord.total_kicks > 0) violations.push('kick');
              if (sicilRecord.total_timeouts > 0) violations.push('timeout');
              if (sicilRecord.total_warnings > 0) violations.push('warning');
              if (sicilRecord.scam_violations > 0) violations.push('scam');
              if (sicilRecord.phishing_violations > 0) violations.push('phishing');
              if (sicilRecord.toxicity_violations > 0) violations.push('toxicity');
              if (sicilRecord.spam_violations > 0) violations.push('spam');
              if (sicilRecord.harassment_violations > 0) violations.push('harassment');

              totalViolations = sicilRecord.total_warnings + sicilRecord.total_timeouts + sicilRecord.total_kicks + sicilRecord.total_bans;
              riskCategory = sicilRecord.risk_category;
              lastViolation = sicilRecord.last_violation_at;
            }
          } catch (error) {
            // Sicil data not available, continue with trust score only
            logger.debug(`No sicil data for user ${userId}`);
          }

          return {
            userId,
            username: member.user.username,
            avatar: member.user.displayAvatarURL(),
            trustScore: Math.round(trustScore),
            lastViolation: lastViolation?.toISOString() || null,
            violations,
            totalViolations,
            riskCategory
          };
        })
      );

      // Filter based on type
      if (type === 'violations') {
        leaderboardData = leaderboardData.filter(u => u.totalViolations > 0);
      } else if (type === 'risky') {
        leaderboardData = leaderboardData.filter(u => u.riskCategory === 'risky' || u.riskCategory === 'dangerous');
      } else if (type === 'trusted') {
        leaderboardData = leaderboardData.filter(u => u.trustScore >= 80);
      }

      // Sort based on type
      if (type === 'violations' || type === 'risky') {
        leaderboardData.sort((a, b) => b.totalViolations - a.totalViolations || a.trustScore - b.trustScore);
      } else if (type === 'trusted') {
        leaderboardData.sort((a, b) => b.trustScore - a.trustScore);
      } else {
        // Default: sort by trust score (lowest first)
        leaderboardData.sort((a, b) => a.trustScore - b.trustScore);
      }

      // Paginate
      const total = leaderboardData.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedData = leaderboardData.slice(startIndex, endIndex);

      // Add rank
      const leaderboard = paginatedData.map((user, index) => ({
        ...user,
        rank: startIndex + index + 1
      }));

      logger.info(`[Leaderboard] Returning ${leaderboard.length} users (total: ${total}, type: ${type})`);

      res.json({
        total,
        page,
        limit,
        leaderboard
      });
    } catch (error) {
      logger.error('Error fetching leaderboard:', error);
      // Return empty leaderboard instead of error
      res.json({ total: 0, page: 1, limit: 20, leaderboard: [] });
    }
  }

  /**
   * GET /api/violations/:userId
   * Returns violation history for a specific user FROM SICIL DATABASE
   */
  private async getViolations(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.userId;
      const guildId = this.client.guilds.cache.first()?.id;

      if (!guildId) {
        logger.warn('No guild found for violations');
        res.json({ violations: [] });
        return;
      }

      // 🔥 Get user actions from SICIL DATABASE
      const userActions = await this.sicilRepo.getUserActions(guildId, userId, 100);
      logger.info(`[Violations Debug] Found ${userActions.length} user actions in sicil for ${userId}`);

      // Format violations from sicil actions
      const violations = userActions
        .filter(action => action.triggered_moderation) // Only actions that triggered moderation
        .map(action => {
          // Determine violation tag
          let tag = 'violation';
          if (action.moderation_action) {
            const modAction = action.moderation_action.toLowerCase();
            if (modAction.includes('ban')) tag = 'ban';
            else if (modAction.includes('timeout') || modAction.includes('mute')) tag = 'timeout';
            else if (modAction.includes('kick')) tag = 'kick';
            else if (modAction.includes('warn')) tag = 'warning';
          }

          // Determine specific violation type
          if (action.scam_score > 0.7) tag = 'scam';
          else if (action.toxicity_score > 0.7) tag = 'toxicity';
          else if (action.spam_score > 0.7) tag = 'spam';

          // Build details text
          let detailsText = `${action.intent || 'Violation detected'}`;
          if (action.content) {
            detailsText += ` | Message: "${action.content.substring(0, 100)}${action.content.length > 100 ? '...' : ''}"`;
          }
          if (action.channel_id) {
            detailsText += ` | Channel: <#${action.channel_id}>`;
          }
          if (action.toxicity_score > 0) {
            detailsText += ` | Toxicity: ${(action.toxicity_score * 100).toFixed(1)}%`;
          }
          if (action.scam_score > 0) {
            detailsText += ` | Scam Risk: ${(action.scam_score * 100).toFixed(1)}%`;
          }

          return {
            type: this.formatViolationType(tag),
            tag,
            date: action.timestamp.toISOString(),
            impact: action.moderation_action || 'Flagged',
            server: action.server_id,
            details: detailsText,
            structured: {
              message: action.content,
              channelId: action.channel_id,
              toxicity: action.toxicity_score,
              scam: action.scam_score,
              spam: action.spam_score,
              intent: action.intent,
              sentiment: action.sentiment,
              wasProvoked: action.was_provoked,
              emotionalState: action.emotional_state,
              moderatorOverride: action.moderator_override
            }
          };
        })
        .reverse(); // Most recent first

      res.json({ violations });
    } catch (error) {
      logger.error('Error fetching violations from sicil:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * GET /api/stats
   * Returns global statistics
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const memoryStats = this.memory.getStats();
      const learningStats = await this.learningEngine.getStats();

      res.json({
        memory: memoryStats,
        learning: learningStats,
        profiles: {
          total: this.profiler.getAllProfiles().length
        },
        discord: {
          guilds: this.client.guilds.cache.size || 0,
          users: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)
        }
      });
    } catch (error) {
      logger.error('Error fetching stats:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Setup WebSocket for real-time updates
   */
  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      logger.info(`🔌 WebSocket client connected: ${socket.id}`);

      // Send initial stats
      this.sendStatsUpdate(socket);

      socket.on('disconnect', () => {
        logger.info(`🔌 WebSocket client disconnected: ${socket.id}`);
      });

      // Handle requests for specific user updates
      socket.on('subscribe:user', (userId: string) => {
        socket.join(`user:${userId}`);
        logger.info(`👤 Client subscribed to user updates: ${userId}`);
      });
    });

    logger.info(`🔌 WebSocket server initialized`);
  }

  /**
   * Emit trust score update to all connected clients
   */
  emitTrustScoreUpdate(userId: string, data: any): void {
    this.io.emit('trustScoreUpdate', { userId, ...data });
    this.io.to(`user:${userId}`).emit('userUpdate', data);
    logger.info(`📡 Emitted trust score update for ${userId}`);
  }

  /**
   * Emit leaderboard update
   */
  emitLeaderboardUpdate(): void {
    this.io.emit('leaderboardUpdate', { timestamp: Date.now() });
  }

  /**
   * Emit stats update
   */
  async sendStatsUpdate(socket?: any): Promise<void> {
    try {
      const memoryStats = this.memory.getStats();
      const learningStats = await this.learningEngine.getStats();
      const stats = {
        memory: memoryStats,
        learning: learningStats,
        profiles: {
          total: this.profiler.getAllProfiles().length
        },
        discord: {
          guilds: this.client.guilds.cache.size || 0,
          users: this.client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0)
        },
        timestamp: Date.now()
      };

      if (socket) {
        socket.emit('statsUpdate', stats);
      } else {
        this.io.emit('statsUpdate', stats);
      }
    } catch (error) {
      logger.error('Error sending stats update:', error);
    }
  }

  /**
   * Start the API server
   */
  start(): void {
    this.httpServer.listen(this.port, () => {
      logger.info(`🌐 Dashboard API running on http://localhost:${this.port}`);
      logger.info(`📊 Visit http://localhost:${this.port}/checkscore.html to view dashboard`);
      logger.info(`🔌 WebSocket server ready for real-time updates`);
    });

    // Send stats updates every 10 seconds
    setInterval(() => {
      this.sendStatsUpdate();
    }, 10000);
  }

  /**
   * Helper: Find Discord user by ID or username
   */
  private async findUser(idOrUsername: string): Promise<any | null> {
    try {
      // Try as ID first
      if (/^\d+$/.test(idOrUsername)) {
        return await this.client.users.fetch(idOrUsername);
      }

      // Try as username
      const cached = this.client.users.cache.find(u =>
        u.tag.toLowerCase() === idOrUsername.toLowerCase() ||
        u.username.toLowerCase() === idOrUsername.toLowerCase()
      );

      return cached || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Helper: Get status label for trust score
   * Score range: 0-100 (default: 100)
   */
  private getScoreStatus(score: number): string {
    if (score >= 70) return 'Low Risk - Trust Score Above 70';
    if (score >= 40) return 'Medium Risk - Trust Score Below 70';
    return 'High Risk - Trust Score Below 40';
  }

  /**
   * Helper: Format violation type for display
   */
  private formatViolationType(type: string): string {
    const map: Record<string, string> = {
      'ban': 'Ban',
      'timeout': 'Timeout',
      'kick': 'Kick',
      'warn': 'Warning',
      'delete': 'Message Deleted'
    };
    return map[type] || type;
  }
}
