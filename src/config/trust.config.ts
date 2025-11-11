// trust.config.ts

export const TRUST_CONFIG = {
  DEFAULT_SCORE: 100,  // New users start with clean record (100)
  MIN_SCORE: 0,
  MAX_SCORE: 100,
  DECAY_RATE: 0.01,  // Decay towards neutral (70) over time

  LEVELS: {
    EXEMPLARY: 85,        // >= 85
    TRUSTED: 65,          // >= 65
    NEUTRAL_MIN: 35,      // 35-64
    NEUTRAL_MAX: 64,
    RISKY: 15,            // >= 15
    DANGEROUS: 0,         // < 15
  },

  PENALTIES: {
    HIGH_TOXICITY: 10,    // toxicity > 0.7
    MEDIUM_TOXICITY: 5,   // toxicity > 0.4
    SPAM: 3,
    SCAM_ATTEMPT: 15,
    MANIPULATION: 5,
  },

  REWARDS: {
    HELPFUL_MESSAGE: 2,
    CONFLICT_RESOLUTION: 5,
    COMMUNITY_CONTRIBUTION: 3,
    REPORT_ISSUE: 4,
  },

  MODIFIERS: {
    // Positive
    HELPFUL_MESSAGE: 2,
    CONFLICT_RESOLUTION: 5,
    COMMUNITY_CONTRIBUTION: 3,
    REPORT_ISSUE: 4,

    // Negative
    SPAM: -3,
    MILD_INSULT: -2,
    SEVERE_INSULT: -5,
    HARASSMENT: -8,
    MANIPULATION: -5,
    SCAM_ATTEMPT: -15,

    // Neutral
    NORMAL_MESSAGE: 0,
    TIME_DECAY: -0.01,
  },

  ACTION_THRESHOLDS: {
    AUTO_WARN: 40,
    AUTO_TIMEOUT: 25,
    AUTO_BAN: 10,
  },
};