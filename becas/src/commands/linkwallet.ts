import { CommandInteraction, SlashCommandBuilder } from 'discord.js';
import { blockchainService } from '../services/BlockchainService';
import { supabaseService } from '../database/DatabaseService';

export const data = new SlashCommandBuilder()
  .setName('linkwallet')
  .setDescription('Link your Ethereum wallet address to your Discord account')
  .addStringOption(option =>
    option
      .setName('address')
      .setDescription('Your Ethereum wallet address (0x...)')
      .setRequired(true)
  );

export async function execute(interaction: CommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const walletAddress = interaction.options.get('address')?.value as string;
  const userId = interaction.user.id;
  const userName = interaction.user.username;

  // Validate Ethereum address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return interaction.editReply({
      content: '❌ Invalid wallet address! Must be a valid Ethereum address (0x... with 40 hex characters).'
    });
  }

  try {
    // 1. Update database (Supabase)
    if (supabaseService.isInitialized()) {
      const { error } = await supabaseService
        .getClient()
        .from('users')
        .update({
          wallet_address: walletAddress.toLowerCase(),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        console.error('Failed to update wallet in database:', error);
        return interaction.editReply({
          content: '❌ Failed to link wallet to database. This wallet may already be linked to another account.'
        });
      }
    }

    // 2. Link on blockchain
    let txHash: string | null = null;
    if (blockchainService.isEnabled()) {
      try {
        txHash = await blockchainService.linkWallet(userId, walletAddress);
      } catch (error) {
        console.error('Failed to link wallet on blockchain:', error);
        // Don't fail the command - database link is more important
      }
    }

    // 3. Success response
    let message = `✅ **Wallet Linked Successfully!**\n\n`;
    message += `👤 Discord: ${userName}\n`;
    message += `💳 Wallet: \`${walletAddress}\`\n\n`;

    if (txHash) {
      message += `⛓️ **Blockchain Confirmation:**\n`;
      message += `Transaction: [View on BaseScan](https://sepolia.basescan.org/tx/${txHash})\n\n`;
    }

    message += `📊 Your trust score will now be visible on the blockchain!\n`;
    message += `🌐 View on dashboard: https://becascore.xyz/checkscore.html`;

    await interaction.editReply({ content: message });

  } catch (error) {
    console.error('Error linking wallet:', error);
    await interaction.editReply({
      content: '❌ An unexpected error occurred while linking your wallet. Please try again later.'
    });
  }
}
