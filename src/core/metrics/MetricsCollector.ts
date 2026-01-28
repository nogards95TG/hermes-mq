/**
 * Metric type
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Metric labels
 */
export type Labels = Record<string, string>;

/**
 * Counter metric
 */
interface Counter {
  type: 'counter';
  value: number;
  labels: Labels;
}

/**
 * Gauge metric
 */
interface Gauge {
  type: 'gauge';
  value: number;
  labels: Labels;
}

/**
 * Histogram bucket
 */
interface HistogramBucket {
  le: number; // less than or equal
  count: number;
}

/**
 * Histogram metric
 */
interface Histogram {
  type: 'histogram';
  sum: number;
  count: number;
  buckets: HistogramBucket[];
  labels: Labels;
}

/**
 * Metric value union
 */
type MetricValue = Counter | Gauge | Histogram;

/**
 * Metric entry
 */
interface MetricEntry {
  name: string;
  help: string;
  type: MetricType;
  values: Map<string, MetricValue>;
}

/**
 * Histogram configuration
 */
export interface HistogramConfig {
  buckets?: number[];
}

/**
 * MetricsCollector provides zero-dependency metrics collection
 *
 * Collects counters, gauges, and histograms with label support.
 * Compatible with Prometheus text format.
 *
 * @example
 * ```typescript
 * import { MetricsCollector } from 'hermes-mq';
 *
 * const metrics = new MetricsCollector();
 *
 * // Increment counter
 * metrics.incrementCounter('messages_published_total', { queue: 'users', status: 'success' });
 *
 * // Set gauge
 * metrics.setGauge('connection_state', { state: 'connected' }, 1);
 *
 * // Observe histogram
 * metrics.observeHistogram('message_duration_seconds', {}, 0.125);
 *
 * // Export to Prometheus format
 * const output = metrics.toPrometheus();
 * ```
 */
export class MetricsCollector {
  private static globalInstance: MetricsCollector | null = null;

  private metrics = new Map<string, MetricEntry>();
  private defaultHistogramBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

  /**
   * Get the global metrics collector instance
   *
   * This allows you to collect metrics without explicitly passing a collector instance.
   * All components will automatically use this global instance if no custom collector is provided.
   *
   * @returns The global MetricsCollector instance
   *
   * @example
   * ```typescript
   * import { MetricsCollector, RpcClient } from 'hermes-mq';
   *
   * // Enable global metrics collection
   * const metrics = MetricsCollector.global();
   *
   * // Now all components automatically collect metrics
   * const client = new RpcClient({
   *   connection: { url: 'amqp://localhost' },
   *   queueName: 'my-service'
   * });
   *
   * // Export metrics
   * console.log(metrics.toPrometheus());
   * ```
   */
  static global(): MetricsCollector {
    if (!MetricsCollector.globalInstance) {
      MetricsCollector.globalInstance = new MetricsCollector();
    }
    return MetricsCollector.globalInstance;
  }

  /**
   * Reset the global metrics collector instance
   *
   * Useful for testing or when you want to start fresh.
   */
  static resetGlobal(): void {
    MetricsCollector.globalInstance = null;
  }

  /**
   * Increment a counter metric
   *
   * @param name - Metric name (should end with _total)
   * @param labels - Metric labels
   * @param value - Value to add (default: 1)
   */
  incrementCounter(name: string, labels: Labels = {}, value: number = 1): void {
    const entry = this.ensureMetric(name, 'counter', 'Total count');
    const key = this.labelsToKey(labels);

    let counter = entry.values.get(key) as Counter | undefined;

    if (!counter) {
      counter = {
        type: 'counter',
        value: 0,
        labels,
      };
      entry.values.set(key, counter);
    }

    counter.value += value;
  }

  /**
   * Set a gauge metric
   *
   * @param name - Metric name
   * @param labels - Metric labels
   * @param value - Value to set
   */
  setGauge(name: string, labels: Labels = {}, value: number): void {
    const entry = this.ensureMetric(name, 'gauge', 'Current value');
    const key = this.labelsToKey(labels);

    const gauge: Gauge = {
      type: 'gauge',
      value,
      labels,
    };

    entry.values.set(key, gauge);
  }

  /**
   * Increment a gauge metric
   *
   * @param name - Metric name
   * @param labels - Metric labels
   * @param value - Value to add (default: 1)
   */
  incrementGauge(name: string, labels: Labels = {}, value: number = 1): void {
    const entry = this.ensureMetric(name, 'gauge', 'Current value');
    const key = this.labelsToKey(labels);

    let gauge = entry.values.get(key) as Gauge | undefined;

    if (!gauge) {
      gauge = {
        type: 'gauge',
        value: 0,
        labels,
      };
      entry.values.set(key, gauge);
    }

    gauge.value += value;
  }

  /**
   * Decrement a gauge metric
   *
   * @param name - Metric name
   * @param labels - Metric labels
   * @param value - Value to subtract (default: 1)
   */
  decrementGauge(name: string, labels: Labels = {}, value: number = 1): void {
    this.incrementGauge(name, labels, -value);
  }

  /**
   * Observe a value in a histogram
   *
   * @param name - Metric name (should end with _seconds or similar)
   * @param labels - Metric labels
   * @param value - Observed value
   * @param config - Histogram configuration
   */
  observeHistogram(
    name: string,
    labels: Labels = {},
    value: number,
    config?: HistogramConfig
  ): void {
    const entry = this.ensureMetric(name, 'histogram', 'Histogram of values');
    const key = this.labelsToKey(labels);

    let histogram = entry.values.get(key) as Histogram | undefined;

    if (!histogram) {
      const buckets = config?.buckets || this.defaultHistogramBuckets;
      histogram = {
        type: 'histogram',
        sum: 0,
        count: 0,
        buckets: buckets.map((le) => ({ le, count: 0 })),
        labels,
      };
      // Add +Inf bucket
      histogram.buckets.push({ le: Infinity, count: 0 });
      entry.values.set(key, histogram);
    }

    histogram.sum += value;
    histogram.count++;

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  /**
   * Set help text for a metric
   *
   * @param name - Metric name
   * @param help - Help text
   */
  setHelp(name: string, help: string): void {
    const entry = this.metrics.get(name);
    if (entry) {
      entry.help = help;
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
  }

  /**
   * Get metric by name
   *
   * @param name - Metric name
   * @returns Metric entry or undefined
   */
  getMetric(name: string): MetricEntry | undefined {
    return this.metrics.get(name);
  }

  /**
   * Get all metrics
   *
   * @returns Map of all metrics
   */
  getAllMetrics(): Map<string, MetricEntry> {
    return new Map(this.metrics);
  }

  /**
   * Export metrics in Prometheus text format
   *
   * @returns Prometheus-formatted metrics string
   */
  toPrometheus(): string {
    let output = '';

    for (const [name, entry] of this.metrics) {
      // HELP line
      output += `# HELP ${name} ${entry.help}\n`;
      // TYPE line
      output += `# TYPE ${name} ${entry.type}\n`;

      // Metric values
      for (const metric of entry.values.values()) {
        if (metric.type === 'counter' || metric.type === 'gauge') {
          const labelsStr = this.formatLabels(metric.labels);
          output += `${name}${labelsStr} ${metric.value}\n`;
        } else if (metric.type === 'histogram') {
          const baseLabels = this.formatLabels(metric.labels, false);

          // Buckets
          for (const bucket of metric.buckets) {
            const le = bucket.le === Infinity ? '+Inf' : bucket.le.toString();
            const labels = baseLabels ? `${baseLabels.slice(0, -1)},le="${le}"}` : `{le="${le}"}`;
            output += `${name}_bucket${labels} ${bucket.count}\n`;
          }

          // Sum
          output += `${name}_sum${this.formatLabels(metric.labels)} ${metric.sum}\n`;

          // Count
          output += `${name}_count${this.formatLabels(metric.labels)} ${metric.count}\n`;
        }
      }

      output += '\n';
    }

    return output.trimEnd();
  }

  /**
   * Ensure metric exists
   */
  private ensureMetric(name: string, type: MetricType, defaultHelp: string): MetricEntry {
    let entry = this.metrics.get(name);

    if (!entry) {
      entry = {
        name,
        help: defaultHelp,
        type,
        values: new Map(),
      };
      this.metrics.set(name, entry);
    } else if (entry.type !== type) {
      throw new Error(
        `Metric ${name} already exists with type ${entry.type}, cannot change to ${type}`
      );
    }

    return entry;
  }

  /**
   * Convert labels to a unique key
   */
  private labelsToKey(labels: Labels): string {
    if (Object.keys(labels).length === 0) {
      return '';
    }

    const sorted = Object.keys(labels)
      .sort()
      .map((key) => `${key}="${labels[key]}"`)
      .join(',');

    return sorted;
  }

  /**
   * Format labels for Prometheus output
   */
  private formatLabels(labels: Labels, includeBraces: boolean = true): string {
    const entries = Object.entries(labels);

    if (entries.length === 0) {
      return '';
    }

    const formatted = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');

    return includeBraces ? `{${formatted}}` : `{${formatted}`;
  }
}
