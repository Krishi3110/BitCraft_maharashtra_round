import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TelemetryCollector } from './telemetry/collector';
import { getMockApi } from './api/mock';

describe('TelemetryCollector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should buffer and flush events correctly', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const telemetry = new TelemetryCollector(1000);
    
    telemetry.start();
    telemetry.recordEvent('click');
    telemetry.recordEvent('scroll');
    
    // Should have 2 events in buffer (we can't directly check private buffer but we know it hasn't flushed yet)
    expect(consoleSpy).not.toHaveBeenCalled();
    
    // Fast-forward time
    vi.advanceTimersByTime(1100);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Telemetry Flush]',
      expect.arrayContaining([
        expect.objectContaining({ type: 'click' }),
        expect.objectContaining({ type: 'scroll' })
      ])
    );
    
    telemetry.stop();
    consoleSpy.mockRestore();
  });
});

describe('Mock API', () => {
  it('returns expected mock data', async () => {
    const api = getMockApi();
    const event = await api.getEventDetails();
    expect(event.id).toBe('ev_123');
    
    const join = await api.joinDrop();
    expect(join.status).toBe('waiting');
  });
});
