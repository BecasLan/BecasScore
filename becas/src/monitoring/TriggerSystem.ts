// TriggerSystem.ts

export interface Trigger {
  id: string;
  name: string;
  event: 'message' | 'pattern' | 'trust_change' | 'time' | 'action_completed';
  condition: (data: any) => boolean;
  action: (data: any) => Promise<void>;
  enabled: boolean;
  triggerCount: number;
  lastTriggered?: Date;
}

export class TriggerSystem {
  private triggers: Map<string, Trigger> = new Map();
  private triggerCounter = 0;

  /**
   * Register a new trigger
   */
  register(
    name: string,
    event: Trigger['event'],
    condition: Trigger['condition'],
    action: Trigger['action']
  ): string {
    const id = `trigger-${++this.triggerCounter}`;

    const trigger: Trigger = {
      id,
      name,
      event,
      condition,
      action,
      enabled: true,
      triggerCount: 0,
    };

    this.triggers.set(id, trigger);
    console.log(`✓ Registered trigger: ${name} (${id})`);

    return id;
  }

  /**
   * Fire event and check triggers
   */
  async fire(event: Trigger['event'], data: any): Promise<void> {
    const relevantTriggers = Array.from(this.triggers.values())
      .filter(t => t.enabled && t.event === event);

    if (relevantTriggers.length === 0) return;

    console.log(`🔔 Event fired: ${event}, checking ${relevantTriggers.length} triggers...`);

    for (const trigger of relevantTriggers) {
      try {
        if (trigger.condition(data)) {
          console.log(`⚡ Trigger activated: ${trigger.name}`);
          
          await trigger.action(data);
          
          trigger.triggerCount++;
          trigger.lastTriggered = new Date();
        }
      } catch (error) {
        console.error(`Failed to execute trigger ${trigger.name}:`, error);
      }
    }
  }

  /**
   * Enable a trigger
   */
  enable(triggerId: string): boolean {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    trigger.enabled = true;
    console.log(`✓ Enabled trigger: ${trigger.name}`);
    return true;
  }

  /**
   * Disable a trigger
   */
  disable(triggerId: string): boolean {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    trigger.enabled = false;
    console.log(`✗ Disabled trigger: ${trigger.name}`);
    return true;
  }

  /**
   * Remove a trigger
   */
  unregister(triggerId: string): boolean {
    const trigger = this.triggers.get(triggerId);
    if (!trigger) return false;

    this.triggers.delete(triggerId);
    console.log(`🗑️ Removed trigger: ${trigger.name}`);
    return true;
  }

  /**
   * Get trigger by ID
   */
  get(triggerId: string): Trigger | undefined {
    return this.triggers.get(triggerId);
  }

  /**
   * Get all triggers for event type
   */
  getByEvent(event: Trigger['event']): Trigger[] {
    return Array.from(this.triggers.values()).filter(t => t.event === event);
  }

  /**
   * Get all enabled triggers
   */
  getEnabled(): Trigger[] {
    return Array.from(this.triggers.values()).filter(t => t.enabled);
  }

  /**
   * Get trigger statistics
   */
  getStats(): {
    total: number;
    enabled: number;
    disabled: number;
    byEvent: Record<string, number>;
  } {
    const triggers = Array.from(this.triggers.values());
    const byEvent: Record<string, number> = {};

    for (const trigger of triggers) {
      byEvent[trigger.event] = (byEvent[trigger.event] || 0) + 1;
    }

    return {
      total: triggers.length,
      enabled: triggers.filter(t => t.enabled).length,
      disabled: triggers.filter(t => !t.enabled).length,
      byEvent,
    };
  }

  /**
   * Create common trigger patterns
   */
  createPatterns() {
    // Pattern: User says specific word
    this.registerWordTrigger = (word: string, action: (data: any) => Promise<void>) => {
      return this.register(
        `Word trigger: "${word}"`,
        'message',
        (data) => data.content?.toLowerCase().includes(word.toLowerCase()),
        action
      );
    };

    // Pattern: Trust drops below threshold
    this.registerTrustThresholdTrigger = (threshold: number, action: (data: any) => Promise<void>) => {
      return this.register(
        `Trust below ${threshold}`,
        'trust_change',
        (data) => data.newScore < threshold && data.oldScore >= threshold,
        action
      );
    };

    // Pattern: Time-based
    this.registerTimeTrigger = (intervalMs: number, action: () => Promise<void>) => {
      const id = this.register(
        `Time trigger: every ${intervalMs}ms`,
        'time',
        () => true,
        action
      );

      // Setup interval
      setInterval(async () => {
        await this.fire('time', {});
      }, intervalMs);

      return id;
    };
  }

  // Helper methods (defined by createPatterns)
  registerWordTrigger?: (word: string, action: (data: any) => Promise<void>) => string;
  registerTrustThresholdTrigger?: (threshold: number, action: (data: any) => Promise<void>) => string;
  registerTimeTrigger?: (intervalMs: number, action: () => Promise<void>) => string;
}