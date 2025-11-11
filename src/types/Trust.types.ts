// Trust.types.ts

export interface TrustScore {
  userId: string;
  userName: string;
  guildId: string;
  score: number; // 0-150
  level: TrustLevel;
  history: TrustEvent[];
  lastUpdated: Date;
  joinedAt: Date;
}

export type TrustLevel = 'exemplary' | 'trusted' | 'neutral' | 'cautious' | 'dangerous';

export interface TrustEvent {
  timestamp: Date;
  action: string;
  delta: number; // change in trust
  reason: string;
  context?: string;
}

export interface TrustModifier {
  pattern: string;
  delta: number;
  reason: string;
}