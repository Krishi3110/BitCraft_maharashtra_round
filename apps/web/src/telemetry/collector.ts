export class TelemetryCollector {
  private buffer: any[] = [];
  private windowMs: number;
  private interval: any;

  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
  }

  start() {
    this.interval = setInterval(() => this.flush(), this.windowMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  recordEvent(type: string, data: any = {}) {
    this.buffer.push({ type, timestamp: Date.now(), ...data });
  }

  private flush() {
    if (this.buffer.length === 0) return;
    console.log('[Telemetry Flush]', this.buffer);
    this.buffer = [];
  }
}

export const telemetry = new TelemetryCollector();
