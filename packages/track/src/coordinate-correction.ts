/** Sport-aware, format-independent GNSS position repair for TrackActivity.
 * No external I/O. Detection and diagnostics never mutate the caller's data.
 */
import type { TrackActivity, TrackPoint } from './activity';
import { inferSportProfile } from './coordinate-sport';
import type { MotionProfile, SportInference } from './coordinate-sport';
import { inferWheelSensor } from './coordinate-motion';
import type { MotionReferenceTrust } from './coordinate-motion';
import { detectCoordinateMask } from './coordinate-detection';

export type CoordinateCorrectionStatus = 'corrected' | 'partial' | 'skipped';
export type CoordinateCorrectionReason =
  | 'missing_position' | 'frozen_position' | 'position_jump'
  | 'implausible_speed' | 'implausible_acceleration'
  | 'poor_gps_accuracy' | 'distance_mismatch' | 'unstable_exit';
export type CoordinateCorrectionSkipReason =
  | 'no_anomaly' | 'insufficient_points' | 'missing_time'
  | 'boundary_not_stable' | 'crosses_segment' | 'possible_stop'
  | 'route_not_linear' | 'gap_too_long' | 'distance_inconsistent'
  | 'low_confidence' | 'already_corrected';
export type CoordinateCorrectionMotionReliability =
  | 'independent_like' | 'position_correlated' | 'unknown' | 'missing';

export interface CoordinateCorrectionOptions {
  maxGapSeconds?: number;
  stableWindowSeconds?: number;
  stableWindowMinPoints?: number;
  maxPlausibleSpeedMps?: number;
  minConfidence?: number;
  logLevel?: 'off' | 'summary' | 'verbose';
  onDiagnostic?: (event: CoordinateCorrectionDiagnostic) => void;
  profileOverride?: Partial<MotionProfile>;
  sportOverride?: string;
  blackExpansionSeconds?: number;
  blackExpansionDistanceM?: number;
  mergeBlackGapSeconds?: number;
  anchorStableSeconds?: number;
  anchorStableMinPoints?: number;
  anchorSearchMaxSeconds?: number;
  anchorSearchMaxDistanceM?: number;
}
export type CoordinateMotionSourceInference =
  | 'wheel_or_doppler_like' | 'speed_only_motion'
  | 'position_correlated' | 'inconclusive';

/** Diagnostic evidence, not a determination of sensor hardware or GNSS accuracy. */
export interface CoordinateRegionDiagnostics {
  maxSampleGapSeconds: number | null;
  samplingIntervalMedianSeconds: number | null;
  chordDistanceM: number | null;
  recordedDistanceDeltaM: number | null;
  recordedSpeedMedianMps: number | null;
  recordedSpeedP90Mps: number | null;
  recordedSpeedMovingFraction: number | null;
  speedIntegratedDistanceM: number | null;
  speedIntegrationCoverage: number;
  speedVsDistanceRatio: number | null;
  gnssPathDistanceM: number | null;
  gnssMaxStepSpeedMps: number | null;
  headingErrorDegrees: number;
  frozenMaxDeviationM: number | null;
  frozenExactCoordinatesFraction: number | null;
  frozenDurationSeconds: number | null;
  frozenRecordedDistanceDeltaM: number | null;
  frozenRecordedDistanceNondecreasing: boolean | null;
  motionSourceInference: CoordinateMotionSourceInference;
  wheelSensorPlausible: boolean;
  motionSourceEvidence: string[];
}

export interface CoordinateCorrectionRegion {
  segmentId?: number;
  startIndex: number;
  endIndex: number;
  leftAnchorIndex?: number;
  rightAnchorIndex?: number;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  durationSeconds: number;
  reasons: CoordinateCorrectionReason[];
  confidence: number;
  action: 'corrected' | 'skipped';
  skipReason?: CoordinateCorrectionSkipReason;
  speedReliability: CoordinateCorrectionMotionReliability;
  distanceReliability: CoordinateCorrectionMotionReliability;
  speedAction: 'preserve' | 'none';
  distanceAction: 'preserve' | 'none';
  pointsCorrected: number;
  diagnostics: CoordinateRegionDiagnostics;
  hardReasons?: string[];
  softReasons?: string[];
  initialStartIndex?: number;
  initialEndIndex?: number;
  sportProfile?: string;
  anchorRejectReasons?: Record<string,number>;
  interpolationQuality?: number | null;
  qualityAssessment?: {anomalyEvidence:number;leftAnchorQuality:number;
    rightAnchorQuality:number;straightLineApproximation:number};
  coreDiagnostics?: CoordinateRegionDiagnostics;
  maxPositionAdjustmentM?: number;
}
export interface CoordinateCorrectionReport {
  inputPointCount: number;
  positionCount: number;
  gpsAccuracyCount: number;
  speedCount: number;
  distanceCount: number;
  regionsDetected: number;
  regionsCorrected: number;
  regionsSkipped: number;
  pointsCorrected: number;
  speedsCorrected: number;
  distancesCorrected: number;
  regions: CoordinateCorrectionRegion[];
}
export interface CoordinateCorrectionResult {
  activity: TrackActivity;
  status: CoordinateCorrectionStatus;
  report: CoordinateCorrectionReport;
}
export type CoordinateCorrectionDiagnostic = {
  schemaVersion: 1 | 2;
  type: 'input_profile' | 'candidate' | 'boundary' | 'region_decision' |
    'motion_decision' | 'metadata_update' | 'summary' |
    'sport_inference' | 'sensor_inference' | 'detection_summary' |
    'mask_summary' | 'white_bridgeheads' | 'anchor_search' | 'interpolation';
  data: Record<string,unknown>;
};

interface V2Config {
  logLevel: 'off' | 'summary' | 'verbose';
  blackExpansionSeconds:number;
  blackExpansionDistanceM:number;
  mergeBlackGapSeconds:number;
  anchorStableSeconds:number;
  anchorStableMinPoints:number;
  anchorSearchMaxSeconds:number;
  anchorSearchMaxDistanceM:number;
}
type Span = { start: number; end: number };
const R = 6371008.8;
const RAD = Math.PI / 180;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validPosition = (p: TrackPoint | undefined): p is TrackPoint & { lat: number; lon: number } =>
  Boolean(p) && finite(p!.lat) && Math.abs(p!.lat!) <= 90 && finite(p!.lon) && Math.abs(p!.lon!) <= 180;
const validTime = (p: TrackPoint | undefined): p is TrackPoint & { time: number } => Boolean(p) && finite(p!.time);
const validAccuracy = (p: TrackPoint | undefined) => Boolean(p) && finite(p!.gpsAccuracyM) && p!.gpsAccuracyM! >= 0;
const segmentId = (p: TrackPoint) => finite(p.segmentId) ? p.segmentId : undefined;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function distance(a: TrackPoint, b: TrackPoint): number {
  if (!validPosition(a) || !validPosition(b)) return NaN;
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function interpolate(a: TrackPoint, b: TrackPoint, ratio: number): { lat: number; lon: number } {
  // Spherical great-circle interpolation, including dateline crossings.
  if (!validPosition(a) || !validPosition(b)) throw new Error('Invalid interpolation endpoint');
  const phi1 = a.lat * RAD, phi2 = b.lat * RAD;
  const lambda1 = a.lon * RAD, lambda2 = b.lon * RAD;
  const d = distance(a, b) / R;
  if (d < 1e-12) return { lat: a.lat, lon: a.lon };
  const sinD = Math.sin(d);
  if (Math.abs(sinD) < 1e-12) return { lat: a.lat, lon: a.lon };
  const u = Math.sin((1 - ratio) * d) / sinD;
  const v = Math.sin(ratio * d) / sinD;
  const x = u * Math.cos(phi1) * Math.cos(lambda1) + v * Math.cos(phi2) * Math.cos(lambda2);
  const y = u * Math.cos(phi1) * Math.sin(lambda1) + v * Math.cos(phi2) * Math.sin(lambda2);
  const z = u * Math.sin(phi1) + v * Math.sin(phi2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / RAD,
    lon: ((Math.atan2(y, x) / RAD + 540) % 360) - 180 };
}
function splitSpans(points: TrackPoint[]): Span[] {
  const spans: Span[] = [];
  let begin = 0;
  for (let i = 1; i <= points.length; i++) {
    const prev = points[i - 1];
    const current = points[i];
    if (i < points.length && segmentId(prev) === segmentId(current) &&
      validTime(prev) && validTime(current) && current.time > prev.time &&
      !(finite(prev.distanceM) && finite(current.distanceM) &&
        current.distanceM < prev.distanceM - 2)) continue;
    if (i - begin >= 1) spans.push({ start: begin, end: i - 1 });
    begin = i;
  }
  return spans;
}
function median(nums: number[]): number | undefined {
  if (!nums.length) return undefined;
  const a = [...nums].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
}
/** Compute only diagnostic evidence; never feed these estimates back into repair decisions. */
function measureRegion(points: TrackPoint[], begin: number, end: number,
  left: number, right: number, chord: number, headingError: number,
  reasons: CoordinateCorrectionReason[], speedReliability: CoordinateCorrectionMotionReliability,
  distanceReliability: CoordinateCorrectionMotionReliability, span: Span): CoordinateRegionDiagnostics {
  const inside = points.slice(begin, end + 1);
  const speeds = inside.map(p => p.speedMps).filter(finite);
  const movingSpeeds = speeds.filter(n => n >= 1.5);
  const sortedSpeeds = [...speeds].sort((a, b) => a - b);
  const p90 = sortedSpeeds.length ? sortedSpeeds[Math.floor((sortedSpeeds.length - 1) * 0.9)] : null;
  const anchored = left >= span.start && right <= span.end;
  const before = Math.max(span.start, left), after = Math.min(span.end, right);
  const intervals: number[] = [];
  let gnssPath = 0, gnssSteps = 0, maxGnssSpeed = 0;
  let integratedSpeed = 0, integratedSeconds = 0;
  for (let k = before + 1; k <= after; k++) {
    const a = points[k - 1], b = points[k];
    if (!validTime(a) || !validTime(b) || segmentId(a) !== segmentId(b)) continue;
    const dt = b.time - a.time;
    if (dt <= 0) continue;
    intervals.push(dt);
    if (validPosition(a) && validPosition(b)) {
      const delta = distance(a, b);
      gnssPath += delta; gnssSteps++;
      maxGnssSpeed = Math.max(maxGnssSpeed, delta / dt);
    }
    if (finite(a.speedMps) && finite(b.speedMps) && a.speedMps >= 0 && b.speedMps >= 0) {
      integratedSpeed += (a.speedMps + b.speedMps) * dt / 2;
      integratedSeconds += dt;
    }
  }
  const elapsed = validTime(points[before]) && validTime(points[after])
    ? points[after].time - points[before].time : 0;
  const distanceDelta = anchored && finite(points[before]?.distanceM) && finite(points[after]?.distanceM)
    ? points[after].distanceM! - points[before].distanceM! : null;
  const internalDistance = finite(points[begin]?.distanceM) && finite(points[end]?.distanceM)
    ? points[end].distanceM! - points[begin].distanceM! : null;
  let internalMonotonic: boolean | null = internalDistance === null ? null : true;
  for (let k = begin + 1; k <= end; k++) {
    if (!finite(points[k - 1].distanceM) || !finite(points[k].distanceM)) {
      internalMonotonic = null;
      break;
    }
    if (points[k].distanceM! < points[k - 1].distanceM! - 0.5) internalMonotonic = false;
  }
  const positions = inside.filter(validPosition);
  let maxDeviation: number | null = null;
  if (positions.length === inside.length && positions.length) {
    maxDeviation = 0;
    for (const p of positions) maxDeviation = Math.max(maxDeviation, distance(positions[0], p));
  }
  // Only call it a continuous freeze if the whole candidate is spatially stationary.
  const freeze = reasons.includes('frozen_position') && maxDeviation !== null && maxDeviation < 2.5;
  const duration = validTime(points[begin]) && validTime(points[end])
    ? points[end].time - points[begin].time : null;
  const speedCoverage = elapsed > 0 ? Math.min(1, integratedSeconds / elapsed) : 0;
  const speedRatio = distanceDelta !== null && distanceDelta > 0 && speedCoverage >= 0.7
    ? integratedSpeed / distanceDelta : null;
  const speedContinues = freeze && speeds.length >= 2 &&
    movingSpeeds.length / speeds.length >= 0.6 && (median(speeds) ?? 0) >= 1.5;
  const distanceContinues = freeze && internalDistance !== null && internalDistance >= 8 &&
    internalMonotonic === true;
  const speedMatchesDistance = speedRatio !== null && speedRatio >= 0.65 && speedRatio <= 1.5;
  let motionSourceInference: CoordinateMotionSourceInference = 'inconclusive';
  if (speedContinues && distanceContinues && speedMatchesDistance) {
    // Cannot discriminate wheel revolutions from independent GNSS Doppler/fused motion.
    motionSourceInference = 'wheel_or_doppler_like';
  } else if (speedContinues) {
    motionSourceInference = 'speed_only_motion';
  } else if (speedReliability === 'position_correlated' && distanceReliability === 'position_correlated') {
    motionSourceInference = 'position_correlated';
  }
  const evidence: string[] = [];
  if (freeze) evidence.push('gnss_coordinates_frozen');
  if (speedContinues) evidence.push('recorded_speed_continues');
  if (distanceContinues) evidence.push('recorded_distance_increases');
  if (speedMatchesDistance) evidence.push('speed_integral_matches_distance');
  if (speedRatio === null) evidence.push('speed_distance_comparison_unavailable');
  if (internalMonotonic === false) evidence.push('recorded_distance_decreases');
  if (motionSourceInference === 'wheel_or_doppler_like') evidence.push('wheel_sensor_possible_not_proven');
  return {
    maxSampleGapSeconds: intervals.length ? intervals.reduce((a, b) => Math.max(a, b), 0) : null,
    samplingIntervalMedianSeconds: median(intervals) ?? null,
    chordDistanceM: finite(chord) ? chord : null,
    recordedDistanceDeltaM: distanceDelta,
    recordedSpeedMedianMps: median(speeds) ?? null,
    recordedSpeedP90Mps: p90,
    recordedSpeedMovingFraction: speeds.length ? movingSpeeds.length / speeds.length : null,
    speedIntegratedDistanceM: integratedSeconds ? integratedSpeed : null,
    speedIntegrationCoverage: speedCoverage,
    speedVsDistanceRatio: speedRatio,
    gnssPathDistanceM: gnssSteps ? gnssPath : null,
    gnssMaxStepSpeedMps: gnssSteps ? maxGnssSpeed : null,
    headingErrorDegrees: headingError,
    frozenMaxDeviationM: freeze ? maxDeviation : null,
    frozenExactCoordinatesFraction: freeze && positions.length
      ? positions.filter(p => p.lat === positions[0].lat && p.lon === positions[0].lon).length / positions.length
      : null,
    frozenDurationSeconds: freeze ? duration : null,
    frozenRecordedDistanceDeltaM: freeze ? internalDistance : null,
    frozenRecordedDistanceNondecreasing: freeze ? internalMonotonic : null,
    motionSourceInference,
    wheelSensorPlausible: motionSourceInference === 'wheel_or_doppler_like',
    motionSourceEvidence: evidence,
  };
}

function resolveOptions(options: CoordinateCorrectionOptions): V2Config {
  const o: V2Config = {
    logLevel: options.logLevel ?? 'off',
    blackExpansionSeconds: options.blackExpansionSeconds ?? 3,
    blackExpansionDistanceM: options.blackExpansionDistanceM ?? 15,
    mergeBlackGapSeconds: options.mergeBlackGapSeconds ?? 10,
    anchorStableSeconds: options.anchorStableSeconds ?? 8,
    anchorStableMinPoints: options.anchorStableMinPoints ?? 5,
    anchorSearchMaxSeconds: options.anchorSearchMaxSeconds ?? 300,
    anchorSearchMaxDistanceM: options.anchorSearchMaxDistanceM ?? 2000,
  };
  for(const k of ['blackExpansionSeconds','blackExpansionDistanceM','mergeBlackGapSeconds',
    'anchorStableSeconds','anchorSearchMaxSeconds','anchorSearchMaxDistanceM'] as const){
    if(!finite(o[k])||o[k]<0)throw new RangeError(`Invalid ${k}`);
  }
  if(!Number.isInteger(o.anchorStableMinPoints)||o.anchorStableMinPoints<2||o.anchorStableMinPoints>30)
    throw new RangeError('Invalid anchorStableMinPoints');
  if(!['off','summary','verbose'].includes(o.logLevel))throw new RangeError('Invalid logLevel');
  return o;
}
function profileForSpan(activity:TrackActivity, span:Span, options:CoordinateCorrectionOptions):SportInference {
  const sessions=activity.metadata.sportSessions ?? [];
  const t=activity.points[span.start].time;
  const entry=sessions.find(s=>finite(t)&&(!finite(s.startTime)||t>=s.startTime)&&
    (!finite(s.endTime)||t<s.endTime));
  const explicit=options.sportOverride ? {sport:options.sportOverride,source:'metadata' as const}
    : entry?{sport:entry.sport,subSport:entry.subSport,source:'session' as const}
    : activity.metadata.source?.type==='fit' && activity.metadata.sport
      ?{sport:activity.metadata.sport,subSport:activity.metadata.subSport,source:'sport_message' as const}
      :undefined;
  const inferred=inferSportProfile(activity,span.start,span.end,explicit);
  if(options.profileOverride){
    const p={...inferred.profile,...options.profileOverride};
    for(const k of ['softSpeedLimitKph','hardSpeedLimitKph','maxAccelerationMps2',
      'maxBrakingMps2','maxLateralAccelerationMps2'] as const){
      if(!finite(p[k])||p[k]<=0)throw new RangeError(`Invalid profileOverride.${k}`);
    }
    if(p.softSpeedLimitKph>p.hardSpeedLimitKph)throw new RangeError('Soft speed exceeds hard speed');
    inferred.profile=p;
  }
  return inferred;
}
function spanAcrossSportSessions(points:TrackPoint[], sessions:NonNullable<TrackActivity['metadata']['sportSessions']>):Span[]{
  const spans:Span[]=splitSpans(points);
  if(!sessions.length)return spans;
  const boundaries=sessions.map(s=>s.startTime).filter(finite);
  const output:Span[]=[];
  for(const s of spans){
    let start=s.start;
    for(let i=s.start+1;i<=s.end;i++){
      const a=points[i-1].time,b=points[i].time;
      if(finite(a)&&finite(b)&&boundaries.some(t=>a<t&&b>=t)){
        output.push({start,end:i-1});start=i;
      }
    }
    output.push({start,end:s.end});
  }
  return output;
}
function recordedDistance(points:TrackPoint[],a:number,b:number):number|null {
  const x=points[a]?.distanceM,y=points[b]?.distanceM;
  return finite(x)&&finite(y)&&y>=x?y-x:null;
}
function stableWindow(points:TrackPoint[],i:number,dir:-1|1,span:Span,mask:boolean[],
  bridgeheadMask:boolean[],soft:Set<string>[],profile:MotionProfile,trust:MotionReferenceTrust,c:V2Config):{ok:boolean;count:number;duration:number} {
  const anchor=points[i];
  if(!validPosition(anchor)||!validTime(anchor)||mask[i]||
    (validAccuracy(anchor)&&anchor.gpsAccuracyM!>30))return {ok:false,count:0,duration:0};
  let count=1,last=i,G=0,W=0,hasDistance=true;
  for(let j=i+dir;j>=span.start&&j<=span.end;j+=dir){
    const p=points[j],prev=points[last];
    if(!validPosition(p)||!validTime(p)||mask[j]||
      (validAccuracy(p)&&p.gpsAccuracyM!>30))break;
    const dt=Math.abs(p.time-prev.time!);
    if(!(dt>0&&dt<=3))break;
    const d=distance(p,prev);
    if(!finite(d)||d/dt*3.6>profile.hardSpeedLimitKph)break;
    // One isolated gray point may be usable; repeated soft violations are not stable.
    if(!bridgeheadMask[j] && (soft[j].size>=2 || (soft[j].size && soft[last].size)))break;
    G+=d;
    const travel=recordedDistance(points,Math.min(j,last),Math.max(j,last));
    if(travel===null)hasDistance=false;else W+=travel;
    last=j;count++;
    const elapsed=Math.abs(p.time-anchor.time);
    if(elapsed>=c.anchorStableSeconds)break;
  }
  const elapsed=Math.abs(points[last].time!-anchor.time);
  // A short but genuinely continuous white run at a track boundary is useful;
  // do not bridge logging holes to satisfy the duration requirement.
  const availableTime = dir===1 ? points[span.end].time! - anchor.time
    : anchor.time - points[span.start].time!;
  const requiredSeconds=Math.min(c.anchorStableSeconds,Math.max(4,availableTime));
  const ok=count>=c.anchorStableMinPoints && elapsed>=requiredSeconds &&
    (trust==='low'||!hasDistance||Math.abs(G-W)<=Math.max(5,.4*W));
  return {ok,count,duration:elapsed};
}
function anchorCandidates(points:TrackPoint[],span:Span,mask:boolean[],bridgeheadMask:boolean[],soft:Set<string>[],
  initial:number,dir:-1|1,profile:MotionProfile,trust:MotionReferenceTrust,c:V2Config):number[]{
  const indices:number[]=[];
  const begin=points[initial-dir]; // the nearest black point, to limit outward search
  const baseline=finite(begin?.time)?begin.time:points[initial]?.time;
  const baselineDistance=begin?.distanceM;
  for(let j=initial;j>=span.start&&j<=span.end;j+=dir){
    const p=points[j];if(!validTime(p))continue;
    if(finite(baseline)&&Math.abs(p.time-baseline)>c.anchorSearchMaxSeconds)break;
    if(finite(baselineDistance)&&finite(p.distanceM) &&
      Math.abs(p.distanceM-baselineDistance)>c.anchorSearchMaxDistanceM)break;
    const window=stableWindow(points,j,dir,span,mask,bridgeheadMask,soft,profile,trust,c);
    if(window.ok){indices.push(j);if(indices.length>=300)break;}
  }
  return indices;
}
function bearingDegrees(a:TrackPoint,b:TrackPoint):number|null {
  if(!validPosition(a)||!validPosition(b)||distance(a,b)<3)return null;
  const phi1=a.lat*RAD,phi2=b.lat*RAD,lambda=(b.lon-a.lon)*RAD;
  const y=Math.sin(lambda)*Math.cos(phi2);
  const x=Math.cos(phi1)*Math.sin(phi2)-Math.sin(phi1)*Math.cos(phi2)*Math.cos(lambda);
  return Math.atan2(y,x)*180/Math.PI;
}
function headingError(points:TrackPoint[],a:number,b:number):number {
  const line=bearingDegrees(points[a],points[b]);
  if(line===null)return 0;
  const candidate=[a>=4?bearingDegrees(points[a-4],points[a]):null,
    b+4<points.length?bearingDegrees(points[b],points[b+4]):null].filter(finite);
  const angles=candidate.map(x=>Math.abs((x-line+540)%360-180));
  return angles.length?Math.max(...angles):0;
}
function estimateQuality(points:TrackPoint[],a:number,b:number):number {
  const straight=distance(points[a],points[b]);
  const W=recordedDistance(points,a,b);
  if(W===null||W<=0)return 1;
  return clamp(straight/W,0,1);
}
function shortRegionStats(points:TrackPoint[],start:number,end:number){
  let path=0,maxGap=0;
  for(let i=start+1;i<=end;i++){
    const d=distance(points[i-1],points[i]);if(finite(d))path+=d;
    const dt=finite(points[i].time)&&finite(points[i-1].time)?points[i].time!-points[i-1].time!:0;
    maxGap=Math.max(maxGap,dt);
  }
  return {gnssPathM:path,recordedDistanceM:recordedDistance(points,start,end),maxSampleGapSeconds:maxGap};
}

/** Fingerprint included in diagnostics to detect stale compiled stgy-track/dist. */
export const COORDINATE_CORRECTION_ALGORITHM_REVISION = 'bridgehead-corridor-real-fit-20261111';

/** v2: score movement evidence, classify hard/soft GNSS anomalies, then anchor black spans. */
export function correctTrackActivityCoordinates(
  activity:TrackActivity,options:CoordinateCorrectionOptions={},
):CoordinateCorrectionResult {
  const c=resolveOptions(options);
  const original=activity.points;
  const spans=spanAcrossSportSessions(original,activity.metadata.sportSessions??[]);
  const report:CoordinateCorrectionReport={
    inputPointCount:original.length,positionCount:original.filter(validPosition).length,
    gpsAccuracyCount:original.filter(validAccuracy).length,
    speedCount:original.filter(p=>finite(p.speedMps)).length,
    distanceCount:original.filter(p=>finite(p.distanceM)).length,
    regionsDetected:0,regionsCorrected:0,regionsSkipped:0,
    pointsCorrected:0,speedsCorrected:0,distancesCorrected:0,regions:[],
  };
  const emit=(type:CoordinateCorrectionDiagnostic['type'],data:Record<string,unknown>,verbose=false)=>{
    if(!options.onDiagnostic||c.logLevel==='off'||(verbose&&c.logLevel!=='verbose'))return;
    try{options.onDiagnostic({type,data,schemaVersion:2} as CoordinateCorrectionDiagnostic);}
    catch{/* A broken diagnostics handler must not interrupt conversion. */}
  };
  const startTime=original.find(validTime)?.time??0;
  let distanceResets=0,nonIncreasingTimePairs=0,geoSpeedOutliers=0;
  const intervals:number[]=[];
  for(let i=1;i<original.length;i++){
    const a=original[i-1],b=original[i];
    if(!validTime(a)||!validTime(b))continue;
    const dt=b.time-a.time;
    if(dt<=0){nonIncreasingTimePairs++;continue;}
    if(segmentId(a)!==segmentId(b))continue;
    intervals.push(dt);
    if(finite(a.distanceM)&&finite(b.distanceM)&&b.distanceM<a.distanceM-2)distanceResets++;
    if(validPosition(a)&&validPosition(b)&&distance(a,b)/dt>30)geoSpeedOutliers++;
  }
  const quantile=(a:number[],p:number):number|null=>{
    if(!a.length)return null;
    const sorted=[...a].sort((x,y)=>x-y);
    return sorted[Math.floor((sorted.length-1)*p)];
  };
  emit('input_profile',{
    sourceFormat:activity.metadata.source?.type??null,
    deviceLabel:activity.metadata.recordingDevice?.productName??activity.metadata.recordingDevice?.product??null,
    points:original.length,segments:spans.length,
    durationSeconds:original.length&&validTime(original[original.length-1])
      ?original[original.length-1].time!-startTime:null,
    withPosition:report.positionCount,missingPosition:original.length-report.positionCount,
    withGpsAccuracy:report.gpsAccuracyCount,
    gpsAccuracyP50M:quantile(original.filter(validAccuracy).map(x=>x.gpsAccuracyM!),.5),
    gpsAccuracyP95M:quantile(original.filter(validAccuracy).map(x=>x.gpsAccuracyM!),.95),
    withRecordedSpeed:report.speedCount,withRecordedDistance:report.distanceCount,
    samplingIntervalP50S:quantile(intervals,.5),samplingIntervalP95S:quantile(intervals,.95),
    nonIncreasingTimePairs,distanceResets,geoSpeedOutliers,
  });
  if(activity.metadata.coordinateCorrection){
    emit('summary',{status:'skipped',reason:'already_corrected',...report});
    return {activity,status:'skipped',report};
  }
  const wheel=inferWheelSensor(activity);
  emit('sensor_inference',{...wheel});
  const sportInferences=spans.map(s=>profileForSpan(activity,s,options));
  for(let s=0;s<spans.length;s++){
    const infer=sportInferences[s],span=spans[s];
    emit('sport_inference',{spanIndex:s,spanStart:span.start,spanEnd:span.end,
      sportTag:activity.metadata.sport??null,subSportTag:activity.metadata.subSport??null,
      profileId:infer.profile.id,source:infer.source,confidence:infer.confidence,
      alternatives:infer.alternatives,movingAverageKph:infer.movingAverageKph,
      movingMedianKph:infer.movingMedianKph,speedP95Kph:infer.speedP95Kph,
      sustainedMaxKph:infer.sustainedMaxKph,thresholds:infer.profile});
  }
  if(!original.length||!spans.length){emit('summary',{status:'skipped',reason:'insufficient_points',...report});
    return {activity,status:'skipped',report};}
  const profileOf=(i:number):MotionProfile=>{
    for(let s=0;s<spans.length;s++)if(spans[s].start<=i&&i<=spans[s].end)return sportInferences[s].profile;
    return sportInferences[0].profile;
  };
  const detection=detectCoordinateMask(original,spans,profileOf,wheel.referenceTrust,c);
  emit('detection_summary',{counts:detection.counts,referenceTrust:wheel.referenceTrust,
    sportProfiles:sportInferences.map(x=>x.profile.id)});
  emit('mask_summary',{algorithmRevision:COORDINATE_CORRECTION_ALGORITHM_REVISION,...detection.summary});
  // A summary-level bridgehead audit is essential to distinguish broad
  // erroneous GNSS corridors from actually protected road intervals.
  emit('white_bridgeheads',{count:detection.protectedWhiteRegions.length,
    protectedPoints:detection.summary.protectedWhitePoints,
    longestDurationSeconds:detection.protectedWhiteRegions.reduce((m,r)=>Math.max(m,r.durationSeconds),0),
    regions:detection.protectedWhiteRegions.slice(0,30),
    omitted:Math.max(0,detection.protectedWhiteRegions.length-30),
    confirmedOffsetPairs:detection.verifiedOffsetCorridors.slice(0,30),
    omittedOffsetPairs:Math.max(0,detection.verifiedOffsetCorridors.length-30)});
  const points=original.map(p=>({...p,metrics:p.metrics?{...p.metrics}:undefined}));
  for(const candidate of detection.regions){
    const span=spans.find(s=>s.start<=candidate.start&&candidate.end<=s.end);
    if(!span)continue;
    const begin=candidate.start,end=candidate.end;
    const sport=profileOf(begin);
    const leftCandidates=anchorCandidates(original,span,detection.mask,detection.protectedWhiteMask,detection.softReasons,
      begin-1,-1,sport,wheel.referenceTrust,c);
    const rightCandidates=anchorCandidates(original,span,detection.mask,detection.protectedWhiteMask,detection.softReasons,
      end+1,1,sport,wheel.referenceTrust,c);
    const rejects:Record<string,number>={};
    let left=-1,right=-1,chord=NaN,travel:number|null=null;
    // Nearest stable left anchor first; then test increasingly distant right anchors.
    // A far-away incorrect GNSS 'recovery' is not a valid endpoint if the recorded
    // distance cannot reach it.
    outer:for(const a of leftCandidates.slice(0,60)){
      for(const b of rightCandidates.slice(0,300)){
        const C=distance(original[a],original[b]);
        const W=recordedDistance(original,a,b);
        const duration=original[b].time!-original[a].time!;
        const distanceReachable=W===null||wheel.referenceTrust==='low'||
          C<=W+Math.max(wheel.referenceTrust==='high'?10:50,
            W*(wheel.referenceTrust==='high'?.1:.6));
        const valid=finite(C)&&duration>0&& C/duration*3.6<=sport.hardSpeedLimitKph &&
          distanceReachable;
        if(!valid){
          const reason=!distanceReachable
            ?'unreachable_chord':'impossible_anchor_speed';
          rejects[reason]=(rejects[reason]??0)+1;
          continue;
        }
        left=a;right=b;chord=C;travel=W;break outer;
      }
    }
    const skip:CoordinateCorrectionSkipReason|undefined=left<0||right<0?'boundary_not_stable':undefined;
    const leftIndex=left>=0?left:leftCandidates[0]??-1;
    const rightIndex=right>=0?right:rightCandidates[0]??-1;
    const duration=leftIndex>=0&&rightIndex>=0?original[rightIndex].time!-original[leftIndex].time!:0;
    const rReasons=[...new Set(candidate.reasons)];
    const legacyReasons:CoordinateCorrectionReason[]=rReasons.map(r=>{
      if(r.includes('missing'))return 'missing_position';
      if(r.includes('frozen')||r.includes('short_step')||r.includes('stationarity'))return 'frozen_position';
      if(r.includes('speed'))return 'implausible_speed';
      if(r.includes('acceleration')||r.includes('direction'))return 'implausible_acceleration';
      if(r.includes('gps_accuracy'))return 'poor_gps_accuracy';
      return 'distance_mismatch';
    });
    const reasons=[...new Set(legacyReasons)];
    const angle=leftIndex>=0&&rightIndex>=0?headingError(original,leftIndex,rightIndex):0;
    const speedReliability:CoordinateCorrectionMotionReliability=report.speedCount?'independent_like':'missing';
    const distanceReliability:CoordinateCorrectionMotionReliability=report.distanceCount?'independent_like':'missing';
    const diagnostics=measureRegion(original,begin,end,leftIndex,rightIndex,chord,angle,
      reasons,speedReliability,distanceReliability,span);
    const coreDiagnostics=measureRegion(original,candidate.initialStart,candidate.initialEnd,
      leftIndex,rightIndex,chord,angle,reasons,speedReliability,distanceReliability,span);
    const straightLineQuality=skip?0:estimateQuality(original,left,right);
    const anomalyEvidence=candidate.reasons.some(r=>r.startsWith('H'))?1:.75;
    const qualityAssessment={anomalyEvidence,
      leftAnchorQuality:left>=0?1:0,rightAnchorQuality:right>=0?1:0,
      straightLineApproximation:straightLineQuality};
    const region:CoordinateCorrectionRegion={
      segmentId:segmentId(original[begin]),startIndex:begin,endIndex:end,
      ...(leftIndex>=0?{leftAnchorIndex:leftIndex}:{}),
      ...(rightIndex>=0?{rightAnchorIndex:rightIndex}:{}),
      startOffsetSeconds:validTime(original[begin])?original[begin].time-startTime:0,
      endOffsetSeconds:validTime(original[end])?original[end].time-startTime:0,
      durationSeconds:duration,reasons,
      confidence:skip?0:(.5*anomalyEvidence+.5),
      action:skip?'skipped':'corrected',...(skip?{skipReason:skip}:{}),
      speedReliability,distanceReliability,
      speedAction:report.speedCount?'preserve':'none',
      distanceAction:report.distanceCount?'preserve':'none',pointsCorrected:0,diagnostics,
      hardReasons:rReasons.filter(r=>r.startsWith('H')),
      softReasons:rReasons.filter(r=>r.startsWith('S')),
      initialStartIndex:candidate.initialStart,initialEndIndex:candidate.initialEnd,
      sportProfile:sport.id,anchorRejectReasons:rejects,
      interpolationQuality:skip?null:straightLineQuality,
      qualityAssessment,coreDiagnostics,
    };
    const regionId=report.regions.length+1;
    const extra=shortRegionStats(original,begin,end);
    emit('anchor_search',{regionId,spanIndex:spans.indexOf(span),
      initialRange:[candidate.initialStart,candidate.initialEnd],
      expandedRange:[begin,end],leftCandidateCount:leftCandidates.length,
      rightCandidateCount:rightCandidates.length,leftAnchorIndex:leftIndex,rightAnchorIndex:rightIndex,
      leftAnchorProtected:leftIndex>=0&&detection.protectedWhiteMask[leftIndex],
      rightAnchorProtected:rightIndex>=0&&detection.protectedWhiteMask[rightIndex],
      rejectionCounts:rejects,chordDistanceM:finite(chord)?chord:null,
      recordedDistanceM:travel,referenceTrust:wheel.referenceTrust},true);
    if(!skip){
      const tA=original[left].time!,tB=original[right].time!;
      let maximumAdjustment=0;
      for(let k=begin;k<=end;k++){
        if(!validTime(original[k]))continue;
        const projected=interpolate(original[left],original[right],clamp((original[k].time!-tA)/(tB-tA),0,1));
        const difference=distance(original[k],{...original[k],...projected});
        if(finite(difference))maximumAdjustment=Math.max(maximumAdjustment,difference);
        points[k].lat=projected.lat;points[k].lon=projected.lon;
        region.pointsCorrected++;
      }
      region.maxPositionAdjustmentM=maximumAdjustment;
      report.pointsCorrected+=region.pointsCorrected;
      report.regionsCorrected++;
      emit('interpolation',{regionId,method:'time',pointsCorrected:region.pointsCorrected,
        shortcutRatio:region.interpolationQuality,
        maxPositionAdjustmentM:region.maxPositionAdjustmentM,
        leftAnchorIndex:left,rightAnchorIndex:right},true);
    } else report.regionsSkipped++;
    report.regions.push(region);
    emit('region_decision',{regionId,...region,maskExpanded:true,
      motionReferenceTrust:wheel.referenceTrust,recordedDistanceM:extra.recordedDistanceM,
      originalGnssPathM:extra.gnssPathM,maxSampleGapSeconds:extra.maxSampleGapSeconds});
    emit('motion_decision',{regionId,
      speed:{reliability:speedReliability,action:region.speedAction},
      distance:{reliability:distanceReliability,action:region.distanceAction},
      motionSourceInference:diagnostics.motionSourceInference,
      wheelInference:wheel.wheelInference,referenceTrust:wheel.referenceTrust,
      reason:'v2_preserves_recorded_motion'});
  }
  report.regionsDetected=report.regions.length;
  const status:CoordinateCorrectionStatus=report.regionsCorrected===0?'skipped'
    :report.regionsSkipped?'partial':'corrected';
  const metadata=report.regionsCorrected?{...activity.metadata,coordinateCorrection:{
    method:'linear-dead-reckoning-v2' as const,
    regionsCorrected:report.regionsCorrected,pointsCorrected:report.pointsCorrected,
    speedsCorrected:0,distancesCorrected:0,
  }}:activity.metadata;
  if(report.regionsCorrected)emit('metadata_update',{updated:['coordinateCorrection'],
    unchanged:['totalDistanceM','netMovingTime','netMovingDistanceM','ascentM','descentM',
      'statistics','histograms']},true);
  emit('summary',{status,...report,regions:undefined,
    algorithmRevision:COORDINATE_CORRECTION_ALGORITHM_REVISION,referenceTrust:wheel.referenceTrust,
    wheelInference:wheel.wheelInference,sportProfiles:sportInferences.map(s=>s.profile.id),
    detectedConditions:detection.counts,mask:detection.summary,
    skippedReasons:report.regions.reduce<Record<string,number>>((a,r)=>{
      if(r.skipReason)a[r.skipReason]=(a[r.skipReason]??0)+1;return a;
    },{})});
  return {activity:report.regionsCorrected?{...activity,points,metadata}:activity,status,report};
}
