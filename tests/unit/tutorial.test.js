import{test}from"node:test";
import assert from"node:assert/strict";
import{TUTORIAL_STEPS,Tutorial}from"../../DrawingBoard/src/tutorial.js";
import{midpointOf}from"../../DrawingBoard/src/render.js";

test("a fresh tutorial is inactive and exposes no step",()=>{
  const tutorial=new Tutorial();
  assert.equal(tutorial.active,false);
  assert.equal(tutorial.current,null);
  assert.equal(tutorial.report("draw"),false);
});

test("start exposes the first step and progress counts",()=>{
  const tutorial=new Tutorial();
  const step=tutorial.start();
  assert.equal(step.id,TUTORIAL_STEPS[0].id);
  assert.deepEqual(tutorial.progress,{index:0,total:TUTORIAL_STEPS.length,done:false});
});

test("only the current step's event advances the walkthrough",()=>{
  const tutorial=new Tutorial([
    {id:"one",title:"One",hint:"",event:"a"},
    {id:"two",title:"Two",hint:"",event:"b"},
  ]);
  tutorial.start();
  assert.equal(tutorial.report("b"),false);
  assert.equal(tutorial.current.id,"one");
  assert.equal(tutorial.report("a"),true);
  assert.equal(tutorial.current.id,"two");
});

test("finishing the last step ends the tutorial",()=>{
  const tutorial=new Tutorial([{id:"only",title:"Only",hint:"",event:"a"}]);
  tutorial.start();
  assert.equal(tutorial.report("a"),true);
  assert.equal(tutorial.active,false);
  assert.equal(tutorial.current,null);
  assert.equal(tutorial.progress.done,true);
  assert.ok(tutorial.completed.has("only"));
});

test("skip works only on skippable steps",()=>{
  const tutorial=new Tutorial([
    {id:"one",title:"One",hint:"",event:"a",skippable:true},
    {id:"two",title:"Two",hint:"",event:"b"},
  ]);
  tutorial.start();
  assert.equal(tutorial.skip(),true);
  assert.equal(tutorial.current.id,"two");
  assert.equal(tutorial.skip(),false);
  assert.equal(tutorial.current.id,"two");
});

test("stop clears the current step and start resets progress",()=>{
  const tutorial=new Tutorial();
  tutorial.start();
  tutorial.report(TUTORIAL_STEPS[0].event);
  tutorial.stop();
  assert.equal(tutorial.current,null);
  tutorial.start();
  assert.equal(tutorial.current.id,TUTORIAL_STEPS[0].id);
  assert.equal(tutorial.completed.size,0);
});

test("the shipped steps cover the release demo in order",()=>{
  const ids=TUTORIAL_STEPS.map(step=>step.id);
  assert.deepEqual(ids,["camera","calibrate","draw","lift","accept","connect","select","drag","export"]);
  for(const step of TUTORIAL_STEPS){
    assert.equal(typeof step.title,"string");
    assert.ok(step.hint.length>0,`${step.id} needs a hint`);
    assert.ok(step.event.length>0,`${step.id} needs an event`);
  }
});

test("midpointOf finds the halfway point along a polyline",()=>{
  assert.deepEqual(midpointOf([{x:0,y:0},{x:100,y:0}]),{x:50,y:0});
  assert.deepEqual(midpointOf([{x:0,y:0},{x:100,y:0},{x:100,y:100}]),{x:100,y:0});
  assert.deepEqual(midpointOf([{x:5,y:5},{x:5,y:5}]),{x:5,y:5});
});
