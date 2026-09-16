// Document commands. Each function mutates a draft document in place and is meant
// to run inside HistoryStore.execute, so one gesture or drag becomes one undo step.
import{defaultStyle,uid}from"./document.js";
import{MIN_SIZE,resolveEndpoint,resizeBounds}from"./geometry.js";

export const DUPLICATE_OFFSET=24;

const findNode=(doc,id)=>doc.nodes.find(n=>n.id===id);
const findStroke=(doc,id)=>doc.strokes.find(s=>s.id===id);
const findEdge=(doc,id)=>doc.edges.find(e=>e.id===id);
export const findAny=(doc,id)=>findNode(doc,id)||findStroke(doc,id)||findEdge(doc,id);

export const addNode=(doc,node)=>{doc.nodes.push({label:"",style:defaultStyle(),...node});return node.id};
export const addStroke=(doc,stroke)=>{doc.strokes.push({style:{...defaultStyle(),fill:"none"},...stroke});return stroke.id};
export const addEdge=(doc,edge)=>{doc.edges.push({routing:"straight",label:"",style:defaultStyle(),...edge});return edge.id};

// Translate a selection. Nodes carry their attached edges implicitly, so an edge
// endpoint bound to a moving node is never translated a second time.
export function moveSelection(doc,ids,dx,dy){
  const moving=new Set(ids);
  for(const node of doc.nodes)if(moving.has(node.id)){node.x+=dx;node.y+=dy}
  for(const stroke of doc.strokes)if(moving.has(stroke.id))stroke.points=stroke.points.map(p=>({...p,x:p.x+dx,y:p.y+dy}));
  for(const edge of doc.edges){
    if(!moving.has(edge.id))continue;
    for(const key of["from","to"]){
      const endpoint=edge[key];
      if(endpoint.type!=="point")continue;
      // An attached endpoint already followed its node; only free points move here.
      edge[key]={...endpoint,x:endpoint.x+dx,y:endpoint.y+dy};
    }
  }
}

export function resizeNode(doc,id,handle,delta,options){
  const node=findNode(doc,id);if(!node)return false;
  Object.assign(node,resizeBounds(node,handle,delta,options));
  return true;
}

export function setBounds(doc,id,bounds){
  const node=findNode(doc,id);if(!node)return false;
  node.x=bounds.x;node.y=bounds.y;
  node.width=Math.max(MIN_SIZE,bounds.width);
  node.height=node.kind==="circle"?node.width:Math.max(MIN_SIZE,bounds.height);
  return true;
}

export function setLabel(doc,id,label){
  const target=findAny(doc,id);if(!target)return false;
  target.label=String(label).slice(0,500);return true;
}

export function setStyle(doc,id,style){
  const target=findAny(doc,id);if(!target)return false;
  target.style={...target.style,...style};return true;
}

// Deleting a node deletes its incident edges in the same transaction.
export function deleteSelection(doc,ids){
  const gone=new Set(ids);
  doc.nodes=doc.nodes.filter(n=>!gone.has(n.id));
  doc.strokes=doc.strokes.filter(s=>!gone.has(s.id));
  doc.edges=doc.edges.filter(e=>!gone.has(e.id)&&!(e.from.type==="port"&&gone.has(e.from.nodeId))&&!(e.to.type==="port"&&gone.has(e.to.nodeId)));
}

// Replace one or more source strokes with a recognized replacement. Undo restores
// the original samples exactly because the store keeps the whole before-state.
export function convertStrokes(doc,sourceIds,replacement){
  const gone=new Set(sourceIds);
  const present=doc.strokes.filter(s=>gone.has(s.id)).length;
  if(present!==gone.size)return false;
  doc.strokes=doc.strokes.filter(s=>!gone.has(s.id));
  if(replacement.node)addNode(doc,replacement.node);
  if(replacement.edge)addEdge(doc,replacement.edge);
  return true;
}

// Duplicate with fresh IDs. Internal edges copy when both endpoint nodes copy;
// an explicitly selected edge copies with unresolved ends frozen to points.
export function duplicateSelection(doc,ids,{offset=DUPLICATE_OFFSET,newId=uid}={}){
  const selected=new Set(ids),map=new Map(),created=[];
  for(const node of doc.nodes.filter(n=>selected.has(n.id))){
    const id=newId("node");map.set(node.id,id);
    doc.nodes.push({...node,id,x:node.x+offset,y:node.y+offset,style:{...node.style}});
    created.push(id);
  }
  for(const stroke of doc.strokes.filter(s=>selected.has(s.id))){
    const id=newId("stroke");map.set(stroke.id,id);
    doc.strokes.push({...stroke,id,points:stroke.points.map(p=>({...p,x:p.x+offset,y:p.y+offset})),style:{...stroke.style}});
    created.push(id);
  }
  const remap=endpoint=>{
    if(endpoint.type==="point")return{type:"point",x:endpoint.x+offset,y:endpoint.y+offset};
    if(map.has(endpoint.nodeId))return{type:"port",nodeId:map.get(endpoint.nodeId),port:endpoint.port};
    const resolved=resolveEndpoint(doc,endpoint);
    return{type:"point",x:resolved.x+offset,y:resolved.y+offset};
  };
  const internal=doc.edges.filter(e=>!selected.has(e.id)&&e.from.type==="port"&&e.to.type==="port"&&map.has(e.from.nodeId)&&map.has(e.to.nodeId));
  for(const edge of[...doc.edges.filter(e=>selected.has(e.id)),...internal]){
    const id=newId("edge");
    doc.edges.push({...edge,id,from:remap(edge.from),to:remap(edge.to),style:{...edge.style}});
    created.push(id);
  }
  return created;
}
