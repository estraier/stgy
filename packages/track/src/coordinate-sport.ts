/** Sport-specific movement constraints for format-independent GNSS quality checks. */
import type { TrackActivity, TrackPoint } from './activity';

export interface MotionProfile {
  id: string;
  softSpeedLimitKph: number;
  hardSpeedLimitKph: number;
  maxAccelerationMps2: number;
  maxBrakingMps2: number;
  maxLateralAccelerationMps2: number;
}
export interface SportInference {
  profile: MotionProfile;
  source: 'session' | 'sport_message' | 'metadata' | 'inferred' | 'generic';
  confidence: number;
  alternatives: { profileId: string; score: number }[];
  movingAverageKph: number | null;
  movingMedianKph: number | null;
  speedP95Kph: number | null;
  sustainedMaxKph: number | null;
  sampledSeconds: number;
}

const tuples: [string, number, number, number, number, number][] = [
  ['walking',9,18,3,5,4], ['hiking',9,20,3,5,4],
  ['running',25,45,5,8,7], ['cycling',50,100,4,8,6],
  ['mountain_biking',40,90,5,9,8], ['e_biking',60,120,5,8,6],
  ['skating',50,120,5,9,8], ['cross_country_skiing',40,100,6,10,8],
  ['alpine_skiing',90,220,8,12,12], ['snowboarding',75,170,8,12,12],
  ['swimming',9,22,3,5,4], ['paddling',30,75,4,7,6],
  ['sailing',65,150,4,7,6], ['horseback',55,100,6,9,8],
  ['motorcycle',150,300,10,15,12], ['driving',100,250,10,15,12],
  ['motorsport',220,420,15,20,18], ['flying',450,1100,20,25,15],
  ['human_generic',70,150,7,12,10], ['generic',100,300,10,15,12],
];
export const MOTION_PROFILES: Readonly<Record<string, MotionProfile>> = Object.freeze(
  Object.fromEntries(tuples.map(([id,soft,hard,accel,brake,lateral]) => [id, Object.freeze({
    id, softSpeedLimitKph: soft, hardSpeedLimitKph: hard,
    maxAccelerationMps2: accel, maxBrakingMps2: brake, maxLateralAccelerationMps2: lateral,
  })])) as Record<string, MotionProfile>);

export function normalizeSport(sport?: string, subSport?: string): string | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const sub = subSport ? norm(subSport) : '';
  const base = sport ? norm(sport) : '';
  const aliases: Record<string,string> = {
    '1':'running', '2':'cycling', '5':'swimming', '11':'walking', '17':'hiking',
    road_cycling:'cycling', indoor_cycling:'cycling', track_cycling:'cycling',
    mountain_biking:'mountain_biking', e_mountain_biking:'e_biking',
    e_biking:'e_biking', ebiking:'e_biking',
    trail_running:'running', treadmill:'running',
    mountaineering:'hiking', walking:'walking', hiking:'hiking',
    inline_skating:'skating', ice_skating:'skating',
    cross_country_skiing:'cross_country_skiing', nordic_skiing:'cross_country_skiing',
    alpine_skiing:'alpine_skiing', skiing:'alpine_skiing',
    snowboarding:'snowboarding', open_water_swimming:'swimming', swimming:'swimming',
    rowing:'paddling', kayaking:'paddling', paddling:'paddling', canoeing:'paddling',
    windsurfing:'sailing', sailing:'sailing', horseback_riding:'horseback',
    motorcycling:'motorcycle', motorcycle:'motorcycle', driving:'driving',
    motor_sports:'motorsport', motorsport:'motorsport', aviation:'flying', flying:'flying',
    cycling:'cycling', running:'running',
  };
  // Sub-sport refines the parent sport, but generic sub-sports such as 'generic' do not.
  if (sub && aliases[sub]) return aliases[sub];
  if (base && aliases[base]) return aliases[base];
  if (base && MOTION_PROFILES[base]) return base;
  return undefined;
}
const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const median = (nums: number[]) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a,b) => a-b);
  const middle = s.length >> 1;
  return s.length % 2 ? s[middle] : (s[middle-1]+s[middle])/2;
};
const quantile = (nums: number[], q: number) => nums.length
  ? [...nums].sort((a,b)=>a-b)[Math.floor((nums.length-1)*q)] : null;

function speedSamples(points: TrackPoint[], from: number, through: number) {
  const values: {speed: number; dt: number}[] = [];
  for (let i = from+1; i <= through; i++) {
    const a = points[i-1], b = points[i];
    const dt = number(a.time) && number(b.time) ? b.time-a.time : NaN;
    if (!(dt>0 && dt<=5) || a.segmentId !== b.segmentId) continue;
    // Recorded speed is preferred; derived distance is used only when unavailable.
    const recorded = number(a.speedMps) && number(b.speedMps) && a.speedMps>=0 && b.speedMps>=0
      ? (a.speedMps+b.speedMps)/2 : undefined;
    const derived = number(a.distanceM) && number(b.distanceM) && b.distanceM>=a.distanceM
      ? (b.distanceM-a.distanceM)/dt : undefined;
    const v = recorded ?? derived;
    if (!number(v) || v < 0 || v > 160) continue;
    values.push({speed: v*3.6, dt});
  }
  // Exclude isolated huge spikes with a time-neighborhood median, without letting
  // individual implausible GPS jumps choose the sport profile.
  return values.map((v,i) => ({...v, speed: median(values.slice(Math.max(0,i-2),i+3).map(x=>x.speed)) ?? v.speed}));
}

const candidateRanges: {id: string; avg:[number,number]; p95:[number,number]}[] = [
  {id:'walking',avg:[2,7],p95:[0,11]},
  {id:'running',avg:[7,18],p95:[12,32]},
  {id:'cycling',avg:[15,45],p95:[30,85]},
  {id:'alpine_skiing',avg:[20,65],p95:[50,125]},
  {id:'driving',avg:[50,250],p95:[100,330]},
];
function rangeScore(x: number, [low,high]: [number,number], full: number): number {
  if (x>=low && x<=high) return full;
  return Math.max(0, full - Math.min(Math.abs(x-low),Math.abs(x-high))*full/Math.max(5,high-low));
}
function chooseBroadProfile(candidates: {id:string;score:number}[]): MotionProfile {
  if (candidates.length < 2) return MOTION_PROFILES.generic;
  const a = MOTION_PROFILES[candidates[0].id], b = MOTION_PROFILES[candidates[1].id];
  if (!a || !b) return MOTION_PROFILES.generic;
  return {
    id:`ambiguous_${a.id}_${b.id}`,
    softSpeedLimitKph: Math.max(a.softSpeedLimitKph,b.softSpeedLimitKph),
    hardSpeedLimitKph: Math.max(a.hardSpeedLimitKph,b.hardSpeedLimitKph),
    maxAccelerationMps2: Math.max(a.maxAccelerationMps2,b.maxAccelerationMps2),
    maxBrakingMps2: Math.max(a.maxBrakingMps2,b.maxBrakingMps2),
    maxLateralAccelerationMps2: Math.max(a.maxLateralAccelerationMps2,b.maxLateralAccelerationMps2),
  };
}
export function inferSportProfile(activity: TrackActivity, from = 0, through = activity.points.length-1,
  explicit?: {sport?: string; subSport?: string; source?: SportInference['source']}): SportInference {
  const points = activity.points;
  const sampled = speedSamples(points,from,through);
  const moving = sampled.filter(x => x.speed>=2).map(x=>x.speed);
  const movingMedianKph = median(moving);
  const movingAverageKph = sampled.filter(x=>x.speed>=2).reduce((s,x)=>s+x.speed*x.dt,0)/
    (sampled.filter(x=>x.speed>=2).reduce((s,x)=>s+x.dt,0)||1);
  const p95 = quantile(moving,.95);
  const sustained = quantile(moving,.99);
  const sampledSeconds = sampled.reduce((s,x)=>s+x.dt,0);
  const base = { movingAverageKph: moving.length?movingAverageKph:null,
    movingMedianKph, speedP95Kph:p95, sustainedMaxKph:sustained, sampledSeconds };
  const sport = explicit?.sport ?? activity.metadata.sport;
  const subSport = explicit?.subSport ?? activity.metadata.subSport;
  const normalized = normalizeSport(sport,subSport);
  if (normalized) return { ...base, profile: MOTION_PROFILES[normalized],
    source: explicit?.source ?? 'metadata', confidence:1, alternatives:[] };
  const candidates = candidateRanges.map(c=>{
    let score = moving.length>=5 && p95!==null
      ? rangeScore(movingAverageKph,c.avg,25)+rangeScore(p95,c.p95,25) : 0;
    if (c.id==='cycling') {
      const cadence = points.slice(from,through+1).filter(p=>number(p.cadenceRpm) && p.cadenceRpm>30).length;
      const power = points.slice(from,through+1).filter(p=>number(p.powerW) && p.powerW>30).length;
      if (cadence > (through-from+1)*.2) score+=25;
      if (power > (through-from+1)*.15) score+=15;
      if (activity.metadata.recordingDevice?.productName?.match(/iGS|Edge|Wahoo|Bryton/i)) score+=8;
    }
    return {id:c.id,score:Math.min(100,score)};
  }).sort((a,b)=>b.score-a.score);
  const best=candidates[0],second=candidates[1];
  const strongEvidence = best?.score>=65 && best.score-(second?.score??0)>=20 && sampledSeconds>=30;
  const ambiguousEvidence = best?.score>=35 && sampledSeconds>=20;
  const confidence = strongEvidence ? .9 : ambiguousEvidence ? .7 : .4;
  const profile = strongEvidence ? MOTION_PROFILES[best.id] : ambiguousEvidence
    ? chooseBroadProfile(candidates) : (movingAverageKph<25 && p95!==null && p95<70
      ? MOTION_PROFILES.human_generic : MOTION_PROFILES.generic);
  return { ...base, profile, source: strongEvidence || ambiguousEvidence ? 'inferred':'generic',
    confidence, alternatives: candidates.slice(0,3).map(x=>({profileId:x.id,score:x.score})) };
}
