// Deterministic synthetic stroke generators. These exercise the classifier's
// decision boundaries; they do not stand in for strokes drawn by real hands.
export function rng(seed=1){
  let state=seed>>>0;
  return()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296};
}

const jitter=(points,amount,random)=>points.map(p=>({...p,x:p.x+(random()-.5)*2*amount,y:p.y+(random()-.5)*2*amount}));
export const withTime=(points,step=12)=>points.map((p,i)=>({x:p.x,y:p.y,t:i*step}));

export function rotate(points,degrees,center){
  const radians=degrees*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
  const cx=center?.x??points.reduce((s,p)=>s+p.x,0)/points.length;
  const cy=center?.y??points.reduce((s,p)=>s+p.y,0)/points.length;
  return points.map(p=>({...p,x:cx+(p.x-cx)*cos-(p.y-cy)*sin,y:cy+(p.x-cx)*sin+(p.y-cy)*cos}));
}

// Walk a closed or open polygon outline at a fixed sample spacing.
export function tracePolygon(vertices,{closed=true,samplesPerEdge=14,noise=0,seed=7}={}){
  const random=rng(seed),points=[];
  const list=closed?[...vertices,vertices[0]]:vertices;
  for(let i=1;i<list.length;i++){
    const a=list[i-1],b=list[i];
    for(let s=0;s<samplesPerEdge;s++){
      const t=s/samplesPerEdge;
      points.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }
  points.push({...list.at(-1)});
  return noise?jitter(points,noise,random):points;
}

export function circle({cx=200,cy=200,r=80,sweep=360,start=0,samples=72,noise=0,seed=11,squash=1}={}){
  const random=rng(seed),points=[];
  for(let i=0;i<=samples;i++){
    const angle=(start+sweep*i/samples)*Math.PI/180;
    points.push({x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r*squash});
  }
  return noise?jitter(points,noise,random):points;
}

export const rectangle=({x=100,y=100,width=180,height=110,noise=0,seed=13,samplesPerEdge=16}={})=>
  tracePolygon([{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}],{noise,seed,samplesPerEdge});

export const diamond=({cx=220,cy=200,width=180,height=130,noise=0,seed=17,samplesPerEdge=16}={})=>
  tracePolygon([{x:cx,y:cy-height/2},{x:cx+width/2,y:cy},{x:cx,y:cy+height/2},{x:cx-width/2,y:cy}],{noise,seed,samplesPerEdge});

export function line({from={x:80,y:200},to={x:300,y:200},samples=40,noise=0,seed=19}={}){
  const random=rng(seed),points=[];
  for(let i=0;i<=samples;i++){const t=i/samples;points.push({x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t})}
  return noise?jitter(points,noise,random):points;
}

// V-shaped arrow head whose middle vertex sits at the tip.
export function arrowHead({tip={x:300,y:200},shaftFrom={x:80,y:200},size=44,spread=32,noise=0,seed=23,samples=12}={}){
  const angle=Math.atan2(tip.y-shaftFrom.y,tip.x-shaftFrom.x);
  const back=angle+Math.PI;
  const a={x:tip.x+Math.cos(back+spread*Math.PI/180)*size,y:tip.y+Math.sin(back+spread*Math.PI/180)*size};
  const b={x:tip.x+Math.cos(back-spread*Math.PI/180)*size,y:tip.y+Math.sin(back-spread*Math.PI/180)*size};
  const path=[...line({from:a,to:tip,samples}),...line({from:tip,to:b,samples}).slice(1)];
  return noise?jitter(path,noise,rng(seed)):path;
}

export function spiral({cx=200,cy=200,turns=2.5,r0=15,r1=85,samples=120,noise=0,seed=29}={}){
  const random=rng(seed),points=[];
  for(let i=0;i<=samples;i++){
    const t=i/samples,angle=t*turns*Math.PI*2,r=r0+(r1-r0)*t;
    points.push({x:cx+Math.cos(angle)*r,y:cy+Math.sin(angle)*r});
  }
  return noise?jitter(points,noise,random):points;
}

export function zigzag({x=80,y=150,width=220,height=70,teeth=6,samples=10,noise=0,seed=31}={}){
  const vertices=[];
  for(let i=0;i<=teeth;i++)vertices.push({x:x+width*i/teeth,y:i%2?y+height:y});
  return tracePolygon(vertices,{closed:false,samplesPerEdge:samples,noise,seed});
}

export function figureEight({cx=200,cy=200,r=55,samples=120,noise=0,seed=37}={}){
  const random=rng(seed),points=[];
  for(let i=0;i<=samples;i++){
    const angle=i/samples*Math.PI*2;
    points.push({x:cx+Math.sin(angle*2)*r,y:cy+Math.sin(angle)*r*1.4});
  }
  return noise?jitter(points,noise,random):points;
}

export function scribble({cx=200,cy=200,size=90,samples=90,seed=41}={}){
  const random=rng(seed),points=[];
  let x=cx,y=cy;
  for(let i=0;i<samples;i++){
    x+=(random()-.5)*size/3;y+=(random()-.5)*size/3;
    points.push({x,y});
  }
  return points;
}
