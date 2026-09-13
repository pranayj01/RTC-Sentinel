import { withRetry } from './reliability.js';

describe('withRetry', () => {
  it('retries transient failures with bounded exponential delays', async () => {
    const operation = jest
      .fn<Promise<string>, [number]>()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);
    const onRetry = jest.fn();

    await expect(
      withRetry(operation, {
        attempts: 3,
        baseDelayMs: 25,
        maxDelayMs: 40,
        sleep,
        onRetry,
      }),
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[25], [40]]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('returns the last error after the configured attempt limit', async () => {
    const failure = new Error('still unavailable');
    const operation = jest.fn().mockRejectedValue(failure);

    await expect(
      withRetry(operation, {
        attempts: 2,
        baseDelayMs: 0,
        sleep: async () => undefined,
      }),
    ).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
