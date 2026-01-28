import { TestFile, TestShard } from '../types';

export interface ShardingOptions {
  files: TestFile[];
  shardCount: number;
  strategy?: 'round-robin' | 'balanced' | 'duration-based';
}

export interface ShardingResult {
  shards: TestShard[];
  totalShards: number;
  balanceScore: number; // 0-1, where 1 is perfectly balanced
}

/**
 * Creates balanced test shards for parallel execution
 */
export class TestSharding {
  /**
   * Create shards using the specified strategy
   */
  createShards(options: ShardingOptions): ShardingResult {
    const { files, shardCount, strategy = 'duration-based' } = options;

    // Validate inputs
    if (shardCount < 1) {
      throw new Error('Shard count must be at least 1');
    }

    if (files.length === 0) {
      throw new Error('Cannot create shards from empty file list');
    }

    // Adjust shard count if we have fewer files than shards
    const actualShardCount = Math.min(shardCount, files.length);

    let shards: TestShard[];

    switch (strategy) {
      case 'round-robin':
        shards = this.roundRobinSharding(files, actualShardCount);
        break;
      case 'balanced':
        shards = this.balancedSharding(files, actualShardCount);
        break;
      case 'duration-based':
        shards = this.durationBasedSharding(files, actualShardCount);
        break;
      default:
        throw new Error(`Unknown sharding strategy: ${strategy}`);
    }

    const balanceScore = this.calculateBalanceScore(shards);

    return {
      shards,
      totalShards: actualShardCount,
      balanceScore,
    };
  }

  /**
   * Round-robin distribution (simplest, but not optimal)
   * Distributes files evenly one-by-one across shards
   */
  private roundRobinSharding(files: TestFile[], shardCount: number): TestShard[] {
    const shards: TestShard[] = Array.from({ length: shardCount }, (_, i) => ({
      id: i,
      files: [],
      estimatedDuration: 0,
      totalSize: 0,
    }));

    files.forEach((file, index) => {
      const shardIndex = index % shardCount;
      shards[shardIndex].files.push(file);
      shards[shardIndex].estimatedDuration += file.estimatedDuration || 0;
      shards[shardIndex].totalSize += file.size;
    });

    return shards;
  }

  /**
   * Balanced sharding by file size
   * Distributes files to balance total size across shards
   */
  private balancedSharding(files: TestFile[], shardCount: number): TestShard[] {
    const shards: TestShard[] = Array.from({ length: shardCount }, (_, i) => ({
      id: i,
      files: [],
      estimatedDuration: 0,
      totalSize: 0,
    }));

    // Sort files by size descending (largest first)
    const sortedFiles = [...files].sort((a, b) => b.size - a.size);

    // Greedy algorithm: assign each file to the shard with smallest total size
    for (const file of sortedFiles) {
      const lightestShard = shards.reduce((min, shard) =>
        shard.totalSize < min.totalSize ? shard : min
      );

      lightestShard.files.push(file);
      lightestShard.estimatedDuration += file.estimatedDuration || 0;
      lightestShard.totalSize += file.size;
    }

    return shards;
  }

  /**
   * Duration-based sharding (best for parallel execution)
   * Distributes files to balance estimated execution time
   */
  private durationBasedSharding(files: TestFile[], shardCount: number): TestShard[] {
    const shards: TestShard[] = Array.from({ length: shardCount }, (_, i) => ({
      id: i,
      files: [],
      estimatedDuration: 0,
      totalSize: 0,
    }));

    // If duration estimates are available, use them
    const hasEstimates = files.some(f => f.estimatedDuration !== undefined);

    if (!hasEstimates) {
      // Fall back to balanced sharding by size
      return this.balancedSharding(files, shardCount);
    }

    // Sort files by estimated duration descending (longest first)
    const sortedFiles = [...files].sort((a, b) => {
      const durationA = a.estimatedDuration || 0;
      const durationB = b.estimatedDuration || 0;
      return durationB - durationA;
    });

    // Greedy algorithm: assign each file to the shard with shortest total duration
    for (const file of sortedFiles) {
      const fastestShard = shards.reduce((min, shard) =>
        shard.estimatedDuration < min.estimatedDuration ? shard : min
      );

      fastestShard.files.push(file);
      fastestShard.estimatedDuration += file.estimatedDuration || 0;
      fastestShard.totalSize += file.size;
    }

    return shards;
  }

  /**
   * Calculate balance score (0-1, where 1 is perfectly balanced)
   */
  private calculateBalanceScore(shards: TestShard[]): number {
    if (shards.length === 0) return 1;

    const durations = shards.map(s => s.estimatedDuration);
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);

    if (maxDuration === 0) {
      // No duration estimates, use file count balance
      const counts = shards.map(s => s.files.length);
      const maxCount = Math.max(...counts);
      const minCount = Math.min(...counts);
      
      if (maxCount === 0) return 1;
      return minCount / maxCount;
    }

    // Calculate balance based on duration
    return minDuration / maxDuration;
  }

  /**
   * Get shard statistics
   */
  getShardStats(shards: TestShard[]): {
    totalFiles: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    durationVariance: number;
  } {
    const totalFiles = shards.reduce((sum, s) => sum + s.files.length, 0);
    const totalDuration = shards.reduce((sum, s) => sum + s.estimatedDuration, 0);
    const avgDuration = totalDuration / shards.length;

    const durations = shards.map(s => s.estimatedDuration);
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    // Calculate variance
    const variance = durations.reduce((sum, d) => {
      return sum + Math.pow(d - avgDuration, 2);
    }, 0) / durations.length;

    return {
      totalFiles,
      totalDuration,
      avgDuration,
      minDuration,
      maxDuration,
      durationVariance: variance,
    };
  }

  /**
   * Visualize shard distribution (for debugging)
   */
  visualizeShards(shards: TestShard[]): string {
    const stats = this.getShardStats(shards);
    const maxDuration = stats.maxDuration || 1;

    let output = '\nShard Distribution:\n';
    output += '━'.repeat(60) + '\n';

    shards.forEach(shard => {
      const barLength = Math.round((shard.estimatedDuration / maxDuration) * 40);
      const bar = '█'.repeat(barLength);
      const duration = (shard.estimatedDuration / 1000).toFixed(1);
      
      output += `Shard ${shard.id}: ${bar} ${duration}s (${shard.files.length} files)\n`;
    });

    output += '━'.repeat(60) + '\n';
    output += `Balance Score: ${this.calculateBalanceScore(shards).toFixed(3)}\n`;
    output += `Avg Duration: ${(stats.avgDuration / 1000).toFixed(1)}s\n`;
    output += `Range: ${(stats.minDuration / 1000).toFixed(1)}s - ${(stats.maxDuration / 1000).toFixed(1)}s\n`;

    return output;
  }
}

/**
 * Convenience function to create shards
 */
export function createShards(
  files: TestFile[],
  shardCount: number,
  strategy: 'round-robin' | 'balanced' | 'duration-based' = 'duration-based'
): TestShard[] {
  const sharding = new TestSharding();
  const result = sharding.createShards({ files, shardCount, strategy });
  return result.shards;
}

/**
 * Get optimal shard count based on file count and parallelism limits
 */
export function getOptimalShardCount(
  fileCount: number,
  maxParallelism: number
): number {
  // Don't create more shards than files
  if (fileCount <= maxParallelism) {
    return fileCount;
  }

  // Aim for 2-5 files per shard for good balance
  const idealFilesPerShard = 3;
  const idealShardCount = Math.ceil(fileCount / idealFilesPerShard);

  // Cap at max parallelism
  return Math.min(idealShardCount, maxParallelism);
}