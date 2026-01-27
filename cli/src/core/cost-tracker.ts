import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { BackendType } from '../types';

export interface CostEntry {
  runId: string;
  timestamp: number;
  backend: BackendType;
  cost: number;
  duration: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  parallelism?: number;
  cpu?: number;
  memory?: number;
}

export interface CostSummary {
  totalRuns: number;
  totalCost: number;
  avgCostPerRun: number;
  totalDuration: number;
  avgDuration: number;
  totalTests: number;
  byBackend: {
    ecs?: { runs: number; totalCost: number };
    kubernetes?: { runs: number; totalCost: number };
  };
}

export class CostTracker {
  private s3: S3Client;
  
  constructor(
    private bucket: string,
    region: string
  ) {
    this.s3 = new S3Client({ region });
  }
  
  /**
   * Save cost data for a run
   */
  async saveCost(entry: CostEntry): Promise<void> {
    const key = `cost-history/${entry.runId}.json`;
    
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(entry, null, 2),
        ContentType: 'application/json',
      })
    );
  }
  
  /**
   * Get cost data for a specific run
   */
  async getCostForRun(runId: string): Promise<CostEntry | null> {
    try {
      const key = `cost-history/${runId}.json`;
      
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      
      const body = await response.Body?.transformToString();
      return body ? JSON.parse(body) : null;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }
  
  /**
   * Get cost history for last N days
   */
  async getCostHistory(days: number): Promise<CostEntry[]> {
    const entries: CostEntry[] = [];
    const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    
    try {
      // List all cost history files
      const listResponse = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: 'cost-history/',
        })
      );
      
      if (!listResponse.Contents) {
        return [];
      }
      
      // Fetch each cost file
      for (const object of listResponse.Contents) {
        if (!object.Key) continue;
        
        try {
          const response = await this.s3.send(
            new GetObjectCommand({
              Bucket: this.bucket,
              Key: object.Key,
            })
          );
          
          const body = await response.Body?.transformToString();
          if (body) {
            const entry: CostEntry = JSON.parse(body);
            
            // Only include entries within time range
            if (entry.timestamp >= cutoffDate) {
              entries.push(entry);
            }
          }
        } catch (err) {
          // Skip files that can't be parsed
          continue;
        }
      }
      
      // Sort by timestamp descending (newest first)
      entries.sort((a, b) => b.timestamp - a.timestamp);
      
      return entries;
    } catch (err: any) {
      throw new Error(`Failed to load cost history: ${err.message}`);
    }
  }
  
  /**
   * Get the last run
   */
  async getLastRun(): Promise<CostEntry | null> {
    const history = await this.getCostHistory(30); // Last 30 days
    return history.length > 0 ? history[0] : null;
  }
  
  /**
   * Calculate summary statistics
   */
  calculateSummary(entries: CostEntry[]): CostSummary {
    const totalRuns = entries.length;
    const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
    const totalDuration = entries.reduce((sum, e) => sum + e.duration, 0);
    const totalTests = entries.reduce((sum, e) => sum + e.totalTests, 0);
    
    // Group by backend
    const byBackend: CostSummary['byBackend'] = {};
    
    const ecsEntries = entries.filter(e => e.backend === 'ecs');
    if (ecsEntries.length > 0) {
      byBackend.ecs = {
        runs: ecsEntries.length,
        totalCost: ecsEntries.reduce((sum, e) => sum + e.cost, 0),
      };
    }
    
    const k8sEntries = entries.filter(e => e.backend === 'kubernetes');
    if (k8sEntries.length > 0) {
      byBackend.kubernetes = {
        runs: k8sEntries.length,
        totalCost: k8sEntries.reduce((sum, e) => sum + e.cost, 0),
      };
    }
    
    return {
      totalRuns,
      totalCost,
      avgCostPerRun: totalCost / totalRuns,
      totalDuration,
      avgDuration: totalDuration / totalRuns,
      totalTests,
      byBackend,
    };
  }
}