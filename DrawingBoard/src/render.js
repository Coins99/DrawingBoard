// SVG construction for both the live editor and standalone export. Labels are set
// through textContent only, so imported text can never introduce markup.
import{HANDLES,anyBounds,handlePoints,objectBounds,resolveEndpoint,routeEdge}from"./geometry.js";

const NS="http://www.w3.org/2000/svg";
export const LABEL_FONT_SIZE=14,LABEL_LINE_HEIGHT=1.2,EXPORT_PADDING=24;

const el=(name,attrs={})=>{const node=document.createElementNS(NS,name);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node};
const pathData=points=>points.map((p,i)=>`${i?"L":"M"} ${p.x} ${p.y}`).join(" ");
const labelLines=label=>String(label).split("\n");
// Rough advance width; enough for export bounds without loading font metrics.
const estimateWidth=lines=>Math.max(...lines.map(line=>line.length))*LABEL_FONT_SIZE*.6;

function shapeElement(n){
  if(n.kind==="circle")return el("ellipse",{cx:n.x+n.width/2,cy:n.y+n.height/2,rx:n.width/2,ry:n.height/2});
  if(n.kind==="diamond")return el("polygon",{points:`${n.x+n.width/2},${n.y} ${n.x+n.width},${n.y+n.height/2} ${n.x+n.width/2},${n.y+n.height} ${n.x},${n.y+n.height/2}`});
  return el("rect",{x:n.x,y:n.y,width:n.width,height:n.height,rx:8});
}

// Point at half the polyline length, used for connector labels.
export function midpointOf(points){
  let total=0;const spans=[];
  for(let i=1;i<points.length;i++){const d=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);spans.push(d);total+=d}
  if(!total)return{...points[0]};
  let walked=0;
  for(let i=0;i<spans.length;i++){
    if(walked+spans[i]>=total/2){
      const t=(total/2-walked)/spans[i],a=points[i],b=points[i+1];
      return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    }
    walked+=spans[i];
  }
  return{...points.at(-1)};
}

function textElement(label,x,y,extra={}){
  const lines=labelLines(label),text=el("text",{x,y,...extra});
  lines.forEach((line,i)=>{
    const span=el("tspan",{x,dy:i?`${LABEL_LINE_HEIGHT}em`:`${-(lines.length-1)*(LABEL_LINE_HEIGHT/2)}em`});
    span.textContent=line;
    text.append(span);
  });
  return text;
}

export function renderDocument(doc,groups,selection,viewport,extras={}){
  const zoom=viewport.zoom||1;
  groups.viewport.setAttribute("transform",`translate(${viewport.panX} ${viewport.panY}) scale(${zoom})`);

  groups.edges.replaceChildren(...doc.edges.flatMap(edge=>{
    const route=routeEdge(doc,edge);
    const path=el("path",{d:pathData(route),class:"diagram-edge","data-id":edge.id,stroke:edge.style.stroke,"stroke-width":edge.style.strokeWidth,"marker-end":"url(#arrowhead)"});
    if(!edge.label)return[path];
    const at=midpointOf(route);
    const backdrop=el("rect",{class:"edge-label-backdrop",x:at.x-estimateWidth(labelLines(edge.label))/2-3,y:at.y-LABEL_FONT_SIZE*.75,width:estimateWidth(labelLines(edge.label))+6,height:LABEL_FONT_SIZE*1.5,rx:3});
    return[path,backdrop,textElement(edge.label,at.x,at.y,{class:"diagram-label","data-id":edge.id})];
  }));

  groups.strokes.replaceChildren(...doc.strokes.map(s=>el("path",{d:pathData(s.points),class:"diagram-stroke","data-id":s.id,stroke:s.style.stroke,"stroke-width":s.style.strokeWidth})));

  groups.nodes.replaceChildren(...doc.nodes.map(n=>{
    const group=el("g",{class:"diagram-node","data-id":n.id});
    const shape=shapeElement(n);
    shape.setAttribute("class","shape");
    shape.setAttribute("fill",n.style.fill);
    shape.setAttribute("stroke",n.style.stroke);
    shape.setAttribute("stroke-width",n.style.strokeWidth);
    group.append(shape);
    if(n.label)group.append(textElement(n.label,n.x+n.width/2,n.y+n.height/2,{class:"diagram-label"}));
    return group;
  }));

  const inset=5/zoom,boxes=[];
  for(const id of selection){
    const object=doc.nodes.find(n=>n.id===id)||doc.strokes.find(s=>s.id===id)||doc.edges.find(e=>e.id===id);
    const box=anyBounds(doc,object);
    if(box)boxes.push(el("rect",{x:box.x-inset,y:box.y-inset,width:box.width+inset*2,height:box.height+inset*2,class:"selection-box"}));
  }
  groups.selection.replaceChildren(...boxes);

  if(groups.handles){
    const handles=[];
    if(selection.size===1){
      const node=doc.nodes.find(n=>n.id===[...selection][0]);
      if(node){
        const points=handlePoints(node),size=8/zoom;
        for(const name of HANDLES){
          const p=points[name];
          handles.push(el("rect",{x:p.x-size/2,y:p.y-size/2,width:size,height:size,class:"resize-handle","data-handle":name}));
        }
      }
    }
    groups.handles.replaceChildren(...handles);
  }

  if(groups.guides){
    const lines=(extras.guides||[]).map(guide=>guide.axis==="x"
      ?el("line",{x1:guide.position,y1:extras.guideExtent?.minY??-1e5,x2:guide.position,y2:extras.guideExtent?.maxY??1e5,class:"alignment-guide"})
      :el("line",{x1:extras.guideExtent?.minX??-1e5,y1:guide.position,x2:extras.guideExtent?.maxX??1e5,y2:guide.position,class:"alignment-guide"}));
    groups.guides.replaceChildren(...lines);
  }
}

// Fresh standalone SVG with inline styles and no external references.
export function standaloneSvg(doc){
  const boxes=[...doc.nodes.map(objectBounds),...doc.strokes.map(objectBounds)].filter(Boolean);
  for(const edge of doc.edges){
    const route=routeEdge(doc,edge);
    const xs=route.map(p=>p.x),ys=route.map(p=>p.y);
    boxes.push({x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)});
    if(edge.label){
      const at=midpointOf(route),lines=labelLines(edge.label),width=estimateWidth(lines),height=lines.length*LABEL_FONT_SIZE*LABEL_LINE_HEIGHT;
      boxes.push({x:at.x-width/2,y:at.y-height/2,width,height});
    }
  }
  for(const node of doc.nodes){
    if(!node.label)continue;
    const lines=labelLines(node.label),width=estimateWidth(lines),height=lines.length*LABEL_FONT_SIZE*LABEL_LINE_HEIGHT;
    boxes.push({x:node.x+node.width/2-width/2,y:node.y+node.height/2-height/2,width,height});
  }
  const empty=!boxes.length;
  const minX=empty?0:Math.min(...boxes.map(b=>b.x))-EXPORT_PADDING;
  const minY=empty?0:Math.min(...boxes.map(b=>b.y))-EXPORT_PADDING;
  const maxX=empty?640:Math.max(...boxes.map(b=>b.x+b.width))+EXPORT_PADDING;
  const maxY=empty?480:Math.max(...boxes.map(b=>b.y+b.height))+EXPORT_PADDING;
  const width=Math.max(1,Math.ceil(maxX-minX)),height=Math.max(1,Math.ceil(maxY-minY));
  const svg=el("svg",{xmlns:NS,viewBox:`${minX} ${minY} ${maxX-minX} ${maxY-minY}`,width,height});

  const strokes=[...new Set(doc.edges.map(e=>e.style.stroke))],defs=el("defs");
  for(const color of strokes){
    const marker=el("marker",{id:`arrow-${color.replace("#","")}`,markerWidth:10,markerHeight:7,refX:9,refY:3.5,orient:"auto",markerUnits:"strokeWidth"});
    marker.append(el("path",{d:"M0,0 L10,3.5 L0,7 z",fill:color}));
    defs.append(marker);
  }
  svg.append(defs);

  for(const edge of doc.edges){
    const route=routeEdge(doc,edge);
    svg.append(el("path",{d:pathData(route),fill:"none",stroke:edge.style.stroke,"stroke-width":edge.style.strokeWidth,"stroke-linecap":"round","stroke-linejoin":"round","marker-end":`url(#arrow-${edge.style.stroke.replace("#","")})`}));
  }
  for(const stroke of doc.strokes)
    svg.append(el("path",{d:pathData(stroke.points),fill:"none",stroke:stroke.style.stroke,"stroke-width":stroke.style.strokeWidth,"stroke-linecap":"round","stroke-linejoin":"round"}));
  for(const node of doc.nodes){
    const shape=shapeElement(node);
    shape.setAttribute("fill",node.style.fill);
    shape.setAttribute("stroke",node.style.stroke);
    shape.setAttribute("stroke-width",node.style.strokeWidth);
    svg.append(shape);
  }
  const labelAttrs={"text-anchor":"middle","dominant-baseline":"middle","font-family":"Inter, Helvetica, Arial, sans-serif","font-size":String(LABEL_FONT_SIZE),fill:"#263548"};
  for(const node of doc.nodes)if(node.label)svg.append(textElement(node.label,node.x+node.width/2,node.y+node.height/2,labelAttrs));
  for(const edge of doc.edges)if(edge.label){const at=midpointOf(routeEdge(doc,edge));svg.append(textElement(edge.label,at.x,at.y,labelAttrs))}
  return new XMLSerializer().serializeToString(svg);
}

// Resolved endpoints are useful to callers that need them without routing.
export{resolveEndpoint};
