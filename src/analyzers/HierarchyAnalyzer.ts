import { GuildMember } from 'discord.js';
import { HierarchyLevel } from '../types/Message.types';
import { TrustScore } from '../types/Trust.types';

export class HierarchyAnalyzer {
  analyze(member: GuildMember, trustScore?: TrustScore): HierarchyLevel {
    // Check Discord roles first
    if (member.permissions.has('Administrator')) {
      return 'admin';
    }

    if (member.permissions.has('ModerateMembers') || member.permissions.has('BanMembers')) {
      return 'moderator';
    }

    // Use trust score if available
    if (trustScore) {
      if (trustScore.score >= 130) return 'trusted';
      if (trustScore.score < 50) return 'suspicious';
    }

    // Check join date
    const joinedDaysAgo = (Date.now() - member.joinedTimestamp!) / (1000 * 60 * 60 * 24);
    if (joinedDaysAgo < 7) {
      return 'new';
    }

    return 'member';
  }

  canModerate(moderator: GuildMember, target: GuildMember): boolean {
    // Bot can't moderate admins
    if (target.permissions.has('Administrator')) {
      return false;
    }

    // Check role hierarchy
    if (moderator.roles.highest.position <= target.roles.highest.position) {
      return false;
    }

    return true;
  }
}