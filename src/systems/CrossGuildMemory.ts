
import { StorageService } from '../services/StorageService';
import { TrustScore } from '../types/Trust.types';

export interface GlobalBanRecord {
  userId: string;
  userName: string;
  reason: string;
  bannedAt: Date;
  bannedBy: string; // 'system' or guildId
  severity: 'critical' | 'high' | 'medium';
  evidence: string[];
  isPermanent: boolean;
  guildsToban: string[]; // List of guilds where user should be banned
}

interface CrossGuildReputation {
  userId: string;
  userName?: string;
  globalScore: number;
  guilds: {
    guildId: string;
    localScore: number;
    lastSeen: Date;
  }[];
  flags: string[];
  banRecord?: GlobalBanRecord;
  lastUpdated: Date;
}

export class CrossGuildMemory {
  private storage: StorageService;
  private reputations: Map<string, CrossGuildReputation> = new Map();
  private globalBans: Map<string, GlobalBanRecord> = new Map();

  constructor(storage: StorageService) {
    this.storage = storage;
    this.loadReputations();
  }

  private async loadReputations(): Promise<void> {
    try {
      // Load reputations from storage
      const data = await this.storage.read<any>('crossguild', 'reputations.json');
      if (data && data.reputations) {
        Object.entries(data.reputations).forEach(([userId, rep]: [string, any]) => {
          // Convert date strings back to Date objects
          rep.lastUpdated = new Date(rep.lastUpdated);
          rep.guilds.forEach((g: any) => {
            g.lastSeen = new Date(g.lastSeen);
          });
          if (rep.banRecord) {
            rep.banRecord.bannedAt = new Date(rep.banRecord.bannedAt);
            this.globalBans.set(userId, rep.banRecord);
          }
          this.reputations.set(userId, rep);
        });
        console.log(`✓ Loaded ${this.reputations.size} cross-guild reputations`);
        console.log(`✓ Loaded ${this.globalBans.size} global bans`);
      }
    } catch (error) {
      console.log('No existing cross-guild data found, starting fresh');
    }
  }

  private async saveReputations(): Promise<void> {
    const data = {
      reputations: Object.fromEntries(this.reputations),
      lastUpdated: new Date().toISOString(),
    };
    await this.storage.write('crossguild', 'reputations.json', data);
  }

  async updateReputation(userId: string, guildId: string, trustScore: TrustScore): Promise<void> {
    let reputation = this.reputations.get(userId);

    if (!reputation) {
      reputation = {
        userId,
        globalScore: 100,
        guilds: [],
        flags: [],
        lastUpdated: new Date(),
      };
      this.reputations.set(userId, reputation);
    }

    // Update guild-specific score
    const guildIndex = reputation.guilds.findIndex(g => g.guildId === guildId);
    if (guildIndex >= 0) {
      reputation.guilds[guildIndex].localScore = trustScore.score;
      reputation.guilds[guildIndex].lastSeen = new Date();
    } else {
      reputation.guilds.push({
        guildId,
        localScore: trustScore.score,
        lastSeen: new Date(),
      });
    }

    // Calculate global score (average across guilds)
    reputation.globalScore = reputation.guilds.reduce((sum, g) => sum + g.localScore, 0) / reputation.guilds.length;

    // Add flags for dangerous users
    if (trustScore.score < 30 && !reputation.flags.includes('dangerous')) {
      reputation.flags.push('dangerous');
    }

    reputation.lastUpdated = new Date();
  }

  getGlobalReputation(userId: string): CrossGuildReputation | undefined {
    return this.reputations.get(userId);
  }

  hasNegativeHistory(userId: string): boolean {
    const reputation = this.reputations.get(userId);
    if (!reputation) return false;

    return reputation.globalScore < 50 || reputation.flags.includes('dangerous');
  }

  /**
   * Add a user to the global ban list
   */
  async addGlobalBan(
    userId: string,
    userName: string,
    reason: string,
    evidence: string[],
    severity: 'critical' | 'high' | 'medium',
    bannedBy: string = 'system'
  ): Promise<GlobalBanRecord> {
    const banRecord: GlobalBanRecord = {
      userId,
      userName,
      reason,
      bannedAt: new Date(),
      bannedBy,
      severity,
      evidence,
      isPermanent: severity === 'critical', // Critical = permanent
      guildsToban: [], // Will be populated as user joins guilds
    };

    this.globalBans.set(userId, banRecord);

    // Update reputation
    let reputation = this.reputations.get(userId);
    if (!reputation) {
      reputation = {
        userId,
        userName,
        globalScore: 0, // Banned users get 0 score
        guilds: [],
        flags: ['globally_banned', `banned_${severity}`],
        banRecord,
        lastUpdated: new Date(),
      };
    } else {
      reputation.globalScore = 0;
      reputation.banRecord = banRecord;
      reputation.flags.push('globally_banned', `banned_${severity}`);
    }

    this.reputations.set(userId, reputation);
    await this.saveReputations();

    console.log(`🚫 Global ban added for ${userName} (${userId})`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Severity: ${severity}`);
    console.log(`   Permanent: ${banRecord.isPermanent}`);

    return banRecord;
  }

  /**
   * Check if user is globally banned
   */
  isGloballyBanned(userId: string): boolean {
    return this.globalBans.has(userId);
  }

  /**
   * Get ban record for user
   */
  getBanRecord(userId: string): GlobalBanRecord | undefined {
    return this.globalBans.get(userId);
  }

  /**
   * Add guild to user's ban list
   */
  async addGuildToBan(userId: string, guildId: string): Promise<void> {
    const banRecord = this.globalBans.get(userId);
    if (banRecord && !banRecord.guildsToban.includes(guildId)) {
      banRecord.guildsToban.push(guildId);
      await this.saveReputations();
      console.log(`📝 Added guild ${guildId} to ban list for user ${userId}`);
    }
  }

  /**
   * Get all globally banned users
   */
  getAllBans(): GlobalBanRecord[] {
    return Array.from(this.globalBans.values());
  }

  /**
   * Get banned users by severity
   */
  getBansBySeverity(severity: 'critical' | 'high' | 'medium'): GlobalBanRecord[] {
    return Array.from(this.globalBans.values()).filter(b => b.severity === severity);
  }

  /**
   * Check if user should be auto-banned in this guild
   */
  shouldAutoBanInGuild(userId: string, guildId: string): {
    shouldBan: boolean;
    reason: string;
    banRecord?: GlobalBanRecord;
  } {
    const banRecord = this.globalBans.get(userId);

    if (!banRecord) {
      return { shouldBan: false, reason: '' };
    }

    // If user is globally banned, they should be banned in all guilds
    return {
      shouldBan: true,
      reason: `Globally banned: ${banRecord.reason}`,
      banRecord,
    };
  }
}