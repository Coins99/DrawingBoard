import{test}from"node:test";
import assert from"node:assert/strict";
import{classifyStroke,cyclicSimplify,fitCircle,rankCandidates,resample,simplify,strokeFeatures}from"../../DrawingBoard/src/recognition.js";
import{circle,diamond,figureEight,line,rectangle,rotate,scribble,spiral,zigzag}from"../fixtures/strokes.js";

const kindOf=points=>classifyStroke(points)?.kind??null;

test("resample returns evenly spaced points and tolerates duplicates",()=>{
  const points=resample([{x:0,y:0},{x:0,y:0},{x:100,y:0}],11);
  assert.equal(points.length,11);
  assert.equal(points[0].x,0);
  assert.equal(points.at(-1).x,100);
  const gaps=points.slice(1).map((p,i)=>p.x-points[i].x);
  for(const gap of gaps)assert.ok(Math.abs(gap-10)<1e-6);
});

test("resample handles degenerate input without throwing",()=>{
  assert.deepEqual(resample([]),[]);
  assert.deepEqual(resample([{x:1,y:1}]),[{x:1,y:1}]);
  assert.equal(resample([{x:1,y:1},{x:1,y:1}]).length,1);
});

test("strokeFeatures rejects strokes that are too small or too short",()=>{
  assert.equal(strokeFeatures([]),null);
  assert.equal(strokeFeatures([{x:0,y:0},{x:1,y:0}]),null);
  assert.equal(strokeFeatures(circle({r:5})),null);
  assert.ok(strokeFeatures(circle({r:80})));
});

test("simplify keeps corners and drops collinear points",()=>{
  const points=[{x:0,y:0},{x:25,y:0},{x:50,y:0},{x:50,y:50}];
  assert.deepEqual(simplify(points,1),[{x:0,y:0},{x:50,y:0},{x:50,y:50}]);
});

test("cyclicSimplify finds four corners regardless of where the stroke starts",()=>{
  const outline=rectangle({width:180,height:120});
  const points=resample(outline);
  const shifted=resample([...outline.slice(20),...outline.slice(0,20)]);
  assert.equal(cyclicSimplify(points,Math.hypot(180,120)*.04).length,4);
  assert.equal(cyclicSimplify(shifted,Math.hypot(180,120)*.04).length,4);
});

test("fitCircle recovers a known circle and guards against a singular system",()=>{
  const fit=fitCircle(resample(circle({cx:150,cy:220,r:60})));
  assert.ok(Math.abs(fit.cx-150)<1);
  assert.ok(Math.abs(fit.cy-220)<1);
  assert.ok(Math.abs(fit.radius-60)<1);
  assert.ok(fit.radialRms<.01);
  assert.equal(fitCircle(resample(line({from:{x:0,y:0},to:{x:100,y:0}}))),null);
});

test("clean shapes classify correctly",()=>{
  assert.equal(kindOf(circle({r:80})),"circle");
  assert.equal(kindOf(rectangle({width:180,height:110})),"rectangle");
  assert.equal(kindOf(diamond({width:180,height:130})),"diamond");
});

test("noisy shapes still classify correctly",()=>{
  assert.equal(kindOf(circle({r:80,noise:4,seed:91})),"circle");
  assert.equal(kindOf(rectangle({width:180,height:110,noise:3,seed:92})),"rectangle");
  assert.equal(kindOf(diamond({width:180,height:130,noise:3,seed:93})),"diamond");
});

test("a stretched rhombus is still a diamond",()=>{
  assert.equal(kindOf(diamond({width:240,height:100})),"diamond");
  assert.equal(kindOf(diamond({width:100,height:240})),"diamond");
});

test("a partial arc is not a circle",()=>{
  assert.equal(kindOf(circle({sweep:190})),null);
  assert.equal(kindOf(circle({sweep:270})),null);
});

test("spirals, figure-eights, zigzags and scribbles stay unknown",()=>{
  assert.equal(kindOf(spiral()),null);
  assert.equal(kindOf(figureEight()),null);
  assert.equal(kindOf(zigzag()),null);
  assert.equal(kindOf(scribble()),null);
});

test("a straight line is not a shape",()=>{
  assert.equal(kindOf(line({from:{x:0,y:0},to:{x:300,y:0}})),null);
  assert.equal(kindOf(line({from:{x:0,y:0},to:{x:200,y:200}})),null);
});

test("a rectangle rotated off-axis stays unknown",()=>{
  // Between roughly 15 and 35 degrees the sides are neither axis-aligned nor at
  // the bounding-box extremes, so neither quadrilateral gate accepts it.
  for(const degrees of[20,25,30,35])
    assert.equal(kindOf(rotate(rectangle({width:180,height:110}),degrees)),null,`${degrees} degrees`);
  assert.equal(kindOf(rotate(rectangle({width:200,height:90}),52)),null);
});

test("a rectangle rotated near 45 degrees is reported as a diamond",()=>{
  // Its corners genuinely sit at the bounding-box extremes, which is what the
  // diamond gate describes. Accept or reject is left to the user.
  assert.equal(kindOf(rotate(rectangle({width:180,height:110}),45)),"diamond");
});

test("a very oblong closed loop is not a circle",()=>{
  assert.notEqual(kindOf(circle({r:90,squash:.35})),"circle");
});

test("candidate scores stay inside the unit range and rank highest first",()=>{
  const ranked=rankCandidates(diamond({width:170,height:150}));
  assert.ok(ranked.length>=1);
  for(const candidate of ranked){
    assert.ok(candidate.score>=0&&candidate.score<=1,`score ${candidate.score} out of range`);
  }
  for(let i=1;i<ranked.length;i++)assert.ok(ranked[i-1].score>=ranked[i].score);
});

test("a near-square diamond reports the rectangle alternative as ambiguous",()=>{
  const ranked=rankCandidates(diamond({width:150,height:150}));
  const kinds=ranked.map(c=>c.kind);
  assert.ok(kinds.includes("diamond"));
  const result=classifyStroke(diamond({width:150,height:150}),{minMargin:1});
  assert.equal(result.ambiguous,kinds.length>1);
});

test("the returned bounds match the recognized geometry",()=>{
  const result=classifyStroke(circle({cx:200,cy:150,r:70}));
  assert.equal(result.kind,"circle");
  assert.equal(Math.round(result.bounds.width),Math.round(result.bounds.height));
  assert.ok(Math.abs(result.bounds.x+result.bounds.width/2-200)<2);
  assert.ok(Math.abs(result.bounds.y+result.bounds.height/2-150)<2);
});

test("raising the minimum score rejects marginal input",()=>{
  const noisy=rectangle({width:180,height:110,noise:5,seed:94});
  assert.equal(classifyStroke(noisy,{minScore:0}) ?.kind,"rectangle");
  assert.equal(classifyStroke(noisy,{minScore:.99}),null);
});
