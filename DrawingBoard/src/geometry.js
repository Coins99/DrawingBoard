// Pure document geometry: ports, routing, hit testing, resize handles and guides.
export const PORTS=["north","east","south","west"];
export const PORT_STUB=16;
export const MIN_SIZE=8;
export const HANDLES=["nw","n","ne","e","se","s","sw","w"];

export const pointAtPort=(n,p)=>({north:{x:n.x+n.width/2,y:n.y},east:{x:n.x+n.width,y:n.y+n.height/2},south:{x:n.x+n.width/2,y:n.y+n.height},west:{x:n.x,y:n.y+n.height/2}}[p]);
const PORT_DIRECTION={north:{x:0,y:-1},east:{x:1,y:0},south:{x:0,y:1},west:{x:-1,y:0}};

export function resolveEndpoint(doc,e){
  if(!e)return{x:0,y:0};
  if(e.type==="point")return{x:e.x,y:e.y};
  const node=doc.nodes.find(n=>n.id===e.nodeId);
  return node?pointAtPort(node,e.port):{x:0,y:0};
}

export function objectBounds(o){
  if(!o)return null;
  if("width"in o)return{x:o.x,y:o.y,width:o.width,height:o.height};
  if(o.points?.length){const xs=o.points.map(p=>p.x),ys=o.points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y}}
  return null;
}

export function boundsOfPoints(points){
  if(!points?.length)return null;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
  return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
}

// Bounds of any selectable object, including edges, which need the document to route.
export function anyBounds(doc,o){
  const direct=objectBounds(o);
  if(direct)return direct;
  if(o?.from&&o?.to)return boundsOfPoints(routeEdge(doc,o));
  return null;
}

export function containsNode(n,p,t=0){
  const cx=n.x+n.width/2,cy=n.y+n.height/2,dx=Math.abs(p.x-cx),dy=Math.abs(p.y-cy);
  if(n.kind==="circle")return Math.hypot(dx/(n.width/2+t),dy/(n.height/2+t))<=1;
  if(n.kind==="diamond")return dx/(n.width/2+t)+dy/(n.height/2+t)<=1;
  return p.x>=n.x-t&&p.x<=n.x+n.width+t&&p.y>=n.y-t&&p.y<=n.y+n.height+t;
}

export const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y;if(!dx&&!dy)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy))};
export function polylineDistance(p,points){
  let best=Infinity;
  for(let i=1;i<points.length;i++)best=Math.min(best,segmentDistance(p,points[i-1],points[i]));
  return points.length===1?Math.hypot(p.x-points[0].x,p.y-points[0].y):best;
}

// Nodes win over strokes, strokes over edges; within a collection, topmost first.
export function hitTest(doc,p,t=8){
  for(let i=doc.nodes.length-1;i>=0;i--)if(containsNode(doc.nodes[i],p,t))return{type:"node",id:doc.nodes[i].id};
  for(let i=doc.strokes.length-1;i>=0;i--)if(polylineDistance(p,doc.strokes[i].points)<=t)return{type:"stroke",id:doc.strokes[i].id};
  for(let i=doc.edges.length-1;i>=0;i--)if(polylineDistance(p,routeEdge(doc,doc.edges[i]))<=t)return{type:"edge",id:doc.edges[i].id};
  return null;
}

export function nearestPort(doc,p,t){
  let best=null;
  for(const n of doc.nodes)for(const port of PORTS){
    const point=pointAtPort(n,port),distance=Math.hypot(p.x-point.x,p.y-point.y);
    if(distance<=t&&(!best||distance<best.distance))best={nodeId:n.id,port,point,distance};
  }
  return best;
}

const collapse=points=>{
  const out=[];
  for(const p of points){
    const last=out.at(-1);
    if(last&&Math.abs(last.x-p.x)<1e-6&&Math.abs(last.y-p.y)<1e-6)continue;
    if(out.length>=2){
      const a=out.at(-2),b=out.at(-1);
      const collinear=Math.abs((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))<1e-6;
      if(collinear){out[out.length-1]={x:p.x,y:p.y};continue}
    }
    out.push({x:p.x,y:p.y});
  }
  return out;
};

export function routeEdge(doc,e){
  const a=resolveEndpoint(doc,e.from),b=resolveEndpoint(doc,e.to);
  if(e.routing!=="orthogonal")return[a,b];
  const stub=(endpoint,point,other)=>{
    const direction=endpoint.type==="port"?PORT_DIRECTION[endpoint.port]:null;
    if(direction)return{x:point.x+direction.x*PORT_STUB,y:point.y+direction.y*PORT_STUB};
    return Math.abs(other.x-point.x)>=Math.abs(other.y-point.y)?{x:point.x+Math.sign(other.x-point.x)*PORT_STUB,y:point.y}:{x:point.x,y:point.y+Math.sign(other.y-point.y)*PORT_STUB};
  };
  const sa=stub(e.from,a,b),sb=stub(e.to,b,a);
  const fromVertical=Math.abs(sa.x-a.x)<Math.abs(sa.y-a.y);
  const elbow=fromVertical?[{x:sa.x,y:(sa.y+sb.y)/2},{x:sb.x,y:(sa.y+sb.y)/2}]:[{x:(sa.x+sb.x)/2,y:sa.y},{x:(sa.x+sb.x)/2,y:sb.y}];
  return collapse([a,sa,...elbow,sb,b]);
}

export const snap=(v,g=10)=>Math.round(v/g)*g;

// Handles keep a constant screen size, so callers pass the current zoom.
export function handlePoints(node){
  const{x,y,width:w,height:h}=node,mx=x+w/2,my=y+h/2;
  return{nw:{x,y},n:{x:mx,y},ne:{x:x+w,y},e:{x:x+w,y:my},se:{x:x+w,y:y+h},s:{x:mx,y:y+h},sw:{x,y:y+h},w:{x,y:my}};
}

export function handleAt(node,p,tolerance){
  const points=handlePoints(node);
  for(const name of HANDLES)if(Math.hypot(p.x-points[name].x,p.y-points[name].y)<=tolerance)return name;
  return null;
}

// Resize from one handle. Circles stay square by using the larger requested delta.
export function resizeBounds(node,handle,delta,{keepSquare=node.kind==="circle",minimum=MIN_SIZE}={}){
  let{x,y,width,height}=node;
  const right=x+width,bottom=y+height;
  if(handle.includes("w"))x=Math.min(x+delta.x,right-minimum);
  if(handle.includes("n"))y=Math.min(y+delta.y,bottom-minimum);
  if(handle.includes("e"))width=Math.max(minimum,width+delta.x);else width=right-x;
  if(handle.includes("s"))height=Math.max(minimum,height+delta.y);else height=bottom-y;
  if(keepSquare){
    const size=Math.max(minimum,Math.max(width,height));
    if(handle.includes("w"))x=right-size;
    if(handle.includes("n"))y=bottom-size;
    width=height=size;
  }
  return{x,y,width:Math.max(minimum,width),height:Math.max(minimum,height)};
}

const rectContains=(rect,b)=>b&&b.x>=rect.x&&b.y>=rect.y&&b.x+b.width<=rect.x+rect.width&&b.y+b.height<=rect.y+rect.height;
export const normalizeRect=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)});

// Marquee selects only objects fully inside the rectangle.
export function marqueeSelect(doc,rect){
  const ids=[];
  for(const n of doc.nodes)if(rectContains(rect,objectBounds(n)))ids.push(n.id);
  for(const s of doc.strokes)if(rectContains(rect,objectBounds(s)))ids.push(s.id);
  for(const e of doc.edges)if(rectContains(rect,boundsOfPoints(routeEdge(doc,e))))ids.push(e.id);
  return ids;
}

const edgesOf=b=>({x:[b.x,b.x+b.width/2,b.x+b.width],y:[b.y,b.y+b.height/2,b.y+b.height]});

// Alignment guides against nodes that are not being moved. Returns the snap offset
// plus the guide lines to draw, both in document coordinates.
export function alignmentGuides(doc,movingIds,movingBounds,tolerance=6){
  if(!movingBounds)return{dx:0,dy:0,guides:[]};
  const ignore=new Set(movingIds);
  const targets=doc.nodes.filter(n=>!ignore.has(n.id)).map(objectBounds);
  if(!targets.length)return{dx:0,dy:0,guides:[]};
  const moving=edgesOf(movingBounds);
  const pick=axis=>{
    let best=null;
    for(const target of targets){
      const other=edgesOf(target)[axis];
      for(const mine of moving[axis])for(const theirs of other){
        const offset=theirs-mine,distance=Math.abs(offset);
        if(distance<=tolerance&&(!best||distance<best.distance))best={offset,distance,position:theirs};
      }
    }
    return best;
  };
  const horizontal=pick("x"),vertical=pick("y");
  const guides=[];
  if(horizontal)guides.push({axis:"x",position:horizontal.position});
  if(vertical)guides.push({axis:"y",position:vertical.position});
  return{dx:horizontal?horizontal.offset:0,dy:vertical?vertical.offset:0,guides};
}
