#!/usr/bin/env node
// Recognition evaluation. Prints a confusion matrix with counts, per-class
// precision and recall, unknown false-acceptance, known-shape rejection and
// coverage. Run: npm run evaluate  (add --json for machine-readable output)
import{classifyStroke,MIN_MARGIN,MIN_SCORE,TOLERANCE}from"../DrawingBoard/src/recognition.js";
import{recognizeArrow}from"../DrawingBoard/src/arrow.js";
import{CLASSES,DATASET,DATASET_PROVENANCE}from"../tests/fixtures/dataset.js";

const args=process.argv.slice(2);
const asJson=args.includes("--json");
const scoreArg=args.find(a=>a.startsWith("--min-score="));
const minScore=scoreArg?Number(scoreArg.split("=")[1]):MIN_SCORE;

export function predict(strokes,{minScore:limit=minScore}={}){
  if(strokes.length===2){
    const arrow=recognizeArrow(strokes[0],strokes[1]);
    if(arrow&&arrow.score>=limit)return{kind:"arrow",score:arrow.score};
  }
  const single=strokes.at(-1);
  const candidate=classifyStroke(single,{minScore:limit,minMargin:MIN_MARGIN});
  return candidate?{kind:candidate.kind,score:candidate.score,ambiguous:candidate.ambiguous}:{kind:"unknown",score:0};
}

export function evaluate(dataset=DATASET,options={}){
  const matrix=new Map();
  for(const expected of CLASSES)matrix.set(expected,new Map(CLASSES.map(k=>[k,0])));
  const errors=[];
  for(const item of dataset){
    const prediction=predict(item.strokes,options);
    matrix.get(item.expected).set(prediction.kind,matrix.get(item.expected).get(prediction.kind)+1);
    if(prediction.kind!==item.expected)errors.push({id:item.id,expected:item.expected,got:prediction.kind,score:Number(prediction.score.toFixed(3))});
  }
  const total=dataset.length;
  const perClass=CLASSES.map(name=>{
    const row=matrix.get(name);
    const support=[...row.values()].reduce((a,b)=>a+b,0);
    const truePositive=row.get(name);
    const predicted=CLASSES.reduce((sum,other)=>sum+matrix.get(other).get(name),0);
    return{name,support,truePositive,predicted,
      precision:predicted?truePositive/predicted:null,
      recall:support?truePositive/support:null};
  });
  const known=CLASSES.filter(c=>c!=="unknown");
  const knownSupport=known.reduce((sum,name)=>sum+perClass.find(c=>c.name===name).support,0);
  const knownCorrect=known.reduce((sum,name)=>sum+perClass.find(c=>c.name===name).truePositive,0);
  const knownRejected=known.reduce((sum,name)=>sum+matrix.get(name).get("unknown"),0);
  const unknownRow=matrix.get("unknown");
  const unknownSupport=[...unknownRow.values()].reduce((a,b)=>a+b,0);
  const unknownAccepted=unknownSupport-unknownRow.get("unknown");
  const accepted=knownSupport-knownRejected;
  return{
    total,matrix,perClass,errors,
    metrics:{
      knownSupport,knownCorrect,knownRejected,unknownSupport,unknownAccepted,
      acceptedShapeAccuracy:accepted?knownCorrect/accepted:null,
      knownCoverage:knownSupport?accepted/knownSupport:null,
      unknownFalseAcceptRate:unknownSupport?unknownAccepted/unknownSupport:null,
      knownRejectionRate:knownSupport?knownRejected/knownSupport:null,
    },
  };
}

const percent=value=>value===null?"n/a":`${(value*100).toFixed(1)}%`;

function report(result){
  const width=Math.max(...CLASSES.map(c=>c.length),12)+2;
  const pad=text=>String(text).padEnd(width);
  const lines=[];
  lines.push(`Recognition evaluation — ${result.total} samples, minimum score ${minScore}`);
  lines.push(`Source: ${DATASET_PROVENANCE.source}, ${DATASET_PROVENANCE.participants} participants. ${DATASET_PROVENANCE.caveat}`);
  lines.push("");
  lines.push(`${pad("expected\\got")}${CLASSES.map(pad).join("")}`);
  for(const expected of CLASSES){
    const row=result.matrix.get(expected);
    lines.push(`${pad(expected)}${CLASSES.map(got=>pad(row.get(got))).join("")}`);
  }
  lines.push("");
  lines.push(`${pad("class")}${pad("support")}${pad("precision")}${pad("recall")}`);
  for(const entry of result.perClass)
    lines.push(`${pad(entry.name)}${pad(`${entry.truePositive}/${entry.support}`)}${pad(percent(entry.precision))}${pad(percent(entry.recall))}`);
  const m=result.metrics;
  lines.push("");
  lines.push(`Accepted-shape accuracy   ${percent(m.acceptedShapeAccuracy)}  (${m.knownCorrect}/${m.knownSupport-m.knownRejected})`);
  lines.push(`Known-shape coverage      ${percent(m.knownCoverage)}  (${m.knownSupport-m.knownRejected}/${m.knownSupport})`);
  lines.push(`Known-shape rejection     ${percent(m.knownRejectionRate)}  (${m.knownRejected}/${m.knownSupport})`);
  lines.push(`Unknown false acceptance  ${percent(m.unknownFalseAcceptRate)}  (${m.unknownAccepted}/${m.unknownSupport})`);
  lines.push("");
  lines.push(`Tolerances: ${JSON.stringify(TOLERANCE)}`);
  if(result.errors.length){
    lines.push("");
    lines.push(`Misclassified (${result.errors.length}):`);
    for(const error of result.errors)lines.push(`  ${error.id}: expected ${error.expected}, got ${error.got} (score ${error.score})`);
  }
  return lines.join("\n");
}

if(import.meta.url===`file://${process.argv[1].replace(/\\/g,"/")}`||process.argv[1]?.endsWith("evaluate-recognition.js")){
  const result=evaluate();
  if(asJson){
    const matrix={};
    for(const[expected,row]of result.matrix)matrix[expected]=Object.fromEntries(row);
    console.log(JSON.stringify({provenance:DATASET_PROVENANCE,minScore,total:result.total,matrix,perClass:result.perClass,metrics:result.metrics,errors:result.errors},null,2));
  }else console.log(report(result));
}
