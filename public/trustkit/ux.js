// trustkit/ux.js
const { EmbedBuilder } = require('discord.js');

function scoreColor(score){
  if (score >= 90) return 0x2ecc71;   // yeşil
  if (score >= 70) return 0xf1c40f;   // sarı
  if (score >= 40) return 0xe67e22;   // turuncu
  return 0xe74c3c;                    // kırmızı
}

function buildScoreEmbed({ user, score, delta = 0, summary, riskFlags = [], advice }) {
  const emb = new EmbedBuilder()
    .setAuthor({ name: `${user.tag || user.username}`, iconURL: user.displayAvatarURL?.() })
    .setTitle(`Trust Score: ${score}${delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}`)
    .setColor(scoreColor(score))
    .setTimestamp(new Date());

  if (summary) emb.setDescription(summary);
  if (riskFlags?.length) emb.addFields({ name: 'Risk Flags', value: riskFlags.map(x => `• ${x}`).join('\n') });
  if (advice) emb.addFields({ name: 'Analyst Advice', value: advice });

  emb.setFooter({ text: 'Becas TrustKit' });
  return emb;
}

module.exports = { buildScoreEmbed };
