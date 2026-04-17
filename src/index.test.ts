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

  describe('Constructor', () => {
    it('should create instance with valid config', () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        source: 'test-app',
      });

      const config = sentinel.getConfig();
      expect(config.apiKey).toBe('sk_test_123');
      expect(config.source).toBe('test-app');
    });

    it('should throw error if API key is missing', () => {
      expect(() => {
        new Sentinel({ apiKey: '' });
      }).toThrow('API key is required');
    });

    it('should use default values', () => {
      const sentinel = new Sentinel({ apiKey: 'sk_test_123' });
      const config = sentinel.getConfig();

      expect(config.source).toBe('unknown');
      expect(config.enabled).toBe(true);
      expect(config.async).toBe(true);
    });
  });

  describe('track()', () => {
    it('should execute function and track result', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
        content: 'test response',
      });

      const result = await sentinel.track(mockFn, {
        model: 'claude-sonnet-4',
      }) as any;

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(result.content).toBe('test response');
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('should not track when disabled', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        enabled: false,
      });

      const mockFn = jest.fn().mockResolvedValue('result');
      const result = await sentinel.track(mockFn, { model: 'test-model' });

      expect(result).toBe('result');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should track failures', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(
        sentinel.track(mockFn, { model: 'test-model' })
      ).rejects.toThrow('Test error');

      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it('should extract Anthropic tokens', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await sentinel.track(mockFn, { model: 'claude-sonnet-4' });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.input_tokens).toBe(10);
      expect(callBody.output_tokens).toBe(5);
    });

    it('should extract OpenAI tokens', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await sentinel.track(mockFn, { model: 'gpt-4', provider: 'openai' });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.input_tokens).toBe(10);
      expect(callBody.output_tokens).toBe(5);
    });

    it('should include metadata', async () => {
      const sentinel = new Sentinel({
        apiKey: 'sk_test_123',
        endpoint: 'https://test.com',
        async: false,
      });

      const mockFn = jest.fn().mockResolvedValue({});

      await sentinel.track(mockFn, {
        model: 'test-model',
        metadata: { user_id: 'user_123' },
        tier: 'testing',
      });

      const callBody = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body
      );
      expect(callBody.metadata.user_id).toBe('user_123');
      expect(callBody.metadata.tier).toBe('testing');
      expect(callBody.metadata.sdk_version).toBe('0.1.0');
    });
  });
});
