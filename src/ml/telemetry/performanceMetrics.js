const MAX_SAMPLES = 18000;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

export class PerformanceMetrics {
  constructor() { this.reset(); }

  reset() {
    this.startedAt = performance.now();
    this.frames = [];
    this.frameCpu = [];
    this.lastFrameTimestamp = null;
    this.collector = [];
    this.uploaderMain = [];
    this.network = [];
    this.uploadedBytes = 0;
    this.requests = 0;
    this.heapStart = performance.memory?.usedJSHeapSize || null;
    this.heapPeak = this.heapStart;
    this.lastHeapSampleAt = this.startedAt;
  }

  add(bucket, value) {
    if (!Number.isFinite(value)) return;
    bucket.push(value);
    if (bucket.length > MAX_SAMPLES) bucket.shift();
  }

  // RAF interval measures delivered FPS; callback CPU time is a separate measurement.
  recordFrame(cpuMs, rafTimestamp) {
    this.add(this.frameCpu, cpuMs);
    if (Number.isFinite(rafTimestamp)) {
      if (this.lastFrameTimestamp !== null && rafTimestamp > this.lastFrameTimestamp) {
        this.add(this.frames, rafTimestamp - this.lastFrameTimestamp);
      }
      this.lastFrameTimestamp = rafTimestamp;
    }
    if (performance.now() - this.lastHeapSampleAt >= 1000) {
      const heap = performance.memory?.usedJSHeapSize;
      if (heap) this.heapPeak = Math.max(this.heapPeak || 0, heap);
      this.lastHeapSampleAt = performance.now();
    }
  }
  recordCollector(ms) { this.add(this.collector, ms); }
  recordUploadMain(ms, bytes) { this.add(this.uploaderMain, ms); this.uploadedBytes += bytes || 0; this.requests++; }
  recordNetwork(ms) { this.add(this.network, ms); }

  summarize(values) {
    const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { count: values.length, meanMs: mean, p50Ms: percentile(values, .50), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99) };
  }

  getStats() {
    const elapsedMinutes = Math.max((performance.now() - this.startedAt) / 60000, 1 / 60);
    const frame = this.summarize(this.frames);
    return {
      elapsedMinutes,
      averageFps: frame.meanMs > 0 ? 1000 / frame.meanMs : 0,
      frame,
      frameCpu: this.summarize(this.frameCpu),
      collector: this.summarize(this.collector),
      uploaderMainThread: this.summarize(this.uploaderMain),
      uploaderMainThreadScope: 'JSON serialization and UTF-8 byte counting only; use browser trace for total cost',
      networkAsyncLatency: this.summarize(this.network),
      requestsPerMinute: this.requests / elapsedMinutes,
      uploadedKBPerMinute: (this.uploadedBytes / 1024) / elapsedMinutes,
      rawBodyKBPerMinute: (this.uploadedBytes / 1024) / elapsedMinutes,
      wireKBPerMinute: null, // Requires browser network trace; not inferred from JSON size.
      averagePayloadBytes: this.requests ? this.uploadedBytes / this.requests : 0,
      heapStartBytes: this.heapStart,
      heapCurrentBytes: performance.memory?.usedJSHeapSize || null,
      heapPeakBytes: this.heapPeak
    };
  }
}

export const telemetryPerformance = new PerformanceMetrics();
