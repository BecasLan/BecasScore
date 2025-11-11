/**
 * SYNC DISCORD USERS TO SUPABASE
 *
 * Bu script Discord sunucularındaki tüm kullanıcıları Supabase'e kaydeder
 * Kullanım: node sync-users-to-supabase.js
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

async function upsertUserToSupabase(userId, username, discriminator, avatarUrl) {
  try {
    // First, check if user already exists
    const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,global_trust_score`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const existingUsers = await checkResponse.json();
    const userExists = existingUsers && existingUsers.length > 0;

    // Prepare payload - only set trust score for NEW users
    const payload = {
      id: userId,
      username: username,
      avatar_url: avatarUrl,
      is_bot: false
    };

    // Only set default scores for NEW users (not existing ones)
    if (!userExists) {
      payload.global_trust_score = 100;
      payload.global_risk_score = 50;
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ Failed to upsert user ${username}: ${response.status} - ${error}`);
      return { success: false, isNew: false };
    }

    return { success: true, isNew: !userExists };
  } catch (error) {
    console.error(`❌ Error upserting user ${username}:`, error.message);
    return { success: false, isNew: false };
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Found ${client.guilds.cache.size} guilds\n`);

  let totalUsers = 0;
  let successCount = 0;
  let failCount = 0;
  let newUsersCount = 0;
  let existingUsersCount = 0;

  for (const [guildId, guild] of client.guilds.cache) {
    console.log(`\n🏰 Processing guild: ${guild.name} (${guild.memberCount} members)`);

    try {
      // Fetch all members
      const members = await guild.members.fetch({ limit: 1000 });
      console.log(`   Fetched ${members.size} members from cache`);

      for (const [memberId, member] of members) {
        // Skip bots
        if (member.user.bot) continue;

        totalUsers++;

        const avatarUrl = member.user.displayAvatarURL({ format: 'png', size: 256 });
        const username = member.user.username;
        const discriminator = member.user.discriminator || '0';

        process.stdout.write(`   [${totalUsers}] Syncing ${username}... `);

        const result = await upsertUserToSupabase(
          member.user.id,
          username,
          discriminator,
          avatarUrl
        );

        if (result.success) {
          successCount++;
          if (result.isNew) {
            newUsersCount++;
            console.log('✅ NEW');
          } else {
            existingUsersCount++;
            console.log('✅ UPDATED');
          }
        } else {
          failCount++;
          console.log('❌');
        }

        // Rate limiting: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error(`❌ Failed to process guild ${guild.name}:`, error.message);
    }
  }

  console.log(`\n\n📊 SYNC COMPLETE`);
  console.log(`   Total users processed: ${totalUsers}`);
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   🆕 New users (with trust=100): ${newUsersCount}`);
  console.log(`   🔄 Existing users (trust preserved): ${existingUsersCount}`);
  console.log(`   ❌ Failed: ${failCount}`);

  process.exit(0);
});

client.login(DISCORD_TOKEN);
