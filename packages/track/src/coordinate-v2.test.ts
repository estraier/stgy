import type { TrackActivity, TrackPoint } from './activity';
import { correctTrackActivityCoordinates, COORDINATE_CORRECTION_ALGORITHM_REVISION } from './coordinate-correction';
import type { CoordinateCorrectionDiagnostic } from './coordinate-correction';
import { inferSportProfile, MOTION_PROFILES } from './coordinate-sport';
import { inferWheelSensor } from './coordinate-motion';
import { detectCoordinateMask } from './coordinate-detection';

function track(n=160,v=5): TrackActivity {
  return {schemaVersion:1, warnings:[],metadata:{sport:'cycling',totalDistanceM:(n-1)*v},
    points:Array.from({length:n},(_,i):TrackPoint=>({segmentId:0,time:i,lat:35,
      lon:139+i*v/91000,distanceM:i*v,speedMps:v,altitudeM:100,
      heartRateBpm:145, cadenceRpm:85}))};
}
function detector(a:TrackActivity,trust:'high'|'medium'|'low'='high'){
  return detectCoordinateMask(a.points,[{start:0,end:a.points.length-1}],
    ()=>MOTION_PROFILES.cycling,trust,
    {blackExpansionSeconds:3,blackExpansionDistanceM:15,mergeBlackGapSeconds:10});
}

describe('Sport profile and recorded motion independence',()=>{
  test('metadata cycling chooses Soft 50 / Hard 100, without reading GNSS top speed',()=>{
    const a=track();a.points[100].lat!+=.01;
    const s=inferSportProfile(a);
    expect(s.profile.softSpeedLimitKph).toBe(50);
    expect(s.profile.hardSpeedLimitKph).toBe(100);
    expect(s.source).toBe('metadata');
  });
  test('updated sport limits match cycling, mountain biking, e-biking, and driving',()=>{
    const cases = [
      {sport:'cycling', subSport:'road', id:'cycling', soft:50, hard:100},
      {sport:'cycling', subSport:'mountain_biking', id:'mountain_biking', soft:40, hard:90},
      {sport:'e_biking', id:'e_biking', soft:60, hard:120},
      {sport:'driving', id:'driving', soft:100, hard:250},
    ];
    for (const {sport,subSport,id,soft,hard} of cases) {
      const activity=track();
      activity.metadata.sport=sport;
      activity.metadata.subSport=subSport;
      const result=inferSportProfile(activity);
      expect(result.profile.id).toBe(id);
      expect(result.profile.softSpeedLimitKph).toBe(soft);
      expect(result.profile.hardSpeedLimitKph).toBe(hard);
    }
  });
  test('cycling cadence plus untagged 22km/h track supports inferred cycling',()=>{
    const a=track(200,22/3.6);delete a.metadata.sport;
    const s=inferSportProfile(a);
    expect(s.profile.id).toBe('cycling');
    expect(s.confidence).toBeGreaterThanOrEqual(.85);
  });
  test('mixed Session sport changes profile at time boundary',()=>{
    const a=track(160,5);
    delete a.metadata.sport;
    a.metadata.sportSessions=[{startTime:0,endTime:79,sport:'cycling'},
      {startTime:79,endTime:159,sport:'running'}];
    const events:CoordinateCorrectionDiagnostic[]=[];
    correctTrackActivityCoordinates(a,{logLevel:'summary',onDiagnostic:e=>events.push(e)});
    const sports=events.filter(e=>e.type==='sport_inference').map(e=>e.data.profileId);
    expect(sports).toEqual(['cycling','running']);
  });
  test('long frozen GNSS plus continuing motion promotes wheel-likely; device info alone does not confirm',()=>{
    const a=track(1000,4);
    for(let i=200;i<=700;i++)a.points[i].lon=a.points[199].lon;
    a.metadata.devices=[{deviceType:'bike_speed'}];
    const w=inferWheelSensor(a);
    expect(w.referenceTrust).toBe('high');
    expect(w.wheelInference).toBe('wheel_likely');
    expect(w.deviceSpeedSensorPresent).toBe(true);
  });
  test('recorded speed without distance does not prove sensor provenance',()=>{
    const a=track();for(const p of a.points)delete p.distanceM;
    const w=inferWheelSensor(a);
    expect(w.referenceTrust).toBe('low');
    expect(w.wheelInference).toBe('wheel_unknown');
  });
});

describe('Hard/soft GNSS anomaly conditions',()=>{
  test('cycling exceeds 100km/h in one second => H2, 99km/h is not H2',()=>{
    const a=track();
    a.points[70].lon=a.points[69].lon!+(101/3.6)/91000;
    const h=detector(a,'medium');
    expect(h.counts.H2_hard_speed).toBeGreaterThan(0);
    a.points[70].lon=a.points[69].lon!+(99/3.6)/91000;
    const s=detector(a,'medium');
    expect(s.counts.H2_hard_speed ?? 0).toBe(0);
  });
  test('mountain biking Hard 90 and driving Hard 250 are applied to GNSS edges',()=>{
    for (const {profile,over,under} of [
      {profile:MOTION_PROFILES.mountain_biking,over:91,under:89},
      {profile:MOTION_PROFILES.driving,over:251,under:249},
    ]) {
      const a=track();
      a.points[70].lon=a.points[69].lon!+(over/3.6)/91000;
      const detected=detectCoordinateMask(a.points,[{start:0,end:a.points.length-1}],()=>profile,'medium',
        {blackExpansionSeconds:3,blackExpansionDistanceM:15,mergeBlackGapSeconds:10});
      expect(detected.counts.H2_hard_speed).toBeGreaterThan(0);
      a.points[70].lon=a.points[69].lon!+(under/3.6)/91000;
      const normal=detectCoordinateMask(a.points,[{start:0,end:a.points.length-1}],()=>profile,'medium',
        {blackExpansionSeconds:3,blackExpansionDistanceM:15,mergeBlackGapSeconds:10});
      expect(normal.counts.H2_hard_speed ?? 0).toBe(0);
    }
  });
  test('one sample 10m wheel and 0m GNSS => H4 without a 5s wait',()=>{
    const a=track(140,10);
    a.points[70].lon=a.points[69].lon;
    const r=detector(a,'high');
    expect(r.counts.H4_extreme_short_step).toBeGreaterThan(0);
    expect(r.mask[70]).toBe(true);
  });
  test('one sample 10m wheel and 25m GNSS => H3',()=>{
    const a=track(140,10);
    a.points[70].lon=a.points[69].lon!+25/91000;
    const r=detector(a,'high');
    expect(r.counts.H3_extreme_long_step).toBeGreaterThan(0);
  });
  test('sustained 55km/h in a straight line is not automatically black',()=>{
    const a=track(130,55/3.6);
    const r=detector(a,'medium');
    expect(r.summary.initialBlack).toBe(0);
    expect(r.regions.length).toBe(0);
  });
  test('smooth continuous turns with matched wheel distance are not black',()=>{
    const a=track(100,4), radius=9;
    for(let i=0;i<a.points.length;i++){
      const theta=i*4/radius;
      a.points[i].lat=35+(radius*(1-Math.cos(theta)))/111195;
      a.points[i].lon=139+(radius*Math.sin(theta))/(111195*Math.cos(35*Math.PI/180));
    }
    const r=detector(a,'high');
    expect(r.summary.initialBlack).toBe(0);
    expect(r.regions.length).toBe(0);
  });
  test('sporadic 27 second recording gap with little movement does not become a frozen tunnel',()=>{
    const a=track(150,4);
    for(let i=75;i<a.points.length;i++)a.points[i].time!+=27;
    const r=correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(0);
  });
});

describe('Mask expansion, anchors and output invariants',()=>{
  test('600-second coordinate freeze is interpolated despite former five-minute cutoff',()=>{
    const a=track(1200,4);
    for(let i=240;i<=840;i++){
      a.points[i].lat=a.points[239].lat;
      a.points[i].lon=a.points[239].lon;
    }
    const events:CoordinateCorrectionDiagnostic[]=[];
    const before=JSON.stringify(a);
    const r=correctTrackActivityCoordinates(a,{logLevel:'verbose',onDiagnostic:e=>events.push(e)});
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.report.pointsCorrected).toBeGreaterThan(600);
    expect(r.report.regions[0].durationSeconds).toBeGreaterThan(600);
    expect(r.activity.points[500].lon).toBeCloseTo(139+500*4/91000,3);
    expect(r.activity.points[500].distanceM).toBe(2000);
    expect(r.activity.points[500].heartRateBpm).toBe(145);
    expect(r.activity.metadata.coordinateCorrection?.method).toBe('linear-dead-reckoning-v2');
    expect(JSON.stringify(a)).toBe(before);
    expect(events.some(e=>e.type==='detection_summary')).toBe(true);
    expect(events.some(e=>e.type==='anchor_search')).toBe(true);
    expect(events.some(e=>e.type==='mask_summary')).toBe(true);
    expect(events.some(e=>e.type==='interpolation')).toBe(true);
  });
  test('two-sided 10-second jump/drift region is expanded and interpolated',()=>{
    const a=track();for(let i=65;i<=80;i++)a.points[i].lat!+=.003;
    const r=correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(1);
    expect(r.report.pointsCorrected).toBeGreaterThan(16);
    expect(r.activity.points[72].lat).toBeCloseTo(35,4);
  });
  test('missing right anchor remains uncorrected; one-sided extrapolation forbidden',()=>{
    const a=track();for(let i=110;i<a.points.length;i++)delete a.points[i].lat;
    const r=correctTrackActivityCoordinates(a);
    expect(r.report.regionsCorrected).toBe(0);
    expect(r.report.regions[0].skipReason).toBe('boundary_not_stable');
  });
  test('already corrected v1 is not corrected again, logger level does not change geometry',()=>{
    const a=track();for(let i=60;i<=75;i++)delete a.points[i].lon;
    const off=correctTrackActivityCoordinates(a);
    const on=correctTrackActivityCoordinates(a,{logLevel:'verbose',onDiagnostic:()=>{}});
    expect(off.activity.points.map(p=>p.lon)).toEqual(on.activity.points.map(p=>p.lon));
    a.metadata.coordinateCorrection={method:'linear-dead-reckoning-v1',regionsCorrected:1,
      pointsCorrected:1,speedsCorrected:0,distancesCorrected:0};
    expect(correctTrackActivityCoordinates(a).activity).toBe(a);
  });
});


describe('Stable white bridgeheads between GNSS failures',()=>{
  test('preserves a 90-second coherent white run between two long frozen tunnels',()=>{
    const a=track(1100,5);
    for(let i=220;i<=400;i++)a.points[i].lon=a.points[219].lon;
    for(let i=510;i<=720;i++)a.points[i].lon=a.points[509].lon;
    const before=a.points[460].lon;
    const d=detector(a);
    expect(d.protectedWhiteRegions.some(r=>r.start<=460&&r.end>=460)).toBe(true);
    expect(d.mask[460]).toBe(false);
    expect(d.regions.some(r=>r.start<=460&&r.end>=460)).toBe(false);
    expect(d.summary.protectedWhitePoints).toBeGreaterThan(30);
    const corrected=correctTrackActivityCoordinates(a);
    expect(corrected.activity.points[460].lon).toBe(before);
    expect(corrected.report.regionsCorrected).toBeGreaterThanOrEqual(2);
    expect(corrected.report.regions.some(r=>r.startIndex<=460&&r.endIndex>=460)).toBe(false);
  });

  test('white travel between two separately shifted GNSS tunnels remains untouched',()=>{
    const a=track(1100,5);
    for(let i=220;i<=400;i++)a.points[i].lat!+=.005;
    for(let i=510;i<=720;i++)a.points[i].lat!+=.004;
    const d=detector(a);
    expect(d.counts.paired_opposite_jumps).toBeGreaterThanOrEqual(2);
    expect(d.protectedWhiteMask[460]).toBe(true);
    expect(d.mask[460]).toBe(false);
    expect(d.mask[300]).toBe(true);
    expect(d.mask[600]).toBe(true);
    const r=correctTrackActivityCoordinates(a);
    expect(r.activity.points[300].lat).toBeCloseTo(35,4);
    expect(r.activity.points[600].lat).toBeCloseTo(35,4);
    expect(r.activity.points[460].lat).toBe(35);
  });

  test('black expansion and permissive merging cannot consume a 20-second bridgehead',()=>{
    const a=track(260,5);
    for(let i=90;i<=110;i++)a.points[i].lon=a.points[89].lon;
    for(let i=135;i<=155;i++)a.points[i].lon=a.points[134].lon;
    const r=detectCoordinateMask(a.points,[{start:0,end:259}],()=>MOTION_PROFILES.cycling,'high',
      {blackExpansionSeconds:8,blackExpansionDistanceM:40,mergeBlackGapSeconds:60});
    expect(r.protectedWhiteRegions.some(x=>x.start<=123&&x.end>=123)).toBe(true);
    expect(r.mask[123]).toBe(false);
    expect(r.regions.some(x=>x.start<=123&&x.end>=123)).toBe(false);
    expect(r.regions.length).toBeGreaterThanOrEqual(2);
    const fixed=correctTrackActivityCoordinates(a,{blackExpansionSeconds:8,
      blackExpansionDistanceM:40,mergeBlackGapSeconds:60});
    expect(fixed.report.regionsCorrected).toBeGreaterThanOrEqual(2);
    expect(fixed.activity.points[123].lon).toBe(a.points[123].lon);
    expect(fixed.report.regions.some(x=>x.startIndex<=123&&x.endIndex>=123)).toBe(false);
  });

  test('opposite entry/exit jumps do not shelter a coherently shifted corridor',()=>{
    const a=track(1000,5);
    for(let i=200;i<=800;i++)a.points[i].lat!+=.005;
    const d=detector(a);
    expect(d.counts.paired_opposite_jumps).toBeGreaterThan(0);
    expect(d.protectedWhiteMask[400]).toBe(false);
    expect(d.mask[400]).toBe(true);
    const fixed=correctTrackActivityCoordinates(a);
    expect(fixed.activity.points[400].lat).toBeCloseTo(35,4);
  });

  test('a continuous 600-second freeze is not misidentified as a white bridgehead',()=>{
    const a=track(1000,5);
    for(let i=180;i<=780;i++)a.points[i].lon=a.points[179].lon;
    const d=detector(a);
    expect(d.protectedWhiteRegions.some(r=>r.start<=400&&r.end>=400)).toBe(false);
    expect(d.mask[400]).toBe(true);
  });
});


describe('Do not infer a whole bad corridor between unrelated GNSS glitches',()=>{
  test('two isolated GNSS spikes 11 minutes apart on a winding road preserve the healthy middle',()=>{
    const a=track(3100,5),radius=6371008.8;
    let wheel=0;
    for(let i=0;i<a.points.length;i++){
      const x=5*i,y=120*Math.sin(i/130);
      a.points[i].lat=35+y/radius*180/Math.PI;
      a.points[i].lon=139+x/(radius*Math.cos(35*Math.PI/180))*180/Math.PI;
      if(i>0)wheel+=Math.hypot(5,120*(Math.sin(i/130)-Math.sin((i-1)/130)));
      a.points[i].distanceM=wheel;
    }
    // Each isolated error has an outward and immediate return jump. Pairing
    // the return of the first with the outward jump of the second is invalid.
    a.points[1050].lat!+=.003;
    a.points[1710].lat!+=.003;
    const beforeMiddle=a.points[1350].lat;
    const detected=detector(a);
    expect(detected.summary.rejectedIsolatedJumpEdges).toBeGreaterThanOrEqual(4);
    expect(detected.summary.verifiedOffsetCorridors).toBe(0);
    expect(detected.summary.longestBlackSpanPoints<=20).toBe(true);
    expect(detected.protectedWhiteMask[1350]).toBe(true);
    expect(detected.mask[1350]).toBe(false);
    const fixed=correctTrackActivityCoordinates(a);
    expect(fixed.activity.points[1350].lat).toBe(beforeMiddle);
    expect(fixed.report.regions.some(r=>r.startIndex<=1350&&r.endIndex>=1350)).toBe(false);
  });

  test('a genuinely shifted 600-second corridor still overrides locally coherent positions',()=>{
    const a=track(1200,5);
    for(let i=280;i<=900;i++)a.points[i].lat!+=.004;
    const d=detector(a);
    expect(d.summary.verifiedOffsetCorridors).toBeGreaterThan(0);
    expect(d.mask[500]).toBe(true);
    const r=correctTrackActivityCoordinates(a);
    expect(r.activity.points[500].lat).toBeCloseTo(35,4);
  });
});


describe('Compiled implementation identification',()=>{
  test('mask and summary diagnostics expose the algorithm revision',()=>{
    const a=track(90,5);
    const events:CoordinateCorrectionDiagnostic[]=[];
    correctTrackActivityCoordinates(a,{logLevel:'summary',onDiagnostic:e=>events.push(e)});
    expect(events.find(e=>e.type==='mask_summary')?.data.algorithmRevision)
      .toBe(COORDINATE_CORRECTION_ALGORITHM_REVISION);
    expect(events.find(e=>e.type==='summary')?.data.algorithmRevision)
      .toBe(COORDINATE_CORRECTION_ALGORITHM_REVISION);
  });
});
