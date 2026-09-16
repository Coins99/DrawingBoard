import{test}from"node:test";
import assert from"node:assert/strict";
import{evaluate,predict}from"../../scripts/evaluate-recognition.js";
import{CLASSES,DATASET}from"../fixtures/dataset.js";

// These gates come from the plan. They are measured on synthetic fixtures, so
// they guard against regressions rather than describing real-world accuracy.
const GATES={acceptedShapeAccuracy:.85,knownCoverage:.7,unknownFalseAcceptRate:.05};

test("the evaluation set covers every class with a usable number of samples",()=>{
  const counts=Object.fromEntries(CLASSES.map(name=>[name,DATASET.filter(item=>item.expected===name).length]));
  for(const name of CLASSES)assert.ok(counts[name]>=10,`${name} has only ${counts[name]} samples`);
  assert.equal(DATASET.length,Object.values(counts).reduce((a,b)=>a+b,0));
});

test("every sample id is unique",()=>{
  const ids=new Set(DATASET.map(item=>item.id));
  assert.equal(ids.size,DATASET.length);
});

test("recognition clears the accuracy, coverage and false-acceptance gates",()=>{
  const{metrics}=evaluate();
  assert.ok(metrics.acceptedShapeAccuracy>=GATES.acceptedShapeAccuracy,`accuracy ${metrics.acceptedShapeAccuracy}`);
  assert.ok(metrics.knownCoverage>=GATES.knownCoverage,`coverage ${metrics.knownCoverage}`);
  assert.ok(metrics.unknownFalseAcceptRate<=GATES.unknownFalseAcceptRate,`unknown false accept ${metrics.unknownFalseAcceptRate}`);
});

test("the confusion matrix accounts for every sample exactly once",()=>{
  const{matrix,total}=evaluate();
  let counted=0;
  for(const row of matrix.values())for(const value of row.values())counted+=value;
  assert.equal(counted,total);
});

test("a stricter score threshold trades coverage without hurting accuracy",()=>{
  const strict=evaluate(DATASET,{minScore:.8});
  assert.ok(strict.metrics.knownCoverage<=evaluate().metrics.knownCoverage);
  assert.ok(strict.metrics.acceptedShapeAccuracy>=GATES.acceptedShapeAccuracy);
});

test("predict falls back to single-stroke classification for an unpaired pair",()=>{
  const circleSample=DATASET.find(item=>item.expected==="circle");
  assert.equal(predict(circleSample.strokes).kind,"circle");
  assert.equal(predict([[{x:0,y:0},{x:1,y:1}]]).kind,"unknown");
});
