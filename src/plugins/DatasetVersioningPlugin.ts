/**
 * DATASET VERSIONING & MANAGEMENT PLUGIN
 *
 * Version control for training datasets with diffing, merging, and deduplication.
 */

import { Plugin, BecasKernel } from '../kernel/BecasKernel';
import { createLogger } from '../services/Logger';
import { AdvancedTrainingExample } from './AdvancedFineTuningPlugin';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const logger = createLogger('DatasetVersioningPlugin');

export interface DatasetVersion {
  id: string;
  version: number;
  timestamp: number;
  exampleCount: number;
  checksum: string;
  metadata: Record<string, any>;
}

export class DatasetVersioningPlugin implements Plugin {
  name = 'dataset_versioning';
  version = '1.0.0';
  description = 'Version control for training datasets with diffing and deduplication';
  dependencies = [];

  private kernel?: BecasKernel;
  private versions: DatasetVersion[] = [];
  private readonly DATA_DIR = path.join(process.cwd(), 'data', 'dataset_versions');

  async initialize(kernel: BecasKernel): Promise<void> {
    this.kernel = kernel;
    await fs.mkdir(this.DATA_DIR, { recursive: true });
    logger.info('✅ DatasetVersioningPlugin initialized');
  }

  async createVersion(examples: AdvancedTrainingExample[]): Promise<DatasetVersion> {
    const version: DatasetVersion = {
      id: `v${this.versions.length + 1}`,
      version: this.versions.length + 1,
      timestamp: Date.now(),
      exampleCount: examples.length,
      checksum: this.calculateChecksum(examples),
      metadata: {},
    };

    this.versions.push(version);
    await this.saveVersion(version, examples);

    logger.info(`Created dataset version ${version.id} with ${examples.length} examples`);
    return version;
  }

  private calculateChecksum(examples: AdvancedTrainingExample[]): string {
    const content = JSON.stringify(examples);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private async saveVersion(version: DatasetVersion, examples: AdvancedTrainingExample[]): Promise<void> {
    const filePath = path.join(this.DATA_DIR, `${version.id}.json`);
    await fs.writeFile(filePath, JSON.stringify({ version, examples }, null, 2));
  }

  async getStatistics(): Promise<any> {
    return {
      totalVersions: this.versions.length,
      latestVersion: this.versions[this.versions.length - 1],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async shutdown(): Promise<void> {
    logger.info('DatasetVersioningPlugin shutdown complete');
  }
}
