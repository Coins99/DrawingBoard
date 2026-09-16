import{test}from"node:test";
import assert from"node:assert/strict";
import{PAIR_WINDOW_MS,canPair,pairArrow,recognizeArrow}from"../../DrawingBoard/src/arrow.js";
import{arrowHead,circle,line,rectangle,zigzag}from"../fixtures/strokes.js";

const shaftFrom={x:80,y:200},tip={x:320,y:200};
const shaft=(options={})=>line({from:shaftFrom,to:tip,...options});
const head=(options={})=>arrowHead({tip,shaftFrom,...options});

const stroke=(id,points,timing)=>({id,points,epoch:1,source:"pointer",...timing});

test("a clean two-stroke arrow is recognized with endpoints in drawing order",()=>{
  const arrow=recognizeArrow(shaft(),head());
  assert.ok(arrow,"expected an arrow");
  assert.equal(arrow.kind,"arrow");
  assert.ok(Math.abs(arrow.from.x-shaftFrom.x)<2);
  assert.ok(Math.abs(arrow.to.x-tip.x)<2);
  assert.ok(arrow.score>0&&arrow.score<=1);
});

test("a noisy arrow is still recognized",()=>{
  assert.ok(recognizeArrow(shaft({noise:3,seed:55}),head({noise:3,seed:56})));
});

test("arrows are recognized in every direction",()=>{
  const cases=[[{x:200,y:80},{x:200,y:320}],[{x:320,y:120},{x:100,y:260}],[{x:300,y:300},{x:120,y:120}]];
  for(const[from,to]of cases){
    const arrow=recognizeArrow(line({from,to}),arrowHead({tip:to,shaftFrom:from}));
    assert.ok(arrow,`${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    assert.ok(Math.hypot(arrow.to.x-to.x,arrow.to.y-to.y)<3);
  }
});

test("the head may be drawn at the start of the shaft",()=>{
  // The tip is taken from where the head sits, not from the drawing direction.
  const reversed=line({from:tip,to:shaftFrom});
  const arrow=recognizeArrow(reversed,head());
  assert.ok(arrow);
  assert.ok(Math.abs(arrow.to.x-tip.x)<3);
  assert.ok(Math.abs(arrow.from.x-shaftFrom.x)<3);
});

test("a curved shaft is rejected",()=>{
  assert.equal(recognizeArrow(circle({sweep:120,r:120}),head()),null);
});

test("a shaft traced back over itself is rejected",()=>{
  const doubled=[...line({from:shaftFrom,to:tip}),...line({from:tip,to:shaftFrom}).slice(1)];
  assert.equal(recognizeArrow(doubled,head()),null);
});

test("a head that is not a V is rejected",()=>{
  assert.equal(recognizeArrow(shaft(),line({from:{x:300,y:180},to:{x:300,y:220}})),null);
  assert.equal(recognizeArrow(shaft(),zigzag({x:280,y:180,width:60,height:30,teeth:5})),null);
});

test("a head far from either shaft end is rejected",()=>{
  const middle={x:200,y:200};
  assert.equal(recognizeArrow(shaft(),arrowHead({tip:middle,shaftFrom})),null);
});

test("a head pointing the wrong way is rejected",()=>{
  // Arms in front of the tip instead of behind it.
  const forward=arrowHead({tip,shaftFrom:{x:560,y:200}});
  assert.equal(recognizeArrow(shaft(),forward),null);
});

test("an oversized or undersized head is rejected",()=>{
  assert.equal(recognizeArrow(shaft(),head({size:10})),null);
  assert.equal(recognizeArrow(shaft(),head({size:200})),null);
});

test("a very short shaft is rejected",()=>{
  const short={x:95,y:200};
  assert.equal(recognizeArrow(line({from:shaftFrom,to:short}),arrowHead({tip:short,shaftFrom,size:6})),null);
});

test("two unrelated strokes are not an arrow",()=>{
  assert.equal(recognizeArrow(rectangle(),circle()),null);
  assert.equal(recognizeArrow(shaft(),circle({cx:320,cy:200,r:40})),null);
});

test("malformed input returns null instead of throwing",()=>{
  assert.equal(recognizeArrow(null,head()),null);
  assert.equal(recognizeArrow(shaft(),[]),null);
  assert.equal(recognizeArrow([],[]),null);
  assert.equal(recognizeArrow([{x:0,y:0},{x:0,y:0}],head()),null);
});

test("pairing needs the same epoch, the same input source and a short gap",()=>{
  const a=stroke("shaft",shaft(),{endedAt:1000});
  assert.equal(canPair(a,stroke("head",head(),{startedAt:1000+PAIR_WINDOW_MS-1})),true);
  assert.equal(canPair(a,stroke("head",head(),{startedAt:1000+PAIR_WINDOW_MS+1})),false);
  assert.equal(canPair(a,stroke("head",head(),{startedAt:900})),false);
  assert.equal(canPair(a,{...stroke("head",head(),{startedAt:1100}),epoch:2}),false);
  assert.equal(canPair(a,{...stroke("head",head(),{startedAt:1100}),source:"gesture"}),false);
  assert.equal(canPair(null,stroke("head",head(),{startedAt:1100})),false);
});

test("pairArrow reports both source stroke ids",()=>{
  const paired=pairArrow(stroke("shaft",shaft(),{endedAt:500}),stroke("head",head(),{startedAt:700}));
  assert.ok(paired);
  assert.deepEqual(paired.sourceIds,["shaft","head"]);
});

test("pairArrow refuses a pair that is out of the timing window",()=>{
  assert.equal(pairArrow(stroke("shaft",shaft(),{endedAt:500}),stroke("head",head(),{startedAt:5000})),null);
});
