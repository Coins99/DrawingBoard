// Two-stroke arrow recognition: a straight shaft drawn tail to tip, then a
// V-shaped head whose middle vertex sits at the tip. Any other arrow style stays
// freehand; the connector tool remains the fallback.
import{dist,pathLength,resample,simplify}from"./recognition.js";

export const PAIR_WINDOW_MS=800;
export const ARROW_TOLERANCE={shaftResidual:.05,headVertex:.15,armMin:.1,armMax:.5,armBalance:.6,behind:0};

const lineResidual=pts=>{
  const a=pts[0],z=pts.at(-1),dx=z.x-a.x,dy=z.y-a.y,span=Math.hypot(dx,dy);
  if(!span)return{span:0,rms:Infinity};
  let sum=0;
  for(const p of pts){const d=Math.abs(dy*p.x-dx*p.y+z.x*a.y-z.y*a.x)/span;sum+=d*d}
  return{span,rms:Math.sqrt(sum/pts.length)/span};
};

const quality=(residual,tolerance)=>Math.max(0,Math.min(1,1-residual/tolerance));

// True when two consecutive strokes are eligible to form one arrow.
export function canPair(shaft,head){
  if(!shaft||!head)return false;
  if(shaft.epoch!==head.epoch||shaft.source!==head.source)return false;
  if(!Number.isFinite(shaft.endedAt)||!Number.isFinite(head.startedAt))return false;
  const gap=head.startedAt-shaft.endedAt;
  return gap>=0&&gap<=PAIR_WINDOW_MS;
}

// Geometry-only pairing. Returns an arrow proposal or null.
export function recognizeArrow(shaftPoints,headPoints){
  if(!Array.isArray(shaftPoints)||!Array.isArray(headPoints))return null;
  const shaft=resample(shaftPoints,48);
  if(shaft.length<8)return null;
  const line=lineResidual(shaft);
  if(!(line.span>=24)||line.rms>ARROW_TOLERANCE.shaftResidual)return null;
  // The shaft must be a line, not a line traced back over itself.
  if(pathLength(shaft)/line.span>1.3)return null;

  const head=resample(headPoints,48);
  if(head.length<5)return null;
  const headLength=pathLength(head);
  if(!(headLength>0))return null;
  let vertices=simplify(head,headLength*.08);
  if(vertices.length>3){
    // Collapse shallow extra corners before rejecting the head outright.
    vertices=simplify(head,headLength*.16);
  }
  if(vertices.length!==3)return null;
  const[armA,middle,armB]=vertices;

  // The tip is whichever shaft end the head vertex meets; drawing order breaks ties.
  const first=shaft[0],last=shaft.at(-1);
  const tip=dist(middle,last)<=dist(middle,first)?last:first;
  const tail=tip===last?first:last;
  const vertexOffset=dist(middle,tip)/line.span;
  if(vertexOffset>ARROW_TOLERANCE.headVertex)return null;

  const armALength=dist(armA,middle)/line.span,armBLength=dist(armB,middle)/line.span;
  if(armALength<ARROW_TOLERANCE.armMin||armBLength<ARROW_TOLERANCE.armMin)return null;
  if(armALength>ARROW_TOLERANCE.armMax||armBLength>ARROW_TOLERANCE.armMax)return null;

  const ux=(tip.x-tail.x)/line.span,uy=(tip.y-tail.y)/line.span;
  const along=p=>((p.x-tip.x)*ux+(p.y-tip.y)*uy)/line.span;
  const across=p=>((p.x-tip.x)*-uy+(p.y-tip.y)*ux)/line.span;
  // Both arms point back down the shaft, one on each side of it.
  if(along(armA)>ARROW_TOLERANCE.behind||along(armB)>ARROW_TOLERANCE.behind)return null;
  if(Math.sign(across(armA))===Math.sign(across(armB)))return null;
  if(!across(armA)||!across(armB))return null;

  const balance=Math.abs(armALength-armBLength)/Math.max(armALength,armBLength);
  if(balance>ARROW_TOLERANCE.armBalance)return null;

  const score=.45*quality(line.rms,ARROW_TOLERANCE.shaftResidual)
    +.35*quality(vertexOffset,ARROW_TOLERANCE.headVertex)
    +.2*quality(balance,ARROW_TOLERANCE.armBalance);
  return{kind:"arrow",score,from:{x:tail.x,y:tail.y},to:{x:tip.x,y:tip.y},detail:{shaftRms:line.rms,vertexOffset,armALength,armBLength,balance}};
}

// Full check used by the editor: timing plus geometry.
export function pairArrow(shaft,head){
  if(!canPair(shaft,head))return null;
  const arrow=recognizeArrow(shaft.points,head.points);
  return arrow?{...arrow,sourceIds:[shaft.id,head.id]}:null;
}
