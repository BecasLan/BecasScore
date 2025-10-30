import { Client, Guild, Message, TextChannel } from 'discord.js';
import { ServerMapper } from './ServerMapper';
import { DeepUserProfiler } from './DeepUserProfiler';
import { StorageService } from '../services/StorageService';

/**
 * AUTONOMOUS LEARNING - Background Learning System
 *
 * This system continuously learns about the server in the background:
 * - Every 1 hour: Update user profiles from recent messages
 * - Every 6 hours: Re-map active channels
 * - Every 24 hours: Full server re-mapping
 * - On startup: Load cached data
 *
 * Makes Becas smarter over time without user intervention.
 */

export interface LearningStats {
  lastUserProfileUpdate: Date;
  lastChannelRemap: Date;
  lastFullRemap: Date;
  totalMessagesSeen: number;
  totalUsersProfiled: number;
  totalChannelsMapped: number;
  learningCycles: number;
}

export class AutonomousLearning {
  private client: Client;
  private serverMapper: ServerMapper;
  private userProfiler: DeepUserProfiler;
  private storage: StorageService;

  private stats: LearningStats;
  private isRunning: boolean = false;

  // Timers
  private userProfileTimer?: NodeJS.Timeout;
  private channelRemapTimer?: NodeJS.Timeout;
  private fullRemapTimer?: NodeJS.Timeout;
  private quickScanTimer?: NodeJS.Timeout;      // NEW: 30-minute quick scan

  // Learning intervals (in ms)
  private readonly INTERVALS = {
    USER_PROFILE_UPDATE: 60 * 60 * 1000,      // 1 hour
    CHANNEL_REMAP: 6 * 60 * 60 * 1000,        // 6 hours
    FULL_REMAP: 24 * 60 * 60 * 1000,          // 24 hours
    QUICK_SCAN: 30 * 60 * 1000                // 30 minutes - PRODUCTION
  };

  constructor(
    client: Client,
    serverMapper: ServerMapper,
    userProfiler: DeepUserProfiler,
    storage: StorageService
  ) {
    this.client = client;
    this.serverMapper = serverMapper;
    this.userProfiler = userProfiler;
    this.storage = storage;

    this.stats = {
      lastUserProfileUpdate: new Date(0),
      lastChannelRemap: new Date(0),
      lastFullRemap: new Date(0),
      totalMessagesSeen: 0,
      totalUsersProfiled: 0,
      totalChannelsMapped: 0,
      learningCycles: 0
    };

    console.log('🧠 AutonomousLearning initialized - AI will learn continuously');
  }

  /**
   * Start autonomous learning
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Autonomous learning already running');
      return;
    }

    console.log('\n🧠 ===== STARTING AUTONOMOUS LEARNING =====');
    this.isRunning = true;

    // Load cached data on startup
    await this.loadCache();

    // Start learning cycles
    this.startUserProfileUpdates();
    this.startChannelRemapping();
    this.startFullRemapping();
    this.startQuickScanning();  // NEW: 30-minute quick scan

    console.log('✅ Autonomous learning started');
    console.log(`  Quick scan: every ${this.INTERVALS.QUICK_SCAN / 1000 / 60} minutes (detects changes)`);
    console.log(`  User profiles: every ${this.INTERVALS.USER_PROFILE_UPDATE / 1000 / 60} minutes`);
    console.log(`  Channel remap: every ${this.INTERVALS.CHANNEL_REMAP / 1000 / 60 / 60} hours`);
    console.log(`  Full remap: every ${this.INTERVALS.FULL_REMAP / 1000 / 60 / 60} hours`);
  }

  /**
   * Stop autonomous learning
   */
  stop(): void {
    console.log('🛑 Stopping autonomous learning...');

    if (this.userProfileTimer) clearInterval(this.userProfileTimer);
    if (this.channelRemapTimer) clearInterval(this.channelRemapTimer);
    if (this.fullRemapTimer) clearInterval(this.fullRemapTimer);
    if (this.quickScanTimer) clearInterval(this.quickScanTimer);  // NEW

    this.isRunning = false;
    console.log('✅ Autonomous learning stopped');
  }

  /**
   * Load cached data on startup
   */
  async loadCache(): Promise<void> {
    console.log('📂 Loading cached data...');

    try {
      // Load server maps
      await this.serverMapper.loadCache();

      // Load user profiles
      await this.userProfiler.loadProfiles();

      // Load stats
      const cachedStats = await this.storage.load('learning_stats.json') as LearningStats | null;
      if (cachedStats) {
        this.stats = {
          ...cachedStats,
          lastUserProfileUpdate: new Date(cachedStats.lastUserProfileUpdate),
          lastChannelRemap: new Date(cachedStats.lastChannelRemap),
          lastFullRemap: new Date(cachedStats.lastFullRemap)
        };
        console.log(`  Loaded stats: ${this.stats.totalUsersProfiled} users, ${this.stats.totalChannelsMapped} channels`);
      }

      console.log('✅ Cache loaded successfully');
    } catch (error) {
      console.error('Failed to load cache:', error);
    }
  }

  /**
   * Save data to cache
   */
  private async saveCache(): Promise<void> {
    try {
      await this.serverMapper.saveCache();
      await this.userProfiler.saveProfiles();
      await this.storage.save('learning_stats.json', this.stats);
    } catch (error) {
      console.error('Failed to save cache:', error);
    }
  }

  /**
   * Start user profile update cycle
   */
  private startUserProfileUpdates(): void {
    // Run immediately on start
    this.updateUserProfiles();

    // Then run every hour
    this.userProfileTimer = setInterval(() => {
      this.updateUserProfiles();
    }, this.INTERVALS.USER_PROFILE_UPDATE);
  }

  /**
   * Update user profiles from recent messages
   */
  private async updateUserProfiles(): Promise<void> {
    console.log('\n👥 ===== UPDATING USER PROFILES =====');

    const guilds = this.client.guilds.cache;
    let totalUpdated = 0;

    for (const [guildId, guild] of guilds) {
      try {
        console.log(`  Processing guild: ${guild.name}`);

        // Get all text channels
        const channels = guild.channels.cache.filter(
          ch => ch.isTextBased() && ch.type === 0
        ) as Map<string, TextChannel>;

        for (const [channelId, channel] of channels) {
          try {
            // Fetch recent messages (last 100)
            const messages = await channel.messages.fetch({ limit: 100 });

            // Group messages by user
            const userMessages = new Map<string, Message[]>();

            messages.forEach(msg => {
              if (msg.author.bot) return; // Skip bots

              if (!userMessages.has(msg.author.id)) {
                userMessages.set(msg.author.id, []);
              }
              userMessages.get(msg.author.id)!.push(msg);
            });

            // Update profiles for each user
            for (const [userId, msgs] of userMessages) {
              if (msgs.length > 0) {
                await this.userProfiler.analyzeUser(
                  userId,
                  msgs[0].author.username,
                  msgs
                );
                totalUpdated++;
                this.stats.totalMessagesSeen += msgs.length;
              }
            }

            // Rate limiting
            await this.sleep(2000);

          } catch (error) {
            console.error(`  Error processing channel ${channel.name}:`, error);
          }
        }

      } catch (error) {
        console.error(`Error processing guild ${guild.name}:`, error);
      }
    }

    this.stats.lastUserProfileUpdate = new Date();
    this.stats.totalUsersProfiled = this.userProfiler.getAllProfiles().length;
    this.stats.learningCycles++;

    console.log(`✅ User profile update complete: ${totalUpdated} profiles updated`);

    await this.saveCache();
  }

  /**
   * Start channel remapping cycle
   */
  private startChannelRemapping(): void {
    // Run after 10 minutes on start (give time for initial load)
    setTimeout(() => {
      this.remapActiveChannels();
    }, 10 * 60 * 1000);

    // Then run every 6 hours
    this.channelRemapTimer = setInterval(() => {
      this.remapActiveChannels();
    }, this.INTERVALS.CHANNEL_REMAP);
  }

  /**
   * Re-map active channels
   */
  private async remapActiveChannels(): Promise<void> {
    console.log('\n📊 ===== REMAPPING ACTIVE CHANNELS =====');

    const guilds = this.client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        const serverMap = this.serverMapper.getServerMap(guildId);

        if (!serverMap) {
          console.log(`  No map found for ${guild.name}, skipping...`);
          continue;
        }

        console.log(`  Updating ${guild.name}...`);

        // Only re-map channels that have been active
        const activeChannels = Array.from(serverMap.channels.values())
          .filter(ch => ch.activityLevel !== 'low');

        console.log(`  Found ${activeChannels.length} active channels to update`);

        // Re-map the server (this will update all channels)
        await this.serverMapper.mapServer(guild);

        this.stats.totalChannelsMapped = serverMap.channels.size;

      } catch (error) {
        console.error(`Error remapping guild ${guild.name}:`, error);
      }
    }

    this.stats.lastChannelRemap = new Date();
    console.log('✅ Channel remapping complete');

    await this.saveCache();
  }

  /**
   * Start full remapping cycle
   */
  private startFullRemapping(): void {
    // Run after 1 hour on start
    setTimeout(() => {
      this.fullServerRemap();
    }, 60 * 60 * 1000);

    // Then run every 24 hours
    this.fullRemapTimer = setInterval(() => {
      this.fullServerRemap();
    }, this.INTERVALS.FULL_REMAP);
  }

  /**
   * Full server re-mapping
   */
  private async fullServerRemap(): Promise<void> {
    console.log('\n🗺️ ===== FULL SERVER REMAP =====');

    const guilds = this.client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        console.log(`  Mapping entire server: ${guild.name}`);

        const structure = await this.serverMapper.mapServer(guild);

        this.stats.totalChannelsMapped = structure.channels.size;

        console.log(`  ✅ Mapped ${structure.channels.size} channels, ${structure.roles.size} roles`);

      } catch (error) {
        console.error(`Error mapping guild ${guild.name}:`, error);
      }
    }

    this.stats.lastFullRemap = new Date();
    console.log('✅ Full server remap complete');

    await this.saveCache();
  }

  /**
   * Get learning statistics
   */
  getStats(): LearningStats {
    return { ...this.stats };
  }

  /**
   * Manual trigger: Update all profiles now
   */
  async triggerProfileUpdate(): Promise<void> {
    console.log('🔄 Manual trigger: Updating user profiles...');
    await this.updateUserProfiles();
  }

  /**
   * Manual trigger: Remap all channels now
   */
  async triggerChannelRemap(): Promise<void> {
    console.log('🔄 Manual trigger: Remapping channels...');
    await this.remapActiveChannels();
  }

  /**
   * Manual trigger: Full server remap now
   */
  async triggerFullRemap(): Promise<void> {
    console.log('🔄 Manual trigger: Full server remap...');
    await this.fullServerRemap();
  }

  /**
   * Start quick scanning cycle (30 minutes)
   * Detects server changes: new channels, role updates, rule changes
   */
  private startQuickScanning(): void {
    // Run after 5 minutes on start
    setTimeout(() => {
      this.quickServerScan();
    }, 5 * 60 * 1000);

    // Then run every 30 minutes
    this.quickScanTimer = setInterval(() => {
      this.quickServerScan();
    }, this.INTERVALS.QUICK_SCAN);
  }

  /**
   * Quick server scan - detects changes without full remap
   * Checks: new channels, deleted channels, role changes, member count
   */
  private async quickServerScan(): Promise<void> {
    console.log('\n🔍 ===== QUICK SERVER SCAN =====');

    const guilds = this.client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        const oldMap = this.serverMapper.getServerMap(guildId);

        if (!oldMap) {
          // No previous map - do a full map
          console.log(`  No previous map for ${guild.name}, doing full map...`);
          await this.serverMapper.mapServer(guild);
          continue;
        }

        // Check for changes
        const changes: string[] = [];

        // 1. Channel count changed?
        const currentChannelCount = guild.channels.cache.filter(ch => ch.isTextBased()).size;
        if (currentChannelCount !== oldMap.channels.size) {
          changes.push(`Channels: ${oldMap.channels.size} → ${currentChannelCount}`);
        }

        // 2. Role count changed?
        const currentRoleCount = guild.roles.cache.size;
        if (currentRoleCount !== oldMap.roles.size) {
          changes.push(`Roles: ${oldMap.roles.size} → ${currentRoleCount}`);
        }

        // 3. Member count changed significantly? (>10% change)
        const currentMemberCount = guild.memberCount;
        const memberChange = Math.abs(currentMemberCount - oldMap.totalMembers);
        const memberChangePercent = (memberChange / oldMap.totalMembers) * 100;
        if (memberChangePercent > 10) {
          changes.push(`Members: ${oldMap.totalMembers} → ${currentMemberCount} (${memberChangePercent.toFixed(1)}%)`);
        }

        if (changes.length > 0) {
          console.log(`  📊 ${guild.name} - Changes detected:`);
          changes.forEach(change => console.log(`     - ${change}`));
          console.log(`  🔄 Triggering full remap...`);

          // Changes detected - do a full remap
          await this.serverMapper.mapServer(guild);
        } else {
          console.log(`  ✅ ${guild.name} - No significant changes`);
        }

      } catch (error) {
        console.error(`Error scanning guild ${guild.name}:`, error);
      }
    }

    console.log('✅ Quick server scan complete\n');
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get status report
   */
  getStatusReport(): string {
    const now = new Date();
    const timeSinceUserUpdate = Math.floor((now.getTime() - this.stats.lastUserProfileUpdate.getTime()) / 1000 / 60);
    const timeSinceChannelRemap = Math.floor((now.getTime() - this.stats.lastChannelRemap.getTime()) / 1000 / 60);
    const timeSinceFullRemap = Math.floor((now.getTime() - this.stats.lastFullRemap.getTime()) / 1000 / 60 / 60);

    return `**Autonomous Learning Status:**\n\n` +
      `🔄 Status: ${this.isRunning ? 'Running' : 'Stopped'}\n` +
      `📊 Learning Cycles: ${this.stats.learningCycles}\n\n` +
      `**Last Updates:**\n` +
      `👥 User Profiles: ${timeSinceUserUpdate} minutes ago\n` +
      `📊 Channel Remap: ${timeSinceChannelRemap} minutes ago\n` +
      `🗺️ Full Remap: ${timeSinceFullRemap} hours ago\n\n` +
      `**Totals:**\n` +
      `💬 Messages Seen: ${this.stats.totalMessagesSeen}\n` +
      `👥 Users Profiled: ${this.stats.totalUsersProfiled}\n` +
      `📁 Channels Mapped: ${this.stats.totalChannelsMapped}`;
  }
}
