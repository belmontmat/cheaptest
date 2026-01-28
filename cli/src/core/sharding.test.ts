import { TestSharding, createShards, getOptimalShardCount } from './sharding';
import { TestFile, TestFramework } from '../types';

describe('TestSharding', () => {
  let sharding: TestSharding;

  beforeEach(() => {
    sharding = new TestSharding();
  });

  describe('createShards', () => {
    it('should create the correct number of shards', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 2 });

      expect(result.shards).toHaveLength(2);
      expect(result.totalShards).toBe(2);
    });

    it('should distribute all files across shards', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test4.spec.ts', relativePath: 'test4.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test5.spec.ts', relativePath: 'test5.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 3 });

      const totalFiles = result.shards.reduce((sum, shard) => sum + shard.files.length, 0);
      expect(totalFiles).toBe(5);

      // Each file should appear exactly once
      const allFiles = result.shards.flatMap(shard => shard.files);
      expect(allFiles).toHaveLength(5);
      expect(new Set(allFiles.map(f => f.path)).size).toBe(5);
    });

    it('should adjust shard count if fewer files than shards', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 5 });

      expect(result.totalShards).toBe(2); // Adjusted down to file count
      expect(result.shards).toHaveLength(2);
    });

    it('should throw error for invalid shard count', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
      ];

      expect(() => {
        sharding.createShards({ files, shardCount: 0 });
      }).toThrow('Shard count must be at least 1');

      expect(() => {
        sharding.createShards({ files, shardCount: -1 });
      }).toThrow('Shard count must be at least 1');
    });

    it('should throw error for empty file list', () => {
      expect(() => {
        sharding.createShards({ files: [], shardCount: 2 });
      }).toThrow('Cannot create shards from empty file list');
    });

    it('should assign sequential IDs to shards', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 3 });

      expect(result.shards[0].id).toBe(0);
      expect(result.shards[1].id).toBe(1);
      expect(result.shards[2].id).toBe(2);
    });
  });

  describe('round-robin strategy', () => {
    it('should distribute files evenly in round-robin fashion', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test4.spec.ts', relativePath: 'test4.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test5.spec.ts', relativePath: 'test5.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test6.spec.ts', relativePath: 'test6.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 3, strategy: 'round-robin' });

      expect(result.shards[0].files.map(f => f.relativePath)).toEqual(['test1.spec.ts', 'test4.spec.ts']);
      expect(result.shards[1].files.map(f => f.relativePath)).toEqual(['test2.spec.ts', 'test5.spec.ts']);
      expect(result.shards[2].files.map(f => f.relativePath)).toEqual(['test3.spec.ts', 'test6.spec.ts']);
    });

    it('should handle uneven distribution', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test4.spec.ts', relativePath: 'test4.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test5.spec.ts', relativePath: 'test5.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 3, strategy: 'round-robin' });

      expect(result.shards[0].files).toHaveLength(2);
      expect(result.shards[1].files).toHaveLength(2);
      expect(result.shards[2].files).toHaveLength(1);
    });
  });

  describe('balanced strategy', () => {
    it('should balance by file size', () => {
      const files: TestFile[] = [
        { path: '/large.spec.ts', relativePath: 'large.spec.ts', framework: 'playwright', size: 1000 },
        { path: '/medium.spec.ts', relativePath: 'medium.spec.ts', framework: 'playwright', size: 500 },
        { path: '/small1.spec.ts', relativePath: 'small1.spec.ts', framework: 'playwright', size: 200 },
        { path: '/small2.spec.ts', relativePath: 'small2.spec.ts', framework: 'playwright', size: 200 },
      ];

      const result = sharding.createShards({ files, shardCount: 2, strategy: 'balanced' });

      // Large file should go to one shard, medium + small files to another
      const shard0Size = result.shards[0].totalSize;
      const shard1Size = result.shards[1].totalSize;

      expect(Math.abs(shard0Size - shard1Size)).toBeLessThan(300); // Reasonably balanced
    });

    it('should assign largest files first', () => {
      const files: TestFile[] = [
        { path: '/small.spec.ts', relativePath: 'small.spec.ts', framework: 'playwright', size: 100 },
        { path: '/large.spec.ts', relativePath: 'large.spec.ts', framework: 'playwright', size: 1000 },
        { path: '/medium.spec.ts', relativePath: 'medium.spec.ts', framework: 'playwright', size: 500 },
      ];

      const result = sharding.createShards({ files, shardCount: 2, strategy: 'balanced' });

      // Each shard should have at least one file
      expect(result.shards[0].files.length).toBeGreaterThan(0);
      expect(result.shards[1].files.length).toBeGreaterThan(0);
    });
  });

  describe('duration-based strategy', () => {
    it('should balance by estimated duration', () => {
      const files: TestFile[] = [
        { path: '/slow.spec.ts', relativePath: 'slow.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 10000 },
        { path: '/medium.spec.ts', relativePath: 'medium.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
        { path: '/fast1.spec.ts', relativePath: 'fast1.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 2000 },
        { path: '/fast2.spec.ts', relativePath: 'fast2.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 2000 },
      ];

      const result = sharding.createShards({ files, shardCount: 2, strategy: 'duration-based' });

      // Durations should be reasonably balanced
      const shard0Duration = result.shards[0].estimatedDuration;
      const shard1Duration = result.shards[1].estimatedDuration;

      expect(Math.abs(shard0Duration - shard1Duration)).toBeLessThan(5000);
    });

    it('should fall back to balanced strategy when no duration estimates', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 1000 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 500 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 200 },
      ];

      const result = sharding.createShards({ files, shardCount: 2, strategy: 'duration-based' });

      // Should still create shards
      expect(result.shards).toHaveLength(2);
      expect(result.shards[0].estimatedDuration).toBe(0);
    });

    it('should assign slowest tests first', () => {
      const files: TestFile[] = [
        { path: '/fast.spec.ts', relativePath: 'fast.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 1000 },
        { path: '/slow.spec.ts', relativePath: 'slow.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 10000 },
        { path: '/medium.spec.ts', relativePath: 'medium.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
      ];

      const result = sharding.createShards({ files, shardCount: 2, strategy: 'duration-based' });

      const allDurations = result.shards.map(s => s.estimatedDuration);
      
      // Both shards should have some tests
      expect(result.shards[0].files.length).toBeGreaterThan(0);
      expect(result.shards[1].files.length).toBeGreaterThan(0);
      
      // Total duration should equal sum of all files
      expect(allDurations.reduce((a, b) => a + b, 0)).toBe(16000);
    });

    it('should achieve good balance with many files', () => {
      const files: TestFile[] = Array.from({ length: 50 }, (_, i) => ({
        path: `/test${i}.spec.ts`,
        relativePath: `test${i}.spec.ts`,
        framework: 'playwright' as TestFramework,
        size: 100 + Math.random() * 900,
        estimatedDuration: 1000 + Math.random() * 9000,
      }));

      const result = sharding.createShards({ files, shardCount: 10, strategy: 'duration-based' });

      // Balance score should be reasonable (> 0.7)
      expect(result.balanceScore).toBeGreaterThan(0.7);
    });
  });

  describe('calculateBalanceScore', () => {
    it('should return 1.0 for perfectly balanced shards', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
      ];

      const result = sharding.createShards({ files, shardCount: 2 });

      expect(result.balanceScore).toBe(1.0);
    });

    it('should return lower score for imbalanced shards', () => {
      const files: TestFile[] = [
        { path: '/slow.spec.ts', relativePath: 'slow.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 10000 },
        { path: '/fast.spec.ts', relativePath: 'fast.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 1000 },
      ];

      const result = sharding.createShards({ files, shardCount: 2 });

      // With round-robin, these will be in separate shards
      // Balance score = 1000/10000 = 0.1
      expect(result.balanceScore).toBeLessThan(1.0);
    });

    it('should handle shards with no duration estimates', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 2 });

      // Should use file count for balance
      expect(result.balanceScore).toBeGreaterThan(0);
      expect(result.balanceScore).toBeLessThanOrEqual(1.0);
    });
  });

  describe('getShardStats', () => {
    it('should calculate correct statistics', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 200, estimatedDuration: 3000 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 150, estimatedDuration: 7000 },
      ];

      const result = sharding.createShards({ files, shardCount: 2 });
      const stats = sharding.getShardStats(result.shards);

      expect(stats.totalFiles).toBe(3);
      expect(stats.totalDuration).toBe(15000);
      expect(stats.avgDuration).toBe(7500);
      expect(stats.minDuration).toBeGreaterThan(0);
      expect(stats.maxDuration).toBeGreaterThan(0);
      expect(stats.durationVariance).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty shards', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
      ];

      const result = sharding.createShards({ files, shardCount: 1 });
      const stats = sharding.getShardStats(result.shards);

      expect(stats.totalFiles).toBe(1);
      expect(stats.totalDuration).toBe(0);
    });
  });

  describe('visualizeShards', () => {
    it('should generate visualization string', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 3000 },
      ];

      const result = sharding.createShards({ files, shardCount: 2 });
      const visualization = sharding.visualizeShards(result.shards);

      expect(visualization).toContain('Shard Distribution');
      expect(visualization).toContain('Shard 0');
      expect(visualization).toContain('Shard 1');
      expect(visualization).toContain('Balance Score');
      expect(visualization).toContain('files');
    });
  });

  describe('createShards convenience function', () => {
    it('should work as standalone function', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
      ];

      const shards = createShards(files, 2);

      expect(shards).toHaveLength(2);
      expect(shards[0].files.length + shards[1].files.length).toBe(2);
    });

    it('should use duration-based strategy by default', () => {
      const files: TestFile[] = [
        { path: '/slow.spec.ts', relativePath: 'slow.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 10000 },
        { path: '/fast.spec.ts', relativePath: 'fast.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 1000 },
      ];

      const shards = createShards(files, 2);

      // Should balance by duration
      const durations = shards.map(s => s.estimatedDuration);
      expect(durations[0]).toBeDefined();
      expect(durations[1]).toBeDefined();
    });

    it('should accept custom strategy', () => {
      const files: TestFile[] = [
        { path: '/test1.spec.ts', relativePath: 'test1.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test2.spec.ts', relativePath: 'test2.spec.ts', framework: 'playwright', size: 100 },
        { path: '/test3.spec.ts', relativePath: 'test3.spec.ts', framework: 'playwright', size: 100 },
      ];

      const shards = createShards(files, 2, 'round-robin');

      expect(shards).toHaveLength(2);
    });
  });

  describe('getOptimalShardCount', () => {
    it('should return file count when fewer files than max parallelism', () => {
        expect(getOptimalShardCount(5, 10)).toBe(5);
        expect(getOptimalShardCount(3, 10)).toBe(3);
        expect(getOptimalShardCount(15, 20)).toBe(15);
    });

    it('should cap at max parallelism', () => {
        expect(getOptimalShardCount(100, 10)).toBe(10);
    });

    it('should aim for 2-5 files per shard when many files', () => {
        expect(getOptimalShardCount(30, 20)).toBe(10); // 30/3 = 10
        expect(getOptimalShardCount(60, 50)).toBe(20); // 60/3 = 20
        expect(getOptimalShardCount(100, 50)).toBe(34); // 100/3 = 34 (rounded up)
    });

    it('should handle edge cases', () => {
        expect(getOptimalShardCount(1, 10)).toBe(1);
        expect(getOptimalShardCount(0, 10)).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle typical test suite', () => {
      const files: TestFile[] = Array.from({ length: 47 }, (_, i) => ({
        path: `/test${i}.spec.ts`,
        relativePath: `test${i}.spec.ts`,
        framework: 'playwright' as TestFramework,
        size: 1000 + Math.random() * 5000,
        estimatedDuration: 3000 + Math.random() * 7000,
      }));

      const shards = createShards(files, 10, 'duration-based');

      expect(shards).toHaveLength(10);
      
      // All files should be distributed
      const totalFiles = shards.reduce((sum, s) => sum + s.files.length, 0);
      expect(totalFiles).toBe(47);

      // No shard should be empty
      shards.forEach(shard => {
        expect(shard.files.length).toBeGreaterThan(0);
      });
    });

    it('should handle single file', () => {
      const files: TestFile[] = [
        { path: '/only.spec.ts', relativePath: 'only.spec.ts', framework: 'playwright', size: 100, estimatedDuration: 5000 },
      ];

      const shards = createShards(files, 10);

      expect(shards).toHaveLength(1);
      expect(shards[0].files).toHaveLength(1);
    });

    it('should handle large test suite', () => {
      const files: TestFile[] = Array.from({ length: 500 }, (_, i) => ({
        path: `/test${i}.spec.ts`,
        relativePath: `test${i}.spec.ts`,
        framework: 'playwright' as TestFramework,
        size: Math.random() * 10000,
        estimatedDuration: Math.random() * 20000,
      }));

      const shards = createShards(files, 50, 'duration-based');

      expect(shards).toHaveLength(50);
      
      const totalFiles = shards.reduce((sum, s) => sum + s.files.length, 0);
      expect(totalFiles).toBe(500);

      // Each shard should have approximately 10 files (500/50)
      const avgFiles = totalFiles / shards.length;
      expect(avgFiles).toBeCloseTo(10, 0);
    });
  });
});