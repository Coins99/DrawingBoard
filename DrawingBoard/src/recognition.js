// Pure single-stroke shape recognition. Scores are normalized heuristic residual
// quality in [0,1]; they are not probabilities or confidence values.
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const bounds=pts=>{const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y}};
export const pathLength=pts=>{let n=0;for(let i=1;i<pts.length;i++)n+=dist(pts[i-1],pts[i]);return n};

// Tolerances. A residual equal to its tolerance is the rejection boundary and scores 0.
export const TOLERANCE={circleRadialRms:.12,circleGapDegrees:60,closure:.22,quadEdgeRms:.06,rectangleAngle:20,rectangleAxis:18,diamondExtreme:.14,diamondMidpoint:.1};
export const MIN_SCORE=.34,MIN_MARGIN=.06;

export function resample(points,count=64){
  const source=points.filter((p,i)=>!i||dist(p,points[i-1])>.001);
  if(source.length<2)return source;
  const lengths=[0];for(let i=1;i<source.length;i++)lengths[i]=lengths[i-1]+dist(source[i-1],source[i]);
  const total=lengths.at(-1);if(!total)return[source[0]];
  const out=[];let j=1;
  for(let i=0;i<count;i++){const target=total*i/(count-1);while(j<lengths.length-1&&lengths[j]<target)j++;const a=source[j-1],b=source[j],span=lengths[j]-lengths[j-1],t=span?(target-lengths[j-1])/span:0;out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})}
  return out;
}

// Ramer-Douglas-Peucker on an open polyline.
export function simplify(points,epsilon){
  if(points.length<3)return points.slice();
  const a=points[0],z=points.at(-1),dx=z.x-a.x,dy=z.y-a.y,span=Math.hypot(dx,dy);
  let max=-1,index=0;
  for(let i=1;i<points.length-1;i++){const d=span?Math.abs(dy*points[i].x-dx*points[i].y+z.x*a.y-z.y*a.x)/span:dist(points[i],a);if(d>max){max=d;index=i}}
  if(max>epsilon){const left=simplify(points.slice(0,index+1),epsilon),right=simplify(points.slice(index),epsilon);return left.slice(0,-1).concat(right)}
  return[a,z];
}

// Closed-stroke simplification with a rotation-stable seam at the farthest point pair.
export function cyclicSimplify(points,epsilon){
  if(points.length<4)return points.slice();
  let seamA=0,seamB=0,best=-1;
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){const d=dist(points[i],points[j]);if(d>best){best=d;seamA=i;seamB=j}}
  const wrap=(from,to)=>{const out=[];for(let i=from;;i=(i+1)%points.length){out.push(points[i]);if(i===to)break}return out};
  const first=simplify(wrap(seamA,seamB),epsilon),second=simplify(wrap(seamB,seamA),epsilon);
  const merged=first.concat(second.slice(1,-1));
  const unique=merged.filter((p,i)=>i===0||dist(p,merged[i-1])>epsilon/2);
  if(unique.length>1&&dist(unique[0],unique.at(-1))<=epsilon)unique.pop();
  return unique;
}

// Kasa least-squares circle fit with a singular-system guard.
export function fitCircle(pts){
  const n=pts.length;if(n<3)return null;
  let sx=0,sy=0,sxx=0,syy=0,sxy=0,sxz=0,syz=0,sz=0;
  for(const p of pts){const z=p.x*p.x+p.y*p.y;sx+=p.x;sy+=p.y;sxx+=p.x*p.x;syy+=p.y*p.y;sxy+=p.x*p.y;sxz+=p.x*z;syz+=p.y*z;sz+=z}
  const a11=2*(sxx-sx*sx/n),a12=2*(sxy-sx*sy/n),a22=2*(syy-sy*sy/n);
  const b1=sxz-sx*sz/n,b2=syz-sy*sz/n,det=a11*a22-a12*a12;
  const scale=Math.max(Math.abs(a11),Math.abs(a22),1e-9);
  if(!Number.isFinite(det)||Math.abs(det)<1e-6*scale*scale)return null;
  const cx=(b1*a22-b2*a12)/det,cy=(b2*a11-b1*a12)/det;
  const radii=pts.map(p=>dist(p,{x:cx,y:cy})),radius=radii.reduce((s,v)=>s+v,0)/radii.length;
  if(!(radius>0))return null;
  return{cx,cy,radius,radialRms:Math.sqrt(radii.reduce((s,v)=>s+(v-radius)**2,0)/radii.length)/radius};
}

export const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y;if(!dx&&!dy)return dist(p,a);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy))};
export const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
const quality=(residual,tolerance)=>Math.max(0,Math.min(1,1-residual/tolerance));
const cornerAngle=(prev,here,next)=>{const a=Math.atan2(prev.y-here.y,prev.x-here.x),b=Math.atan2(next.y-here.y,next.x-here.x);let d=Math.abs(a-b);if(d>Math.PI)d=Math.PI*2-d;return d*180/Math.PI};
const axisOffset=(a,b)=>{const deg=Math.abs(Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI)%90;return Math.min(deg,90-deg)};

export function strokeFeatures(raw){
  if(!Array.isArray(raw)||raw.length<2)return null;
  const pts=resample(raw);if(pts.length<16)return null;
  const box=bounds(pts),diagonal=Math.hypot(box.width,box.height);
  if(!(diagonal>=20))return null;
  return{points:pts,bounds:box,diagonal,closure:dist(pts[0],pts.at(-1))/diagonal,ratio:box.height>0?box.width/box.height:Infinity,length:pathLength(pts)};
}

function circleCandidate(f){
  if(f.closure>TOLERANCE.closure)return null;
  const fit=fitCircle(f.points);if(!fit)return null;
  if(fit.radialRms>TOLERANCE.circleRadialRms)return null;
  if(!(f.ratio>=.75&&f.ratio<=1.334))return null;
  const angles=f.points.map(p=>Math.atan2(p.y-fit.cy,p.x-fit.cx)).sort((a,b)=>a-b);
  let gap=angles[0]+Math.PI*2-angles.at(-1);
  for(let i=1;i<angles.length;i++)gap=Math.max(gap,angles[i]-angles[i-1]);
  const gapDegrees=gap*180/Math.PI;
  if(gapDegrees>TOLERANCE.circleGapDegrees)return null;
  // Reject figure-eights and doubled-back arcs: traversal must keep one direction.
  let forward=0,backward=0;
  for(let i=1;i<f.points.length;i++){
    const a=Math.atan2(f.points[i-1].y-fit.cy,f.points[i-1].x-fit.cx),b=Math.atan2(f.points[i].y-fit.cy,f.points[i].x-fit.cx);
    let d=b-a;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;
    if(d>0)forward+=d;else backward-=d;
  }
  const total=forward+backward;if(!(total>0))return null;
  const consistency=Math.max(forward,backward)/total;
  if(consistency<.85)return null;
  const size=fit.radius*2;
  const score=.55*quality(fit.radialRms,TOLERANCE.circleRadialRms)+.25*quality(gapDegrees,TOLERANCE.circleGapDegrees)+.2*quality(f.closure,TOLERANCE.closure);
  return{kind:"circle",score,bounds:{x:fit.cx-size/2,y:fit.cy-size/2,width:size,height:size},detail:{radialRms:fit.radialRms,gapDegrees,consistency}};
}

function quadCandidates(f){
  if(f.closure>TOLERANCE.closure)return null;
  const corners=cyclicSimplify(f.points,f.diagonal*.04);
  if(corners.length!==4)return null;
  const signs=corners.map((c,i)=>Math.sign(cross(corners[(i+3)%4],c,corners[(i+1)%4])));
  if(!signs.every(s=>s===signs[0]&&s!==0))return null;
  let sum=0;
  for(const p of f.points){let near=Infinity;for(let i=0;i<4;i++)near=Math.min(near,segmentDistance(p,corners[i],corners[(i+1)%4]));sum+=near*near}
  const edgeRms=Math.sqrt(sum/f.points.length)/f.diagonal;
  if(edgeRms>TOLERANCE.quadEdgeRms)return null;
  const base=.5*quality(edgeRms,TOLERANCE.quadEdgeRms),out=[];
  const worstAngle=Math.max(...corners.map((c,i)=>Math.abs(cornerAngle(corners[(i+3)%4],c,corners[(i+1)%4])-90)));
  const axis=Math.max(...corners.map((c,i)=>axisOffset(c,corners[(i+1)%4])));
  if(worstAngle<=TOLERANCE.rectangleAngle&&axis<=TOLERANCE.rectangleAxis)
    out.push({kind:"rectangle",score:base+.3*quality(worstAngle,TOLERANCE.rectangleAngle)+.2*quality(axis,TOLERANCE.rectangleAxis),bounds:{...f.bounds},detail:{edgeRms,worstAngle,axis}});
  const b=f.bounds,extremes=[{x:b.x+b.width/2,y:b.y},{x:b.x+b.width,y:b.y+b.height/2},{x:b.x+b.width/2,y:b.y+b.height},{x:b.x,y:b.y+b.height/2}];
  const used=new Set();let worstExtreme=0;
  for(const extreme of extremes){
    let bestIndex=-1,bestDistance=Infinity;
    corners.forEach((c,i)=>{if(used.has(i))return;const d=dist(c,extreme)/f.diagonal;if(d<bestDistance){bestDistance=d;bestIndex=i}});
    if(bestIndex<0){worstExtreme=Infinity;break}
    used.add(bestIndex);worstExtreme=Math.max(worstExtreme,bestDistance);
  }
  const mid=(p,q)=>({x:(p.x+q.x)/2,y:(p.y+q.y)/2});
  const midOffset=dist(mid(corners[0],corners[2]),mid(corners[1],corners[3]))/f.diagonal;
  if(worstExtreme<=TOLERANCE.diamondExtreme&&midOffset<=TOLERANCE.diamondMidpoint)
    out.push({kind:"diamond",score:base+.3*quality(worstExtreme,TOLERANCE.diamondExtreme)+.2*quality(midOffset,TOLERANCE.diamondMidpoint),bounds:{...f.bounds},detail:{edgeRms,worstExtreme,midOffset}});
  return out.length?out:null;
}

// Ranked candidates, best first. An empty array means the stroke stays freehand.
export function rankCandidates(raw){
  const f=strokeFeatures(raw);if(!f)return[];
  const out=[];
  const circle=circleCandidate(f);if(circle)out.push(circle);
  const quads=quadCandidates(f);if(quads)out.push(...quads);
  return out.sort((a,b)=>b.score-a.score);
}

// Best proposal, or null when nothing clears the score gate.
export function classifyStroke(raw,{minScore=MIN_SCORE,minMargin=MIN_MARGIN}={}){
  const ranked=rankCandidates(raw);
  if(!ranked.length||ranked[0].score<minScore)return null;
  const alternatives=ranked.slice(1).filter(c=>ranked[0].score-c.score<minMargin);
  return{...ranked[0],alternatives,ambiguous:alternatives.length>0};
}
