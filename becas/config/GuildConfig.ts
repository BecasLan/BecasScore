import { StorageService } from '../services/StorageService';
import { createLogger } from '../services/Logger';

const logger = createLogger('GuildConfig');

export interface GuildFeatures {
  scamDetection: boolean;
  emotionalSupport: boolean;
  conflictPrediction: boolean;
  languageDetection: boolean;
  imageAnalysis: boolean;
  userProfiling: boolean;
  networkAnalysis: boolean;
  smartSlowmode: boolean;
  reactionVoting: boolean;
  aiJury: boolean;
  behaviorRehabilitation: boolean;
  crossGuildReputation: boolean;
}

export interface GuildPerformance {
  maxAiCallsPerMessage: number;
  responseTimeoutMs: number;
  enableCaching: boolean;
  prioritySystemEnabled: boolean;
}

export interface GuildModeration {
  autoBanScammers: boolean;
  trustDecayRate: number;
  autoModeration: boolean;
  warningThreshold: number;
  timeoutThreshold: number;
  banThreshold: number;
  exemptModerators: boolean;
}

export interface GuildAISettings {
  sensitivity: 'low' | 'medium' | 'high';
  temperature: number;
  maxResponseLength: number;
  personalityIntensity: number;
}

export interface GuildConfiguration {
  guildId: string;
  guildName: string;
  features: GuildFeatures;
  performance: GuildPerformance;
  moderation: GuildModeration;
  ai: GuildAISettings;
  updatedAt: Date;
}

// Default configuration
const DEFAULT_CONFIG: Omit<GuildConfiguration, 'guildId' | 'guildName'> = {
  features: {
    scamDetection: true,
    emotionalSupport: true,
    conflictPrediction: false, // Too chatty
    languageDetection: true,
    imageAnalysis: true,
    userProfiling: true,
    networkAnalysis: false, // Expensive
    smartSlowmode: true,
    reactionVoting: true,
    aiJury: false, // Experimental
    behaviorRehabilitation: true,
    crossGuildReputation: true,
  },
  performance: {
    maxAiCallsPerMessage: 3,
    responseTimeoutMs: 5000,
    enableCaching: true,
    prioritySystemEnabled: true,
  },
  moderation: {
    autoBanScammers: true,
    trustDecayRate: 0.95,
    autoModeration: true,
    warningThreshold: 60,
    timeoutThreshold: 40,
    banThreshold: 20,
    exemptModerators: true,
  },
  ai: {
    sensitivity: 'medium',
    temperature: 0.8,
    maxResponseLength: 500,
    personalityIntensity: 0.8,
  },
  updatedAt: new Date(),
};

export class GuildConfigManager {
  private storage: StorageService;
  private configs: Map<string, GuildConfiguration> = new Map();

  constructor(storage: StorageService) {
    this.storage = storage;
    this.loadConfigs();
  }

  /**
   * Load all guild configurations from storage
   */
  private async loadConfigs(): Promise<void> {
    try {
      const data = await this.storage.read<any>('', 'guild-configs.json');
      if (data && Array.isArray(data)) {
        data.forEach((config: any) => {
          // Parse dates
          config.updatedAt = new Date(config.updatedAt);
          this.configs.set(config.guildId, config);
        });
        logger.info(`Loaded ${this.configs.size} guild configurations`);
      }
    } catch (error) {
      logger.warn('No existing guild configurations found, starting fresh');
    }
  }

  /**
   * Save all configurations to storage
   */
  private async saveConfigs(): Promise<void> {
    try {
      const data = Array.from(this.configs.values());
      await this.storage.write('', 'guild-configs.json', data);
      logger.debug(`Saved ${data.length} guild configurations`);
    } catch (error) {
      logger.error('Failed to save guild configurations', error);
    }
  }

  /**
   * Get configuration for a guild
   */
  getConfig(guildId: string, guildName?: string): GuildConfiguration {
    if (!this.configs.has(guildId)) {
      // Create default config for new guild
      const newConfig: GuildConfiguration = {
        guildId,
        guildName: guildName || 'Unknown Guild',
        ...DEFAULT_CONFIG,
      };
      this.configs.set(guildId, newConfig);
      this.saveConfigs();
      logger.info(`Created default configuration for guild: ${guildName} (${guildId})`);
    }
    return this.configs.get(guildId)!;
  }

  /**
   * Update guild configuration
   */
  async updateConfig(guildId: string, updates: Partial<GuildConfiguration>): Promise<GuildConfiguration> {
    const current = this.getConfig(guildId);
    const updated: GuildConfiguration = {
      ...current,
      ...updates,
      updatedAt: new Date(),
    };
    this.configs.set(guildId, updated);
    await this.saveConfigs();
    logger.info(`Updated configuration for guild: ${guildId}`, { updates });
    return updated;
  }

  /**
   * Check if a feature is enabled for a guild
   */
  isFeatureEnabled(guildId: string, feature: keyof GuildFeatures): boolean {
    const config = this.getConfig(guildId);
    return config.features[feature];
  }

  /**
   * Enable/disable a feature
   */
  async toggleFeature(guildId: string, feature: keyof GuildFeatures, enabled: boolean): Promise<void> {
    const config = this.getConfig(guildId);
    config.features[feature] = enabled;
    config.updatedAt = new Date();
    this.configs.set(guildId, config);
    await this.saveConfigs();
    logger.info(`${enabled ? 'Enabled' : 'Disabled'} feature ${feature} for guild ${guildId}`);
  }

  /**
   * Get all configurations (for admin dashboard)
   */
  getAllConfigs(): GuildConfiguration[] {
    return Array.from(this.configs.values());
  }

  /**
   * Reset guild to default configuration
   */
  async resetToDefault(guildId: string, guildName?: string): Promise<GuildConfiguration> {
    const config: GuildConfiguration = {
      guildId,
      guildName: guildName || this.configs.get(guildId)?.guildName || 'Unknown Guild',
      ...DEFAULT_CONFIG,
    };
    this.configs.set(guildId, config);
    await this.saveConfigs();
    logger.info(`Reset configuration to defaults for guild: ${guildId}`);
    return config;
  }

  /**
   * Export configuration as JSON
   */
  exportConfig(guildId: string): string {
    const config = this.getConfig(guildId);
    return JSON.stringify(config, null, 2);
  }

  /**
   * Import configuration from JSON
   */
  async importConfig(guildId: string, jsonConfig: string): Promise<GuildConfiguration> {
    try {
      const config = JSON.parse(jsonConfig);
      config.guildId = guildId; // Ensure correct guild ID
      config.updatedAt = new Date();
      this.configs.set(guildId, config);
      await this.saveConfigs();
      logger.info(`Imported configuration for guild: ${guildId}`);
      return config;
    } catch (error) {
      logger.error(`Failed to import configuration for guild ${guildId}`, error);
      throw new Error('Invalid configuration JSON');
    }
  }
}
