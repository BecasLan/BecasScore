import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { blockchainService } from '../services/BlockchainService';
import { getSupabaseClient } from '../database/SupabaseClient';

export const data = new SlashCommandBuilder()
  .setName('linkbasename')
  .setDescription('Link your Base name (basename) to your Discord account')
  .addStringOption(option =>
    option
      .setName('basename')
      .setDescription('Your Base name (e.g., yourname.base.eth)')
      .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const basename = interaction.options.get('basename', true).value as string;
  const userId = interaction.user.id;
  const userName = interaction.user.username;

  // Basic validation for basename format
  if (!basename.includes('.') || basename.length < 5) {
    return interaction.editReply({
      content: '❌ Invalid basename! Must be in format: yourname.base.eth or similar.'
    });
  }

  try {
    // 1. Update database (Supabase)
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('users')
      .update({
        basename: basename.toLowerCase(),
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (error) {
      console.error('Failed to update basename in database:', error);
      return interaction.editReply({
        content: '❌ Failed to link basename to database. This basename may already be linked to another account.'
      });
    }

    // 2. Link on blockchain
    let txHash: string | null = null;
    if (blockchainService.isEnabled()) {
      try {
        txHash = await blockchainService.linkBasename(userId, basename);
      } catch (error) {
        console.error('Failed to link basename on blockchain:', error);
        // Don't fail the command - database link is more important
      }
    }

    // 3. Success response
    let message = `✅ **Basename Linked Successfully!**\n\n`;
    message += `👤 Discord: ${userName}\n`;
    message += `🏷️ Basename: \`${basename}\`\n\n`;

    if (txHash) {
      message += `⛓️ **Blockchain Confirmation:**\n`;
      message += `Transaction: [View on BaseScan](https://sepolia.basescan.org/tx/${txHash})\n\n`;
    }

    message += `📊 Your trust score is now linked to your Base identity!\n`;
    message += `🌐 View on dashboard: https://becascore.xyz/checkscore.html`;

    await interaction.editReply({ content: message });

  } catch (error) {
    console.error('Error linking basename:', error);
    await interaction.editReply({
      content: '❌ An unexpected error occurred while linking your basename. Please try again later.'
    });
  }
}
