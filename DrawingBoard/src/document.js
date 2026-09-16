export const LIMITS={objects:2000,points:100000,pointsPerStroke:10000,coordinate:1e6};
export const defaultStyle=()=>({stroke:"#334155",fill:"#ffffff",strokeWidth:2});
export const createDocument=(title="Untitled diagram")=>({schemaVersion:1,title,nodes:[],strokes:[],edges:[]});
export const clone=value=>structuredClone(value);
export const uid=(prefix="item")=>`${prefix}-${crypto.randomUUID()}`;
const finite=(n,min=-LIMITS.coordinate,max=LIMITS.coordinate)=>Number.isFinite(n)&&n>=min&&n<=max;
const styleOk=s=>s&&/^#[\da-f]{6}$/i.test(s.stroke)&&(/^#[\da-f]{6}$/i.test(s.fill)||s.fill==="none")&&finite(s.strokeWidth,.5,20);
export function validateDocument(input){
  const errors=[];if(!input||typeof input!=="object"||Array.isArray(input))return{ok:false,errors:["Document must be an object."]};
  if(input.schemaVersion!==1)errors.push("Unsupported schemaVersion.");
  if(typeof input.title!=="string"||input.title.length>200)errors.push("Invalid title.");
  // A collection that is present but not an array is a damaged file. Treating it
  // as empty would import a blank diagram and report success.
  for(const key of["nodes","strokes","edges"])if(key in input&&!Array.isArray(input[key]))errors.push(`Field ${key} must be an array.`);
  if(errors.length)return{ok:false,errors};
  const nodes=Array.isArray(input.nodes)?input.nodes:[],strokes=Array.isArray(input.strokes)?input.strokes:[],edges=Array.isArray(input.edges)?input.edges:[];
  if(nodes.length+strokes.length+edges.length>LIMITS.objects)errors.push("Document has too many objects.");
  const ids=new Set(),takeId=(o,type)=>{if(typeof o.id!=="string"||!o.id||o.id.length>128||ids.has(o.id))errors.push(`Invalid or duplicate ${type} id.`);else ids.add(o.id)};
  for(const n of nodes){takeId(n,"node");if(!["rectangle","circle","diamond"].includes(n.kind))errors.push(`Invalid node kind for ${n.id}.`);if(!finite(n.x)||!finite(n.y)||!finite(n.width,8,1e5)||!finite(n.height,8,1e5))errors.push(`Invalid bounds for ${n.id}.`);if(n.kind==="circle"&&Math.abs(n.width-n.height)>.001)errors.push(`Circle ${n.id} must have equal dimensions.`);if(typeof n.label!=="string"||n.label.length>500||!styleOk(n.style))errors.push(`Invalid content for ${n.id}.`)}
  let total=0;for(const s of strokes){takeId(s,"stroke");if(!Array.isArray(s.points)||s.points.length<2||s.points.length>LIMITS.pointsPerStroke)errors.push(`Invalid points for ${s.id}.`);else{total+=s.points.length;let last=-1;for(const p of s.points){if(!finite(p.x)||!finite(p.y)||!finite(p.t,0,1e12)||p.t<last){errors.push(`Invalid sample in ${s.id}.`);break}last=p.t}}if(!styleOk(s.style))errors.push(`Invalid style for ${s.id}.`)}if(total>LIMITS.points)errors.push("Document has too many stroke points.");
  const nodeIds=new Set(nodes.map(n=>n.id)),endpointOk=e=>e&&((e.type==="point"&&finite(e.x)&&finite(e.y))||(e.type==="port"&&nodeIds.has(e.nodeId)&&["north","east","south","west"].includes(e.port)));
  const sameEndpoint=(a,b)=>a.type===b.type&&(a.type==="port"?a.nodeId===b.nodeId&&a.port===b.port:a.x===b.x&&a.y===b.y);
  for(const e of edges){takeId(e,"edge");if(!endpointOk(e.from)||!endpointOk(e.to)||!["straight","orthogonal"].includes(e.routing)||typeof e.label!=="string"||e.label.length>500||!styleOk(e.style))errors.push(`Invalid edge ${e.id}.`);else if(sameEndpoint(e.from,e.to))errors.push(`Edge ${e.id} starts and ends at the same point.`)}
  if(errors.length)return{ok:false,errors};const document=createDocument(input.title);
  document.nodes=nodes.map(n=>({id:n.id,kind:n.kind,x:n.x,y:n.y,width:n.width,height:n.height,label:n.label,style:{...n.style}}));
  document.strokes=strokes.map(s=>({id:s.id,points:s.points.map(p=>({x:p.x,y:p.y,t:p.t})),style:{...s.style}}));
  document.edges=edges.map(e=>({id:e.id,from:{...e.from},to:{...e.to},routing:e.routing,label:e.label,style:{...e.style}}));return{ok:true,document};
}
export const HISTORY_LIMIT=100;
export class HistoryStore{
  constructor(doc=createDocument()){this.doc=clone(doc);this.undoStack=[];this.redoStack=[];this.listeners=new Set();this.revision=0;this.lastLabel=null}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  emit(label=null){this.revision++;this.lastLabel=label;for(const fn of this.listeners)fn(this.doc,this)}
  get canUndo(){return this.undoStack.length>0} get canRedo(){return this.redoStack.length>0}
  replace(doc,{clearHistory=true}={}){const result=validateDocument(doc);if(!result.ok)throw new Error(result.errors.join(" "));this.doc=result.document;if(clearHistory){this.undoStack=[];this.redoStack=[]}this.emit("Replace document")}
  // Returns false when the mutation left the document unchanged, so no-op drags add
  // nothing to history. Invalid mutations throw and leave the document untouched.
  execute(label,mutate){
    const before=clone(this.doc),after=clone(this.doc);
    mutate(after);
    const result=validateDocument(after);
    if(!result.ok)throw new Error(result.errors.join(" "));
    if(JSON.stringify(before)===JSON.stringify(result.document))return false;
    this.doc=result.document;
    this.undoStack.push({label,before,after:clone(this.doc)});
    if(this.undoStack.length>HISTORY_LIMIT)this.undoStack.shift();
    this.redoStack=[];this.emit(label);return true;
  }
  // Fold a repeated action into the previous entry so held arrow keys stay one undo.
  amend(label,mutate){
    const top=this.undoStack.at(-1);
    if(!top||top.label!==label)return this.execute(label,mutate);
    const after=clone(this.doc);
    mutate(after);
    const result=validateDocument(after);
    if(!result.ok)throw new Error(result.errors.join(" "));
    if(JSON.stringify(this.doc)===JSON.stringify(result.document))return false;
    this.doc=result.document;top.after=clone(this.doc);this.redoStack=[];this.emit(label);return true;
  }
  undo(){const entry=this.undoStack.pop();if(!entry)return false;this.redoStack.push(entry);this.doc=clone(entry.before);this.emit(`Undo ${entry.label}`);return true}
  redo(){const entry=this.redoStack.pop();if(!entry)return false;this.undoStack.push(entry);this.doc=clone(entry.after);this.emit(`Redo ${entry.label}`);return true}
}
