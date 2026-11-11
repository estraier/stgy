/** Independence diagnostics for recorded speed/distance. Do not equate it with hardware proof. */
import type { TrackActivity, TrackPoint } from './activity';

export type WheelInference = 'wheel_confirmed' | 'wheel_likely' | 'wheel_possible' | 'wheel_unknown';
export type MotionReferenceTrust = 'high' | 'medium' | 'low';
export interface WheelSensorInference {
  wheelInference: WheelInference;
  referenceTrust: MotionReferenceTrust;
  score: number;
  evidence: {reason:string; points:number; score:number}[];
  deviceSpeedSensorPresent: boolean;
  speedDistanceConsistency: number | null;
  frozenMovingEvents: number;
  positionJumpIndependentEvents: number;
}
const finite = (n:unknown): n is number => typeof n==='number' && Number.isFinite(n);
const clamp=(x:number)=>Math.min(100,Math.max(0,x));
const rad=Math.PI/180;
const dist=(a:TrackPoint,b:TrackPoint)=>{
  if (!finite(a.lat)||!finite(a.lon)||!finite(b.lat)||!finite(b.lon))return NaN;
  const dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;
  const v=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
  return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(v)));
};

export function inferWheelSensor(activity:TrackActivity):WheelSensorInference {
  const points=activity.points;
  const evidence:WheelSensorInference['evidence']=[];
  let score=0;
  const add=(reason:string,pts:number,amount:number)=>{evidence.push({reason,points:pts,score:amount});score+=amount;};
  const devices=activity.metadata.devices ?? [];
  const hasSensor=devices.some(d=>/speed|cadence|bike|bicycle/i.test([d.deviceType,d.sourceType,d.productName].filter(Boolean).join(' ')));
  if (hasSensor) add('speed_or_bicycle_sensor_device_info',0,25);
  let frozenEvents=0, jumpEvents=0;
  const consistencyRatios:number[]=[];
  let frozenStart=0;
  for (let i=1;i<=points.length;i++) {
    const a=points[i-1], b=points[i];
    const inFreeze=i<points.length && finite(a.time)&&finite(b.time)&&b.time>a.time&&b.time-a.time<=5 &&
      a.segmentId===b.segmentId && dist(a,b)<2.5;
    if (inFreeze)continue;
    if (i-1-frozenStart>=2) {
      const start=points[frozenStart],end=points[i-1];
      if (finite(start.time)&&finite(end.time)&&finite(start.distanceM)&&finite(end.distanceM)) {
        const elapsed=end.time-start.time,travel=end.distanceM-start.distanceM;
        let integrated=0,covered=0;
        for(let j=frozenStart+1;j<i;j++) {
          const prev=points[j-1],current=points[j];
          const dt=finite(prev.time)&&finite(current.time)?current.time-prev.time:NaN;
          if(dt>0&&dt<=5&&finite(prev.speedMps)&&finite(current.speedMps)&&prev.speedMps>=0&&current.speedMps>=0) {
            integrated+=(prev.speedMps+current.speedMps)*.5*dt;covered+=dt;
          }
        }
        if(elapsed>=20 && travel>=50 && covered/elapsed>=.65 && integrated>0 &&
          integrated/travel>=.85 && integrated/travel<=1.15) frozenEvents++;
      }
    }
    frozenStart=i;
  }
  let currentWindowStart=0,windowDistance=0,windowSpeed=0,windowCoverage=0;
  let consistentWindows=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    const dt=finite(a.time)&&finite(b.time)?b.time-a.time:NaN;
    if (!(dt>0&&dt<=5) || a.segmentId!==b.segmentId ||
      !finite(a.distanceM)||!finite(b.distanceM)||b.distanceM<a.distanceM){
      currentWindowStart=i;windowDistance=0;windowSpeed=0;windowCoverage=0;continue;
    }
    const W=b.distanceM-a.distanceM;
    windowDistance+=W;
    if(finite(a.speedMps)&&finite(b.speedMps)&&a.speedMps>=0&&b.speedMps>=0){
      windowSpeed+=(a.speedMps+b.speedMps)*.5*dt;windowCoverage+=dt;
    }
    const G=dist(a,b),Vg=G/dt;
    const vw=W/dt;
    if (dt<=2 && finite(Vg) && Vg>30 && vw<25 &&
        (!finite(b.speedMps) || b.speedMps<25)) jumpEvents++;
    if(finite(b.time)&&finite(points[currentWindowStart].time)&&b.time-points[currentWindowStart].time!>=30){
      if (windowDistance>=15&&windowCoverage>=24&&windowSpeed>0){
        const ratio=windowSpeed/windowDistance;
        consistencyRatios.push(ratio);
        if(ratio>=.9&&ratio<=1.1)consistentWindows++;
      }
      currentWindowStart=i;windowDistance=0;windowSpeed=0;windowCoverage=0;
    }
  }
  if(frozenEvents) add('position_frozen_with_continuing_speed_and_distance',frozenEvents,50);
  if(jumpEvents>=2) add('position_jumps_without_recorded_motion_jumps',jumpEvents,25);
  if(consistentWindows>=3) add('speed_integral_matches_recorded_distance',consistentWindows,15);
  // Speed staying smooth while GNSS jumps is supporting evidence, not independent proof.
  if((jumpEvents>=2 || frozenEvents>=1) && consistencyRatios.filter(r=>r>.85&&r<1.15).length>=2)
    add('recorded_speed_stable_during_position_errors',jumpEvents,10);
  const medianRatio=consistencyRatios.length
    ? consistencyRatios.sort((a,b)=>a-b)[Math.floor(consistencyRatios.length/2)] : null;
  const inconsistent=consistencyRatios.length>=3 &&
    consistencyRatios.filter(r=>r<.65||r>1.5).length>consistencyRatios.length*.5;
  if(inconsistent)add('recorded_speed_and_distance_disagree',consistencyRatios.length,-40);
  score=clamp(score);
  const wheelInference:WheelInference=score>=70?'wheel_likely':score>=40?'wheel_possible':'wheel_unknown';
  const referenceTrust:MotionReferenceTrust = (score>=70&& !inconsistent) ? 'high'
    : (score>=15 && !inconsistent)?'medium':'low';
  return {wheelInference,referenceTrust,score,evidence,deviceSpeedSensorPresent:hasSensor,
    speedDistanceConsistency:medianRatio,frozenMovingEvents:frozenEvents,
    positionJumpIndependentEvents:jumpEvents};
}
