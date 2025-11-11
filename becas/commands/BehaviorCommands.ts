import { Message, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { Pool } from 'pg';
import { BehaviorParser } from '../services/BehaviorParser';
import { BehaviorEngine } from '../core/BehaviorEngine';
import { BehaviorTemplates } from '../templates/BehaviorTemplates';
import logger from '../utils/logger';

/**
 * BehaviorCommands
 *
 * Discord command interface for managing behaviors.
 * Allows moderators to create, list, enable, disable behaviors via Discord.
 *
 * Commands:
 * - @BECAS create behavior: [description]
 * - @BECAS list behaviors
 * - @BECAS enable behavior [id/name]
 * - @BECAS disable behavior [id/name]
 * - @BECAS delete behavior [id/name]
 * - @BECAS show templates
 * - @BECAS test behavior [id/name]
 */

export class BehaviorCommands {
  private db: Pool;
  private parser: BehaviorParser;
  private engine: BehaviorEngine;

  constructor(db: Pool, parser: BehaviorParser, engine: BehaviorEngine) {
    this.db = db;
    this.parser = parser;
    this.engine = engine;
  }

  /**
   * Handle behavior command
   */
  async handle(message: Message, command: string, args: string[]): Promise<void> {
    try {
      // Check if user is moderator
      if (!message.member?.permissions.has('ModerateMembers')) {
        await message.reply('❌ You need moderator permissions to manage behaviors');
        return;
      }

      switch (command) {
        case 'create':
        case 'add':
          await this.handleCreate(message, args);
          break;

        case 'list':
        case 'ls':
          await this.handleList(message, args);
          break;

        case 'enable':
          await this.handleEnable(message, args);
          break;

        case 'disable':
          await this.handleDisable(message, args);
          break;

        case 'delete':
        case 'remove':
          await this.handleDelete(message, args);
          break;

        case 'templates':
        case 'template':
          await this.handleTemplates(message, args);
          break;

        case 'test':
          await this.handleTest(message, args);
          break;

        case 'info':
        case 'show':
          await this.handleInfo(message, args);
          break;

        default:
          await this.showHelp(message);
      }

    } catch (error) {
      logger.error('Error handling behavior command:', error);
      await message.reply('❌ An error occurred while processing your command');
    }
  }

  /**
   * Create behavior from natural language
   */
  private async handleCreate(message: Message, args: string[]): Promise<void> {
    const description = args.join(' ');

    if (!description) {
      await message.reply('❌ Please provide a behavior description\nExample: `@BECAS create behavior: When a new user joins, send them a welcome DM`');
      return;
    }

    await message.reply('🤖 Parsing your behavior description...');

    try {
      // Parse natural language to BDL
      const bdl = await this.parser.parse(description, message.guildId!);

      // Show confirmation
      const embed = new EmbedBuilder()
        .setTitle('✅ Behavior Parsed Successfully')
        .setDescription(`**Name:** ${bdl.name}\n**Description:** ${bdl.description}`)
        .setColor('#00FF00')
        .addFields(
          { name: 'Trigger', value: `${bdl.trigger.type}: ${bdl.trigger.event || bdl.trigger.cron || 'custom'}` },
          { name: 'Actions', value: `${bdl.actions.length} action(s)` }
        );

      const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('confirm-behavior')
            .setLabel('✅ Create')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('cancel-behavior')
            .setLabel('❌ Cancel')
            .setStyle(ButtonStyle.Danger)
        );

      const confirmMsg = await message.reply({ embeds: [embed], components: [row] });

      // Wait for button click
      const collector = confirmMsg.createMessageComponentCollector({ time: 60000 });

      collector.on('collect', async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          await interaction.reply({ content: '❌ Only the command author can confirm', ephemeral: true });
          return;
        }

        if (interaction.customId === 'confirm-behavior') {
          // Save behavior
          const id = `behavior-${message.guildId}-${Date.now()}`;
          bdl.id = id;

          const query = `
            INSERT INTO dynamic_behaviors
            (id, server_id, created_by, name, description, enabled, trigger, tracking, analysis, actions, safety)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `;

          await this.db.query(query, [
            id,
            message.guildId,
            message.author.id,
            bdl.name,
            bdl.description,
            true,
            JSON.stringify(bdl.trigger),
            bdl.tracking ? JSON.stringify(bdl.tracking) : null,
            bdl.analysis ? JSON.stringify(bdl.analysis) : null,
            JSON.stringify(bdl.actions),
            JSON.stringify(bdl.safety)
          ]);

          await this.engine.reload();

          await interaction.update({
            content: `✅ Behavior "${bdl.name}" created successfully! (ID: ${id})`,
            embeds: [],
            components: []
          });

          logger.info(`Created behavior via Discord: ${bdl.name}`);

        } else {
          await interaction.update({
            content: '❌ Behavior creation cancelled',
            embeds: [],
            components: []
          });
        }

        collector.stop();
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
          await confirmMsg.edit({ content: '⏱️ Confirmation timeout', components: [] });
        }
      });

    } catch (error) {
      logger.error('Error creating behavior:', error);
      await message.reply(`❌ Failed to create behavior: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all behaviors
   */
  private async handleList(message: Message, args: string[]): Promise<void> {
    const showDisabled = args.includes('--all') || args.includes('-a');

    let query = 'SELECT * FROM dynamic_behaviors WHERE server_id = $1';
    const params: any[] = [message.guildId];

    if (!showDisabled) {
      query += ' AND enabled = true';
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query(query, params);

    if (result.rows.length === 0) {
      await message.reply('📭 No behaviors found. Create one with `@BECAS create behavior: [description]`');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Server Behaviors')
      .setDescription(`Found ${result.rows.length} behavior(s)`)
      .setColor('#0099FF');

    for (const row of result.rows.slice(0, 10)) { // Max 10
      const status = row.enabled ? '✅' : '❌';
      const trigger = row.trigger.event || row.trigger.cron || row.trigger.type;

      embed.addFields({
        name: `${status} ${row.name}`,
        value: `ID: \`${row.id.split('-').pop()}\` | Trigger: ${trigger} | Executions: ${row.execution_count}`,
        inline: false
      });
    }

    if (result.rows.length > 10) {
      embed.setFooter({ text: `Showing 10 of ${result.rows.length} behaviors` });
    }

    await message.reply({ embeds: [embed] });
  }

  /**
   * Enable behavior
   */
  private async handleEnable(message: Message, args: string[]): Promise<void> {
    const identifier = args.join(' ');

    if (!identifier) {
      await message.reply('❌ Please provide behavior ID or name\nExample: `@BECAS enable behavior Welcome DM`');
      return;
    }

    const behavior = await this.findBehavior(message.guildId!, identifier);

    if (!behavior) {
      await message.reply(`❌ Behavior not found: ${identifier}`);
      return;
    }

    await this.db.query('UPDATE dynamic_behaviors SET enabled = true WHERE id = $1', [behavior.id]);
    await this.engine.reload();

    await message.reply(`✅ Enabled behavior: ${behavior.name}`);
    logger.info(`Enabled behavior ${behavior.id} via Discord`);
  }

  /**
   * Disable behavior
   */
  private async handleDisable(message: Message, args: string[]): Promise<void> {
    const identifier = args.join(' ');

    if (!identifier) {
      await message.reply('❌ Please provide behavior ID or name\nExample: `@BECAS disable behavior Welcome DM`');
      return;
    }

    const behavior = await this.findBehavior(message.guildId!, identifier);

    if (!behavior) {
      await message.reply(`❌ Behavior not found: ${identifier}`);
      return;
    }

    await this.db.query('UPDATE dynamic_behaviors SET enabled = false WHERE id = $1', [behavior.id]);
    await this.engine.reload();

    await message.reply(`❌ Disabled behavior: ${behavior.name}`);
    logger.info(`Disabled behavior ${behavior.id} via Discord`);
  }

  /**
   * Delete behavior
   */
  private async handleDelete(message: Message, args: string[]): Promise<void> {
    const identifier = args.join(' ');

    if (!identifier) {
      await message.reply('❌ Please provide behavior ID or name\nExample: `@BECAS delete behavior Welcome DM`');
      return;
    }

    const behavior = await this.findBehavior(message.guildId!, identifier);

    if (!behavior) {
      await message.reply(`❌ Behavior not found: ${identifier}`);
      return;
    }

    await this.db.query('DELETE FROM dynamic_behaviors WHERE id = $1', [behavior.id]);
    await this.engine.reload();

    await message.reply(`🗑️ Deleted behavior: ${behavior.name}`);
    logger.info(`Deleted behavior ${behavior.id} via Discord`);
  }

  /**
   * Show templates
   */
  private async handleTemplates(message: Message, args: string[]): Promise<void> {
    const category = args[0];

    let templates = category
      ? BehaviorTemplates.getByCategory(category)
      : BehaviorTemplates.getAll();

    const embed = new EmbedBuilder()
      .setTitle('📚 Behavior Templates')
      .setDescription(`${templates.length} template(s) available`)
      .setColor('#9B59B6');

    for (const template of templates.slice(0, 10)) {
      embed.addFields({
        name: `${template.name} (${template.difficulty})`,
        value: `${template.description}\nID: \`${template.id}\` | Category: ${template.category}`,
        inline: false
      });
    }

    const categories = BehaviorTemplates.getCategories();
    embed.setFooter({ text: `Categories: ${categories.join(', ')}` });

    await message.reply({ embeds: [embed] });
  }

  /**
   * Test behavior (dry run)
   */
  private async handleTest(message: Message, args: string[]): Promise<void> {
    await message.reply('⚠️ Test mode coming soon! This will simulate behavior execution without actually performing actions.');
  }

  /**
   * Show behavior info
   */
  private async handleInfo(message: Message, args: string[]): Promise<void> {
    const identifier = args.join(' ');

    if (!identifier) {
      await message.reply('❌ Please provide behavior ID or name');
      return;
    }

    const behavior = await this.findBehavior(message.guildId!, identifier);

    if (!behavior) {
      await message.reply(`❌ Behavior not found: ${identifier}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`ℹ️ ${behavior.name}`)
      .setDescription(behavior.description)
      .setColor(behavior.enabled ? '#00FF00' : '#FF0000')
      .addFields(
        { name: 'ID', value: behavior.id, inline: true },
        { name: 'Status', value: behavior.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        { name: 'Executions', value: behavior.execution_count.toString(), inline: true },
        { name: 'Trigger', value: `Type: ${behavior.trigger.type}\nEvent: ${behavior.trigger.event || 'N/A'}` },
        { name: 'Actions', value: `${behavior.actions.length} action(s)` }
      );

    if (behavior.last_executed) {
      embed.addFields({ name: 'Last Executed', value: new Date(behavior.last_executed).toLocaleString() });
    }

    await message.reply({ embeds: [embed] });
  }

  /**
   * Show help
   */
  private async showHelp(message: Message): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle('🤖 Behavior Commands Help')
      .setDescription('Manage custom behaviors for your server')
      .setColor('#3498DB')
      .addFields(
        {
          name: 'Create Behavior',
          value: '`@BECAS create behavior: [description]`\nExample: `@BECAS create behavior: When a new user joins, send them a welcome DM`'
        },
        {
          name: 'List Behaviors',
          value: '`@BECAS list behaviors` - Show active behaviors\n`@BECAS list behaviors --all` - Show all including disabled'
        },
        {
          name: 'Enable/Disable',
          value: '`@BECAS enable behavior [name/id]`\n`@BECAS disable behavior [name/id]`'
        },
        {
          name: 'Delete',
          value: '`@BECAS delete behavior [name/id]`'
        },
        {
          name: 'Templates',
          value: '`@BECAS show templates` - Show all templates\n`@BECAS show templates [category]` - Filter by category'
        },
        {
          name: 'Info',
          value: '`@BECAS show behavior [name/id]` - Show detailed info'
        }
      );

    await message.reply({ embeds: [embed] });
  }

  /**
   * Find behavior by ID or name
   */
  private async findBehavior(serverId: string, identifier: string): Promise<any> {
    // Try by ID first
    let query = 'SELECT * FROM dynamic_behaviors WHERE server_id = $1 AND (id = $2 OR id LIKE $3)';
    let result = await this.db.query(query, [serverId, identifier, `%${identifier}%`]);

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Try by name
    query = 'SELECT * FROM dynamic_behaviors WHERE server_id = $1 AND name ILIKE $2';
    result = await this.db.query(query, [serverId, `%${identifier}%`]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }
}
