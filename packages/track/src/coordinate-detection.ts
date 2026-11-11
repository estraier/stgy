/** GNSS black/gray mask: physical contradictions, sustained weak anomalies, dilation. */
import type { TrackPoint } from './activity';
import type { MotionProfile } from './coordinate-sport';
import type { MotionReferenceTrust } from './coordinate-motion';

export interface CoordinateSpan {start:number;end:number}
export interface MaskRegion {start:number;end:number;initialStart:number;initialEnd:number;reasons:string[]}
/** A verified white run which GNSS anomaly propagation must not erase. */
export interface ProtectedWhiteRegion {start:number;end:number;durationSeconds:number;recordedDistanceM:number|null}
export interface VerifiedOffsetCorridor {entryIndex:number;exitIndex:number;durationSeconds:number;overriddenWhitePoints:number}
export interface MaskConfig {
  blackExpansionSeconds:number;
  blackExpansionDistanceM:number;
  mergeBlackGapSeconds:number;
}
export interface DetectionResult {
  mask: boolean[];
  protectedWhiteMask: boolean[];
  hardReasons: Set<string>[];
  softReasons: Set<string>[];
  regions: MaskRegion[];
  protectedWhiteRegions: ProtectedWhiteRegion[];
  verifiedOffsetCorridors: VerifiedOffsetCorridor[];
  counts:Record<string,number>;
  summary:{initialBlack:number;initialGray:number;promotedGray:number;expandedBlack:number;mergedAdditionalBlack:number;finalBlack:number;regionsBeforeMerge:number;regionsAfterMerge:number;protectedWhitePoints:number;protectedWhiteRegions:number;rejectedIsolatedJumpEdges:number;verifiedOffsetCorridors:number;overriddenBridgeheadPoints:number;longestBlackSpanPoints:number;longestBlackSpanSeconds:number};
}
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const rad=Math.PI/180;
export function pointDistance(a:TrackPoint,b:TrackPoint):number{
  if(!finite(a.lat)||!finite(a.lon)||!finite(b.lat)||!finite(b.lon) ||
    Math.abs(a.lat)>90||Math.abs(b.lat)>90||Math.abs(a.lon)>180||Math.abs(b.lon)>180) return NaN;
  const phi=(b.lat-a.lat)*rad,lambda=(b.lon-a.lon)*rad;
  const h=Math.sin(phi/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lambda/2)**2;
  return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(h)));
}
function velocity(a:TrackPoint,b:TrackPoint):{x:number;y:number}|null{
  if(!finite(a.time)||!finite(b.time)||b.time<=a.time || !finite(pointDistance(a,b)))return null;
  const dlon=(((b.lon!-a.lon!+540)%360)-180)*rad;
  return {x:dlon*6371008.8*Math.cos((a.lat!+b.lat!)*.5*rad)/(b.time-a.time),
    y:(b.lat!-a.lat!)*rad*6371008.8/(b.time-a.time)};
}
const speed=(v:{x:number;y:number})=>Math.hypot(v.x,v.y);

/** Opposite displacement vectors are meaningful only when they are genuine
 * entry/exit transitions. A one-point GNSS spike also has opposite edges,
 * but the interval between those two edges is already handled locally. */
function reversingJumps(points:TrackPoint[],entry:number,exit:number,
  minimumJumpM:number,maximumDurationS:number):boolean {
  if(entry<1||exit<=entry+2||exit>=points.length)return false;
  const start=points[entry-1],finish=points[exit];
  if(!finite(start.time)||!finite(finish.time)||
    finish.time-start.time>maximumDurationS)return false;
  const v1=velocity(points[entry-1],points[entry]);
  const v2=velocity(points[exit-1],points[exit]);
  if(!v1||!v2)return false;
  const dt1=points[entry].time!-start.time;
  const dt2=finish.time!-points[exit-1].time!;
  if(dt1>2||dt2>2)return false;
  const x1=v1.x*dt1,y1=v1.y*dt1,x2=v2.x*dt2,y2=v2.y*dt2;
  const a=Math.hypot(x1,y1),b=Math.hypot(x2,y2);
  const longPair=finish.time-start.time>180;
  // The longer the interval, the greater the danger that two unrelated
  // glitches will be paired across a real road. Demand a much stronger match.
  const threshold=longPair?Math.max(minimumJumpM,100):minimumJumpM;
  if(a<threshold||b<threshold ||
    Math.min(a,b)/Math.max(a,b)<(longPair?.85:.7))return false;
  if((x1*x2+y1*y2)/(a*b)>(longPair?-.95:-.88))return false;
  // Require the two position offsets to cancel, as on reacquisition.
  return Math.hypot(x1+x2,y1+y2)<=Math.max(longPair?10:12,
    (longPair?.15:.27)*Math.max(a,b));
}
/** Both edges of a one-sample spike must never be paired with jumps from
 * another time. Without this, unrelated glitches can blacken kilometres of
 * otherwise coherent road between them. */
function oneSampleSpike(points:TrackPoint[],i:number,minimumJumpM:number,
  trust:MotionReferenceTrust):boolean {
  if(i<1||i+1>=points.length)return false;
  const a=points[i-1],b=points[i],c=points[i+1];
  if(!finite(a.time)||!finite(b.time)||!finite(c.time)||
    b.time-a.time>2||c.time-b.time>2)return false;
  const u=velocity(a,b),v=velocity(b,c);
  if(!u||!v)return false;
  const dt1=b.time-a.time,dt2=c.time-b.time;
  const x1=u.x*dt1,y1=u.y*dt1,x2=v.x*dt2,y2=v.y*dt2;
  const d1=Math.hypot(x1,y1),d2=Math.hypot(x2,y2);
  if(d1<minimumJumpM||d2<minimumJumpM||Math.min(d1,d2)/Math.max(d1,d2)<.65 ||
    (x1*x2+y1*y2)/(d1*d2)>-.8)return false;
  return chordUpper(points,i-1,i+1,trust);
}

function chordUpper(points:TrackPoint[],a:number,b:number,trust:MotionReferenceTrust):boolean {
  if (trust!=='high')return true;
  const x=points[a],y=points[b];
  if(!finite(x.distanceM)||!finite(y.distanceM)||y.distanceM<x.distanceM)return true;
  return pointDistance(x,y)<=y.distanceM-x.distanceM+Math.max(10,.1*(y.distanceM-x.distanceM));
}
function edgeValues(points:TrackPoint[],i:number):{dt:number;G:number;W:number|null;vg:number}|null {
  const a=points[i-1],b=points[i];
  if(!finite(a.time)||!finite(b.time)||b.time<=a.time)return null;
  const dt=b.time-a.time,G=pointDistance(a,b);
  if(!finite(G))return null;
  const W=finite(a.distanceM)&&finite(b.distanceM)&&b.distanceM>=a.distanceM
    ? b.distanceM-a.distanceM : null;
  return {dt,G,W,vg:G/dt};
}
function pathLength(points:TrackPoint[],a:number,b:number):number{
  let sum=0;
  for(let i=a+1;i<=b;i++){const d=pointDistance(points[i-1],points[i]);if(!finite(d))return NaN;sum+=d;}
  return sum;
}
const asSet=()=>new Set<string>();

/**
 * Protect sufficiently long, *independently coherent* white runs before pairing
 * distant GNSS excursions. A pair of bad entry/exit positions does not prove
 * that all intermediate samples are bad. Only primary point/edge evidence is
 * consulted here: inferred corridor flags do not yet exist.
 *
 * A stable run needs continuous samples, credible recorded travel, no direct
 * hard contradiction, and only occasional weak anomalies. Windows overlap so
 * their union forms a bridgehead which later dilation/merging cannot cross.
 */
function protectStableWhiteRuns(points:TrackPoint[], span:CoordinateSpan,
  hard:Set<string>[], soft:Set<string>[], trust:MotionReferenceTrust,
  protectedMask:boolean[]):void {
  for(let left=span.start;left<span.end;left++){
    const first=points[left];
    if(!finite(first.time)||hard[left].size)continue;
    let gps=0,wheel=0,validWheel=true,softCount=soft[left].size?1:0;
    for(let right=left+1;right<=span.end;right++){
      const e=edgeValues(points,right);
      if(!e || e.dt>3 || hard[right].size)break;
      if(points[right].time!-first.time>21)break;
      gps+=e.G;
      if(e.W===null)validWheel=false;else wheel+=e.W;
      if(soft[right].size)softCount++;
      const count=right-left+1,duration=points[right].time!-first.time;
      if(duration<15 || count<10)continue;
      // Dense soft evidence is suspicious, but scattered window warnings are
      // not proof of bad absolute position. The aggregate wheel/GNSS distance
      // consistency below is a stronger check for a real white bridgehead.
      if(softCount>Math.floor(count*.6))continue;
      if(trust==='high'||trust==='medium'){
        if(!validWheel)continue;
        if(wheel<=3){
          if(gps>6)continue;
          if(points.slice(left,right+1).some(p=>finite(p.speedMps)&&p.speedMps>1.5))continue;
        } else {
          if(wheel<12 || Math.abs(gps-wheel)>Math.max(6,.25*wheel))continue;
        }
      } else {
        // Without an independent distance reference, only a genuinely clean
        // segment can be protected against broad, inferred excursion masks.
        if(softCount>0)continue;
      }
      for(let j=left;j<=right;j++)protectedMask[j]=true;
      break;
    }
  }
}

export function detectCoordinateMask(points:TrackPoint[],spans:CoordinateSpan[],
  profileOf:(index:number)=>MotionProfile,trust:MotionReferenceTrust,cfg:MaskConfig):DetectionResult {
  const n=points.length,hard=Array.from({length:n},asSet),soft=Array.from({length:n},asSet);
  const mask=Array<boolean>(n).fill(false);
  const protectedMask=Array<boolean>(n).fill(false);
  const counts:Record<string,number>={};
  const verifiedOffsetCorridors:VerifiedOffsetCorridor[]=[];
  let overriddenBridgeheadPoints=0;
  const flag=(type:'H'|'S',i:number,reason:string)=>{
    if(i<0||i>=n)return;
    const s=type==='H'?hard[i]:soft[i];
    if(!s.has(reason)){s.add(reason);counts[reason]=(counts[reason]??0)+1;}
  };
  for(const span of spans){
    const {start,end}=span;
    const hardEdges=new Map<number,string[]>();
    for(let i=start;i<=end;i++){
      const p=points[i];
      if(!finite(p.lat)||!finite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180)
        flag('H',i,'H1_invalid_or_missing_position');
      if(finite(p.gpsAccuracyM)&&p.gpsAccuracyM>30)flag('S',i,'S6_gps_accuracy');
    }
    const addHardEdge=(i:number,reason:string)=>{
      const a=hardEdges.get(i)??[];a.push(reason);hardEdges.set(i,a);
    };
    const softEdges=new Map<number,Set<string>>();
    const addSoftEdge=(i:number,reason:string)=>{
      if(!softEdges.has(i))softEdges.set(i,new Set());
      softEdges.get(i)!.add(reason);
    };
    for(let i=start+1;i<=end;i++){
      const e=edgeValues(points,i);if(!e||e.dt>5)continue;
      const {G,W,dt,vg}=e,p=profileOf(i),fast=dt<=2;
      if(fast && vg*3.6>p.hardSpeedLimitKph) addHardEdge(i,'H2_hard_speed');
      if(fast&&vg*3.6>p.softSpeedLimitKph){
        // Sustained fast movement with matching recorded speed is not itself
        // suspicious. Soft speed is a trigger for reachability checks.
        const recorded=points[i].speedMps;
        const nearby= i>start+1 ? edgeValues(points,i-1) : null;
        const sustained=nearby && nearby.dt<=2 && nearby.vg*3.6>p.softSpeedLimitKph*.8 &&
          Math.abs(nearby.vg-vg)<p.maxAccelerationMps2*2 &&
          (!finite(recorded)||Math.abs(recorded-vg)<Math.max(3,vg*.15));
        if(!sustained)addSoftEdge(i,'S1_soft_speed');
      }
      if(fast && W!==null && trust==='high'){
        if(G>W+Math.max(10,.6*W))addHardEdge(i,'H3_extreme_long_step');
        if(W>=8 && G<.15*W)addHardEdge(i,'H4_extreme_short_step');
      }
      if(fast && W!==null && trust!=='low'){
        if(G>W+Math.max(5,.25*W))addSoftEdge(i,'S3_long_distance');
        if(W>=4 && W/dt>=2){
          const theta=p.maxLateralAccelerationMps2*dt/Math.max(2,W/dt);
          if(theta<2.5){
            const q=Math.abs(theta)<1e-7?1:Math.sin(theta/2)/(theta/2);
            if(G<q*W-Math.max(3,.15*W))addSoftEdge(i,'S2_short_distance');
          }
        }
      }
      // Strongly implausible turning or acceleration with stable recorded motion.
      if(i>=start+2 && i<end && dt<=2 && fast){
        const previous=velocity(points[i-2],points[i-1]);
        const next=velocity(points[i],points[i+1]);
        if(previous&&next){
          const v1=speed(previous),v2=speed(next);
          const interval=(points[i+1].time!-points[i-2].time!)*.5;
          if(interval>0&&interval<=5){
            const accel=Math.hypot(next.x-previous.x,next.y-previous.y)/interval;
            const allowed=Math.max(p.maxAccelerationMps2,p.maxBrakingMps2,p.maxLateralAccelerationMps2);
            if(accel>allowed && Math.max(v1,v2)>3){
              const recordedA=points[i-2].speedMps,recordedB=points[i+1].speedMps;
              const recordStable=finite(recordedA)&&finite(recordedB)&&
                Math.abs(recordedB-recordedA)/interval < Math.max(3,p.maxAccelerationMps2);
              flag('S',i,'S4_acceleration');
              if(accel>allowed*3 && recordStable && trust!=='low')flag('H',i,'H5_impossible_vector_change');
              const a=Math.atan2(previous.y,previous.x),b=Math.atan2(next.y,next.x);
              const change=Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
              if(Math.max(v1,v2)>4 && change>.75 && accel>p.maxLateralAccelerationMps2)
                flag('S',i,'S5_direction');
            }
          }
        }
      }
    }
    // Strong edge contradictions are localized using the adjacent edge and a one-point bypass.
    const marked=new Set<number>();
    const indices=[...hardEdges.keys()].sort((a,b)=>a-b);
    for(const i of indices){
      if(hardEdges.has(i+1)){
        for(const r of [...hardEdges.get(i)!,...hardEdges.get(i+1)!])flag('H',i,r);
        marked.add(i);
      }
    }
    for(const i of indices){
      if(marked.has(i) || marked.has(i-1))continue;
      let target=i;
      // An isolated incoming jump could be caused by either endpoint.
      if(i-1>start && i+1<=end){
        const bypassRight=pointDistance(points[i-1],points[i+1]);
        const bypassLeft=pointDistance(points[i-2],points[i]);
        const Wa=finite(points[i-1].distanceM)&&finite(points[i+1].distanceM)
          ? points[i+1].distanceM!-points[i-1].distanceM! : NaN;
        const Wb=finite(points[i-2].distanceM)&&finite(points[i].distanceM)
          ? points[i].distanceM!-points[i-2].distanceM! : NaN;
        const ra=finite(Wa)&&Wa>=0?Math.abs(bypassRight-Wa):bypassRight;
        const rb=finite(Wb)&&Wb>=0?Math.abs(bypassLeft-Wb):bypassLeft;
        if(rb+5<ra)target=i-1;
      }
      for(const r of hardEdges.get(i)!)flag('H',target,r);
      marked.add(target);
    }
    // Soft edge symptoms attach to the destination; surrounding evidence promotes later.
    for(const [i,rs] of softEdges)for(const r of rs)flag('S',i,r);
    // Persistent frozen position while reported speed continues is useful
    // even when hardware provenance cannot be determined. In low-trust input
    // it is weak evidence, never a standalone hard contradiction.
    for(let i=start;i<=end;i++){
      const origin=points[i];
      if(!finite(origin.time))continue;
      let until=i, hasGap=false;
      while(until+1<=end && finite(points[until+1].time) &&
        points[until+1].time!-origin.time<=5){
        const dt=points[until+1].time!-points[until].time!;
        if(dt>3){hasGap=true;break;}until++;
      }
      if(hasGap||until-i<3)continue;
      const travel=pathLength(points,i,until);
      const speedMoving=points.slice(i,until+1).filter(p=>finite(p.speedMps)&&p.speedMps>=2).length;
      if(finite(travel)&&travel<3 && speedMoving>=(until-i+1)*.6)
        for(let j=i+1;j<=until;j++)flag('S',j,'S8_repeated_stationarity');
    }
    // Five-second fixed position with continuing independent recorded motion.
    if(trust==='high'){
      for(let i=start;i<=end;i++){
        const p=points[i];if(!finite(p.time)||!finite(p.distanceM))continue;
        for(let j=i+1;j<=end;j++){
          const q=points[j];if(!finite(q.time)||q.time-p.time>5||!finite(q.distanceM))break;
          const W=q.distanceM-p.distanceM;
          if(W>=20 && W>=0){
            const G=pathLength(points,i,j);
            if(finite(G)&&G<.15*W){for(let k=i+1;k<=j;k++)flag('H',k,'H6_frozen_while_moving');}
          }
        }
      }
    }
    // Three/five/ten second sliding movement windows. Require close samples; never
    // confuse an irregular 27-second logging hole with frozen GNSS coordinates.
    if(trust!=='low')for(const seconds of [3,5,10]){
      let left=start;
      let G=0,W=0,invalid=0;
      for(let right=start+1;right<=end;right++){
        const edge=edgeValues(points,right);
        if(!edge||edge.dt>3||edge.W===null){left=right;G=0;W=0;invalid=0;continue;}
        G+=edge.G;W+=edge.W;
        while(left<right && points[right].time!-points[left].time!>seconds){
          const old=edgeValues(points,left+1);
          if(old&&old.W!==null){G-=old.G;W-=old.W;}else invalid++;
          left++;
        }
        if(invalid||right-left<2 || points[right].time!-points[left].time!<seconds*.7 || W<=0)continue;
        // A hard spike is already localized using its neighboring edges.
        // Otherwise its huge distance would falsely gray the entire window.
        if(Array.from({length:right-left+1},(_,k)=>left+k).some(k=>hard[k].size>0||
          hardEdges.has(k) || hardEdges.has(k+1)))continue;
        if(G>W+Math.max(5,.25*W) || G<W-Math.max(8,.2*W)){
          const r='S8_repeated_stationarity';
          for(let k=left+1;k<=right;k++)flag('S',k,r);
          counts[`window_${seconds}s_mismatch`]=(counts[`window_${seconds}s_mismatch`]??0)+1;
        }
      }
    }
    // First establish local, independently coherent white bridgeheads. Broad
    // entry/exit hypotheses cannot disqualify them merely by their length.
    protectStableWhiteRuns(points,span,hard,soft,trust,protectedMask);
    // Bridgeheads are stable *interiors*. Keep a small margin next to a real
    // hard anomaly available for black dilation, without allowing it to erase
    // an entire coherent road interval between two failures.
    const rawProtected=[...protectedMask];
    for(let i=start;i<=end;i++)if(hard[i].size){
      for(const dir of [-1,1]){
        let last=i,travel=0;
        for(let j=i+dir;j>=start&&j<=end;j+=dir){
          if(!finite(points[i].time)||!finite(points[last].time)||
            !finite(points[j].time)||Math.abs(points[j].time!-points[last].time!)>3||
            Math.abs(points[j].time!-points[i].time!)>3)break;
          const x=points[last].distanceM,y=points[j].distanceM;
          if(finite(x)&&finite(y))travel+=Math.abs(y-x);
          else {const d=pointDistance(points[last],points[j]);if(finite(d))travel+=d;}
          if(travel>15)break;
          if(rawProtected[j])protectedMask[j]=false;
          last=j;
        }
      }
    }

    // A transient one-point spike produces two opposite *adjacent* bad edges.
    // Pairing the exit of one spike with the entry of another produced the
    // kilometres-long false interpolations seen on the Odani ride.
    const isTransient=(edge:number,edges:Set<number>,minimumJumpM:number)=>
      (edges.has(edge-1)&&oneSampleSpike(points,edge-1,minimumJumpM,trust)) ||
      (edges.has(edge+1)&&oneSampleSpike(points,edge,minimumJumpM,trust));
    const extremeEdges=indices.filter(k=>hardEdges.get(k)?.some(r=>
      r==='H2_hard_speed'||r==='H3_extreme_long_step'));
    const extremeSet=new Set(extremeEdges);
    const transitions=extremeEdges.filter(k=>!isTransient(k,extremeSet,30));
    const rejectedTransient=extremeEdges.length-transitions.length;
    counts.rejected_transient_jump_edges=(counts.rejected_transient_jump_edges??0)+rejectedTransient;
    for(let k=0;k+1<transitions.length;k++){
      const entry=transitions[k],exit=transitions[k+1];
      if(exit-entry>2000||!reversingJumps(points,entry,exit,40,900)||
        !chordUpper(points,entry-1,exit,trust))continue;
      // A verified transition pair is an exception: the entire intervening
      // track can be a smooth but consistently *displaced* GNSS trajectory.
      let overwritten=0;
      for(let j=entry;j<exit;j++){
        if(protectedMask[j]){overwritten++;overriddenBridgeheadPoints++;}
        protectedMask[j]=false;
        flag('H',j,'H2_displaced_corridor');
      }
      verifiedOffsetCorridors.push({entryIndex:entry,exitIndex:exit,
        durationSeconds:points[exit].time!-points[entry-1].time!,
        overriddenWhitePoints:overwritten});
      counts.paired_opposite_jumps=(counts.paired_opposite_jumps??0)+1;
      k++;
    }
    // Smoothly displaced corridor: entrance and exit distance contradictions can
    // each be only soft anomalies. Pair them and inspect the enclosed geometry.
    // This remains a weak clue until multiple gray points corroborate it.
    const crossTrack=(p:TrackPoint,a:TrackPoint,b:TrackPoint):number=>{
      if(!finite(p.lat)||!finite(p.lon)||!finite(a.lat)||!finite(a.lon)||
        !finite(b.lat)||!finite(b.lon))return 0;
      const X=(b.lon-a.lon)*Math.cos(a.lat*rad),Y=b.lat-a.lat;
      const x=(p.lon-a.lon)*Math.cos(a.lat*rad),y=p.lat-a.lat;
      const size=Math.hypot(X,Y);
      return size>1e-12?Math.abs(X*y-Y*x)/size*rad*6371008.8:0;
    };
    const softExcursionEdges=[...softEdges.keys()].filter(i=>softEdges.get(i)?.has('S3_long_distance'));
    const softEdgeSet=new Set(softExcursionEdges);
    const softTransitions=softExcursionEdges.filter(k=>!isTransient(k,softEdgeSet,12));
    for(let k=0;k+1<softTransitions.length;k++){
      const entry=softTransitions[k],exit=softTransitions[k+1];
      if(exit-entry>180||entry<=start||exit>end||
        !reversingJumps(points,entry,exit,12,180))continue;
      const left=entry-1,right=exit;
      const W=finite(points[left].distanceM)&&finite(points[right].distanceM)
        ?points[right].distanceM!-points[left].distanceM!:NaN;
      const C=pointDistance(points[left],points[right]);
      if(!finite(W)||W<=0||!finite(C)||C>W+Math.max(20,.3*W))continue;
      let deviation=0;
      for(let j=entry;j<exit;j++)deviation=Math.max(deviation,
        crossTrack(points[j],points[left],points[right]));
      if(deviation<20)continue;
      for(let j=entry;j<exit;j++)if(!protectedMask[j])flag('S',j,'S7_offset_excursion');
      k++;
    }
    // Do not infer a hard corridor from cross-track deviation alone. A
    // perfectly healthy winding road can deviate hundreds of metres from the
    // chord connecting two unrelated position jumps. Confirmed offset pairs
    // above are the sole source of broad H2_displaced_corridor masks.
  }

  for(let i=0;i<n;i++)mask[i]=!protectedMask[i]&&hard[i].size>0;
  const initialBlack=mask.filter(Boolean).length;
  const initialGray=soft.filter((s,i)=>s.size>0&&!mask[i]&&!protectedMask[i]).length;
  // Independent weak classes or repeated weak conditions in short time windows.
  for(const span of spans){
    for(let i=span.start;i<=span.end;i++){
      if(protectedMask[i]||mask[i]||soft[i].size===0)continue;
      if(soft[i].size>=2){mask[i]=true;continue;}
      const p=points[i];if(!finite(p.time))continue;
      for(const [seconds,needed] of [[3,2],[5,3]] as const){
        let count=0;
        for(let j=Math.max(span.start,i-10);j<=Math.min(span.end,i+10);j++){
          if(finite(points[j].time)&&Math.abs(points[j].time!-p.time)<=seconds*.5&&soft[j].size)count++;
        }
        if(count>=needed){mask[i]=true;break;}
      }
    }
  }
  const promotedGray=mask.filter((b,i)=>b&&hard[i].size===0).length;
  const promotedMask=[...mask];
  // One bounded morphological dilation per segment. Elapsed time and travelled
  // distance both matter, but never cross a large sample gap or a time boundary.
  for(const span of spans){
    for(let i=span.start;i<=span.end;i++){
      if(!promotedMask[i]||protectedMask[i])continue;
      for(const dir of [-1,1]){
        let travel=0,last=i;
        for(let j=i+dir;j>=span.start&&j<=span.end;j+=dir){
          const a=points[last],b=points[j];
          if(protectedMask[j]||!finite(a.time)||!finite(b.time)||Math.abs(b.time-a.time)>3)break;
          const dt=Math.abs(b.time-points[i].time!);
          if(dt>8)break;
          const d=finite(a.distanceM)&&finite(b.distanceM)?Math.abs(b.distanceM-a.distanceM):pointDistance(a,b);
          if(finite(d))travel+=d;
          mask[j]=true;last=j;
          if(dt>=cfg.blackExpansionSeconds && travel>=cfg.blackExpansionDistanceM)break;
        }
      }
    }
  }
  const expandedBlack=mask.filter((b,i)=>b&&!promotedMask[i]).length;
  const initialRegions:MaskRegion[]=[];
  for(const span of spans){
    for(let i=span.start;i<=span.end;i++){
      if(!mask[i])continue;
      const begin=i;while(i+1<=span.end&&mask[i+1])i++;
      const end=i;
      let firstCore=begin,lastCore=end;
      for(let j=begin;j<=end;j++)if(promotedMask[j]){firstCore=j;break;}
      for(let j=end;j>=begin;j--)if(promotedMask[j]){lastCore=j;break;}
      initialRegions.push({start:begin,end,initialStart:firstCore,initialEnd:lastCore,
        reasons:[...new Set(Array.from({length:end-begin+1},(_,k)=>[
          ...hard[begin+k],...soft[begin+k]]).flat())]});
    }
  }
  // Merge only if no stable white stretch exists between close black regions.
  const regions:MaskRegion[]=[];
  for(const r of initialRegions){
    const prev=regions[regions.length-1];
    if(prev && points[r.start].segmentId===points[prev.end].segmentId &&
      finite(points[r.start].time)&&finite(points[prev.end].time)&&
      points[r.start].time!-points[prev.end].time!<=cfg.mergeBlackGapSeconds &&
      (r.start-prev.end<5 || points[r.start].time!-points[prev.end].time!<8) &&
      !protectedMask.slice(prev.end+1,r.start).some(Boolean)){
      for(let j=prev.end+1;j<r.start;j++)mask[j]=true;
      prev.end=r.end;prev.initialEnd=r.initialEnd;
      prev.reasons=[...new Set([...prev.reasons,...r.reasons])];
    } else regions.push({...r});
  }
  const protectedWhiteRegions:ProtectedWhiteRegion[]=[];
  for(const span of spans)for(let i=span.start;i<=span.end;i++){
    if(!protectedMask[i])continue;
    const start=i;
    while(i+1<=span.end&&protectedMask[i+1])i++;
    const end=i;
    protectedWhiteRegions.push({start,end,
      durationSeconds:points[end].time!-points[start].time!,
      recordedDistanceM:finite(points[start].distanceM)&&finite(points[end].distanceM)
        ? points[end].distanceM!-points[start].distanceM!:null});
  }
  const finalBlack=mask.filter(Boolean).length;
  const longestBlackSpanPoints=regions.reduce((m,r)=>Math.max(m,r.end-r.start+1),0);
  const longestBlackSpanSeconds=regions.reduce((m,r)=>Math.max(m,
    finite(points[r.start].time)&&finite(points[r.end].time)
      ?points[r.end].time!-points[r.start].time!:0),0);
  return {mask,protectedWhiteMask:protectedMask,protectedWhiteRegions,verifiedOffsetCorridors,hardReasons:hard,softReasons:soft,regions,counts,summary:{initialBlack,
    initialGray,promotedGray,expandedBlack,mergedAdditionalBlack:finalBlack-initialBlack-promotedGray-expandedBlack,
    finalBlack,regionsBeforeMerge:initialRegions.length,
    regionsAfterMerge:regions.length,
    protectedWhitePoints:protectedMask.filter(Boolean).length,
    protectedWhiteRegions:protectedWhiteRegions.length,
    rejectedIsolatedJumpEdges:counts.rejected_transient_jump_edges??0,
    verifiedOffsetCorridors:verifiedOffsetCorridors.length,
    overriddenBridgeheadPoints,
    longestBlackSpanPoints,longestBlackSpanSeconds}};
}
