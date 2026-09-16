import{test}from"node:test";
import assert from"node:assert/strict";
import{Calibrator,DEFAULT_THRESHOLDS,MIN_GAP,SAMPLE_MS,defaultCalibration,deriveThresholds,palmRatio,percentile}from"../../DrawingBoard/src/calibration.js";
import{hand,IMAGE}from"../fixtures/landmarks.js";

const repeat=(value,count,spread=0)=>Array.from({length:count},(_,i)=>value+(spread?((i%5)-2)*spread/5:0));

test("percentile interpolates and handles empty input",()=>{
  assert.equal(percentile([1,2,3,4,5],0),1);
  assert.equal(percentile([1,2,3,4,5],1),5);
  assert.equal(percentile([1,2,3,4,5],.5),3);
  assert.equal(percentile([0,10],.9),9);
  assert.ok(Number.isNaN(percentile([],.5)));
});

test("palmRatio measures a finger pair against the palm",()=>{
  const points=hand({pauseRatio:.4,palmPixels:100});
  const ratio=palmRatio(points,4,20,IMAGE.width,IMAGE.height);
  assert.ok(Math.abs(ratio-.4)<1e-9);
});

test("palmRatio rejects a palm too small to trust",()=>{
  assert.equal(palmRatio(hand({palmPixels:5}),4,20,IMAGE.width,IMAGE.height),null);
  assert.equal(palmRatio(null,4,20,IMAGE.width,IMAGE.height),null);
  assert.equal(palmRatio([{x:0,y:0}],4,20,IMAGE.width,IMAGE.height),null);
});

test("well separated samples produce thresholds inside the gap",()=>{
  const result=deriveThresholds(repeat(.12,30,.02),repeat(.62,30,.02));
  assert.equal(result.accepted,true);
  assert.ok(result.enter>.13&&result.enter<result.release);
  assert.ok(result.release<.62);
  assert.ok(result.gap>=MIN_GAP);
  assert.deepEqual(result.samples,{contact:30,released:30});
});

test("overlapping distributions keep the defaults and explain why",()=>{
  const result=deriveThresholds(repeat(.3,30,.05),repeat(.33,30,.05));
  assert.equal(result.accepted,false);
  assert.equal(result.enter,DEFAULT_THRESHOLDS.enter);
  assert.equal(result.release,DEFAULT_THRESHOLDS.release);
  assert.match(result.reason,/overlap/i);
});

test("a gap narrower than the minimum keeps the defaults",()=>{
  const result=deriveThresholds(repeat(.3,30),repeat(.3+MIN_GAP/2,30));
  assert.equal(result.accepted,false);
  assert.equal(result.enter,DEFAULT_THRESHOLDS.enter);
});

test("too few valid samples keeps the defaults",()=>{
  const result=deriveThresholds(repeat(.1,3),repeat(.8,3));
  assert.equal(result.accepted,false);
  assert.match(result.reason,/enough/i);
});

test("nonfinite samples are discarded rather than poisoning the thresholds",()=>{
  const contact=[...repeat(.12,30),NaN,Infinity];
  const result=deriveThresholds(contact,repeat(.7,30));
  assert.equal(result.accepted,true);
  assert.equal(result.samples.contact,30);
});

test("the collector gathers one second per phase and applies the result",()=>{
  const calibrator=new Calibrator();
  const phases=[["pauseContact",.12],["pauseReleased",.7],["pinchContact",.12],["pinchReleased",.7]];
  let now=0;
  for(const[phase,ratio]of phases){
    calibrator.begin(phase,now);
    for(let i=0;i<30;i++){
      now+=SAMPLE_MS/30;
      const options=phase.startsWith("pause")?{pauseRatio:ratio}:{pinchRatio:ratio};
      calibrator.observe(hand(options),now,IMAGE.width,IMAGE.height);
    }
    now+=10;
  }
  const result=calibrator.finish();
  assert.equal(result.pause.accepted,true);
  assert.equal(result.pinch.accepted,true);
  assert.equal(result.calibrated,true);
});

test("frames with an unusable palm never enter the sample",()=>{
  const calibrator=new Calibrator();
  calibrator.begin("pauseContact",0);
  for(let i=0;i<10;i++)calibrator.observe(hand({pauseRatio:.1,palmPixels:4}),i*10,IMAGE.width,IMAGE.height);
  assert.equal(calibrator.samples.pauseContact.length,0);
});

test("observe reports remaining time and stops collecting after one second",()=>{
  const calibrator=new Calibrator();
  calibrator.begin("pauseContact",0);
  const early=calibrator.observe(hand({pauseRatio:.1}),100,IMAGE.width,IMAGE.height);
  assert.equal(early.collecting,true);
  assert.equal(early.remaining,SAMPLE_MS-100);
  const late=calibrator.observe(hand({pauseRatio:.1}),SAMPLE_MS+1,IMAGE.width,IMAGE.height);
  assert.equal(late.collecting,false);
  assert.equal(calibrator.observe(hand({pauseRatio:.1}),SAMPLE_MS+50,IMAGE.width,IMAGE.height).collecting,false);
});

test("an unknown phase is rejected",()=>{
  assert.throws(()=>new Calibrator().begin("nonsense",0),/Unknown calibration phase/);
});

test("two corners define the input region and swapped corners still work",()=>{
  const calibrator=new Calibrator();
  calibrator.captureCorner({x:.85,y:.8});
  calibrator.captureCorner({x:.15,y:.2});
  const result=calibrator.finish();
  assert.equal(result.regionAccepted,true);
  assert.ok(Math.abs(result.region.x-.15)<1e-9);
  assert.ok(Math.abs(result.region.width-.7)<1e-9);
});

test("corners that are too close keep the full camera area",()=>{
  const calibrator=new Calibrator();
  calibrator.captureCorner({x:.5,y:.5});
  calibrator.captureCorner({x:.55,y:.55});
  const result=calibrator.finish();
  assert.equal(result.regionAccepted,false);
  assert.deepEqual(result.region,{x:0,y:0,width:1,height:1});
});

test("only the last two corners are kept",()=>{
  const calibrator=new Calibrator();
  calibrator.captureCorner({x:0,y:0});
  calibrator.captureCorner({x:.1,y:.1});
  calibrator.captureCorner({x:.9,y:.9});
  assert.deepEqual(calibrator.corners,[{x:.1,y:.1},{x:.9,y:.9}]);
});

test("reset returns to defaults",()=>{
  const calibrator=new Calibrator();
  calibrator.captureCorner({x:0,y:0});
  calibrator.captureCorner({x:1,y:1});
  calibrator.finish();
  const result=calibrator.reset();
  assert.deepEqual(result,defaultCalibration());
  assert.equal(calibrator.corners.length,0);
});
