import { calculateTrackAscentDescent } from './activity';
import type { TrackActivity, TrackPoint } from './activity';
import { createRegionalElevationSource } from './elevation-regional';
import { isCacheableElevationTileUrl, readCachedElevationTile, writeCachedElevationTile } from './elevation-tile-cache';

export type AltitudeCorrectionStatus = 'corrected' | 'partial' | 'skipped';
export type AltitudeCorrectionReason =
  | 'outside_coverage' | 'missing_coordinates' | 'missing_altitudes'
  | 'missing_time' | 'insufficient_reference' | 'network_unavailable'
  | 'request_budget_exhausted' | 'already_corrected' | 'cancelled';

export interface ElevationCoordinate { lat: number; lon: number }
export interface ElevationSample { elevationM: number; dataset: string }
export interface ElevationRequestContext {
  signal?: AbortSignal;
  fetchBytes(url: string): Promise<ArrayBuffer | undefined>;
}
export interface ElevationSource {
  readonly id: string;
  /** Optional coverage test; undefined means any valid Web-Mercator coordinate. */
  supportsCoordinate?(position: ElevationCoordinate): boolean;
  getGroupKey(position: ElevationCoordinate): string | undefined;
  getElevations(
    groupKey: string,
    positions: readonly ElevationCoordinate[],
    context: ElevationRequestContext,
  ): Promise<readonly (ElevationSample | undefined)[]>;
  /** Optional regional fallback for an entire unreliable/missing primary reference. */
  getFallbackElevations?(
    groupKey: string,
    positions: readonly ElevationCoordinate[],
    context: ElevationRequestContext,
  ): Promise<readonly (ElevationSample | undefined)[]>;
  /** Optional quality-upgrade attempts. Each attempt must use at most one tile URL. */
  canUpgradeAnchor?(groupKey: string, dataset: string): boolean;
  getHigherResolutionElevations?(
    groupKey: string,
    positions: readonly ElevationCoordinate[],
    level: number,
    context: ElevationRequestContext,
  ): Promise<readonly (ElevationSample | undefined)[]>;
}
export interface AltitudeCorrectionProgress {
  stage: 'selecting' | 'fetching' | 'estimating' | 'applying';
  completed: number;
  total: number;
  requestsMade: number;
}
export interface AltitudeCorrectionOptions {
  source?: ElevationSource;
  anchorCount?: number;
  maxTileRequests?: number;
  signal?: AbortSignal;
  onProgress?: (progress: AltitudeCorrectionProgress) => void;
}
export interface AltitudeCorrectionAnchorReport {
  segmentIndex: number;
  timeSeconds: number;
  cellKey: string;
  referencePoints: number;
  representedDistanceM: number;
  driftM: number;
  dispersionM: number;
  dataset: string;
}
export interface AltitudeCorrectionReport {
  sourceId: string;
  candidateRegions: number;
  anchorsUsed: number;
  tileRequests: number;
  uniqueTilesLoaded: number;
  tilesFromCache: number;
  pointsCorrected: number;
  pointsTotal: number;
  anchors: AltitudeCorrectionAnchorReport[];
  reason?: AltitudeCorrectionReason;
}
export interface AltitudeCorrectionResult {
  activity: TrackActivity;
  status: AltitudeCorrectionStatus;
  report: AltitudeCorrectionReport;
}

type IndexedPoint = { index: number; point: TrackPoint; time: number; lat: number; lon: number; alt: number };
type Segment = { index: number; points: IndexedPoint[]; start: number; end: number };
type Candidate = {
  segmentIndex: number; groupKey: string; points: IndexedPoint[];
  target: number; distanceM: number; firstTime: number; lastTime: number;
};
type Region = { segmentIndex: number; candidates: Candidate[] };
type Anchor = AltitudeCorrectionAnchorReport;

const BIN_M = 20;
const MIN_BINS = 8;
const MIN_DISTANCE_M = 200;
const MAX_MAD_M = 15;
const MAX_REGION_SPAN_S = 20 * 60;
const MAX_PLAUSIBLE_SPEED_MPS = 80;

function finite(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n); }
function validPosition(p: TrackPoint): p is TrackPoint & { lat: number; lon: number } {
  return finite(p.lat) && finite(p.lon) && Math.abs(p.lat) <= 85.05112878 && Math.abs(p.lon) <= 180;
}
function distanceM(a: ElevationCoordinate, b: ElevationCoordinate): number {
  const r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r;
  const dlon = (b.lon - a.lon) * r;
  const x = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(x)));
}
function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
function medianOf(values: number[]): number { return median([...values].sort((a, b) => a - b)); }

function collectSegments(points: TrackPoint[]): Segment[] {
  const segments: Segment[] = [];
  let current: IndexedPoint[] = [];
  let previousId: number | undefined;
  let previousTime: number | undefined;
  const flush = () => {
    if (!current.length) return;
    segments.push({ index: segments.length, points: current, start: current[0].time, end: current[current.length - 1].time });
    current = [];
  };
  points.forEach((point, index) => {
    if (!Object.keys(point).length) {
      flush(); previousId = undefined; previousTime = undefined; return;
    }
    const id = finite(point.segmentId) ? point.segmentId : undefined;
    if (current.length && (id !== previousId ||
      (finite(point.time) && finite(previousTime) && point.time < previousTime))) flush();
    previousId = id;
    if (finite(point.time)) previousTime = point.time;
    // Missing readings are not section breaks; they just cannot be reference samples.
    if (!validPosition(point) || !finite(point.time) || !finite(point.altitudeM)) return;
    current.push({ index, point, time: point.time, lat: point.lat, lon: point.lon, alt: point.altitudeM });
  });
  flush();
  return segments;
}

function allocateAnchors(segments: Segment[], requested: number): Map<number, number> {
  const eligible = segments.filter((s) => s.points.length > 1 && s.end > s.start);
  eligible.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.index - b.index);
  const allocated = new Map<number, number>();
  for (const segment of eligible.slice(0, requested)) allocated.set(segment.index, 1);
  for (let i = allocated.size; i < requested && allocated.size; i++) {
    const best = eligible.filter((s) => allocated.has(s.index)).sort((a, b) =>
      (b.end - b.start) / (allocated.get(b.index)! + 1) - (a.end - a.start) / (allocated.get(a.index)! + 1) || a.index - b.index)[0];
    allocated.set(best.index, allocated.get(best.index)! + 1);
  }
  return allocated;
}

function getCandidateDistance(points: IndexedPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    if (b.index !== a.index + 1 || b.time <= a.time) continue;
    const dist = distanceM(a, b);
    if (dist / (b.time - a.time) <= MAX_PLAUSIBLE_SPEED_MPS) total += dist;
  }
  return total;
}

function buildRegions(segments: Segment[], source: ElevationSource, count: number): Region[] {
  const allocation = allocateAnchors(segments, count);
  const regions: Region[] = [];
  for (const segment of segments) {
    const n = allocation.get(segment.index) || 0;
    for (let j = 0; j < n; j++) {
      const target = segment.start + (segment.end - segment.start) * (j + 0.5) / n;
      const windowHalfWidth = Math.min(MAX_REGION_SPAN_S / 2, (segment.end - segment.start) / (2 * n));
      const byTile = new Map<string, IndexedPoint[]>();
      for (const item of segment.points) {
        if (Math.abs(item.time - target) > windowHalfWidth || source.supportsCoordinate?.(item) === false) continue;
        const groupKey = source.getGroupKey(item);
        if (!groupKey) continue;
        const list = byTile.get(groupKey) || [];
        list.push(item);
        byTile.set(groupKey, list);
      }
      const candidates = [...byTile].map(([groupKey, points]): Candidate => ({
        segmentIndex: segment.index, groupKey, points,
        target, distanceM: getCandidateDistance(points),
        firstTime: points[0].time, lastTime: points[points.length - 1].time,
      })).filter((c) => c.distanceM >= MIN_DISTANCE_M && c.points.length >= MIN_BINS)
        .sort((a, b) => b.distanceM - a.distanceM ||
          Math.abs((a.firstTime + a.lastTime) / 2 - target) - Math.abs((b.firstTime + b.lastTime) / 2 - target) ||
          a.groupKey.localeCompare(b.groupKey));
      regions.push({ segmentIndex: segment.index, candidates });
    }
  }
  return regions;
}

function estimateAnchor(candidate: Candidate, samples: readonly (ElevationSample | undefined)[]): Anchor | undefined {
  if (samples.length !== candidate.points.length) return undefined;
  const bins = new Map<number, { differences: number[]; times: number[] }>();
  let accumulated = 0;
  let previous: IndexedPoint | undefined;
  let validDistance = 0;
  let validCount = 0;
  let previousValid: IndexedPoint | undefined;
  let dataset = '';
  for (let i = 0; i < candidate.points.length; i++) {
    const item = candidate.points[i];
    const distance = previous && previous.index + 1 === item.index && item.time > previous.time
      ? distanceM(previous, item) : 0;
    const plausible = previous && item.time > previous.time && distance / (item.time - previous.time) <= MAX_PLAUSIBLE_SPEED_MPS;
    if (plausible && distance > 0) accumulated += distance;
    else if (previous && previous.index + 1 !== item.index) accumulated += BIN_M;
    previous = item;
    const sample = samples[i];
    if (!sample || !finite(sample.elevationM)) continue;
    dataset = sample.dataset;
    if (previousValid && previousValid.index + 1 === item.index && item.time > previousValid.time) {
      const validStepM = distanceM(previousValid, item);
      if (validStepM / (item.time - previousValid.time) <= MAX_PLAUSIBLE_SPEED_MPS) {
        validDistance += validStepM;
      }
    }
    previousValid = item;
    validCount++;
    const binKey = Math.floor(accumulated / BIN_M);
    const bin = bins.get(binKey) || { differences: [], times: [] };
    bin.differences.push(sample.elevationM - item.alt);
    bin.times.push(item.time);
    bins.set(binKey, bin);
  }
  if (validCount < MIN_BINS || bins.size < MIN_BINS || validDistance < MIN_DISTANCE_M) return undefined;
  const binValues = [...bins.values()].map((b) => ({
    difference: medianOf(b.differences), time: medianOf(b.times),
  })).sort((a, b) => a.difference - b.difference);
  const trim = Math.floor(binValues.length * 0.1);
  const retained = binValues.slice(trim, binValues.length - trim);
  const center = retained.reduce((s, b) => s + b.difference, 0) / retained.length;
  const retainedMedian = medianOf(retained.map((b) => b.difference));
  const mad = medianOf(retained.map((b) => Math.abs(b.difference - retainedMedian)));
  if (!finite(center) || mad > MAX_MAD_M) return undefined;
  return {
    segmentIndex: candidate.segmentIndex, cellKey: candidate.groupKey,
    timeSeconds: medianOf(retained.map((b) => b.time)), referencePoints: validCount,
    representedDistanceM: validDistance, driftM: center,
    dispersionM: mad, dataset,
  };
}

function interpolate(anchors: Anchor[], time: number): number {
  if (time <= anchors[0].timeSeconds) return anchors[0].driftM;
  const last = anchors[anchors.length - 1];
  if (time >= last.timeSeconds) return last.driftM;
  for (let i = 1; i < anchors.length; i++) {
    const right = anchors[i]; const left = anchors[i - 1];
    if (time <= right.timeSeconds) {
      const span = right.timeSeconds - left.timeSeconds;
      return span > 0 ? left.driftM + (right.driftM - left.driftM) * (time - left.timeSeconds) / span : left.driftM;
    }
  }
  return last.driftM;
}

class TileRequestManager {
  // Deduplicate URLs within one conversion, including IndexedDB hits and misses.
  private readonly requested = new Map<string, Promise<ArrayBuffer | undefined>>();
  private readonly budgetBlocked = new Set<string>();
  private networkRequests = 0;
  private allowance: number;
  private readonly throttledHosts = new Set<string>();
  private networkFailure = false;
  get serviceUnavailable(): boolean { return this.throttledHosts.size > 0 || this.networkFailure; }
  private inFlight = 0;
  private readonly pending: (() => void)[] = [];
  readonly loaded = new Set<string>();
  readonly reused = new Set<string>();
  constructor(readonly max: number, readonly signal?: AbortSignal) {
    this.allowance = max;
  }
  /** Reserve network slots for remaining time regions; cache hits cost no slots. */
  setNetworkAllowance(allowance: number): void {
    this.allowance = Math.max(0, Math.min(this.max, allowance));
  }
  /** Number of actual HTTP fetch attempts (not URL lookups or cache hits). */
  get used(): number { return this.networkRequests; }
  fetchBytes(url: string): Promise<ArrayBuffer | undefined> {
    if (this.signal?.aborted || !/^https:\/\//.test(url)) return Promise.resolve(undefined);
    const task = this.requested.get(url);
    if (task) return task;
    const next = this.loadBytes(url).finally(() => {
      // A reserved network slot may become available in a later region.
      if (this.budgetBlocked.delete(url)) this.requested.delete(url);
    });
    this.requested.set(url, next);
    return next;
  }
  private async loadBytes(url: string): Promise<ArrayBuffer | undefined> {
    const cacheable = isCacheableElevationTileUrl(url);
    if (cacheable) {
      // Cache lookup precedes budget checks so a budget of zero can reuse tiles.
      const cached = await readCachedElevationTile(url);
      if (this.signal?.aborted) return undefined;
      if (cached) {
        this.reused.add(url);
        this.loaded.add(url);
        return cached;
      }
    }
    if (this.throttledHosts.has(new URL(url).origin) || this.signal?.aborted) return undefined;
    const bytes = await this.performFetch(url);
    if (bytes && cacheable && !this.signal?.aborted) {
      // Persistence is best effort; success must not depend on storage permission.
      await writeCachedElevationTile(url, bytes);
    }
    return bytes;
  }
  private async performFetch(url: string): Promise<ArrayBuffer | undefined> {
    if (this.inFlight >= 2) await new Promise<void>((resolve) => this.pending.push(resolve));
    if (this.throttledHosts.has(new URL(url).origin) || this.signal?.aborted || this.used >= this.allowance) {
      if (!this.throttledHosts.has(new URL(url).origin) && !this.signal?.aborted) this.budgetBlocked.add(url);
      this.releaseWaiter();
      return undefined;
    }
    this.networkRequests++;
    this.inFlight++;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    this.signal?.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
      });
      if (response.status === 429) { this.throttledHosts.add(new URL(url).origin); return undefined; }
      if (response.status >= 500) this.networkFailure = true;
      if (!response.ok) return undefined;
      const bytes = await response.arrayBuffer();
      this.loaded.add(url);
      return bytes;
    } catch { if (!this.signal?.aborted) this.networkFailure = true; return undefined; }
    finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener('abort', onAbort);
      this.inFlight--;
      this.releaseWaiter();
    }
  }
  private releaseWaiter() { this.pending.shift()?.(); }
}

export async function correctTrackActivityAltitudes(
  activity: TrackActivity, options: AltitudeCorrectionOptions = {},
): Promise<AltitudeCorrectionResult> {
  const requested = options.anchorCount ?? 5;
  const max = options.maxTileRequests ?? 12;
  if (!Number.isInteger(requested) || requested < 1 || requested > 50 || !Number.isInteger(max) || max < 0 || max > 1000) {
    throw new RangeError('Invalid altitude correction anchorCount or maxTileRequests.');
  }
  const source = options.source ?? createRegionalElevationSource();
  const manager = new TileRequestManager(max, options.signal);
  const report: AltitudeCorrectionReport = {
    sourceId: source.id, candidateRegions: 0, anchorsUsed: 0, tileRequests: 0,
    uniqueTilesLoaded: 0, tilesFromCache: 0, pointsCorrected: 0, pointsTotal: activity.points.length, anchors: [],
  };
  const finish = (status: AltitudeCorrectionStatus, reason?: AltitudeCorrectionReason, resultActivity = activity): AltitudeCorrectionResult => {
    report.tileRequests = manager.used;
    report.uniqueTilesLoaded = manager.loaded.size;
    report.tilesFromCache = manager.reused.size;
    report.reason = reason;
    report.anchorsUsed = report.anchors.length;
    return { activity: resultActivity, status, report };
  };
  if (activity.metadata.altitudeCorrection) return finish('skipped', 'already_corrected');
  if (options.signal?.aborted) return finish('skipped', 'cancelled');
  if (!activity.points.some(validPosition)) return finish('skipped', 'missing_coordinates');
  if (!activity.points.some((p) => validPosition(p) && source.supportsCoordinate?.(p) !== false && source.getGroupKey(p))) return finish('skipped', 'outside_coverage');
  if (!activity.points.some((p) => finite(p.altitudeM))) return finish('skipped', 'missing_altitudes');
  if (!activity.points.some((p) => finite(p.time))) return finish('skipped', 'missing_time');
  const segments = collectSegments(activity.points);
  const regions = buildRegions(segments, source, requested);
  report.candidateRegions = regions.length;
  const notify = (stage: AltitudeCorrectionProgress['stage'], completed: number, total: number) => {
    try { options.onProgress?.({ stage, completed, total, requestsMade: manager.used }); } catch { /* progress callbacks must not disrupt conversion */ }
  };
  notify('selecting', regions.length, regions.length);
  const anchorsByRegion = new Map<number, Anchor>();
  let regionDone = 0;
  // First give every region one primary tile. Reserve capacity for later regions,
  // and avoid consuming the whole HTTP budget on alternative candidates before
  // fallback sources get a chance (notably GSI -> Mapzen).
  for (let r = 0; r < regions.length; r++) {
    if (options.signal?.aborted) return finish('skipped', 'cancelled');
    const reserved = regions.slice(r + 1).filter((region) => region.candidates.length > 0).length;
    manager.setNetworkAllowance(max - reserved);
    const candidate = regions[r].candidates[0];
    if (candidate) {
      const coords = candidate.points.map(({ lat, lon }) => ({ lat, lon }));
      try {
        const samples = await source.getElevations(candidate.groupKey, coords, {
          signal: options.signal, fetchBytes: (url) => manager.fetchBytes(url),
        });
        const anchor = estimateAnchor(candidate, samples);
        if (anchor) anchorsByRegion.set(r, anchor);
      } catch { /* primary source is best effort */ }
    }
    regionDone++;
    notify('fetching', regionDone, regions.length);
  }
  // If GSI has no usable reference (missing tile, missing elevations, or an
  // unreliable reference), retry the same region with Mapzen before spending
  // remaining requests on alternate candidate tiles or DEM5 upgrades.
  if (source.getFallbackElevations) {
    for (let r = 0; r < regions.length; r++) {
      if (options.signal?.aborted) return finish('skipped', 'cancelled');
      if (anchorsByRegion.has(r)) continue;
      const candidate = regions[r].candidates[0];
      if (!candidate) continue;
      const remaining = regions.slice(r + 1).filter((region, index) =>
        !anchorsByRegion.has(r + 1 + index) && region.candidates.length > 0).length;
      manager.setNetworkAllowance(max - remaining);
      try {
        const samples = await source.getFallbackElevations(candidate.groupKey,
          candidate.points.map(({ lat, lon }) => ({ lat, lon })),
          { signal: options.signal, fetchBytes: (url) => manager.fetchBytes(url) });
        const anchor = estimateAnchor(candidate, samples);
        if (anchor) anchorsByRegion.set(r, anchor);
      } catch { /* do not block conversion for fallback failures */ }
    }
  }
  // A second candidate can rescue an otherwise unsupported area. This phase
  // starts only after each region had a fair chance with its preferred source.
  manager.setNetworkAllowance(max);
  for (let r = 0; r < regions.length; r++) {
    if (options.signal?.aborted) return finish('skipped', 'cancelled');
    if (anchorsByRegion.has(r)) continue;
    const candidate = regions[r].candidates[1];
    if (!candidate) continue;
    const coords = candidate.points.map(({ lat, lon }) => ({ lat, lon }));
    try {
      const samples = await source.getElevations(candidate.groupKey, coords, {
        signal: options.signal, fetchBytes: (url) => manager.fetchBytes(url),
      });
      let anchor = estimateAnchor(candidate, samples);
      if (!anchor && source.getFallbackElevations) {
        const fallback = await source.getFallbackElevations(candidate.groupKey, coords, {
          signal: options.signal, fetchBytes: (url) => manager.fetchBytes(url),
        });
        anchor = estimateAnchor(candidate, fallback);
      }
      if (anchor) anchorsByRegion.set(r, anchor);
    } catch { /* best effort */ }
  }
  // Optional source-specific quality upgrades (GSI DEM5A/B/C); Mapzen has one raster tier.
  manager.setNetworkAllowance(max);
  if (source.getHigherResolutionElevations) {
    for (let level = 0; level < 3; level++) {
      for (const [r, anchor] of [...anchorsByRegion]) {
        if (options.signal?.aborted) break;
        if (source.canUpgradeAnchor
          ? !source.canUpgradeAnchor(anchor.cellKey, anchor.dataset)
          : anchor.dataset !== 'DEM10B') continue;
        const candidate = regions[r].candidates.find((c) => c.groupKey === anchor.cellKey);
        if (!candidate) continue;
        try {
          const samples = await source.getHigherResolutionElevations(
            candidate.groupKey, candidate.points.map(({ lat, lon }) => ({ lat, lon })), level,
            { signal: options.signal, fetchBytes: (url) => manager.fetchBytes(url) },
          );
          const upgraded = estimateAnchor(candidate, samples);
          if (upgraded && (anchor.dataset === 'DEM10B' || anchor.dataset === 'Mapzen Terrarium'))
            anchorsByRegion.set(r, upgraded);
        } catch { /* best effort */ }
      }
    }
  }
  if (options.signal?.aborted) return finish('skipped', 'cancelled');
  report.anchors = [...anchorsByRegion.values()].sort((a, b) => a.segmentIndex - b.segmentIndex || a.timeSeconds - b.timeSeconds);
  notify('estimating', report.anchors.length, regions.length);
  if (report.anchors.length === 0) {
    const reason: AltitudeCorrectionReason = manager.serviceUnavailable
      ? 'network_unavailable'
      : manager.used >= max ? 'request_budget_exhausted' : 'insufficient_reference';
    return finish('skipped', reason);
  }
  const correctedPoints = activity.points.slice();
  let correctedSegments = 0;
  let skippedSegments = 0;
  let outsidePoints = 0;
  for (const segment of segments) {
    const anchors = report.anchors.filter((a) => a.segmentIndex === segment.index)
      .filter((a, i, arr) => i === 0 || a.timeSeconds > arr[i - 1].timeSeconds);
    if (!anchors.length || (anchors.length === 1 && segment.end - segment.start > 1800)) {
      skippedSegments++; continue;
    }
    correctedSegments++;
    for (const item of segment.points) {
      if (source.supportsCoordinate?.(item) === false) { outsidePoints++; continue; }
      const next = item.alt + interpolate(anchors, item.time);
      if (!finite(next)) continue;
      correctedPoints[item.index] = { ...item.point, altitudeM: next };
      report.pointsCorrected++;
    }
  }
  if (report.pointsCorrected === 0) return finish('skipped', 'insufficient_reference');
  const metadata = { ...activity.metadata };
  const elevation = calculateTrackAscentDescent(correctedPoints);
  if (elevation) { metadata.ascentM = elevation.ascentM; metadata.descentM = elevation.descentM; }
  else { delete metadata.ascentM; delete metadata.descentM; }
  const complete = correctedSegments === segments.length && skippedSegments === 0 && outsidePoints === 0 && report.anchors.length >= regions.length &&
    segments.every((s) => report.anchors.filter((a) => a.segmentIndex === s.index).length >= 2);
  const status: AltitudeCorrectionStatus = complete ? 'corrected' : 'partial';
  metadata.altitudeCorrection = { method: 'terrain-drift-v1', source: source.id, anchorsUsed: report.anchors.length, status };
  notify('applying', report.pointsCorrected, report.pointsTotal);
  return finish(status, undefined, { ...activity, metadata, points: correctedPoints });
}
