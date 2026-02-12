import chalk from 'chalk';
import { table } from 'table';
import { Logger } from '../utils/logger';
import { CostTracker, CostEntry, CostSummary } from '../core/cost-tracker';
import { loadConfig, findConfigFile } from '../utils/config';

interface CostOptions {
  lastRun?: boolean;
  last7Days?: boolean;
  last30Days?: boolean;
  breakdown?: boolean;
  runId?: string;
  export?: string; // Export to CSV/JSON
}

export async function costCommand(options: CostOptions): Promise<void> {
  const logger = new Logger();
  
  try {
    logger.header('Cost Analysis');
    logger.info('');
    
    // Load configuration to get storage bucket
    const configPath = await findConfigFile() || '.cheaptest.yml';
    const config = await loadConfig(configPath);
    
    const tracker = new CostTracker(config.storage.bucket, config.aws.region);
    
    // Determine time range
    let entries: CostEntry[];
    let timeRange: string;
    
    if (options.runId) {
      // Specific run
      logger.startSpinner(`Loading cost data for run ${options.runId}...`);
      const entry = await tracker.getCostForRun(options.runId);
      entries = entry ? [entry] : [];
      timeRange = `Run: ${options.runId}`;
      logger.succeedSpinner('Cost data loaded');
    } else if (options.lastRun) {
      // Last run only
      logger.startSpinner('Loading last run cost data...');
      const entry = await tracker.getLastRun();
      entries = entry ? [entry] : [];
      timeRange = 'Last Run';
      logger.succeedSpinner('Cost data loaded');
    } else if (options.last7Days) {
      // Last 7 days
      logger.startSpinner('Loading cost data for last 7 days...');
      entries = await tracker.getCostHistory(7);
      timeRange = 'Last 7 Days';
      logger.succeedSpinner('Cost data loaded');
    } else if (options.last30Days) {
      // Last 30 days
      logger.startSpinner('Loading cost data for last 30 days...');
      entries = await tracker.getCostHistory(30);
      timeRange = 'Last 30 Days';
      logger.succeedSpinner('Cost data loaded');
    } else {
      // Default: last 30 days
      logger.startSpinner('Loading cost data for last 30 days...');
      entries = await tracker.getCostHistory(30);
      timeRange = 'Last 30 Days';
      logger.succeedSpinner('Cost data loaded');
    }
    
    if (entries.length === 0) {
      logger.warn('No cost data found for the specified period');
      logger.info('');
      logger.info('Run some tests to generate cost data:');
      logger.info(`  ${chalk.cyan('cheaptest run --tests ./e2e')}`);
      return;
    }
    
    // Calculate summary
    const summary = tracker.calculateSummary(entries);
    
    logger.info('');
    
    // ============================================
    // SUMMARY SECTION
    // ============================================
    logger.section('Summary', timeRange);
    logger.info('');
    
    logger.info(`  Total Runs:          ${chalk.cyan(summary.totalRuns)}`);
    logger.info(`  Total Cost:          ${logger.cost(summary.totalCost)}`);
    logger.info(`  Average Cost/Run:    ${logger.cost(summary.avgCostPerRun)}`);
    logger.info(`  Total Duration:      ${logger.duration(summary.totalDuration)}`);
    logger.info(`  Average Duration:    ${logger.duration(summary.avgDuration)}`);
    logger.info(`  Total Tests:         ${summary.totalTests}`);
    
    if (summary.byBackend.ecs && summary.byBackend.kubernetes) {
      logger.info('');
      logger.info('  By Backend:');
      logger.info(`    ECS:        ${summary.byBackend.ecs.runs} runs, ${logger.cost(summary.byBackend.ecs.totalCost)}`);
      logger.info(`    Kubernetes: ${summary.byBackend.kubernetes.runs} runs, ${logger.cost(summary.byBackend.kubernetes.totalCost)}`);
    }
    
    // ============================================
    // COST COMPARISON
    // ============================================
    logger.info('');
    logger.section('Cost Comparison vs Traditional CI/CD', '');
    logger.info('');
    
    const circleCICost = calculateCircleCICostForPeriod(entries);
    const githubActionsCost = calculateGitHubActionsCost(entries);
    const savings = circleCICost - summary.totalCost;
    const savingsPercent = ((savings / circleCICost) * 100).toFixed(1);
    
    logger.info(`  CircleCI (estimated):       ${logger.cost(circleCICost)}`);
    logger.info(`  GitHub Actions (estimated): ${logger.cost(githubActionsCost)}`);
    logger.info(`  cheaptest (actual):         ${logger.cost(summary.totalCost)}`);
    logger.info('');
    logger.success(`  Your Savings:               ${logger.cost(savings)} (${savingsPercent}%)`);
    
    // ============================================
    // BREAKDOWN TABLE
    // ============================================
    if (options.breakdown) {
      logger.info('');
      logger.section('Detailed Breakdown', '');
      logger.info('');
      
      displayBreakdownTable(entries);
    }
    
    // ============================================
    // RECENT RUNS
    // ============================================
    if (!options.breakdown && entries.length > 1) {
      logger.info('');
      logger.section('Recent Runs', `Last ${Math.min(entries.length, 10)}`);
      logger.info('');
      
      displayRecentRunsTable(entries.slice(0, 10));
    }
    
    // ============================================
    // TRENDS & INSIGHTS
    // ============================================
    if (entries.length >= 5) {
      logger.info('');
      logger.section('Trends & Insights', '');
      logger.info('');
      
      const insights = generateInsights(entries, summary);
      insights.forEach(insight => {
        if (insight.type === 'warning') {
          logger.warn(`  [!] ${insight.message}`);
        } else if (insight.type === 'success') {
          logger.success(`  [OK] ${insight.message}`);
        } else {
          logger.info(`  [i] ${insight.message}`);
        }
      });
    }
    
    // ============================================
    // MONTHLY PROJECTION
    // ============================================
    if (entries.length >= 3) {
      logger.info('');
      logger.section('Monthly Projection', 'Based on current usage');
      logger.info('');
      
      const projection = calculateMonthlyProjection(entries);
      
      logger.info(`  Projected runs/month:  ${chalk.cyan(projection.runsPerMonth)}`);
      logger.info(`  Projected cost/month:  ${logger.cost(projection.costPerMonth)}`);
      logger.info(`  vs CircleCI:           ${logger.cost(projection.circleCICost)} (save ${logger.cost(projection.savings)})`);
    }
    
    // ============================================
    // EXPORT OPTION
    // ============================================
    if (options.export) {
      logger.info('');
      logger.startSpinner(`Exporting to ${options.export}...`);
      
      await exportCostData(entries, options.export);
      
      logger.succeedSpinner(`Exported to ${chalk.cyan(options.export)}`);
    }
    
    // ============================================
    // FOOTER WITH TIPS
    // ============================================
    logger.info('');
    logger.info('💡 Tips:');
    logger.info(`  • Run ${chalk.cyan('cheaptest cost --breakdown')} for detailed breakdown`);
    logger.info(`  • Run ${chalk.cyan('cheaptest cost --last-7-days')} for weekly costs`);
    logger.info(`  • Run ${chalk.cyan('cheaptest cost --export costs.csv')} to export data`);
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load cost data: ${message}`);
    process.exit(1);
  }
}

/**
 * Display breakdown table with all runs
 */
function displayBreakdownTable(entries: CostEntry[]): void {
  const data = [
    ['Run ID', 'Date', 'Backend', 'Tests', 'Duration', 'Cost'],
    ...entries.map(entry => [
      entry.runId.substring(0, 20) + '...',
      new Date(entry.timestamp).toLocaleDateString(),
      entry.backend,
      entry.totalTests.toString(),
      formatDuration(entry.duration),
      `$${entry.cost.toFixed(4)}`,
    ]),
  ];
  
  const config = {
    columns: {
      0: { width: 25 },
      1: { width: 12 },
      2: { width: 10 },
      3: { width: 8, alignment: 'right' as const },
      4: { width: 12, alignment: 'right' as const },
      5: { width: 10, alignment: 'right' as const },
    },
  };
  
  console.log(table(data, config));
}

/**
 * Display recent runs in compact format
 */
function displayRecentRunsTable(entries: CostEntry[]): void {
  const data = [
    ['Date', 'Backend', 'Tests', 'Pass Rate', 'Cost'],
    ...entries.map(entry => {
      const passRate = entry.totalTests > 0
        ? ((entry.passed / entry.totalTests) * 100).toFixed(0)
        : '0';
      
      return [
        new Date(entry.timestamp).toLocaleDateString(),
        entry.backend,
        entry.totalTests.toString(),
        `${passRate}%`,
        `$${entry.cost.toFixed(4)}`,
      ];
    }),
  ];
  
  const config = {
    columns: {
      0: { width: 12 },
      1: { width: 10 },
      2: { width: 8, alignment: 'right' as const },
      3: { width: 10, alignment: 'right' as const },
      4: { width: 10, alignment: 'right' as const },
    },
  };
  
  console.log(table(data, config));
}

/**
 * Generate insights from cost history
 */
function generateInsights(
  entries: CostEntry[],
  summary: CostSummary
): Array<{ type: 'info' | 'warning' | 'success'; message: string }> {
  const insights: Array<{ type: 'info' | 'warning' | 'success'; message: string }> = [];
  
  // Cost trend
  if (entries.length >= 5) {
    const recent = entries.slice(0, 5);
    const older = entries.slice(-5);
    const recentAvg = recent.reduce((sum, e) => sum + e.cost, 0) / recent.length;
    const olderAvg = older.reduce((sum, e) => sum + e.cost, 0) / older.length;
    
    if (recentAvg > olderAvg * 1.2) {
      insights.push({
        type: 'warning',
        message: `Costs trending up (+${((recentAvg / olderAvg - 1) * 100).toFixed(0)}%). Consider optimizing test parallelism.`,
      });
    } else if (recentAvg < olderAvg * 0.8) {
      insights.push({
        type: 'success',
        message: `Costs trending down (-${((1 - recentAvg / olderAvg) * 100).toFixed(0)}%). Great job optimizing!`,
      });
    }
  }
  
  // Backend comparison
  if (summary.byBackend.ecs && summary.byBackend.kubernetes) {
    const ecsAvg = summary.byBackend.ecs.totalCost / summary.byBackend.ecs.runs;
    const k8sAvg = summary.byBackend.kubernetes.totalCost / summary.byBackend.kubernetes.runs;
    
    if (ecsAvg < k8sAvg && summary.totalRuns > 30) {
      insights.push({
        type: 'info',
        message: `With ${summary.totalRuns} runs/month, ECS is more cost-effective than Kubernetes.`,
      });
    } else if (k8sAvg < ecsAvg) {
      insights.push({
        type: 'success',
        message: 'Kubernetes backend is more cost-effective for your usage pattern.',
      });
    }
  }
  
  // Test efficiency
  const avgTestsPerRun = summary.totalTests / summary.totalRuns;
  if (avgTestsPerRun < 10) {
    insights.push({
      type: 'info',
      message: `Running ${avgTestsPerRun.toFixed(0)} tests/run on average. Consider batching more tests together.`,
    });
  }
  
  // Duration consistency
  const durations = entries.map(e => e.duration);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance = durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev > avgDuration * 0.5) {
    insights.push({
      type: 'warning',
      message: 'High duration variance detected. Some test runs are much slower than others.',
    });
  }
  
  return insights;
}

/**
 * Calculate monthly projection
 */
function calculateMonthlyProjection(entries: CostEntry[]): {
  runsPerMonth: number;
  costPerMonth: number;
  circleCICost: number;
  savings: number;
} {
  // Calculate days covered
  const timestamps = entries.map(e => new Date(e.timestamp).getTime());
  const daysCovered = (Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24);
  
  // Project to 30 days
  const runsPerDay = entries.length / Math.max(daysCovered, 1);
  const runsPerMonth = Math.round(runsPerDay * 30);
  
  const avgCostPerRun = entries.reduce((sum, e) => sum + e.cost, 0) / entries.length;
  const costPerMonth = runsPerMonth * avgCostPerRun;
  
  // Calculate CircleCI equivalent
  const avgParallelism = entries.reduce((sum, e) => sum + (e.parallelism || 10), 0) / entries.length;
  const circleCICost = avgParallelism * 15; // $15/container/month
  
  return {
    runsPerMonth,
    costPerMonth,
    circleCICost,
    savings: circleCICost - costPerMonth,
  };
}

/**
 * Calculate CircleCI cost for historical period
 */
function calculateCircleCICostForPeriod(entries: CostEntry[]): number {
  // CircleCI charges per minute of compute time
  // $0.006 per minute per container
  return entries.reduce((total, entry) => {
    const minutes = entry.duration / (1000 * 60);
    const parallelism = entry.parallelism || 10;
    return total + (minutes * parallelism * 0.006);
  }, 0);
}

/**
 * Calculate GitHub Actions cost
 */
function calculateGitHubActionsCost(entries: CostEntry[]): number {
  // GitHub Actions: $0.008 per minute
  return entries.reduce((total, entry) => {
    const minutes = entry.duration / (1000 * 60);
    const parallelism = entry.parallelism || 10;
    return total + (minutes * parallelism * 0.008);
  }, 0);
}

/**
 * Export cost data to file
 */
async function exportCostData(
  entries: CostEntry[],
  filepath: string
): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const ext = path.extname(filepath).toLowerCase();
  
  if (ext === '.json') {
    // Export as JSON
    const data = {
      exportDate: new Date().toISOString(),
      totalRuns: entries.length,
      entries: entries.map(e => ({
        runId: e.runId,
        timestamp: new Date(e.timestamp).toISOString(),
        backend: e.backend,
        cost: e.cost,
        duration: e.duration,
        totalTests: e.totalTests,
        passed: e.passed,
        failed: e.failed,
        parallelism: e.parallelism,
      })),
    };
    
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  } else if (ext === '.csv') {
    // Export as CSV
    const header = 'Run ID,Date,Backend,Cost,Duration (ms),Total Tests,Passed,Failed,Parallelism\n';
    const rows = entries.map(e => 
      `${e.runId},${new Date(e.timestamp).toISOString()},${e.backend},${e.cost},${e.duration},${e.totalTests},${e.passed},${e.failed},${e.parallelism || 10}`
    ).join('\n');
    
    await fs.writeFile(filepath, header + rows);
  } else {
    throw new Error('Unsupported export format. Use .json or .csv');
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}