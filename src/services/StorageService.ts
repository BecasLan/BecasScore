import fs from 'fs/promises';
import path from 'path';
import { ENV } from '../config/environment';

export class StorageService {
  private dataDir: string;
  private cache: Map<string, any> = new Map();

  constructor() {
    this.dataDir = ENV.DATA_DIR;
    this.initializeStorage();
  }

  /**
   * Initialize storage directories
   */
  private async initializeStorage(): Promise<void> {
    const dirs = [
      this.dataDir,
      path.join(this.dataDir, 'memories'),
      path.join(this.dataDir, 'trust'),
      path.join(this.dataDir, 'rules'),
      path.join(this.dataDir, 'reflections'),
      path.join(this.dataDir, 'tasks'),
      path.join(this.dataDir, 'crossguild'),
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        console.error(`Failed to create directory ${dir}:`, error);
      }
    }

    // Initialize default files
    await this.initializeDefaultFiles();
  }

  /**
   * Initialize default data files
   */
  private async initializeDefaultFiles(): Promise<void> {
    const defaults = {
      'memories/short_term.json': { conversations: [] },
      'memories/long_term.json': { users: {} },
      'memories/meta_memory.json': {
        reflections: [],
        learnings: [],
        emotionalState: {
          currentMood: 'calm',
          confidence: 0.8,
          satisfaction: 0.75,
          stress: 0.2,
          lastUpdated: new Date().toISOString(),
        },
        goals: [],
      },
      'trust/trust_scores.json': { scores: {} },
      'rules/active_rules.json': { rules: [] },
      'reflections/diary.json': { entries: [] },
      'crossguild/reputations.json': { reputations: {}, lastUpdated: new Date().toISOString() },
      'tasks/active_tasks.json': [],
    };

    for (const [filePath, defaultData] of Object.entries(defaults)) {
      const fullPath = path.join(this.dataDir, filePath);
      try {
        await fs.access(fullPath);
      } catch {
        await fs.writeFile(fullPath, JSON.stringify(defaultData, null, 2));
      }
    }
  }

  /**
   * Read data from file
   */
  async read<T>(category: string, filename: string): Promise<T | null> {
    const cacheKey = `${category}/${filename}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const filePath = path.join(this.dataDir, category, filename);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.cache.set(cacheKey, parsed);
      return parsed;
    } catch (error: any) {
      // Only log non-ENOENT errors (file not found is expected on first run)
      if (error.code !== 'ENOENT') {
        console.error(`Failed to read ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Write data to file
   */
  async write(category: string, filename: string, data: any): Promise<boolean> {
    const cacheKey = `${category}/${filename}`;
    const filePath = path.join(this.dataDir, category, filename);

    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      this.cache.set(cacheKey, data);
      return true;
    } catch (error) {
      console.error(`Failed to write ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Append to array in file
   */
  async append<T>(
    category: string,
    filename: string,
    arrayKey: string,
    item: T
  ): Promise<boolean> {
    const data = await this.read<any>(category, filename);
    if (!data) return false;

    if (!Array.isArray(data[arrayKey])) {
      data[arrayKey] = [];
    }

    data[arrayKey].push(item);
    return this.write(category, filename, data);
  }

  /**
   * Update nested data
   */
  async update(
    category: string,
    filename: string,
    path: string[],
    value: any
  ): Promise<boolean> {
    const data = await this.read<any>(category, filename);
    if (!data) return false;

    let current = data;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {};
      }
      current = current[path[i]];
    }

    current[path[path.length - 1]] = value;
    return this.write(category, filename, data);
  }

  /**
   * Delete data
   */
  async delete(category: string, filename: string): Promise<boolean> {
    const cacheKey = `${category}/${filename}`;
    const filePath = path.join(this.dataDir, category, filename);

    try {
      await fs.unlink(filePath);
      this.cache.delete(cacheKey);
      return true;
    } catch (error) {
      console.error(`Failed to delete ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Clear cache
   */
  clearCache(category?: string): void {
    if (category) {
      for (const key of this.cache.keys()) {
        if (key.startsWith(category)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Backup all data
   */
  async backup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const backupDir = path.join(this.dataDir, 'backups', timestamp);

    try {
      await fs.mkdir(backupDir, { recursive: true });
      
      const categories = ['memories', 'trust', 'rules', 'reflections'];
      for (const category of categories) {
        const srcDir = path.join(this.dataDir, category);
        const destDir = path.join(backupDir, category);
        await fs.mkdir(destDir, { recursive: true });
        
        const files = await fs.readdir(srcDir);
        for (const file of files) {
          await fs.copyFile(
            path.join(srcDir, file),
            path.join(destDir, file)
          );
        }
      }
      
      return backupDir;
    } catch (error) {
      console.error('Backup failed:', error);
      throw error;
    }
  }

  /**
   * Query data with filter
   */
  async query<T>(
    category: string,
    filename: string,
    filter: (item: T) => boolean
  ): Promise<T[]> {
    const data = await this.read<any>(category, filename);
    if (!data) return [];

    // Assume data has an array property (adjust based on structure)
    const items = Object.values(data).flat() as T[];
    return items.filter(filter);
  }

  /**
   * Generic save - saves directly to root data directory
   * For sentient AI systems
   */
  async save(filename: string, data: any): Promise<boolean> {
    const filePath = path.join(this.dataDir, filename);

    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      this.cache.set(filename, data);
      return true;
    } catch (error) {
      console.error(`Failed to save ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Generic load - loads directly from root data directory
   * For sentient AI systems
   */
  async load<T>(filename: string): Promise<T | null> {
    // Check cache first
    if (this.cache.has(filename)) {
      return this.cache.get(filename);
    }

    const filePath = path.join(this.dataDir, filename);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.cache.set(filename, parsed);
      return parsed;
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Failed to load ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Save event to database (for analytics)
   */
  async saveEvent(event: any): Promise<void> {
    const eventsDir = path.join(this.dataDir, 'events');
    await fs.mkdir(eventsDir, { recursive: true });

    const filePath = path.join(eventsDir, `${event.guildId}.json`);

    try {
      // Load existing events
      let events: any[] = [];
      try {
        const data = await fs.readFile(filePath, 'utf-8');
        events = JSON.parse(data);
      } catch (error: any) {
        if (error.code !== 'ENOENT') throw error;
      }

      // Append new event
      events.push(event);

      // Keep only last 10,000 events per guild (prevent file bloat)
      if (events.length > 10000) {
        events = events.slice(-10000);
      }

      // Save back
      await fs.writeFile(filePath, JSON.stringify(events, null, 2));
    } catch (error) {
      console.error(`Failed to save event to ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Get events for a guild (for analytics)
   */
  async getEvents(guildId: string): Promise<any[]> {
    const filePath = path.join(this.dataDir, 'events', `${guildId}.json`);

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return []; // No events yet
      }
      console.error(`Failed to load events from ${filePath}:`, error);
      throw error;
    }
  }
}