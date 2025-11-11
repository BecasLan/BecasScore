import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { BecasCore } from './core/BecasCore';
import { ENV } from './config/environment';
import { AdminServer } from './api/AdminServer';
import { DashboardAPI } from './api/DashboardAPI';
import { GuildCommandAPI } from './api/GuildCommandAPI';
import { GuildConfigManager } from './config/GuildConfig';
import { OllamaConnectionPool } from './services/OllamaConnectionPool';
import { StorageService } from './services/StorageService';
import { createLogger } from './services/Logger';
import { verifyDatabaseConnection } from './startup-check';
import { OnboardingSystem } from './systems/OnboardingSystem';

const logger = createLogger('Main');

// ASCII art banner
const BANNER = `
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║  ██████╗ ███████╗ ██████╗ █████╗ ███████╗              ║
║  ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝              ║
║  ██████╔╝█████╗  ██║     ███████║███████╗              ║
║  ██╔══██╗██╔══╝  ██║     ██╔══██║╚════██║              ║
║  ██████╔╝███████╗╚██████╗██║  ██║███████║              ║
║  ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝              ║
║                                                          ║
║          Sentient AI Community Moderator                ║
║              Powered by Local LLM                       ║
║           ✨ Enhanced with Observability ✨             ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`;

async function main() {
  console.log(BANNER);
  logger.info('Starting Becas...');

  // 🔥 STEP 1: Verify database connection FIRST
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('STEP 1: Database Connection Check');
  logger.info('='.repeat(60));
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    logger.error('Database connection check failed - cannot start Becas');
    process.exit(1);
  }

  // Validate environment
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('STEP 2: Environment Validation');
  logger.info('='.repeat(60));

  if (!ENV.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN is required');
    console.error('❌ DISCORD_TOKEN is required');
    console.error('Please set DISCORD_TOKEN in your .env file');
    process.exit(1);
  }

  if (!ENV.OLLAMA_BASE_URL) {
    logger.error('OLLAMA_BASE_URL is required');
    console.error('❌ OLLAMA_BASE_URL is required');
    console.error('Please ensure Ollama is running');
    process.exit(1);
  }

  // Initialize core services
  logger.info('Initializing core services...');
  const storage = new StorageService();
  const ollamaPool = new OllamaConnectionPool({
    baseURL: ENV.OLLAMA_BASE_URL,
    maxConnections: 5,
    maxRetries: 3,
  });
  const configManager = new GuildConfigManager(storage);

  logger.info('✓ Core services initialized');

  // Create Discord client
  logger.info('Creating Discord client...');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildModeration,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
    ],
  });

  // Initialize Becas
  logger.info('Initializing Becas Core...');
  const becas = new BecasCore(client, { ollamaPool, configManager });

  try {
    await becas.initialize();
    logger.info('✓ Becas initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Becas', error);
    console.error('❌ Failed to initialize Becas:', error);
    process.exit(1);
  }

  // Initialize Onboarding System
  logger.info('Initializing Onboarding System...');
  const onboarding = new OnboardingSystem(client, {
    configManager,
    watchSystem: becas.getWatchSystem(),
    policyEngine: becas.getPolicyEngine(),
    workflowManager: becas.getWorkflowManager(),
  });
  logger.info('✓ Onboarding system ready - interactive setup enabled');
  console.log('🎯 Onboarding System: Interactive button-based setup for new servers');

  // Initialize Admin Server
  logger.info('Starting admin server...');
  const adminServer = new AdminServer(ENV.ADMIN_PORT, {
    configManager,
    ollamaPool,
    getMetrics: () => becas.getMetrics(),
    analyticsManager: becas.getAnalyticsManager(),
  });

  try {
    const actualAdminPort = await adminServer.start();
    logger.info(`✓ Admin dashboard available at http://localhost:${actualAdminPort}`);
    if (actualAdminPort !== ENV.ADMIN_PORT) {
      logger.warn(`⚠️ Admin server started on port ${actualAdminPort} instead of ${ENV.ADMIN_PORT} (port conflict resolved)`);
    }
  } catch (error) {
    logger.error('Failed to start admin server', error);
    console.error('⚠️ Failed to start admin server:', error);
    // Don't exit - continue without admin server
  }

  // Initialize Dashboard API
  logger.info('Starting dashboard API...');
  const dashboardPort = 3003;
  const dashboardAPI = new DashboardAPI(
    client,
    becas.getTrustEngine(),
    becas.getRelationshipTracker(),
    becas.getUnifiedMemory(),
    becas.getSafeLearningEngine(),
    dashboardPort
  );

  // 🔥 Wire real-time WebSocket updates
  becas.getTrustEngine().setOnScoreUpdate((userId, data) => {
    dashboardAPI.emitTrustScoreUpdate(userId, data);
    dashboardAPI.emitLeaderboardUpdate();
  });

  try {
    await dashboardAPI.start();
    logger.info(`✓ Dashboard API available at http://localhost:${dashboardPort}`);
    logger.info(`🔌 Real-time WebSocket updates enabled`);
  } catch (error) {
    logger.error('Failed to start dashboard API', error);
    console.error('⚠️ Failed to start dashboard API:', error);
    // Don't exit - continue without dashboard API
  }

  // Initialize Guild Command Center
  logger.info('Starting Guild Command Center...');
  const commandCenterPort = 3002;
  const guildCommandAPI = new GuildCommandAPI(
    client,
    becas.getOllamaService(),
    becas.getTrustEngine(),
    becas.getRelationshipTracker(),
    commandCenterPort
  );

  try {
    const actualCommandPort = await guildCommandAPI.start();
    logger.info(`✓ Command Center available at http://localhost:${actualCommandPort}`);
    if (actualCommandPort !== commandCenterPort) {
      logger.warn(`⚠️ Command Center started on port ${actualCommandPort} instead of ${commandCenterPort} (port conflict resolved)`);
      console.log(`🎯 Guild Command Center: http://localhost:${actualCommandPort}/command-center.html`);
    }
  } catch (error) {
    logger.error('Failed to start command center', error);
    console.error('⚠️ Failed to start command center:', error);
    // Don't exit - continue without command center
  }

  // Login to Discord
  logger.info('Logging into Discord...');
  console.log('\n🔐 Logging into Discord...');
  try {
    await client.login(ENV.DISCORD_TOKEN);
    logger.info('✓ Successfully logged into Discord');
  } catch (error) {
    logger.error('Failed to login to Discord', error);
    console.error('❌ Failed to login to Discord:', error);
    console.error('Please check your DISCORD_TOKEN');
    process.exit(1);
  }

  // Status update every 5 minutes
  setInterval(() => {
    console.log('\n' + becas.getStatus());
  }, 300000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutdown signal received');
    console.log('\n\n🛑 Shutting down gracefully...');

    try {
      // Perform final backup
      logger.info('Creating final backup...');
      console.log('💾 Creating final backup...');
      await storage.backup();

      // Disconnect from Discord
      logger.info('Disconnecting from Discord...');
      console.log('👋 Disconnecting from Discord...');
      client.destroy();

      logger.info('Shutdown complete');
      console.log('✅ Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });

  // Handle uncaught errors
  process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection', error);
    console.error('❌ Unhandled rejection:', error);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
  });

  console.log('\n✨ Becas is now online and monitoring');
  console.log(`📊 Admin Dashboard: http://localhost:${ENV.ADMIN_PORT}`);
  console.log(`🎯 Command Center: http://localhost:${commandCenterPort}/command-center.html`);
  console.log(`🌐 User Dashboard: http://localhost:${dashboardPort}/checkscore.html`);
  console.log('Press Ctrl+C to shut down\n');
  logger.info('Becas is now fully operational');
}

// Start the application
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});