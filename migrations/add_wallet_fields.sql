-- Add wallet_address and basename columns to trust_scores table
-- Migration: Add Web3 identity fields for Base blockchain integration

ALTER TABLE trust_scores
ADD COLUMN IF NOT EXISTS wallet_address TEXT,
ADD COLUMN IF NOT EXISTS basename TEXT;

-- Create indexes for fast wallet/basename lookups
CREATE INDEX IF NOT EXISTS idx_trust_scores_wallet ON trust_scores(wallet_address);
CREATE INDEX IF NOT EXISTS idx_trust_scores_basename ON trust_scores(basename);

-- Add unique constraints (one Discord user = one wallet/basename)
ALTER TABLE trust_scores
ADD CONSTRAINT unique_wallet_address UNIQUE (wallet_address);

ALTER TABLE trust_scores
ADD CONSTRAINT unique_basename UNIQUE (basename);

-- Comments for documentation
COMMENT ON COLUMN trust_scores.wallet_address IS 'Ethereum wallet address linked to Discord user (Base network)';
COMMENT ON COLUMN trust_scores.basename IS 'Base name (ENS-like) linked to Discord user';
