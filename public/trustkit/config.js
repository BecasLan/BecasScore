// trustkit-v2/config.js
module.exports = {
  ENABLED: true,

  // Skor modeli (profesyonel — 100'den sadece düşer)
  BASELINE: 100,
  FLOOR: 0,

  // Eşikler: skor <= eşik tetikler
  THRESHOLDS: {
    WARN: 95,     // uyarı
    LIMIT: 85,    // sınırlı mod (yavaşlatma vb.)
    MUTE: 70,     // timeout
    BAN: 40       // ban önerisi
  },

  // Etiket başına puan düşüşleri (severity çarpanıyla)
  // severity: 1 (düşük) .. 3 (yüksek)
  PENALTIES: {
    toxicity:  { base: 1,  maxPerMsg: 5 },
    insult:    { base: 2,  maxPerMsg: 8 },
    harassment:{ base: 3,  maxPerMsg: 10 },
    spam:      { base: 3,  maxPerMsg: 12 },
    scam:      { base: 6,  maxPerMsg: 20 },
    nsfw:      { base: 2,  maxPerMsg: 8 },
    hate:      { base: 8,  maxPerMsg: 25 },
    // pozitif etiket yok — artış YOK
  },

  // Politikalar
  TIMEOUTS: { soft: 600, hard: 3600 }, // saniye
  ANNOUNCE_IN_CHANNEL: true,           // ön planda duyuru
  MOD_CHANNEL_ID: "",                  // sadece mod kanalına log istiyorsan buraya kanal ID

  // Anti-abuse
  RATE_LIMIT: { windowMs: 5000, maxActions: 3 }, // aynı kullanıcı için 5 sn pencerede max 3 işlem
  IDEMPOTENCY_WINDOW_MS: 15000, // aynı mesaj iki kez işlenmesin

  // On-chain opsiyonel (salted hash, PII yok)
  ONCHAIN_ENABLED: false,
  CHAIN: {
    RPC_URL: process.env.BASE_SEPOLIA_RPC || "",
    PRIVATE_KEY: process.env.BASE_SEPOLIA_PK || "",
    CONTRACT_ADDRESS: process.env.TRUST_ANCHOR_ADDRESS || ""
  }
};
