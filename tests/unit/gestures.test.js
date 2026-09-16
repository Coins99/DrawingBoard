import{test}from"node:test";
import assert from"node:assert/strict";
import{DWELL_MS,GestureController,LOSS_GAP_MS,STABLE_MS,STALL_MS,STATES}from"../../DrawingBoard/src/gestures.js";
import{CONFIG,emptyFrame,frame,recorder}from"../fixtures/landmarks.js";

// pauseRatio below 0.25 means thumb and pinky are touching, which lifts the pen.
const PEN_UP={pauseRatio:.15},PEN_DOWN={pauseRatio:.9};
const PINCH_CLOSED={pinchRatio:.15},PINCH_OPEN={pinchRatio:.9};

// Feeds one landmark state for long enough that the hysteresis latch settles.
function hold(controller,options,{from=0,frames=6,step=STABLE_MS/2,config=CONFIG}={}){
  let time=from;
  for(let i=0;i<frames;i++){
    time+=step;
    controller.update(frame(options),time,{...CONFIG,...config});
  }
  return time;
}

function armedDrawing(target=null){
  const log=recorder(target);
  const controller=new GestureController(log.actions);
  return{log,controller};
}

test("a hand appearing with the pen down does not start a stroke on its own",()=>{
  const{log,controller}=armedDrawing();
  hold(controller,{...PEN_DOWN,...PINCH_OPEN});
  assert.equal(log.of("begin").length,0);
  assert.equal(controller.state,STATES.pointing);
});

test("an explicit pen-up then pen-down starts exactly one stroke",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,{...PEN_UP,...PINCH_OPEN});
  time=hold(controller,{...PEN_DOWN,...PINCH_OPEN},{from:time});
  assert.equal(log.of("begin").length,1);
  assert.ok(log.of("move").length>0);
  assert.equal(controller.state,STATES.drawing);
});

test("touching thumb to pinky ends the stroke once",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  time=hold(controller,PEN_UP,{from:time});
  const ends=log.of("end");
  assert.equal(ends.length,1);
  assert.equal(ends[0].args[0],"penUp");
  assert.equal(controller.state,STATES.pointing);
});

test("jitter around the threshold does not toggle the pen",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  const beforeEnds=log.of("end").length;
  // Alternate across the boundary faster than the stable window.
  for(let i=0;i<20;i++){
    time+=10;
    controller.update(frame({pauseRatio:i%2?.24:.26}),time,CONFIG);
  }
  assert.equal(log.of("end").length,beforeEnds);
  assert.equal(controller.state,STATES.drawing);
});

test("hysteresis needs a clear release, not a brush past the enter threshold",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  // 0.3 is above the enter threshold but below the release threshold.
  time=hold(controller,{pauseRatio:.3},{from:time});
  assert.equal(log.of("end").length,0);
});

test("losing the hand ends the stroke immediately",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  controller.update(emptyFrame(),time+50,CONFIG);
  const ends=log.of("end");
  assert.equal(ends.length,1);
  assert.equal(ends[0].args[0],"noHand");
  assert.equal(controller.state,STATES.idle);
});

test("reacquisition after loss requires a fresh pen-up before drawing again",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  controller.update(emptyFrame(),time+50,CONFIG);
  time+=50;
  // The hand returns far away and still pen-down: no new stroke may start.
  time=hold(controller,{...PEN_DOWN,index:{x:.9,y:.1}},{from:time});
  assert.equal(log.of("begin").length,1);
  time=hold(controller,PEN_UP,{from:time});
  time=hold(controller,PEN_DOWN,{from:time});
  assert.equal(log.of("begin").length,2);
});

test("a frame gap longer than the loss window breaks the stroke",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  controller.update(frame(PEN_DOWN),time+LOSS_GAP_MS+10,CONFIG);
  const ends=log.of("end");
  assert.equal(ends.length,1);
  assert.equal(ends[0].args[0],"gap");
});

test("out-of-order frames are ignored",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  const movesBefore=log.of("move").length;
  controller.update(frame({...PEN_DOWN,index:{x:.1,y:.1}}),time-30,CONFIG);
  controller.update(frame({...PEN_DOWN,index:{x:.1,y:.1}}),time,CONFIG);
  assert.equal(log.of("move").length,movesBefore);
  assert.equal(log.of("end").length,0);
});

test("irregular frame spacing inside the window still advances the stroke",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  for(const step of[7,120,13,200,5]){
    time+=step;
    controller.update(frame(PEN_DOWN),time,CONFIG);
  }
  assert.equal(log.of("end").length,0);
  assert.equal(controller.state,STATES.drawing);
});

test("a palm too small to measure reports unavailable and ends the stroke",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  controller.update(frame({...PEN_DOWN,palmPixels:8}),time+20,CONFIG);
  assert.equal(log.of("end").length,1);
  assert.equal(log.of("end")[0].args[0],"palmInvalid");
  assert.equal(controller.state,STATES.unavailable);
  assert.equal(log.of("state").at(-1).args[0],STATES.unavailable);
});

test("the watchdog ends a stroke when frames stop arriving",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  assert.equal(controller.checkStall(time+STALL_MS-1),false);
  assert.equal(controller.checkStall(time+STALL_MS+1),true);
  assert.equal(log.of("end")[0].args[0],"stalled");
  assert.equal(controller.state,STATES.idle);
});

test("disarming ends the stroke and blocks new ones",()=>{
  const{log,controller}=armedDrawing();
  let time=hold(controller,PEN_UP);
  time=hold(controller,PEN_DOWN,{from:time});
  time=hold(controller,PEN_DOWN,{from:time,config:{armed:false}});
  assert.equal(log.of("end")[0].args[0],"disarmed");
  const begins=log.of("begin").length;
  time=hold(controller,PEN_DOWN,{from:time,config:{armed:false}});
  assert.equal(log.of("begin").length,begins);
});

test("leaving a calibrated input region ends the stroke instead of clamping",()=>{
  const{log,controller}=armedDrawing();
  const region={x:.3,y:.3,width:.4,height:.4};
  const config={calibration:{region}};
  let time=hold(controller,{...PEN_UP,index:{x:.5,y:.5}},{config});
  time=hold(controller,{...PEN_DOWN,index:{x:.5,y:.5}},{from:time,config});
  assert.equal(controller.state,STATES.drawing);
  time+=50;
  controller.update(frame({...PEN_DOWN,index:{x:.05,y:.5}}),time,{...CONFIG,...config});
  assert.equal(log.of("end")[0].args[0],"outOfRegion");
  assert.equal(log.of("cursor").at(-1).args[2],false);
});

test("calibration frames are forwarded and no editing happens",()=>{
  const{log,controller}=armedDrawing();
  hold(controller,PEN_DOWN,{config:{calibrating:true}});
  assert.ok(log.of("calibrationFrame").length>0);
  assert.equal(log.of("begin").length,0);
  assert.equal(log.of("move").length,0);
});

test("custom calibration thresholds replace the defaults",()=>{
  const{log,controller}=armedDrawing();
  const calibration={pause:{enter:.6,release:.8}};
  // 0.7 is pen-down with defaults but pen-up under this calibration.
  hold(controller,{pauseRatio:.5},{config:{calibration}});
  const time=hold(controller,{pauseRatio:.9},{from:400,config:{calibration}});
  assert.equal(log.of("begin").length,1);
  assert.ok(time>0);
});

test("select mode fires dwell once and resets when the hand moves away",()=>{
  const log=recorder({type:"node",id:"n1"});
  const controller=new GestureController(log.actions);
  const config={tool:"select",...PINCH_OPEN};
  let time=0;
  for(let i=0;i<20;i++){time+=60;controller.update(frame({index:{x:.5,y:.5},...PINCH_OPEN}),time,{...CONFIG,tool:"select"})}
  assert.equal(log.of("select").length,1,"dwell should select exactly once");
  assert.ok(time>=DWELL_MS);
  // A large move restarts the dwell timer, so it can fire again later.
  for(let i=0;i<20;i++){time+=60;controller.update(frame({index:{x:.2,y:.2},...PINCH_OPEN}),time,{...CONFIG,tool:"select"})}
  assert.equal(log.of("select").length,2);
  assert.ok(config);
});

test("a pinch already closed on acquisition cannot start a drag",()=>{
  const log=recorder({type:"node",id:"n1"});
  const controller=new GestureController(log.actions);
  hold(controller,PINCH_CLOSED,{config:{tool:"select"}});
  assert.equal(log.of("dragBegin").length,0);
});

test("opening then pinching starts a drag, and releasing ends it",()=>{
  const log=recorder({type:"node",id:"n1"});
  const controller=new GestureController(log.actions);
  const config={tool:"select"};
  let time=hold(controller,PINCH_OPEN,{config});
  time=hold(controller,PINCH_CLOSED,{from:time,config});
  assert.equal(log.of("dragBegin").length,1);
  assert.ok(log.of("dragMove").length>0);
  time=hold(controller,PINCH_OPEN,{from:time,config});
  assert.equal(log.of("dragEnd").length,1);
  assert.equal(controller.state,STATES.pointing);
});

test("losing the hand during a drag cancels it rather than committing",()=>{
  const log=recorder({type:"node",id:"n1"});
  const controller=new GestureController(log.actions);
  const config={tool:"select"};
  let time=hold(controller,PINCH_OPEN,{config});
  time=hold(controller,PINCH_CLOSED,{from:time,config});
  controller.update(emptyFrame(),time+40,{...CONFIG,...config});
  assert.equal(log.of("cancel").length,1);
  assert.equal(log.of("dragEnd").length,0);
  assert.equal(controller.state,STATES.idle);
});

test("a drag does not resume by itself after the pinch reopens and closes once",()=>{
  const log=recorder({type:"node",id:"n1"});
  const controller=new GestureController(log.actions);
  const config={tool:"select"};
  let time=hold(controller,PINCH_OPEN,{config});
  time=hold(controller,PINCH_CLOSED,{from:time,config});
  time=hold(controller,PINCH_OPEN,{from:time,config});
  time=hold(controller,PINCH_CLOSED,{from:time,config});
  assert.equal(log.of("dragBegin").length,2);
  assert.equal(log.of("dragEnd").length,1);
});

test("an empty stage size is reported without crashing",()=>{
  const{log,controller}=armedDrawing();
  controller.update(frame(PEN_DOWN),16,{...CONFIG,stageWidth:0,stageHeight:0});
  assert.equal(log.of("cursor").length,0);
  assert.equal(log.of("begin").length,0);
});

test("a short hand landmark list counts as no hand",()=>{
  const{log,controller}=armedDrawing();
  controller.update({multiHandLandmarks:[[{x:.5,y:.5,z:0}]]},16,CONFIG);
  assert.equal(log.of("cursor").length,0);
  assert.equal(log.of("state").at(-1).args[0],STATES.idle);
});
