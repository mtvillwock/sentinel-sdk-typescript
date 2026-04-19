/// <reference types="jest" />

import { Sentinel } from './index';

// Mock fetch globally
globalThis.fetch = jest.fn();

describe('Sentinel SDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'evt_123', status: 'completed' }),
    });
  });

  // ... existing tests ...

  describe('retry tracking', () => {
    it('should generate request_id if not provided', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await sentinel.track(mockFn, { model: 'claude-sonnet-4' });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.request_id).toBeDefined();
      expect(callBody.request_id).toMatch(/^req_[a-f0-9]+$/);
    });

    it('should preserve provided request_id', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await sentinel.track(mockFn, {
        model: 'claude-sonnet-4',
        request_id: 'req_custom_123',
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.request_id).toBe('req_custom_123');
    });

    it('should default attempt_number to 1', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await sentinel.track(mockFn, { model: 'claude-sonnet-4' });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.attempt_number).toBe(1);
    });

    it('should include provided attempt_number', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await sentinel.track(mockFn, {
        model: 'claude-sonnet-4',
        attempt_number: 3,
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.attempt_number).toBe(3);
    });

    it('should track retry sequence with same request_id', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const requestId = 'req_retry_test';

      // Attempt 1: fails
      const failFn = jest.fn().mockRejectedValue(new Error('timeout'));
      await expect(
        sentinel.track(failFn, {
          model: 'claude-sonnet-4',
          request_id: requestId,
          attempt_number: 1,
        })
      ).rejects.toThrow();

      // Attempt 2: fails
      await expect(
        sentinel.track(failFn, {
          model: 'claude-sonnet-4',
          request_id: requestId,
          attempt_number: 2,
        })
      ).rejects.toThrow();

      // Attempt 3: succeeds
      const successFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      await sentinel.track(successFn, {
        model: 'claude-sonnet-4',
        request_id: requestId,
        attempt_number: 3,
      });

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);

      const calls = (globalThis.fetch as jest.Mock).mock.calls;
      const events = calls.map((call) => JSON.parse(call[1].body));

      // All events should have same request_id
      expect(events.every((e) => e.request_id === requestId)).toBe(true);

      // Attempt numbers should be 1, 2, 3
      expect(events.map((e) => e.attempt_number)).toEqual([1, 2, 3]);

      // First two failed, third completed
      expect(events.map((e) => e.status)).toEqual([
        'failed',
        'failed',
        'completed',
      ]);
    });

    it('should include retry fields in failed events', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(
        sentinel.track(mockFn, {
          model: 'claude-sonnet-4',
          request_id: 'req_fail_test',
          attempt_number: 2,
        })
      ).rejects.toThrow();

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.request_id).toBe('req_fail_test');
      expect(callBody.attempt_number).toBe(2);
      expect(callBody.status).toBe('failed');
    });
  });

  describe('actual_cost_cents calculation', () => {
    it('should calculate cost from tokens for sonnet', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 1000, output_tokens: 500 },
      });

      await sentinel.track(mockFn, { model: 'claude-sonnet-4-20250514' });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.actual_cost_cents).toBeDefined();
      expect(callBody.actual_cost_cents).toBeGreaterThan(0);
    });

    it('should not include actual_cost_cents when tokens missing', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({ content: 'no usage data' });

      await sentinel.track(mockFn, { model: 'claude-sonnet-4' });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.actual_cost_cents).toBeUndefined();
    });
  });

  describe('completed_over_budget status', () => {
    it('should set completed_over_budget when warn mode and over budget', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 10000, output_tokens: 5000 },
      });

      await sentinel.track(mockFn, {
        model: 'claude-sonnet-4-20250514',
        budget_cents: 1, // Very low budget
        enforce_mode: 'warn',
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.status).toBe('completed_over_budget');
    });

    it('should set completed when under budget', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await sentinel.track(mockFn, {
        model: 'claude-sonnet-4-20250514',
        budget_cents: 1000,
        enforce_mode: 'warn',
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.status).toBe('completed');
    });
  });

  describe('workflow_key in metadata', () => {
    it('should set workflow_key from tier', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({});

      await sentinel.track(mockFn, {
        model: 'claude-sonnet-4',
        tier: 'classification',
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.metadata.workflow_key).toBe('classification');
      expect(callBody.metadata.tier).toBe('classification');
    });

    it('should preserve explicit workflow_key over tier', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({});

      await sentinel.track(mockFn, {
        model: 'claude-sonnet-4',
        tier: 'classification',
        metadata: { workflow_key: 'custom_workflow' },
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.metadata.workflow_key).toBe('custom_workflow');
    });
  });
});
