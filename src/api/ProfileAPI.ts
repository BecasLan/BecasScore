/**
 * PROFILE API - View and manage user character profiles
 *
 * Endpoints:
 * - GET /profile/:userId - Get user profile
 * - POST /profile/:userId/rebuild - Force rebuild profile
 * - GET /profile/:userId/traits - Get specific trait categories
 * - GET /profile/compare/:userId1/:userId2 - Compare two profiles
 * - GET /profiles/server/:serverId - Get all profiles for server
 * - GET /profiles/risky - Get high-risk users
 */

import { Router, Request, Response } from 'express';
import { ProfileBuilder, UserCharacterProfile } from '../services/ProfileBuilder';
import { TrustScoreCalculator } from '../services/TrustScoreCalculator';
import { ProfileUpdateAutomation } from '../services/ProfileUpdateAutomation';
import { UserRepository } from '../database/repositories/UserRepository';
import { MessageRepository } from '../database/repositories/MessageRepository';
import { SicilRepository } from '../database/repositories/SicilRepository';
import { createLogger } from '../services/Logger';

const logger = createLogger('ProfileAPI');

export class ProfileAPI {
  router: Router;

  constructor(
    private profileBuilder: ProfileBuilder,
    private trustCalculator: TrustScoreCalculator,
    private profileAutomation: ProfileUpdateAutomation,
    private userRepo: UserRepository,
    private messageRepo: MessageRepository,
    private sicilRepo: SicilRepository
  ) {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Get user profile
    this.router.get('/profile/:userId', this.getProfile.bind(this));

    // Force rebuild profile
    this.router.post('/profile/:userId/rebuild', this.rebuildProfile.bind(this));

    // Get specific trait category
    this.router.get('/profile/:userId/traits/:category', this.getTraits.bind(this));

    // Compare two users
    this.router.get('/profile/compare/:userId1/:userId2', this.compareProfiles.bind(this));

    // Get all profiles for server (paginated)
    this.router.get('/profiles/server/:serverId', this.getServerProfiles.bind(this));

    // Get high-risk users
    this.router.get('/profiles/risky/:serverId', this.getRiskyUsers.bind(this));

    // Get update automation stats
    this.router.get('/profiles/stats', this.getStats.bind(this));
  }

  /**
   * GET /profile/:userId?serverId=xxx
   * Get user profile with trust score
   */
  private async getProfile(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;
    const { serverId } = req.query;

    if (!serverId) {
      res.status(400).json({ error: 'serverId query parameter required' });
      return;
    }

    try {
      logger.info(`Fetching profile for user ${userId} in server ${serverId}`);

      // Get or build profile
      const profile = await this.profileBuilder.buildProfile(
        userId,
        serverId as string,
        10
      );

      if (!profile) {
        res.status(404).json({
          error: 'Profile not available',
          reason: 'Not enough messages (minimum 10 required)',
        });
        return;
      }

      // Calculate trust score with profile
      const sicilSummary = await this.sicilRepo.getSicilSummary(serverId as string, userId);
      const violations = {
        warnings: sicilSummary.total_warnings,
        timeouts: sicilSummary.total_timeouts,
        kicks: sicilSummary.total_kicks,
        bans: sicilSummary.total_bans,
      };

      const lastViolation = sicilSummary.last_violation_at;
      const cleanStreak = lastViolation
        ? Math.floor((Date.now() - lastViolation.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const trustFactors = this.trustCalculator.calculateTrustScore(
        violations,
        cleanStreak,
        0, // helpful actions
        profile
      );

      const trustLevel = this.trustCalculator.getTrustLevel(trustFactors.finalScore);
      const trustColor = this.trustCalculator.getTrustLevelColor(trustFactors.finalScore);

      res.json({
        profile,
        trust: {
          score: trustFactors.finalScore,
          level: trustLevel,
          color: trustColor,
          factors: trustFactors,
          explanation: this.trustCalculator.explainScore(trustFactors),
        },
        sicil: sicilSummary,
      });

    } catch (error) {
      logger.error('Failed to get profile', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }

  /**
   * POST /profile/:userId/rebuild?serverId=xxx
   * Force rebuild user profile
   */
  private async rebuildProfile(req: Request, res: Response): Promise<void> {
    const { userId } = req.params;
    const { serverId } = req.query;

    if (!serverId) {
      res.status(400).json({ error: 'serverId query parameter required' });
      return;
    }

    try {
      logger.info(`Manual profile rebuild requested for ${userId}`);

      const profile = await this.profileAutomation.manualRebuild(
        userId,
        serverId as string
      );

      if (!profile) {
        res.status(404).json({
          error: 'Profile rebuild failed',
          reason: 'Not enough messages',
        });
        return;
      }

      res.json({
        success: true,
        profile,
        message: 'Profile rebuilt successfully',
      });

    } catch (error) {
      logger.error('Failed to rebuild profile', error);
      res.status(500).json({ error: 'Failed to rebuild profile' });
    }
  }

  /**
   * GET /profile/:userId/traits/:category?serverId=xxx
   * Get specific trait category (personality, behavior, social, etc.)
   */
  private async getTraits(req: Request, res: Response): Promise<void> {
    const { userId, category } = req.params;
    const { serverId } = req.query;

    if (!serverId) {
      res.status(400).json({ error: 'serverId query parameter required' });
      return;
    }

    const validCategories = ['personality', 'behavior', 'social', 'timePatterns', 'language', 'riskIndicators'];
    if (!validCategories.includes(category)) {
      res.status(400).json({
        error: 'Invalid category',
        validCategories,
      });
      return;
    }

    try {
      const profile = await this.profileBuilder.buildProfile(
        userId,
        serverId as string,
        10
      );

      if (!profile) {
        res.status(404).json({ error: 'Profile not available' });
        return;
      }

      res.json({
        userId,
        category,
        traits: profile[category as keyof UserCharacterProfile],
        confidence: profile.confidence,
        lastUpdated: profile.lastUpdated,
      });

    } catch (error) {
      logger.error('Failed to get traits', error);
      res.status(500).json({ error: 'Failed to fetch traits' });
    }
  }

  /**
   * GET /profile/compare/:userId1/:userId2?serverId=xxx
   * Compare two user profiles
   */
  private async compareProfiles(req: Request, res: Response): Promise<void> {
    const { userId1, userId2 } = req.params;
    const { serverId } = req.query;

    if (!serverId) {
      res.status(400).json({ error: 'serverId query parameter required' });
      return;
    }

    try {
      const [profile1, profile2] = await Promise.all([
        this.profileBuilder.buildProfile(userId1, serverId as string, 10),
        this.profileBuilder.buildProfile(userId2, serverId as string, 10),
      ]);

      if (!profile1 || !profile2) {
        res.status(404).json({
          error: 'One or both profiles not available',
          profile1Available: !!profile1,
          profile2Available: !!profile2,
        });
        return;
      }

      // Calculate differences
      const comparison = {
        users: {
          user1: userId1,
          user2: userId2,
        },
        personality: this.compareTraits(profile1.personality, profile2.personality),
        behavior: this.compareTraits(profile1.behavior, profile2.behavior),
        social: this.compareTraits(profile1.social, profile2.social),
        riskIndicators: this.compareTraits(profile1.riskIndicators, profile2.riskIndicators),
        summary: {
          similarityScore: this.calculateSimilarity(profile1, profile2),
          biggestDifferences: this.findBiggestDifferences(profile1, profile2),
        },
      };

      res.json(comparison);

    } catch (error) {
      logger.error('Failed to compare profiles', error);
      res.status(500).json({ error: 'Failed to compare profiles' });
    }
  }

  /**
   * GET /profiles/server/:serverId?limit=50&offset=0
   * Get all profiles for server (paginated)
   */
  private async getServerProfiles(req: Request, res: Response): Promise<void> {
    const { serverId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    try {
      // TODO: Implement database query for all server profiles
      // For now, return placeholder
      res.json({
        serverId,
        profiles: [],
        total: 0,
        limit,
        offset,
        message: 'Server profile listing not fully implemented',
      });

    } catch (error) {
      logger.error('Failed to get server profiles', error);
      res.status(500).json({ error: 'Failed to fetch server profiles' });
    }
  }

  /**
   * GET /profiles/risky/:serverId?threshold=0.7&limit=20
   * Get high-risk users (sorted by risk score)
   */
  private async getRiskyUsers(req: Request, res: Response): Promise<void> {
    const { serverId } = req.params;
    const threshold = parseFloat(req.query.threshold as string) || 0.7;
    const limit = parseInt(req.query.limit as string) || 20;

    try {
      // TODO: Implement database query for risky users
      // Would query user_character_profiles table for:
      // - High riskIndicators.deception
      // - High riskIndicators.manipulation
      // - High riskIndicators.predatoryBehavior
      // - Low personality.empathy + high personality.aggression

      res.json({
        serverId,
        riskyUsers: [],
        threshold,
        limit,
        message: 'Risky user listing not fully implemented',
      });

    } catch (error) {
      logger.error('Failed to get risky users', error);
      res.status(500).json({ error: 'Failed to fetch risky users' });
    }
  }

  /**
   * GET /profiles/stats
   * Get profile update automation statistics
   */
  private async getStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = this.profileAutomation.getStats();
      res.json(stats);
    } catch (error) {
      logger.error('Failed to get stats', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  }

  /**
   * Helper: Compare two trait objects
   */
  private compareTraits(traits1: any, traits2: any): any {
    const result: any = {};
    for (const key in traits1) {
      if (typeof traits1[key] === 'number' && typeof traits2[key] === 'number') {
        result[key] = {
          user1: traits1[key],
          user2: traits2[key],
          difference: Math.abs(traits1[key] - traits2[key]),
          percentDiff: Math.abs((traits1[key] - traits2[key]) / Math.max(traits1[key], traits2[key], 0.01) * 100),
        };
      }
    }
    return result;
  }

  /**
   * Helper: Calculate overall profile similarity (0-1)
   */
  private calculateSimilarity(profile1: UserCharacterProfile, profile2: UserCharacterProfile): number {
    // Calculate similarity across all numeric traits
    let totalDiff = 0;
    let traitCount = 0;

    const categories = ['personality', 'behavior', 'social', 'riskIndicators'];
    for (const category of categories) {
      const traits1 = profile1[category as keyof UserCharacterProfile] as any;
      const traits2 = profile2[category as keyof UserCharacterProfile] as any;

      for (const key in traits1) {
        if (typeof traits1[key] === 'number' && typeof traits2[key] === 'number') {
          totalDiff += Math.abs(traits1[key] - traits2[key]);
          traitCount++;
        }
      }
    }

    const avgDiff = totalDiff / traitCount;
    return Math.max(0, 1 - avgDiff); // Convert difference to similarity
  }

  /**
   * Helper: Find biggest differences between profiles
   */
  private findBiggestDifferences(
    profile1: UserCharacterProfile,
    profile2: UserCharacterProfile
  ): Array<{ trait: string; category: string; difference: number }> {
    const differences: Array<{ trait: string; category: string; difference: number }> = [];

    const categories = ['personality', 'behavior', 'social', 'riskIndicators'];
    for (const category of categories) {
      const traits1 = profile1[category as keyof UserCharacterProfile] as any;
      const traits2 = profile2[category as keyof UserCharacterProfile] as any;

      for (const key in traits1) {
        if (typeof traits1[key] === 'number' && typeof traits2[key] === 'number') {
          differences.push({
            trait: key,
            category,
            difference: Math.abs(traits1[key] - traits2[key]),
          });
        }
      }
    }

    // Sort by difference descending, return top 5
    return differences.sort((a, b) => b.difference - a.difference).slice(0, 5);
  }

  /**
   * Get Express router
   */
  getRouter(): Router {
    return this.router;
  }
}
