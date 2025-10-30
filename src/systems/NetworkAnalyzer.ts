// NetworkAnalyzer.ts - Graph-based user relationship analysis

export interface UserRelationship {
  userId1: string;
  userId2: string;
  strength: number; // 0-1, how often they interact
  sentiment: 'positive' | 'neutral' | 'negative';
  interactions: number;
}

export interface NetworkCluster {
  members: string[];
  type: 'friendly' | 'coordinated_attack' | 'bot_network' | 'normal';
  suspicionLevel: number;
}

export class NetworkAnalyzer {
  private relationships: Map<string, UserRelationship[]> = new Map();
  private messageGraph: Map<string, string[]> = new Map(); // userId -> array of users they talked to

  /**
   * Record interaction between users
   */
  recordInteraction(
    user1: string,
    user2: string,
    sentiment: 'positive' | 'neutral' | 'negative'
  ): void {
    const key = [user1, user2].sort().join(':');
    let relationships = this.relationships.get(key) || [];

    const existing = relationships.find(r =>
      (r.userId1 === user1 && r.userId2 === user2) ||
      (r.userId1 === user2 && r.userId2 === user1)
    );

    if (existing) {
      existing.interactions++;
      existing.strength = Math.min(1, existing.interactions / 100);
      existing.sentiment = sentiment;
    } else {
      relationships.push({
        userId1: user1,
        userId2: user2,
        strength: 0.01,
        sentiment,
        interactions: 1,
      });
      this.relationships.set(key, relationships);
    }

    // Update message graph
    const user1Connections = this.messageGraph.get(user1) || [];
    if (!user1Connections.includes(user2)) {
      user1Connections.push(user2);
      this.messageGraph.set(user1, user1Connections);
    }
  }

  /**
   * Detect coordinated attacks
   */
  detectCoordinatedAttack(recentMessages: { authorId: string; timestamp: Date }[]): {
    isCoordinated: boolean;
    suspectedUsers: string[];
    confidence: number;
  } {
    // Check for multiple users posting within short time
    const timeWindow = 60000; // 1 minute
    const coordThreshold = 3; // 3+ users

    const grouped: Map<number, string[]> = new Map();

    for (const msg of recentMessages) {
      const bucket = Math.floor(msg.timestamp.getTime() / timeWindow);
      const users = grouped.get(bucket) || [];
      if (!users.includes(msg.authorId)) {
        users.push(msg.authorId);
      }
      grouped.set(bucket, users);
    }

    for (const [bucket, users] of grouped.entries()) {
      if (users.length >= coordThreshold) {
        // Check if these users have coordinated before
        const hasHistory = users.every(u1 =>
          users.some(u2 => u1 !== u2 && this.hasStrongRelationship(u1, u2))
        );

        return {
          isCoordinated: true,
          suspectedUsers: users,
          confidence: hasHistory ? 0.9 : 0.6,
        };
      }
    }

    return {
      isCoordinated: false,
      suspectedUsers: [],
      confidence: 0,
    };
  }

  /**
   * Check if two users have strong relationship
   */
  private hasStrongRelationship(user1: string, user2: string): boolean {
    const key = [user1, user2].sort().join(':');
    const relationships = this.relationships.get(key) || [];
    return relationships.some(r => r.strength > 0.5);
  }

  /**
   * Detect bot networks
   */
  detectBotNetwork(): NetworkCluster[] {
    const clusters: NetworkCluster[] = [];

    // Find groups of users with similar behavior patterns
    // (Simple version - can be enhanced with graph algorithms)

    return clusters;
  }

  /**
   * Get user connections
   */
  getUserConnections(userId: string): string[] {
    return this.messageGraph.get(userId) || [];
  }
}
