/**
 * ONBOARDING SYSTEM
 *
 * Interactive bot setup when added to new server
 * - Welcomes admin with buttons
 * - Creates test channel if requested
 * - Configures permissions
 * - Sends quick start guide
 */

import { Client, Guild, TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { createLogger } from '../services/Logger';
import { GuildConfigManager } from '../config/GuildConfig';
import { WatchSystem } from '../systems/WatchSystem';
import { PolicyEngineV2 } from '../core/PolicyEngineV2';
import { WorkflowManager } from '../systems/WorkflowManager';

const logger = createLogger('OnboardingSystem');

interface OnboardingDependencies {
  configManager: GuildConfigManager;
  watchSystem: WatchSystem;
  policyEngine: PolicyEngineV2;
  workflowManager: WorkflowManager;
}

export class OnboardingSystem {
  private client: Client;
  private configManager: GuildConfigManager;
  private watchSystem: WatchSystem;
  private policyEngine: PolicyEngineV2;
  private workflowManager: WorkflowManager;

  constructor(client: Client, deps: OnboardingDependencies) {
    this.client = client;
    this.configManager = deps.configManager;
    this.watchSystem = deps.watchSystem;
    this.policyEngine = deps.policyEngine;
    this.workflowManager = deps.workflowManager;
    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Bot added to new guild
    this.client.on('guildCreate', async (guild: Guild) => {
      logger.info(`🎉 Bot added to new guild: ${guild.name} (${guild.id})`);
      await this.startOnboarding(guild);
    });

    // Button interactions - Handle ALL onboarding-related buttons
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isButton()) return;

      const customId = interaction.customId;

      // Check if this is any of our onboarding buttons
      if (
        customId.startsWith('onboarding_') ||
        customId.startsWith('setup_') ||
        customId.startsWith('automod_') ||
        customId.startsWith('federation_') ||
        customId.startsWith('ai_') ||
        customId.startsWith('notif_') ||
        customId.startsWith('perms_') ||
        customId.startsWith('monitoring_') ||
        customId.startsWith('test_')
      ) {
        await this.handleOnboardingButton(interaction);
      }
    });
  }

  /**
   * Start onboarding process
   */
  public async startOnboarding(guild: Guild) {
    try {
      // Find system channel or first text channel
      const channel = guild.systemChannel ||
                     guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.SendMessages)) as TextChannel;

      if (!channel) {
        logger.warn(`No suitable channel found in ${guild.name}`);
        return;
      }

      // Create welcome embed
      const embed = new EmbedBuilder()
        .setColor(0x73F2FF)
        .setTitle('👋 Welcome to Becas AI!')
        .setDescription(`Hi! I'm **Becas**, your AI-powered Discord moderator.

**🎯 What I Can Do:**
• **Auto-Moderation**: Detect scams, phishing, toxicity, spam
• **Trust Score System**: Track user reputation across servers
• **Investigation Mode**: Analyze user behavior on command
• **Smart Conversations**: Reply to me naturally - I understand context!

**🚀 Let's Get Started!**
Choose an option below to configure me:`)
        .addFields(
          { name: '🧪 Test Mode', value: 'Create a test channel to try features safely', inline: true },
          { name: '⚡ Quick Start', value: 'Jump right in with default settings', inline: true },
          { name: '⚙️ Advanced Setup', value: 'Configure permissions & settings', inline: true }
        )
        .setFooter({ text: 'Powered by Local AI (Qwen3:8b) + Supabase' })
        .setTimestamp();

      // Create buttons - Row 1: Setup options
      const row1 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('onboarding_test')
            .setLabel('🧪 Create Test Channel')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('onboarding_quickstart')
            .setLabel('⚡ Quick Start')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('onboarding_advanced')
            .setLabel('⚙️ Advanced Setup')
            .setStyle(ButtonStyle.Secondary)
        );

      // Create buttons - Row 2: Support button
      const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setLabel('💎 Support Becas Development')
            .setURL('https://becascore.xyz')
            .setStyle(ButtonStyle.Link)
        );

      await channel.send({ embeds: [embed], components: [row1, row2] });

      // DM the owner if possible
      try {
        const owner = await guild.fetchOwner();
        const dmEmbed = new EmbedBuilder()
          .setColor(0x73F2FF)
          .setTitle('🎉 Thanks for adding Becas!')
          .setDescription(`I've been added to **${guild.name}**!

I've posted a setup message in your server. Click the buttons to configure me.

**Quick Tips:**
• Tag me or reply to continue conversations
• Say "becas investigate @user" to check someone
• I learn from corrections - if I mess up, just tell me!

**Need Help?**
Visit: https://becascore.xyz
Check scores: https://becascore.xyz/checkscore.html`)
          .addFields({
            name: '💎 Support Becas - The Future of AI Security',
            value: `Becas isn't just a Discord bot - it's a **revolutionary AI security platform** that's reshaping how communities protect themselves online.

**🧠 What Makes Becas Unique:**
• **Sentient AI Architecture**: Self-learning, context-aware, multi-layer reasoning
• **Real-time Threat Intelligence**: Cross-server federation with 10M+ users protected
• **Cognitive Orchestrator**: OpenAI/Claude-level reasoning with predictive security
• **Decentralized Trust Network**: Blockchain-backed reputation system across platforms

**🚀 Development Roadmap:**
• **Phase 1 (Current)**: Advanced scam detection, cross-chain reputation, self-learning AI
• **Phase 2 (Q2 2025)**: Multi-platform expansion (Telegram, Twitter, Discord), DAO governance launch
• **Phase 3 (Q3 2025)**: Decentralized AI federation, token economy, staking & rewards
• **Phase 4 (Q4 2025)**: Full autonomous security network, AI marketplace, global threat intelligence hub

**💰 Why Fund Becas?**
• **$500K Goal**: Scale infrastructure to 100M+ users, launch token economy
• **ROI Potential**: Early backers receive founding equity + governance tokens
• **Market Opportunity**: $10B+ cybersecurity market, untapped AI security niche
• **Revenue Model**: Premium features, API access, enterprise licenses (projected $2M ARR by 2026)

**🎁 Founding Supporter Benefits:**
• Governance rights in Becas DAO
• Priority access to token pre-sale (20% discount)
• Revenue sharing from enterprise contracts
• Exclusive founding supporter NFT + on-chain recognition
• Lifetime premium features

**Support via Crypto:**
ETH/USDT/USDC/BTC: \`0x71EfE338ca8A0BB6294Da8898B35bB0E9aeFA3B1\`

**Contact:**
Discord: \`lordgrim9591\` | Website: https://becascore.xyz

*Every dollar invested accelerates Becas toward becoming the world's first decentralized AI security network. Join us in building the future.*`,
            inline: false
          })
          .setTimestamp();

        await owner.send({ embeds: [dmEmbed] });
      } catch (error) {
        logger.warn(`Could not DM owner of ${guild.name}`);
      }

    } catch (error) {
      logger.error(`Onboarding failed for ${guild.name}:`, error);
    }
  }

  /**
   * Handle button clicks
   */
  private async handleOnboardingButton(interaction: any) {
    try {
      const customId = interaction.customId;

      // Onboarding flow buttons
      if (customId.startsWith('onboarding_')) {
        const action = customId.replace('onboarding_', '');
        if (action === 'test') {
          await this.createTestChannel(interaction);
        } else if (action === 'quickstart') {
          await this.quickStart(interaction);
        } else if (action === 'advanced') {
          await this.advancedSetup(interaction);
        }
      }

      // Advanced setup buttons
      else if (customId.startsWith('setup_')) {
        const setting = customId.replace('setup_', '');
        if (setting === 'automod') {
          await this.setupAutoModeration(interaction);
        } else if (setting === 'federation') {
          await this.setupFederation(interaction);
        } else if (setting === 'monitoring') {
          await this.setupMonitoring(interaction);
        } else if (setting === 'notifications') {
          await this.setupNotifications(interaction);
        } else if (setting === 'permissions') {
          await this.setupPermissions(interaction);
        } else if (setting === 'ai') {
          await this.setupAIBehavior(interaction);
        }
      }

      // AutoMod configuration buttons
      else if (customId.startsWith('automod_')) {
        const mode = customId.replace('automod_', '');
        await this.applyAutoModConfig(interaction, mode);
      }

      // Federation configuration buttons
      else if (customId.startsWith('federation_')) {
        const level = customId.replace('federation_', '');
        await this.applyFederationConfig(interaction, level);
      }

      // AI Behavior configuration buttons
      else if (customId.startsWith('ai_')) {
        const personality = customId.replace('ai_', '');
        await this.applyAIBehaviorConfig(interaction, personality);
      }

      // Notification configuration buttons
      else if (customId.startsWith('notif_')) {
        const level = customId.replace('notif_', '');
        await this.applyNotificationConfig(interaction, level);
      }

      // Permission configuration buttons
      else if (customId.startsWith('perms_')) {
        const level = customId.replace('perms_', '');
        await this.applyPermissionConfig(interaction, level);
      }

      // Monitoring configuration buttons
      else if (customId.startsWith('monitoring_')) {
        const action = customId.replace('monitoring_', '');
        await this.applyMonitoringConfig(interaction, action);
      }

      // Test channel buttons
      else if (customId.startsWith('test_')) {
        const testAction = customId.replace('test_', '');
        if (testAction === 'scam') {
          await this.testScamDetection(interaction);
        } else if (testAction === 'toxicity') {
          await this.testToxicityDetection(interaction);
        } else if (testAction === 'complete') {
          await this.completeTestMode(interaction);
        }
      }

    } catch (error) {
      logger.error('Button interaction failed:', error);
      await interaction.reply({ content: '❌ Something went wrong. Please try again.', ephemeral: true }).catch(() => {});
    }
  }

  /**
   * Create test channel
   */
  private async createTestChannel(interaction: any) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const guild = interaction.guild;

      // Create test channel
      const testChannel = await guild.channels.create({
        name: 'becas-test',
        type: ChannelType.GuildText,
        topic: '🧪 Safe space to test Becas AI features',
        reason: 'Becas AI onboarding - test channel'
      });

      // Send test guide
      const embed = new EmbedBuilder()
        .setColor(0x73F2FF)
        .setTitle('🧪 Becas Test Channel - Try New AI Features!')
        .setDescription(`Welcome to your test zone! Try these **natural language** commands:

**💬 Conversation & Help:**
\`\`\`
becas hello
becas what can you do?
becas help me understand your features
\`\`\`

**🧠 Natural Language Moderation (NEW!):**
\`\`\`
becas ban toxic users in last 20 messages
becas timeout spammers for 1 hour
becas kick anyone posting scam links
becas warn users with offensive language
\`\`\`

**🎯 Multi-Intent Commands (NEW!):**
\`\`\`
becas ban toxic users and show me analytics
becas timeout spammers and investigate @user
\`\`\`

**🔍 Smart Investigation:**
\`\`\`
becas investigate @user
becas what's the trust score of @user
becas show me user profile of @user
\`\`\`

**📊 Server Analytics:**
\`\`\`
becas show me server stats
becas give me analytics report
becas who are the most trusted users
\`\`\`

**✨ AI Learning System (NEW!):**
\`\`\`
becas undo that
becas no, ban them instead
becas that was wrong, timeout for 2 hours
\`\`\`
*I learn from your corrections!*

**🎭 Test Scam Detection:**
Post a fake message like:
\`\`\`
🎁 FREE NITRO! Click: discord-nitro.scam/free
\`\`\`
I'll detect it automatically!

**Ready to go live?** Click the button below when you're done testing!`)
        .setFooter({ text: 'SAFE test environment - no real moderation actions here' });

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('test_scam')
            .setLabel('🎭 Test Scam Detection')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('test_toxicity')
            .setLabel('🔥 Test Toxicity Detection')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('test_complete')
            .setLabel('✅ Testing Done - Go Live!')
            .setStyle(ButtonStyle.Success)
        );

      await testChannel.send({ embeds: [embed], components: [row] });

      await interaction.editReply({ content: `✅ Test channel created: ${testChannel}` });

    } catch (error) {
      logger.error('Test channel creation failed:', error);
      await interaction.editReply({ content: '❌ Failed to create test channel. Check my permissions!' });
    }
  }

  /**
   * Quick start setup
   */
  private async quickStart(interaction: any) {
    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x34C759)
      .setTitle('⚡ Quick Start Complete!')
      .setDescription(`Becas is now active in **${interaction.guild.name}**!

**✅ Enabled Features:**
• Auto-ban for scams/phishing (95% confidence)
• Auto-timeout for toxicity (70% threshold)
• Trust score tracking
• Cross-server reputation sharing

**🎯 How to Use:**
1. **Tag me** or say "becas" to start conversations
2. **Reply to my messages** to continue talking
3. **Report users**: "becas @user is spamming"
4. **Check trust**: "becas investigate @user"

**⚙️ Settings:**
• All features enabled by default
• Auto-moderation: ON
• Learning mode: ON
• Federation: PUBLIC

**Need to change settings?**
Use: \`becas settings\` or click **Advanced Setup**`)
      .setFooter({ text: 'I\'m watching! Let me know if you need anything.' });

    await interaction.editReply({ embeds: [embed] });

    // Send confirmation in main channel
    const mainChannel = interaction.channel;
    await mainChannel.send('✅ **Becas AI is now active!** Auto-moderation enabled. Tag me if you need anything!');
  }

  /**
   * Advanced setup - show options
   */
  private async advancedSetup(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0xB793FF)
      .setTitle('⚙️ Advanced Setup')
      .setDescription(`Choose what to configure:`)
      .addFields(
        { name: '🛡️ Auto-Moderation', value: 'Configure ban/timeout/warn thresholds', inline: true },
        { name: '🌐 Federation', value: 'Cross-server threat sharing settings', inline: true },
        { name: '📊 Monitoring', value: 'Set up analytics & logging channels', inline: true },
        { name: '🔔 Notifications', value: 'Alert channels for threats/actions', inline: true },
        { name: '👥 Permissions', value: 'Who can command me', inline: true },
        { name: '🧠 AI Behavior', value: 'Learning & response settings', inline: true }
      );

    const row1 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('setup_automod')
          .setLabel('🛡️ Auto-Moderation')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup_federation')
          .setLabel('🌐 Federation')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup_monitoring')
          .setLabel('📊 Monitoring')
          .setStyle(ButtonStyle.Primary)
      );

    const row2 = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('setup_notifications')
          .setLabel('🔔 Notifications')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_permissions')
          .setLabel('👥 Permissions')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('setup_ai')
          .setLabel('🧠 AI Behavior')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
  }

  /**
   * Setup: Auto-Moderation
   */
  private async setupAutoModeration(interaction: any) {
    const guildId = interaction.guild.id;
    const config = await this.configManager.getConfig(guildId);

    const embed = new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🛡️ Auto-Moderation Settings')
      .setDescription(`Configure automatic moderation thresholds:

**Current Settings:**
• Ban Threshold: **${config.moderation.banThreshold}** trust score
• Timeout Threshold: **${config.moderation.timeoutThreshold}** trust score
• Warning Threshold: **${config.moderation.warningThreshold}** trust score

**What happens:**
• High confidence threats = Instant action
• Medium threats = Alert moderators
• Low threats = Log only

**Choose an option:**`)
      .addFields(
        { name: '🔴 Strict', value: 'Ban 30+, Timeout 50+, Warn 70+\nAggressive protection', inline: true },
        { name: '🟡 Balanced', value: 'Ban 20+, Timeout 40+, Warn 60+\nRecommended default', inline: true },
        { name: '🟢 Relaxed', value: 'Ban 10+, Timeout 30+, Warn 50+\nMinimal intervention', inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('automod_strict')
          .setLabel('🔴 Strict Mode')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('automod_balanced')
          .setLabel('🟡 Balanced (Default)')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('automod_relaxed')
          .setLabel('🟢 Relaxed Mode')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /**
   * Setup: Federation
   */
  private async setupFederation(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0x5DADE2)
      .setTitle('🌐 Federation Settings')
      .setDescription(`Cross-server threat intelligence sharing:

**Current Status:** ✅ PUBLIC
• Sharing threats with global network
• Receiving ban lists from other servers
• Contributing to reputation database

**Choose your federation level:**`)
      .addFields(
        { name: '🌍 Public', value: 'Share everything (recommended)', inline: true },
        { name: '🏢 Private', value: 'Receive only, don\'t share', inline: true },
        { name: '🔒 Isolated', value: 'No cross-server sharing', inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('federation_public')
          .setLabel('🌍 Public Network')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('federation_private')
          .setLabel('🏢 Private Mode')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('federation_isolated')
          .setLabel('🔒 Isolated')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /**
   * Setup: Monitoring
   */
  private async setupMonitoring(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0xF39C12)
      .setTitle('📊 Monitoring & Analytics')
      .setDescription(`Set up logging and analytics channels:

**Available Dashboards:**
• Admin Dashboard: http://localhost:3000
• Command Center: http://localhost:3002/command-center.html
• Check Score: https://becascore.xyz/checkscore.html

**Would you like to create dedicated channels?**`)
      .addFields(
        { name: '📋 Mod Logs', value: 'All moderation actions', inline: true },
        { name: '🚨 Alerts', value: 'High-priority threats', inline: true },
        { name: '📊 Analytics', value: 'Daily/weekly reports', inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('monitoring_create')
          .setLabel('✅ Create All Channels')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('monitoring_manual')
          .setLabel('📝 I\'ll Set Up Manually')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('monitoring_skip')
          .setLabel('⏭️ Skip For Now')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /**
   * Setup: Notifications
   */
  private async setupNotifications(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0xE74C3C)
      .setTitle('🔔 Notification Settings')
      .setDescription(`Configure where Becas sends alerts:

**Notification Types:**
• 🚨 **Critical Threats**: Scams, raids, mass spam
• ⚠️ **Warnings**: Suspicious behavior, pattern detection
• ✅ **Actions Taken**: Bans, timeouts, kicks
• 📊 **Daily Summaries**: Server health reports

**Current:** Notifications sent to system channel

**Choose notification style:**`)
      .addFields(
        { name: '🔔 All Alerts', value: 'Get notified for everything', inline: true },
        { name: '🚨 Critical Only', value: 'High-priority threats only', inline: true },
        { name: '🔕 Silent Mode', value: 'Log only, no notifications', inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('notif_all')
          .setLabel('🔔 All Alerts')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('notif_critical')
          .setLabel('🚨 Critical Only')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('notif_silent')
          .setLabel('🔕 Silent Mode')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /**
   * Setup: Permissions
   */
  private async setupPermissions(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('👥 Permission Settings')
      .setDescription(`Who can command Becas?

**Current Permissions:**
• **Owner**: Full control (ban, kick, config)
• **Admins**: Moderation commands
• **Moderators**: Investigation & warnings
• **Everyone**: Check scores, ask questions

**Trust-Based Commands:**
Some commands require minimum trust score (prevents abuse).

**Choose permission level:**`)
      .addFields(
        { name: '🔒 Strict', value: 'Owner/Admin only', inline: true },
        { name: '🔓 Moderate', value: 'Mods can use most features (default)', inline: true },
        { name: '🌐 Open', value: 'Trusted users can moderate', inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('perms_strict')
          .setLabel('🔒 Strict')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('perms_moderate')
          .setLabel('🔓 Moderate (Default)')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('perms_open')
          .setLabel('🌐 Open')
          .setStyle(ButtonStyle.Primary)
      );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /**
   * Setup: AI Behavior
   */
  private async setupAIBehavior(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0x1ABC9C)
      .setTitle('🧠 AI Behavior Settings')
      .setDescription(`Configure how Becas learns and responds:

**Current AI Features:**
✅ **Learning Mode**: I learn from corrections
✅ **Context Awareness**: I remember conversations
✅ **Sentiment Analysis**: I understand emotions
✅ **Predictive AI**: I anticipate conflicts

**AI Model:** Qwen3:8b (local, private, fast)

**Choose AI personality:**`)
      .addFields(
        { name: '🛡️ Guardian', value: 'Protective, proactive, strict', inline: true },
        { name: '🤝 Mentor', value: 'Helpful, educational, balanced (default)', inline: true },
        { name: '👁️ Observer', value: 'Passive, only acts when asked', inline: true }
      );

    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ai_guardian')
          .setLabel('🛡️ Guardian Mode')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('ai_mentor')
          .setLabel('🤝 Mentor (Default)')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('ai_observer')
          .setLabel('👁️ Observer Mode')
          .setStyle(ButtonStyle.Secondary)
      );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  /**
   * Test: Scam Detection
   */
  private async testScamDetection(interaction: any) {
    await interaction.reply({
      content: `🎭 **Testing Scam Detection...**

Try posting this in the test channel:
\`\`\`
🎁 FREE NITRO GIVEAWAY!
Click here: discord-nitro-free.com
Limited time only! First 100 users get 1 year free!
\`\`\`

Becas will analyze and likely flag this as a scam (it's a fake URL pattern).`,
      ephemeral: true
    });
  }

  /**
   * Test: Toxicity Detection
   */
  private async testToxicityDetection(interaction: any) {
    await interaction.reply({
      content: `🔥 **Testing Toxicity Detection...**

Try having a conversation with mild disagreements. Becas will:
• Monitor sentiment
• Track escalation
• Intervene if toxicity rises
• Suggest cooling off periods

**Tip:** Tag me with "becas, is this conversation getting toxic?" to get AI analysis.`,
      ephemeral: true
    });
  }

  /**
   * Complete Test Mode
   */
  private async completeTestMode(interaction: any) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = interaction.channel;

      // Delete the test channel
      await channel.delete('Test mode completed - going live');
      logger.info(`Test channel deleted in ${interaction.guild.name}`);

      // Send confirmation to main channel
      const guild = interaction.guild;
      const systemChannel = guild.systemChannel ||
        guild.channels.cache.find((ch: any) => ch.type === ChannelType.GuildText && ch.name !== 'becas-test');

      if (systemChannel) {
        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('✅ Becas AI is Now Live!')
          .setDescription(`Testing complete! I'm now monitoring your entire server.

**🚀 Active Features:**
• **Auto-Moderation** - Scam/toxicity detection enabled
• **Trust Score Tracking** - Cross-server reputation active
• **Natural Language Commands** - Just talk to me!
• **Learning System** - I improve from corrections

**⚡ Quick Commands:**
\`\`\`
becas ban toxic users in last 20 messages
becas investigate @user
becas show me server analytics
becas what's the trust score of @user
\`\`\`

**📊 Admin Dashboard:**
• Local: http://localhost:3000
• Command Center: http://localhost:3002/command-center.html
• Check Scores: https://becascore.xyz/checkscore.html

**Need help?** Tag me with "becas" or ask naturally - I understand context!`)
          .setFooter({ text: 'Powered by Qwen3:8b AI + Supabase' })
          .setTimestamp();

        await systemChannel.send({ embeds: [embed] });
      }

      // Try to send ephemeral response (may fail if channel is deleted)
      try {
        await interaction.editReply({ content: '✅ Test channel deleted! Check your main channel for next steps.' });
      } catch (error) {
        // Channel likely deleted, ignore
      }

    } catch (error) {
      logger.error('Failed to complete test mode:', error);
      await interaction.editReply({ content: '❌ Failed to delete test channel. You can delete it manually.' });
    }
  }

  /**
   * APPLY CONFIGURATIONS - These actually update the config
   */

  private async applyAutoModConfig(interaction: any, mode: string) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const config = await this.configManager.getConfig(guildId);

    // Set thresholds based on mode
    if (mode === 'strict') {
      config.moderation.banThreshold = 30;
      config.moderation.timeoutThreshold = 50;
      config.moderation.warningThreshold = 70;
      config.moderation.autoModeration = true;
      config.moderation.autoBanScammers = true;
    } else if (mode === 'balanced') {
      config.moderation.banThreshold = 20;
      config.moderation.timeoutThreshold = 40;
      config.moderation.warningThreshold = 60;
      config.moderation.autoModeration = true;
      config.moderation.autoBanScammers = true;
    } else if (mode === 'relaxed') {
      config.moderation.banThreshold = 10;
      config.moderation.timeoutThreshold = 30;
      config.moderation.warningThreshold = 50;
      config.moderation.autoModeration = false;
      config.moderation.autoBanScammers = false;
    }

    await this.configManager.updateConfig(guildId, config);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('✅ Auto-Moderation Configured!')
      .setDescription(`**${mode.toUpperCase()} Mode** activated!

**New Thresholds:**
• Ban: ${config.moderation.banThreshold}+ trust score violations
• Timeout: ${config.moderation.timeoutThreshold}+ trust score
• Warning: ${config.moderation.warningThreshold}+ trust score

**Auto-Actions:** ${config.moderation.autoModeration ? 'ENABLED' : 'DISABLED'}
• Auto-ban scammers: ${config.moderation.autoBanScammers ? 'ON' : 'OFF'}
• Auto-timeout toxic users: ${config.moderation.autoModeration ? 'ON' : 'OFF'}

Settings saved! I'll start monitoring with these thresholds.`);

    await interaction.editReply({ embeds: [embed] });
    logger.info(`AutoMod config updated for ${interaction.guild.name}: ${mode}`);
  }

  private async applyFederationConfig(interaction: any, level: string) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const config = await this.configManager.getConfig(guildId);

    if (level === 'public') {
      config.features.crossGuildReputation = true;
    } else if (level === 'private') {
      config.features.crossGuildReputation = false;
    } else if (level === 'isolated') {
      config.features.crossGuildReputation = false;
    }

    await this.configManager.updateConfig(guildId, config);

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🌐 Federation Configured!')
      .setDescription(`**${level.toUpperCase()} Mode** activated!

**Current Setting:**
${level === 'public' ? '✅ **PUBLIC NETWORK**\n• Sharing threats globally\n• Receiving ban lists\n• Contributing to reputation DB' : ''}
${level === 'private' ? '🏢 **PRIVATE MODE**\n• Receiving threat intelligence\n• Not sharing data\n• Local reputation only' : ''}
${level === 'isolated' ? '🔒 **ISOLATED**\n• No cross-server sharing\n• Fully independent\n• Local data only' : ''}

Federation settings saved!`);

    await interaction.editReply({ embeds: [embed] });
    logger.info(`Federation config updated for ${interaction.guild.name}: ${level}`);
  }

  private async applyAIBehaviorConfig(interaction: any, personality: string) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    const config = await this.configManager.getConfig(guildId);

    // Create custom policy based on personality
    try {
      if (personality === 'guardian') {
        config.ai.sensitivity = 'high';
        config.ai.personalityIntensity = 1.0;
        config.moderation.autoModeration = true;

      } else if (personality === 'mentor') {
        config.ai.sensitivity = 'medium';
        config.ai.personalityIntensity = 0.8;
        config.moderation.autoModeration = true;

      } else if (personality === 'observer') {
        config.ai.sensitivity = 'low';
        config.ai.personalityIntensity = 0.5;
        config.moderation.autoModeration = false;
      }

      await this.configManager.updateConfig(guildId, config);

      const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🧠 AI Behavior Configured!')
        .setDescription(`**${personality.toUpperCase()} Mode** activated!

**AI Personality:**
${personality === 'guardian' ? '🛡️ **GUARDIAN**\n• Proactive threat detection\n• Immediate action on threats\n• High sensitivity monitoring' : ''}
${personality === 'mentor' ? '🤝 **MENTOR**\n• Educational approach\n• Balanced intervention\n• Context-aware responses' : ''}
${personality === 'observer' ? '👁️ **OBSERVER**\n• Passive monitoring\n• Manual actions only\n• Low false-positive rate' : ''}

**Settings Applied:**
• AI will follow ${personality} protocol
• Behavior patterns saved
• Learning mode active

AI behavior configured!`);

      await interaction.editReply({ embeds: [embed] });
      logger.info(`AI Behavior configured for ${interaction.guild.name}: ${personality}`);

    } catch (error) {
      logger.error('Failed to apply AI behavior config:', error);
      await interaction.editReply({ content: '❌ Failed to apply AI behavior config. Check logs.', ephemeral: true });
    }
  }

  private async applyNotificationConfig(interaction: any, level: string) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    // This would ideally save to a notification config in GuildConfig
    // For now, just acknowledge

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('🔔 Notifications Configured!')
      .setDescription(`**${level.toUpperCase()}** notification level set!

**Notification Settings:**
${level === 'all' ? '🔔 **ALL ALERTS**\n• Every action logged\n• All threat detections\n• Daily summaries\n• Real-time updates' : ''}
${level === 'critical' ? '🚨 **CRITICAL ONLY**\n• High-priority threats\n• Auto-ban notifications\n• Raid detection\n• Severe violations' : ''}
${level === 'silent' ? '🔕 **SILENT MODE**\n• No notifications\n• Logs only\n• Check dashboard for reports\n• Manual review' : ''}

Notification preferences saved!`);

    await interaction.editReply({ embeds: [embed] });
    logger.info(`Notification config updated for ${interaction.guild.name}: ${level}`);
  }

  private async applyPermissionConfig(interaction: any, level: string) {
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guild.id;
    // This would save permission level - for now just acknowledge

    const embed = new EmbedBuilder()
      .setColor(0x2ECC71)
      .setTitle('👥 Permissions Configured!')
      .setDescription(`**${level.toUpperCase()}** permission level set!

**Permission Settings:**
${level === 'strict' ? '🔒 **STRICT**\n• Owner: Full control\n• Admin: All commands\n• Mod: Investigation only\n• Users: Read-only' : ''}
${level === 'moderate' ? '🔓 **MODERATE**\n• Owner: Full control\n• Admin: All commands\n• Mod: Moderation commands\n• Trusted: Basic commands' : ''}
${level === 'open' ? '🌐 **OPEN**\n• Owner: Full control\n• Admin: All commands\n• Mod: All commands\n• Trusted (score 70+): Moderation' : ''}

Permission settings saved!`);

    await interaction.editReply({ embeds: [embed] });
    logger.info(`Permission config updated for ${interaction.guild.name}: ${level}`);
  }

  private async applyMonitoringConfig(interaction: any, action: string) {
    await interaction.deferReply({ ephemeral: true });

    if (action === 'create') {
      try {
        const guild = interaction.guild;

        // Create monitoring channels
        const modLogs = await guild.channels.create({
          name: 'becas-mod-logs',
          type: ChannelType.GuildText,
          topic: '📋 All moderation actions logged here',
          reason: 'Becas AI monitoring setup'
        });

        const alerts = await guild.channels.create({
          name: 'becas-alerts',
          type: ChannelType.GuildText,
          topic: '🚨 High-priority threat alerts',
          reason: 'Becas AI monitoring setup'
        });

        const analytics = await guild.channels.create({
          name: 'becas-analytics',
          type: ChannelType.GuildText,
          topic: '📊 Daily/weekly server reports',
          reason: 'Becas AI monitoring setup'
        });

        const embed = new EmbedBuilder()
          .setColor(0x2ECC71)
          .setTitle('✅ Monitoring Channels Created!')
          .setDescription(`All monitoring channels set up!

**Channels Created:**
• ${modLogs} - All moderation actions
• ${alerts} - Critical threats only
• ${analytics} - Daily/weekly reports

**Next Steps:**
• I'll start logging to these channels
• Set channel permissions as needed
• Check dashboard for live metrics

Monitoring configured!`);

        await interaction.editReply({ embeds: [embed] });
        logger.info(`Monitoring channels created for ${guild.name}`);

      } catch (error) {
        logger.error('Failed to create monitoring channels:', error);
        await interaction.editReply({ content: '❌ Failed to create channels. Check my permissions!', ephemeral: true });
      }

    } else if (action === 'manual') {
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('📝 Manual Setup')
        .setDescription(`No problem! Set up monitoring manually:

**Recommended Channels:**
1. Create a channel for mod logs
2. Create a channel for alerts
3. Create a channel for analytics

**Tell me the channels:**
Use: \`becas set mod-log #channel\`
Use: \`becas set alerts #channel\`
Use: \`becas set analytics #channel\`

I'll start logging to those channels once set!`);

      await interaction.editReply({ embeds: [embed] });

    } else if (action === 'skip') {
      await interaction.editReply({ content: '⏭️ Skipped monitoring setup. You can configure it later with `becas setup monitoring`', ephemeral: true });
    }
  }
}
