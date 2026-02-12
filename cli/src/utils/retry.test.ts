import { withRetry, getErrorMessage } from './retry';

describe('withRetry', () => {
  it('should return the result on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withRetry(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and return on eventual success', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw the last error after exhausting all attempts', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockRejectedValueOnce(new Error('fail-3'));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow('fail-3');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should call onRetry callback with attempt number and error', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('oops'))
      .mockResolvedValue('ok');

    await withRetry(fn, {
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    expect(onRetry.mock.calls[0][1].message).toBe('oops');
  });

  it('should not call onRetry on the final failed attempt', async () => {
    const onRetry = jest.fn();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'));

    await expect(
      withRetry(fn, { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 5, onRetry })
    ).rejects.toThrow('fail-2');

    // Only called once (after attempt 1, not after final attempt 2)
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.objectContaining({ message: 'fail-1' }));
  });

  it('should wrap non-Error throws into Error objects', async () => {
    const fn = jest.fn().mockRejectedValue('string error');

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow('string error');
  });

  it('should cap delay at maxDelayMs', async () => {
    const start = Date.now();
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    // baseDelayMs=10000 would be huge, but maxDelayMs=10 caps it
    const result = await withRetry(fn, { maxAttempts: 2, baseDelayMs: 10000, maxDelayMs: 10 });
    const elapsed = Date.now() - start;

    expect(result).toBe('ok');
    // With max 10ms + 25% jitter → max ~12.5ms. Should be well under 100ms.
    expect(elapsed).toBeLessThan(100);
  });

  it('should use default options when none provided', async () => {
    // Override just to keep the test fast
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { baseDelayMs: 1, maxDelayMs: 5 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should attempt exactly maxAttempts times', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 })
    ).rejects.toThrow('fail');

    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('should apply exponential backoff between retries', async () => {
    const delays: number[] = [];
    let lastCall = Date.now();

    const fn = jest.fn().mockImplementation(() => {
      const now = Date.now();
      delays.push(now - lastCall);
      lastCall = now;
      return Promise.reject(new Error('fail'));
    });

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 20, maxDelayMs: 1000 })
    ).rejects.toThrow('fail');

    // Second delay should be roughly 2x the first (exponential backoff)
    // Allow generous tolerance for jitter (±25%) and timer imprecision
    expect(delays.length).toBe(3);
    // delays[0] is negligible (first call, no delay)
    // delays[1] should be ~20ms * (0.75–1.25) = 15–25ms
    // delays[2] should be ~40ms * (0.75–1.25) = 30–50ms
    expect(delays[1]).toBeGreaterThan(5);
    expect(delays[2]).toBeGreaterThan(delays[1] * 0.5);
  });
});

describe('getErrorMessage', () => {
  it('should return message from Error instances', () => {
    expect(getErrorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('should return message from Error subclasses', () => {
    expect(getErrorMessage(new TypeError('bad type'))).toBe('bad type');
    expect(getErrorMessage(new RangeError('out of range'))).toBe('out of range');
  });

  it('should stringify non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
    expect(getErrorMessage(true)).toBe('true');
  });

  it('should stringify objects', () => {
    expect(getErrorMessage({ code: 'ENOENT' })).toBe('[object Object]');
  });
});
