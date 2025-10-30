// discord.config.ts

export const DISCORD_CONFIG = {
  intents: [
    'Guilds',
    'GuildMessages',
    'MessageContent',
    'GuildMembers',
    'GuildModeration',
  ],
  partials: ['Message', 'Channel', 'Reaction'],
};