// Pure coordinate transforms. No DOM access so these run under `node --test`.
export const MIN_REGION=0.2;

// Aspect-contained placement of an image inside a display box (letterbox/pillarbox).
export function containRect(imageWidth,imageHeight,displayWidth,displayHeight){
  const iw=Number(imageWidth),ih=Number(imageHeight),dw=Number(displayWidth),dh=Number(displayHeight);
  if(!(iw>0&&ih>0&&dw>0&&dh>0))return null;
  const scale=Math.min(dw/iw,dh/ih),width=iw*scale,height=ih*scale;
  return{offsetX:(dw-width)/2,offsetY:(dh-height)/2,width,height,scale};
}

// Normalized input rectangle from two reachable corners, in any order.
export function normalizeRegion(a,b){
  if(!a||!b)return null;
  const clamp=v=>Math.min(1,Math.max(0,Number(v)));
  const x0=clamp(Math.min(a.x,b.x)),y0=clamp(Math.min(a.y,b.y)),x1=clamp(Math.max(a.x,b.x)),y1=clamp(Math.max(a.y,b.y));
  const width=x1-x0,height=y1-y0;
  if(!(width>=MIN_REGION&&height>=MIN_REGION))return null;
  return{x:x0,y:y0,width,height};
}

export const FULL_REGION={x:0,y:0,width:1,height:1};

// Normalized landmark -> stage pixels. Mirroring is applied exactly once, here.
export function cameraToStage(u,v,config){
  const{mirror=false,imageWidth=640,imageHeight=480,stageWidth=0,stageHeight=0,region=FULL_REGION}=config||{};
  const box=containRect(imageWidth,imageHeight,stageWidth,stageHeight);
  if(!box||!Number.isFinite(u)||!Number.isFinite(v))return null;
  const r=region&&region.width>0&&region.height>0?region:FULL_REGION;
  const ru=(u-r.x)/r.width,rv=(v-r.y)/r.height;
  const inside=ru>=0&&ru<=1&&rv>=0&&rv<=1;
  const mu=mirror?1-ru:ru;
  return{x:box.offsetX+mu*box.width,y:box.offsetY+rv*box.height,inside};
}

// Aspect-corrected pixel distance between two normalized landmarks.
export const landmarkDistance=(a,b,imageWidth=640,imageHeight=480)=>Math.hypot((a.x-b.x)*imageWidth,(a.y-b.y)*imageHeight);

export const stageToDoc=(p,viewport)=>({x:(p.x-viewport.panX)/viewport.zoom,y:(p.y-viewport.panY)/viewport.zoom});
export const docToStage=(p,viewport)=>({x:p.x*viewport.zoom+viewport.panX,y:p.y*viewport.zoom+viewport.panY});

// Zoom about a stage anchor so the document point under the anchor does not move.
export function zoomAbout(viewport,anchor,zoom,min=.25,max=4){
  const next=Math.max(min,Math.min(max,zoom)),before=stageToDoc(anchor,viewport);
  return{zoom:next,panX:anchor.x-before.x*next,panY:anchor.y-before.y*next};
}
