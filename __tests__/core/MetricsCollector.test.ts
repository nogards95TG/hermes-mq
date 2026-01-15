import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/core/metrics/MetricsCollector';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('Counter metrics', () => {
    it('should increment counter', () => {
      collector.incrementCounter('test_total', { status: 'success' }, 1);
      collector.incrementCounter('test_total', { status: 'success' }, 2);

      const output = collector.toPrometheus();

      expect(output).toContain('# HELP test_total');
      expect(output).toContain('# TYPE test_total counter');
      expect(output).toContain('test_total{status="success"} 3');
    });

    it('should handle multiple labels', () => {
      collector.incrementCounter('requests_total', { method: 'GET', status: '200' });
      collector.incrementCounter('requests_total', { method: 'POST', status: '201' });

      const output = collector.toPrometheus();

      expect(output).toContain('requests_total{method="GET",status="200"} 1');
      expect(output).toContain('requests_total{method="POST",status="201"} 1');
    });

    it('should handle empty labels', () => {
      collector.incrementCounter('simple_counter_total');

      const output = collector.toPrometheus();

      expect(output).toContain('simple_counter_total 1');
    });

    it('should default to increment by 1', () => {
      collector.incrementCounter('test_total', {});
      collector.incrementCounter('test_total', {});

      const output = collector.toPrometheus();

      expect(output).toContain('test_total 2');
    });
  });

  describe('Gauge metrics', () => {
    it('should set gauge value', () => {
      collector.setGauge('temperature', { location: 'room1' }, 22.5);

      const output = collector.toPrometheus();

      expect(output).toContain('# HELP temperature');
      expect(output).toContain('# TYPE temperature gauge');
      expect(output).toContain('temperature{location="room1"} 22.5');
    });

    it('should update gauge value', () => {
      collector.setGauge('memory_usage', {}, 100);
      collector.setGauge('memory_usage', {}, 200);

      const output = collector.toPrometheus();

      expect(output).toContain('memory_usage 200');
      expect(output).not.toContain('memory_usage 100');
    });

    it('should increment gauge', () => {
      collector.incrementGauge('connections', {}, 5);
      collector.incrementGauge('connections', {}, 3);

      const output = collector.toPrometheus();

      expect(output).toContain('connections 8');
    });

    it('should decrement gauge', () => {
      collector.setGauge('queue_size', {}, 10);
      collector.decrementGauge('queue_size', {}, 3);

      const output = collector.toPrometheus();

      expect(output).toContain('queue_size 7');
    });

    it('should handle negative values from decrement', () => {
      collector.setGauge('balance', {}, 5);
      collector.decrementGauge('balance', {}, 10);

      const output = collector.toPrometheus();

      expect(output).toContain('balance -5');
    });
  });

  describe('Histogram metrics', () => {
    it('should observe values in histogram', () => {
      collector.observeHistogram('request_duration_seconds', {}, 0.05);
      collector.observeHistogram('request_duration_seconds', {}, 0.5);
      collector.observeHistogram('request_duration_seconds', {}, 1.5);

      const output = collector.toPrometheus();

      expect(output).toContain('# HELP request_duration_seconds');
      expect(output).toContain('# TYPE request_duration_seconds histogram');
      expect(output).toContain('request_duration_seconds_sum');
      expect(output).toContain('request_duration_seconds_count');
      expect(output).toContain('le=');
    });

    it('should calculate histogram buckets correctly', () => {
      collector.observeHistogram('latency_seconds', {}, 0.001);
      collector.observeHistogram('latency_seconds', {}, 0.01);
      collector.observeHistogram('latency_seconds', {}, 0.1);
      collector.observeHistogram('latency_seconds', {}, 1);

      const output = collector.toPrometheus();

      // Should have buckets
      expect(output).toMatch(/latency_seconds_bucket\{le="0.005"\} \d+/);
      expect(output).toMatch(/latency_seconds_bucket\{le="0.01"\} \d+/);
      expect(output).toMatch(/latency_seconds_bucket\{le="0.1"\} \d+/);
      expect(output).toMatch(/latency_seconds_bucket\{le="1"\} \d+/);
      expect(output).toMatch(/latency_seconds_bucket\{le="\+Inf"\} 4/);

      // Should have sum and count
      expect(output).toContain('latency_seconds_sum');
      expect(output).toContain('latency_seconds_count 4');
    });

    it('should support custom buckets', () => {
      collector.observeHistogram('custom_metric', {}, 50, { buckets: [10, 50, 100] });

      const output = collector.toPrometheus();

      expect(output).toContain('le="10"');
      expect(output).toContain('le="50"');
      expect(output).toContain('le="100"');
      expect(output).toContain('le="+Inf"');
    });

    it('should handle histogram with labels', () => {
      collector.observeHistogram('api_duration_seconds', { endpoint: '/users' }, 0.1);
      collector.observeHistogram('api_duration_seconds', { endpoint: '/orders' }, 0.2);

      const output = collector.toPrometheus();

      expect(output).toContain('endpoint="/users"');
      expect(output).toContain('endpoint="/orders"');
    });

    it('should calculate sum correctly', () => {
      collector.observeHistogram('test_seconds', {}, 1.5);
      collector.observeHistogram('test_seconds', {}, 2.5);
      collector.observeHistogram('test_seconds', {}, 3.0);

      const output = collector.toPrometheus();

      expect(output).toContain('test_seconds_sum 7');
    });
  });

  describe('setHelp()', () => {
    it('should set custom help text', () => {
      collector.incrementCounter('custom_total', {});
      collector.setHelp('custom_total', 'This is a custom help message');

      const output = collector.toPrometheus();

      expect(output).toContain('# HELP custom_total This is a custom help message');
    });

    it('should do nothing if metric does not exist', () => {
      collector.setHelp('nonexistent_metric', 'Help text');

      const metric = collector.getMetric('nonexistent_metric');
      expect(metric).toBeUndefined();
    });
  });

  describe('reset()', () => {
    it('should clear all metrics', () => {
      collector.incrementCounter('test1_total', {});
      collector.setGauge('test2', {}, 42);
      collector.observeHistogram('test3_seconds', {}, 1.0);

      collector.reset();

      const output = collector.toPrometheus();
      expect(output).toBe('');
    });
  });

  describe('getMetric()', () => {
    it('should return metric by name', () => {
      collector.incrementCounter('test_total', { foo: 'bar' }, 5);

      const metric = collector.getMetric('test_total');

      expect(metric).toBeDefined();
      expect(metric?.name).toBe('test_total');
      expect(metric?.type).toBe('counter');
    });

    it('should return undefined for non-existent metric', () => {
      const metric = collector.getMetric('nonexistent');

      expect(metric).toBeUndefined();
    });
  });

  describe('getAllMetrics()', () => {
    it('should return all metrics', () => {
      collector.incrementCounter('counter1_total', {});
      collector.setGauge('gauge1', {}, 10);
      collector.observeHistogram('histogram1_seconds', {}, 1.0);

      const metrics = collector.getAllMetrics();

      expect(metrics.size).toBe(3);
      expect(metrics.has('counter1_total')).toBe(true);
      expect(metrics.has('gauge1')).toBe(true);
      expect(metrics.has('histogram1_seconds')).toBe(true);
    });

    it('should return empty map when no metrics', () => {
      const metrics = collector.getAllMetrics();

      expect(metrics.size).toBe(0);
    });
  });

  describe('toPrometheus()', () => {
    it('should format metrics in Prometheus text format', () => {
      collector.incrementCounter('messages_published_total', { queue: 'users', status: 'success' }, 100);
      collector.setGauge('connection_state', { state: 'connected' }, 1);

      const output = collector.toPrometheus();

      // Should have HELP and TYPE comments
      expect(output).toMatch(/# HELP messages_published_total/);
      expect(output).toMatch(/# TYPE messages_published_total counter/);
      expect(output).toMatch(/# HELP connection_state/);
      expect(output).toMatch(/# TYPE connection_state gauge/);

      // Should have metric values
      expect(output).toContain('messages_published_total{queue="users",status="success"} 100');
      expect(output).toContain('connection_state{state="connected"} 1');
    });

    it('should return empty string when no metrics', () => {
      const output = collector.toPrometheus();

      expect(output).toBe('');
    });

    it('should sort labels alphabetically', () => {
      collector.incrementCounter('test_total', { z: 'last', a: 'first', m: 'middle' });

      const output = collector.toPrometheus();

      expect(output).toContain('test_total{a="first",m="middle",z="last"} 1');
    });
  });

  describe('Error handling', () => {
    it('should throw error when changing metric type', () => {
      collector.incrementCounter('test_metric', {});

      expect(() => {
        collector.setGauge('test_metric', {}, 42);
      }).toThrow('Metric test_metric already exists with type counter, cannot change to gauge');
    });

    it('should handle special characters in labels', () => {
      collector.incrementCounter('test_total', { path: '/api/v1/users', method: 'GET' });

      const output = collector.toPrometheus();

      expect(output).toContain('test_total{method="GET",path="/api/v1/users"} 1');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical RabbitMQ metrics', () => {
      // Messages published
      collector.incrementCounter('hermes_messages_published_total', { queue: 'users', status: 'success' }, 150);
      collector.incrementCounter('hermes_messages_published_total', { queue: 'users', status: 'error' }, 5);

      // Messages consumed
      collector.incrementCounter('hermes_messages_consumed_total', { queue: 'orders', status: 'ack' }, 120);
      collector.incrementCounter('hermes_messages_consumed_total', { queue: 'orders', status: 'nack' }, 3);

      // Processing duration
      collector.observeHistogram('hermes_message_processing_duration_seconds', { queue: 'orders' }, 0.05);
      collector.observeHistogram('hermes_message_processing_duration_seconds', { queue: 'orders' }, 0.15);
      collector.observeHistogram('hermes_message_processing_duration_seconds', { queue: 'orders' }, 0.25);

      // Connection state
      collector.setGauge('hermes_connection_state', { state: 'connected' }, 1);

      // Channel count
      collector.setGauge('hermes_channel_count', {}, 3);

      const output = collector.toPrometheus();

      // Verify all metrics are present
      expect(output).toContain('hermes_messages_published_total');
      expect(output).toContain('hermes_messages_consumed_total');
      expect(output).toContain('hermes_message_processing_duration_seconds');
      expect(output).toContain('hermes_connection_state');
      expect(output).toContain('hermes_channel_count');

      // Verify values
      expect(output).toContain('hermes_messages_published_total{queue="users",status="success"} 150');
      expect(output).toContain('hermes_messages_consumed_total{queue="orders",status="ack"} 120');
      expect(output).toContain('hermes_channel_count 3');
    });
  });
});
