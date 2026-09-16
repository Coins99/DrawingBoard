// Editor composition. Document state lives in the store; pointer and gesture input
// both drive the same begin/move/end lifecycle so neither can bypass validation.
import{createDocument,defaultStyle,HistoryStore,clone,uid}from"./src/document.js";
import{addEdge,addNode,addStroke,convertStrokes,deleteSelection as deleteFrom,duplicateSelection,findAny,moveSelection,setBounds,setLabel,setStyle}from"./src/commands.js";
import{alignmentGuides,anyBounds,handleAt,hitTest,marqueeSelect,nearestPort,normalizeRect,objectBounds,resizeBounds,snap}from"./src/geometry.js";
import{classifyStroke}from"./src/recognition.js";
import{pairArrow}from"./src/arrow.js";
import{renderDocument}from"./src/render.js";
import{exportPng,exportSvg,openJson,saveJson}from"./src/io.js";
import{Autosave}from"./src/autosave.js";
import{CameraController}from"./src/camera.js";
import{GestureController,STATES}from"./src/gestures.js";
import{Calibrator,defaultCalibration}from"./src/calibration.js";
import{stageToDoc,zoomAbout}from"./src/coordinates.js";
import{Tutorial}from"./src/tutorial.js";

const $=id=>document.getElementById(id);
const groups={viewport:$("viewport"),edges:$("edges"),strokes:$("strokes"),nodes:$("nodes"),selection:$("selection"),handles:$("handles"),guides:$("guides")};
const stage=$("stage"),overlay=$("overlay"),ctx=overlay.getContext("2d"),video=$("video");
const store=new HistoryStore(createDocument()),selection=new Set();
const calibrator=new Calibrator(),tutorial=new Tutorial();

const session={
  tool:"select",viewport:{panX:0,panY:0,zoom:1},interaction:null,candidate:null,
  cursor:null,cursorInside:true,hand:null,camera:"off",armed:false,
  grid:true,guides:true,activeGuides:[],spaceDown:false,
  epoch:0,lastStroke:null,lastNudgeAt:0,
  calibration:defaultCalibration(),calibrating:null,lastLandmark:null,
  saved:false,dirty:false,
};

const CALIBRATION_PHASES=[
  {phase:"pauseContact",prompt:"Hold your thumb against your pinky and keep still."},
  {phase:"pauseReleased",prompt:"Relax your hand with the fingers apart."},
  {phase:"pinchContact",prompt:"Pinch your thumb and index finger together."},
  {phase:"pinchReleased",prompt:"Open your hand again."},
];

const setStatus=message=>{$("status").textContent=message};
const stagePoint=event=>{const r=stage.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top}};
const toDoc=p=>stageToDoc(p,session.viewport);
const gridPoint=p=>session.grid?{x:snap(p.x),y:snap(p.y)}:p;
const currentDoc=()=>session.interaction?.preview||store.doc;
const tolerance=px=>px/session.viewport.zoom;

// Any committed edit, tool change or import ends arrow pairing and stale proposals.
function breakContinuity(){session.epoch++;session.lastStroke=null}

const autosave=new Autosave({onStatus:(state,detail)=>{
  if(state==="unavailable"){$("saveState").textContent="Local recovery unavailable";return}
  if(state==="pending"){$("saveState").textContent="Saving…";return}
  if(state==="error"){$("saveState").textContent="Local save failed — use Save JSON";setStatus(`Local recovery failed: ${detail?.error?.message||"storage error"}. Your work is still editable; use Save JSON.`);return}
  session.saved=true;$("saveState").textContent="Recovery saved";
}});

function render(){
  const doc=currentDoc();
  const extras=session.activeGuides.length?{guides:session.activeGuides,guideExtent:guideExtent(doc)}:{};
  renderDocument(doc,groups,selection,session.viewport,extras);
  $("undoBtn").disabled=!store.canUndo;$("redoBtn").disabled=!store.canRedo;
  $("deleteBtn").disabled=!selection.size;$("duplicateBtn").disabled=!selection.size;
  $("zoomLabel").textContent=`${Math.round(session.viewport.zoom*100)}%`;
  renderInspector();renderObjectList();drawOverlay();
}

function guideExtent(doc){
  const boxes=doc.nodes.map(objectBounds);
  if(!boxes.length)return null;
  return{minX:Math.min(...boxes.map(b=>b.x))-40,maxX:Math.max(...boxes.map(b=>b.x+b.width))+40,minY:Math.min(...boxes.map(b=>b.y))-40,maxY:Math.max(...boxes.map(b=>b.y+b.height))+40};
}

let inspectorTarget=null,inspectorDirty=false;
function renderInspector(){
  const object=selection.size===1?findAny(store.doc,[...selection][0]):null;
  $("emptyInspector").hidden=!!object;$("inspectorForm").hidden=!object;
  if(!object){inspectorTarget=null;return}
  const isNode="width"in object,isEdge=!!object.from;
  // Strokes carry no label in the schema, so the control is not offered for them.
  $("labelField").hidden=!isNode&&!isEdge;
  $("nodeFields").hidden=!isNode;
  $("fillField").hidden=!isNode;
  $("routingField").hidden=!isEdge;
  if(isNode)$("heightInput").disabled=object.kind==="circle";
  // Keep unapplied edits. They are discarded only by Apply or by selecting
  // something else, so an unrelated repaint cannot wipe what was typed.
  const keepEdits=inspectorTarget===object.id&&inspectorDirty;
  if(inspectorTarget!==object.id)inspectorDirty=false;
  inspectorTarget=object.id;
  if(keepEdits)return;
  $("labelInput").value=object.label||"";
  $("strokeInput").value=object.style.stroke;
  if(isNode){
    $("fillInput").value=object.style.fill==="none"?"#ffffff":object.style.fill;
    $("xInput").value=Math.round(object.x);$("yInput").value=Math.round(object.y);
    $("widthInput").value=Math.round(object.width);$("heightInput").value=Math.round(object.height);
  }
  if(isEdge)$("routingInput").value=object.routing;
}

// Text alternative for the canvas so the diagram is readable without sight.
function renderObjectList(){
  const doc=store.doc,items=[];
  for(const node of doc.nodes)items.push(`${node.kind}${node.label?` labelled ${node.label}`:""} at ${Math.round(node.x)}, ${Math.round(node.y)}, ${Math.round(node.width)} by ${Math.round(node.height)}${selection.has(node.id)?", selected":""}`);
  for(const edge of doc.edges){
    const describe=end=>end.type==="port"?`${doc.nodes.find(n=>n.id===end.nodeId)?.label||"a shape"} (${end.port})`:`point ${Math.round(end.x)}, ${Math.round(end.y)}`;
    items.push(`connector from ${describe(edge.from)} to ${describe(edge.to)}${edge.label?` labelled ${edge.label}`:""}${selection.has(edge.id)?", selected":""}`);
  }
  for(const stroke of doc.strokes)items.push(`freehand stroke with ${stroke.points.length} samples${selection.has(stroke.id)?", selected":""}`);
  const list=$("objectList");
  list.replaceChildren(...(items.length?items:["empty diagram"]).map(text=>{const li=document.createElement("li");li.textContent=text;return li}));
}

function setTool(tool){
  if(session.tool===tool)return;
  cancelInteraction();rejectCandidate({silent:true});breakContinuity();
  session.tool=tool;
  document.querySelectorAll("[data-tool]").forEach(button=>{
    const active=button.dataset.tool===tool;
    button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));
  });
  $("toolLabel").textContent=`${tool[0].toUpperCase()+tool.slice(1)} tool`;
  render();
}

function setSelection(ids=[]){selection.clear();for(const id of ids)selection.add(id);render()}

// Single commit path. A rejected or empty mutation still repaints, so a draft or
// preview is never left on screen, and a validation failure reaches the user.
function commit(label,mutate){
  try{
    if(store.execute(label,mutate))return true;
  }catch(error){
    setStatus(`Change rejected: ${error.message}`);
  }
  render();
  return false;
}

store.subscribe((doc,self)=>{
  session.dirty=true;session.saved=false;
  autosave.schedule(doc,self.revision);
  // Drop any drag or resize preview: it was built from the previous document, so
  // rendering it would show objects that no longer exist, and committing it would
  // apply a delta measured against a state that is gone.
  if(session.interaction?.base){session.interaction=null;session.activeGuides=[]}
  // Drop selections that no longer exist, for example after undoing an insert.
  for(const id of[...selection])if(!findAny(doc,id))selection.delete(id);
  if(session.candidate&&session.candidate.revision!==self.revision)dismissCandidate();
  render();
});

/* ---------- interaction lifecycle ---------- */

function begin(point,time=performance.now(),modifiers={}){
  if(session.candidate)return;
  if(modifiers.pan){session.interaction={kind:"pan",origin:point,pan:{...session.viewport}};return}
  const p=toDoc(point);
  if(session.tool==="select"){
    if(selection.size===1){
      const node=store.doc.nodes.find(n=>n.id===[...selection][0]);
      const handle=node&&handleAt(node,p,tolerance(9));
      if(handle){session.interaction={kind:"resize",id:node.id,handle,start:p,base:clone(store.doc),preview:clone(store.doc)};return}
    }
    const hit=hitTest(store.doc,p,tolerance(8));
    if(!hit){
      if(!modifiers.shift)setSelection([]);
      session.interaction={kind:"marquee",start:p,current:p,additive:!!modifiers.shift,baseSelection:[...selection]};
      return;
    }
    if(modifiers.shift){selection.has(hit.id)?selection.delete(hit.id):selection.add(hit.id);render()}
    else if(!selection.has(hit.id))setSelection([hit.id]);
    if(!selection.size)return;
    const base=clone(store.doc);
    session.interaction={kind:"move",start:p,base,preview:clone(base),moved:false};
    return;
  }
  if(session.tool==="connector"){
    const port=nearestPort(store.doc,p,tolerance(18));
    session.interaction={kind:"connector",start:port?{type:"port",nodeId:port.nodeId,port:port.port}:{type:"point",x:p.x,y:p.y},startPoint:port?.point||p,current:p};
    drawOverlay();return;
  }
  session.interaction={kind:session.tool,start:p,current:p,time,points:[{x:p.x,y:p.y,t:0}]};
  drawOverlay();
}

function move(point,time=performance.now()){
  const action=session.interaction;
  if(!action)return;
  if(action.kind==="pan"){
    session.viewport={...session.viewport,panX:action.pan.panX+(point.x-action.origin.x),panY:action.pan.panY+(point.y-action.origin.y)};
    render();return;
  }
  const p=toDoc(point);
  if(action.kind==="move"){
    let dx=p.x-action.start.x,dy=p.y-action.start.y;
    session.activeGuides=[];
    if(session.grid){dx=snap(dx);dy=snap(dy)}
    if(session.guides){
      const moved=[...selection].map(id=>anyBounds(action.base,findAny(action.base,id))).filter(Boolean);
      if(moved.length){
        const union={x:Math.min(...moved.map(b=>b.x))+dx,y:Math.min(...moved.map(b=>b.y))+dy,width:Math.max(...moved.map(b=>b.x+b.width))-Math.min(...moved.map(b=>b.x)),height:Math.max(...moved.map(b=>b.y+b.height))-Math.min(...moved.map(b=>b.y))};
        const aligned=alignmentGuides(action.base,[...selection],union,tolerance(6));
        dx+=aligned.dx;dy+=aligned.dy;session.activeGuides=aligned.guides;
      }
    }
    const preview=clone(action.base);
    moveSelection(preview,[...selection],dx,dy);
    action.preview=preview;action.delta={dx,dy};action.moved=!!(dx||dy);
    render();return;
  }
  if(action.kind==="resize"){
    const base=action.base.nodes.find(n=>n.id===action.id);
    if(!base)return;
    const raw={x:p.x-action.start.x,y:p.y-action.start.y};
    const delta=session.grid?{x:snap(raw.x),y:snap(raw.y)}:raw;
    const preview=clone(action.base);
    setBounds(preview,action.id,resizeBounds(base,action.handle,delta));
    action.preview=preview;render();return;
  }
  action.current=p;
  if(action.kind==="freehand"){
    const last=action.points.at(-1);
    if(Math.hypot(p.x-last.x,p.y-last.y)>=tolerance(2)&&action.points.length<10000)
      action.points.push({x:p.x,y:p.y,t:Math.max(0,Math.round(time-action.time))});
  }
  drawOverlay();
}

function end(point,time=performance.now()){
  const action=session.interaction;
  if(!action)return;
  if(point)move(point,time);
  session.interaction=null;
  session.activeGuides=[];
  if(action.kind==="pan"){render();return}
  if(action.kind==="move"){
    if(!action.moved){render();return}
    const{dx,dy}=action.delta;
    const ids=[...selection];
    const moved=commit("Move selection",doc=>moveSelection(doc,ids,dx,dy));
    breakContinuity();
    if(moved)tutorial.report("moved")&&renderTutorial();
    return;
  }
  if(action.kind==="resize"){
    const bounds=action.preview.nodes.find(n=>n.id===action.id);
    if(!bounds){render();return}
    const target={x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
    commit("Resize shape",doc=>setBounds(doc,action.id,target));
    breakContinuity();return;
  }
  if(action.kind==="marquee"){
    const rect=normalizeRect(action.start,action.current);
    if(rect.width>2&&rect.height>2){
      const ids=marqueeSelect(store.doc,rect);
      setSelection(action.additive?[...new Set([...action.baseSelection,...ids])]:ids);
      if(ids.length)tutorial.report("selected")&&renderTutorial();
    }else render();
    return;
  }
  if(action.kind==="connector"){
    const target=nearestPort(store.doc,action.current,tolerance(18));
    const to=target?{type:"port",nodeId:target.nodeId,port:target.port}:{type:"point",x:action.current.x,y:action.current.y};
    if(action.start.type==="port"&&to.type==="port"&&action.start.nodeId===to.nodeId){setStatus("A connector must end on a different shape.");render();return}
    if(Math.hypot(action.current.x-action.startPoint.x,action.current.y-action.startPoint.y)<tolerance(8)){render();return}
    const added=commit("Add connector",doc=>addEdge(doc,{id:uid("edge"),from:action.start,to,routing:"straight",label:"",style:defaultStyle()}));
    breakContinuity();
    if(added)tutorial.report("edgeAdded")&&renderTutorial();
    return;
  }
  if(action.kind==="freehand"){
    if(action.points.length<2){render();return}
    const id=uid("stroke"),points=action.points.map(p=>({...p}));
    if(!commit("Add stroke",doc=>addStroke(doc,{id,points,style:{...defaultStyle(),fill:"none"}})))return;
    tutorial.report("strokeAdded")&&renderTutorial();
    // startedAt and endedAt share one clock per input source, which is what
    // arrow pairing compares against its grouping window.
    proposeFor({id,points,startedAt:action.time,endedAt:time,epoch:session.epoch,source:action.source||"pointer"});
    return;
  }
  if(["rectangle","circle","diamond"].includes(action.kind)){
    const a=gridPoint(action.start),b=gridPoint(action.current);
    const width=Math.abs(b.x-a.x),height=Math.abs(b.y-a.y);
    if(Math.max(width,height)<8){render();return}
    let x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=width,h=height;
    if(action.kind==="circle"){w=h=Math.max(width,height);x=b.x<a.x?a.x-w:a.x;y=b.y<a.y?a.y-h:a.y}
    const node={id:uid("node"),kind:action.kind,x,y,width:w,height:h,label:"",style:defaultStyle()};
    const added=commit(`Add ${action.kind}`,doc=>addNode(doc,node));
    breakContinuity();
    if(added)setSelection([node.id]);
  }
}

function cancelInteraction(){
  if(!session.interaction)return;
  session.interaction=null;session.activeGuides=[];render();
}

/* ---------- recognition proposals ---------- */

function proposeFor(stroke){
  const previous=session.lastStroke;
  session.lastStroke=stroke;
  const arrow=previous?pairArrow(previous,stroke):null;
  if(arrow){showCandidate({kind:"arrow",result:arrow,sourceIds:arrow.sourceIds});return}
  const shape=classifyStroke(stroke.points);
  if(shape)showCandidate({kind:"shape",result:shape,sourceIds:[stroke.id]});
}

function showCandidate(candidate){
  session.candidate={...candidate,revision:store.revision};
  const{result}=candidate;
  $("candidateText").textContent=`Convert to ${result.kind}? Match quality ${Math.round(result.score*100)} of 100.`;
  const alternative=result.alternatives?.[0];
  const altButton=$("altCandidate");
  altButton.hidden=!alternative;
  if(alternative){altButton.textContent=`Use ${alternative.kind}`;altButton.dataset.kind=alternative.kind}
  $("candidate").hidden=false;
  $("acceptCandidate").focus({preventScroll:true});
  setStatus(alternative
    ?`Recognition is unsure between ${result.kind} and ${alternative.kind}. Accept one or keep the original stroke.`
    :`Recognition proposes a ${result.kind}. Accept it or keep the original stroke.`);
}

function dismissCandidate(){session.candidate=null;$("candidate").hidden=true;$("altCandidate").hidden=true}

function acceptCandidate(preferred){
  const candidate=session.candidate;
  if(!candidate)return;
  // A proposal computed against an older document must not be applied blindly.
  if(candidate.revision!==store.revision){dismissCandidate();setStatus("The proposal expired because the diagram changed. Draw again to retry.");render();return}
  const chosen=preferred&&candidate.result.alternatives?.find(c=>c.kind===preferred)||candidate.result;
  let replacement;
  if(candidate.kind==="arrow"){
    replacement={edge:{id:uid("edge"),from:{type:"point",...candidate.result.from},to:{type:"point",...candidate.result.to},routing:"straight",label:"",style:defaultStyle()}};
  }else{
    const b=chosen.bounds;
    const width=Math.max(8,b.width),height=chosen.kind==="circle"?width:Math.max(8,b.height);
    replacement={node:{id:uid("node"),kind:chosen.kind,x:b.x,y:b.y,width,height,label:"",style:defaultStyle()}};
  }
  const ids=candidate.sourceIds;
  let applied=false;
  try{applied=store.execute("Convert stroke",doc=>{if(!convertStrokes(doc,ids,replacement))throw new Error("The original stroke is no longer present.")})}
  catch(error){dismissCandidate();setStatus(`Conversion cancelled: ${error.message}`);render();return}
  dismissCandidate();breakContinuity();
  if(applied)setSelection([replacement.node?.id||replacement.edge.id]);
  setStatus(`Converted to ${chosen.kind}. Undo restores the original stroke.`);
  tutorial.report("candidateResolved")&&renderTutorial();
}

function rejectCandidate({silent=false}={}){
  if(!session.candidate)return;
  dismissCandidate();
  if(!silent){setStatus("Kept the original freehand stroke.");tutorial.report("candidateResolved")&&renderTutorial()}
  render();
}

/* ---------- selection commands ---------- */

function removeSelection(){
  if(!selection.size)return;
  const ids=[...selection];
  const removed=commit("Delete selection",doc=>deleteFrom(doc,ids));
  breakContinuity();
  if(removed)setSelection([]);
}

function duplicate(){
  if(!selection.size)return;
  const ids=[...selection];
  let created=[];
  commit("Duplicate selection",doc=>{created=duplicateSelection(doc,ids)});
  breakContinuity();
  if(created.length){setSelection(created);setStatus(`Duplicated ${created.length} object${created.length===1?"":"s"}.`)}
}

function nudge(dx,dy){
  if(!selection.size)return;
  const ids=[...selection],now=performance.now();
  const coalesce=now-session.lastNudgeAt<600;
  session.lastNudgeAt=now;
  const apply=doc=>moveSelection(doc,ids,dx,dy);
  try{coalesce?store.amend("Nudge selection",apply):store.execute("Nudge selection",apply)}
  catch(error){setStatus(`Nudge rejected: ${error.message}`);render()}
  breakContinuity();
}

/* ---------- overlay ---------- */

function drawOverlay(){
  const rect=stage.getBoundingClientRect(),dpr=devicePixelRatio||1;
  const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
  if(overlay.width!==width||overlay.height!==height){overlay.width=width;overlay.height=height}
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,rect.width,rect.height);
  const action=session.interaction;
  if(action&&action.kind!=="pan"&&action.kind!=="move"&&action.kind!=="resize"){
    const zoom=session.viewport.zoom;
    ctx.save();
    ctx.translate(session.viewport.panX,session.viewport.panY);ctx.scale(zoom,zoom);
    ctx.strokeStyle="#2563eb";ctx.lineWidth=2/zoom;ctx.setLineDash([6/zoom,4/zoom]);
    if(action.kind==="freehand"){
      ctx.setLineDash([]);ctx.beginPath();
      action.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      ctx.stroke();
    }else if(action.kind==="marquee"){
      const r=normalizeRect(action.start,action.current);
      ctx.fillStyle="#2563eb1a";ctx.fillRect(r.x,r.y,r.width,r.height);ctx.strokeRect(r.x,r.y,r.width,r.height);
    }else if(action.kind==="connector"){
      ctx.beginPath();ctx.moveTo(action.startPoint.x,action.startPoint.y);ctx.lineTo(action.current.x,action.current.y);ctx.stroke();
    }else if(["rectangle","circle","diamond"].includes(action.kind)){
      const x=Math.min(action.start.x,action.current.x),y=Math.min(action.start.y,action.current.y);
      const w=Math.abs(action.current.x-action.start.x),h=Math.abs(action.current.y-action.start.y);
      ctx.beginPath();
      if(action.kind==="circle")ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2);
      else if(action.kind==="diamond"){ctx.moveTo(x+w/2,y);ctx.lineTo(x+w,y+h/2);ctx.lineTo(x+w/2,y+h);ctx.lineTo(x,y+h/2);ctx.closePath()}
      else ctx.roundRect(x,y,w,h,8);
      ctx.stroke();
    }
    ctx.restore();
  }
  if(session.cursor){
    const drawing=session.camera===STATES.drawing;
    ctx.beginPath();ctx.arc(session.cursor.x,session.cursor.y,drawing?6:8,0,Math.PI*2);
    ctx.fillStyle=!session.cursorInside?"#94a3b8":drawing?"#ef4444":"#2563eb";
    ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.setLineDash([]);ctx.stroke();
  }
  if(session.hand&&$("debugToggle").checked&&window.drawConnectors){
    const landmarks=session.hand.map(p=>({x:$("mirrorToggle").checked?1-p.x:p.x,y:p.y,z:p.z}));
    try{
      window.drawConnectors(ctx,landmarks,window.HAND_CONNECTIONS,{color:"#22c55e",lineWidth:2});
      window.drawLandmarks(ctx,landmarks,{color:"#ef4444",radius:2});
    }catch{/* overlay is cosmetic */}
  }
}

/* ---------- pointer, wheel and keyboard ---------- */

stage.addEventListener("pointerdown",event=>{
  if(session.candidate&&event.button===0)return;
  const pan=event.button===1||(event.button===0&&session.spaceDown);
  if(event.button!==0&&!pan)return;
  stage.setPointerCapture(event.pointerId);
  stage.focus({preventScroll:true});
  begin(stagePoint(event),performance.now(),{shift:event.shiftKey,pan});
  event.preventDefault();
});
stage.addEventListener("pointermove",event=>{if(session.interaction)move(stagePoint(event),performance.now())});
stage.addEventListener("pointerup",event=>{if(session.interaction)end(stagePoint(event),performance.now())});
stage.addEventListener("pointercancel",cancelInteraction);
stage.addEventListener("dblclick",()=>{if(selection.size===1)$("labelInput").focus()});
stage.addEventListener("wheel",event=>{
  event.preventDefault();
  if(session.interaction)return;
  const anchor=stagePoint(event),factor=event.deltaY<0?1.1:.9;
  session.viewport=zoomAbout(session.viewport,anchor,session.viewport.zoom*factor);
  render();
},{passive:false});

document.querySelectorAll("[data-tool]").forEach(button=>button.addEventListener("click",()=>setTool(button.dataset.tool)));
$("undoBtn").onclick=()=>{breakContinuity();dismissCandidate();store.undo()};
$("redoBtn").onclick=()=>{breakContinuity();dismissCandidate();store.redo()};
$("deleteBtn").onclick=removeSelection;
$("duplicateBtn").onclick=duplicate;
$("acceptCandidate").onclick=()=>acceptCandidate();
$("altCandidate").onclick=event=>acceptCandidate(event.currentTarget.dataset.kind);
$("rejectCandidate").onclick=()=>rejectCandidate();

$("newBtn").onclick=async()=>{
  if(session.dirty&&!confirm("Discard unsaved changes and start a new diagram?"))return;
  selection.clear();breakContinuity();dismissCandidate();
  store.replace(createDocument());
  await autosave.clear();
  session.dirty=false;setStatus("New diagram.");
};
$("saveBtn").onclick=()=>{saveJson(store.doc);session.dirty=false;$("saveState").textContent="Downloaded"};
$("openBtn").onclick=()=>$("fileInput").click();
$("fileInput").onchange=async event=>{
  const file=event.target.files[0];
  try{
    if(!file)return;
    const doc=await openJson(file);
    selection.clear();breakContinuity();dismissCandidate();
    store.replace(doc);
    setStatus(`Opened ${file.name}.`);
  }catch(error){setStatus(`Open failed: ${error.message}`)}
  finally{event.target.value=""}
};
$("svgBtn").onclick=()=>{
  try{exportSvg(store.doc);setStatus("Exported SVG.");tutorial.report("exported")&&renderTutorial()}
  catch(error){setStatus(`SVG export failed: ${error.message}`)}
};
$("pngBtn").onclick=async()=>{
  try{
    const result=await exportPng(store.doc,{scale:Number($("pngScale").value),background:$("pngTransparent").checked?null:"#ffffff"});
    setStatus(result.reduced?`Exported PNG at reduced ${result.width}×${result.height} to stay within limits.`:`Exported PNG at ${result.width}×${result.height}.`);
    tutorial.report("exported")&&renderTutorial();
  }catch(error){setStatus(`PNG export failed: ${error.message}`)}
};

$("inspectorForm").onsubmit=event=>{
  event.preventDefault();
  const id=[...selection][0],object=findAny(store.doc,id);
  if(!object)return;
  const isNode="width"in object,isEdge=!!object.from;
  const label=$("labelInput").value,stroke=$("strokeInput").value,fill=$("fillInput").value;
  const routing=$("routingInput").value;
  const bounds=isNode?{x:Number($("xInput").value),y:Number($("yInput").value),width:Number($("widthInput").value),height:Number($("heightInput").value)}:null;
  const applied=commit("Update object",doc=>{
    if(isNode||isEdge)setLabel(doc,id,label);
    setStyle(doc,id,isNode?{stroke,fill}:{stroke});
    if(bounds&&Number.isFinite(bounds.x)&&Number.isFinite(bounds.y)&&Number.isFinite(bounds.width)&&Number.isFinite(bounds.height))setBounds(doc,id,bounds);
    if(isEdge)doc.edges.find(e=>e.id===id).routing=routing;
  });
  breakContinuity();
  inspectorDirty=false;
  if(applied)setStatus("Applied inspector changes.");
};

$("inspectorForm").addEventListener("input",()=>{inspectorDirty=true});
$("gridToggle").onchange=event=>{session.grid=event.target.checked};
$("guideToggle").onchange=event=>{session.guides=event.target.checked;session.activeGuides=[];render()};
const setZoom=value=>{
  const anchor={x:stage.clientWidth/2,y:stage.clientHeight/2};
  session.viewport=zoomAbout(session.viewport,anchor,value);render();
};
$("zoomOut").onclick=()=>setZoom(session.viewport.zoom/1.25);
$("zoomIn").onclick=()=>setZoom(session.viewport.zoom*1.25);
$("zoomReset").onclick=()=>{session.viewport={panX:0,panY:0,zoom:1};render()};

const TOOL_KEYS={v:"select",p:"freehand",r:"rectangle",o:"circle",d:"diamond",c:"connector"};
const NUDGE={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
const typing=target=>/^(input|textarea|select)$/i.test(target?.tagName)||target?.isContentEditable;

document.addEventListener("keydown",event=>{
  if(typing(event.target))return;
  if(event.key===" "&&!session.spaceDown){session.spaceDown=true;stage.classList.add("panning");if(event.target===stage)event.preventDefault();return}
  // A visible proposal suspends every other shortcut. Enter on a focused panel
  // button is left to the browser so the button activates itself exactly once.
  if(session.candidate){
    const onPanel=!!event.target?.closest?.("#candidate");
    if(event.key==="Enter"&&!onPanel){event.preventDefault();acceptCandidate()}
    else if(event.key==="Escape"){event.preventDefault();rejectCandidate()}
    return;
  }
  const modifier=event.ctrlKey||event.metaKey;
  if(modifier&&event.key.toLowerCase()==="z"){event.preventDefault();breakContinuity();event.shiftKey?store.redo():store.undo();return}
  if(modifier&&event.key.toLowerCase()==="d"){event.preventDefault();duplicate();return}
  if(modifier)return;
  if(NUDGE[event.key]&&selection.size){event.preventDefault();const[dx,dy]=NUDGE[event.key];const step=event.shiftKey?10:1;nudge(dx*step,dy*step);return}
  if(TOOL_KEYS[event.key.toLowerCase()]){setTool(TOOL_KEYS[event.key.toLowerCase()]);return}
  if(event.key==="Delete"||event.key==="Backspace"){if(selection.size){event.preventDefault();removeSelection()}return}
  if(event.key==="Enter"&&selection.size===1){event.preventDefault();$("labelInput").focus();return}
  if(event.key==="Escape")cancelInteraction();
});
document.addEventListener("keyup",event=>{if(event.key===" "){session.spaceDown=false;stage.classList.remove("panning")}});
window.addEventListener("blur",()=>{session.spaceDown=false;stage.classList.remove("panning")});

/* ---------- gestures and camera ---------- */

function describeState(state){
  return{drawing:"Drawing",dragging:"Dragging",pointing:"Tracking hand",idle:"Hand not found",unavailable:"Hand too far away",off:"Camera off",starting:"Starting camera",error:"Camera unavailable",ready:"Camera ready"}[state]||state;
}
function paintGestureState(state,detail){
  const card=$("gestureState");
  card.dataset.state=state;
  card.querySelector("strong").textContent=describeState(state);
  card.querySelector("small").textContent=session.calibrating?"Calibrating"
    :state==="off"?"Mouse editing is ready"
    :session.armed?"Gesture input armed":"Gesture input paused";
  if(detail==="outOfRegion")setStatus("Your hand left the calibrated drawing area, so the stroke ended.");
}

const gesture=new GestureController({
  state:(state,detail)=>{session.camera=state;paintGestureState(state,detail);drawOverlay()},
  cursor:(point,hand,inside)=>{session.cursor=point;session.hand=hand;session.cursorInside=inside!==false;session.lastLandmark={x:hand[8].x,y:hand[8].y};drawOverlay()},
  target:point=>hitTest(store.doc,toDoc(point),tolerance(10)),
  select:target=>{if(!selection.has(target.id)){setSelection([target.id]);tutorial.report("selected")&&renderTutorial()}},
  begin:(point,time)=>{begin(point,time);if(session.interaction)session.interaction.source="gesture"},
  move:(point,time)=>move(point,time),
  end:(reason,time)=>{
    if(reason==="penUp"){tutorial.report("penUp")&&renderTutorial()}
    end(undefined,Number.isFinite(time)?time:performance.now());
  },
  dragBegin:point=>begin(point),
  dragMove:point=>move(point),
  dragEnd:point=>end(point),
  cancel:()=>cancelInteraction(),
  calibrationFrame:(hand,now,imageWidth,imageHeight)=>advanceCalibration(hand,now,imageWidth,imageHeight),
});

const camera=new CameraController(video,(results,time)=>gesture.update(results,time,{
  mirror:$("mirrorToggle").checked,
  stageWidth:stage.clientWidth,stageHeight:stage.clientHeight,
  imageWidth:video.videoWidth,imageHeight:video.videoHeight,
  tau:Number($("smoothing").value),
  armed:session.armed,tool:session.tool,
  calibration:session.calibration,
  calibrating:!!session.calibrating,
}),(state,error)=>{
  session.camera=state;
  $("cameraPlaceholder").hidden=state==="ready";
  $("armToggle").disabled=state!=="ready";
  $("calibrateBtn").disabled=state!=="ready";
  $("cornerBtn").disabled=state!=="ready";
  $("cameraBtn").textContent=state==="ready"?"Disable camera":state==="starting"?"Starting…":"Enable camera";
  $("cameraBtn").disabled=state==="starting";
  paintGestureState(state);
  if(state==="ready"){startWatchdog();tutorial.report("cameraReady")&&renderTutorial()}
  if(state!=="ready")stopWatchdog();
  if(state==="error")setStatus(`Camera unavailable: ${error?.message||"unknown error"}. Mouse editing remains available.`);
  if(state==="off"){
    session.cursor=null;session.hand=null;session.armed=false;session.calibrating=null;
    $("armToggle").checked=false;gesture.reset();drawOverlay();
  }
});

$("cameraBtn").onclick=async()=>{
  if(camera.running){camera.stop();return}
  try{await camera.start()}catch{/* state callback already reported it */}
};
$("armToggle").onchange=event=>{
  session.armed=event.target.checked;
  if(!session.armed&&session.interaction)end();
  paintGestureState(session.camera);
  setStatus(session.armed?"Gesture input armed. Touch thumb to pinky once to ready the pen.":"Gesture input paused.");
};
$("mirrorToggle").onchange=event=>{video.style.transform=event.target.checked?"scaleX(-1)":"none"};

// Watchdog: a tracking callback that stops arriving must still end the stroke.
let watchdog=0;
const tick=()=>{gesture.checkStall(performance.now());watchdog=requestAnimationFrame(tick)};
const startWatchdog=()=>{if(!watchdog)watchdog=requestAnimationFrame(tick)};
const stopWatchdog=()=>{cancelAnimationFrame(watchdog);watchdog=0};

/* ---------- calibration ---------- */

function renderCalibration(){
  const element=$("calibrationState");
  if(session.calibrating){element.textContent=session.calibrating.prompt;return}
  const{pause,pinch,region,regionAccepted}=session.calibration;
  const parts=[];
  parts.push(pause.accepted?`Pen thresholds ${pause.enter.toFixed(2)}/${pause.release.toFixed(2)}`:"Default pen thresholds");
  parts.push(pinch.accepted?`pinch ${pinch.enter.toFixed(2)}/${pinch.release.toFixed(2)}`:"default pinch");
  parts.push(regionAccepted?`input area ${Math.round(region.width*100)}% × ${Math.round(region.height*100)}%`:"full camera area");
  element.textContent=`${parts.join(", ")}.`;
}

function startCalibration(){
  if(!camera.running){setStatus("Enable the camera before calibrating.");return}
  calibrator.reset();
  // Keep the previous calibration so cancelling really does keep it.
  session.calibrating={queue:CALIBRATION_PHASES.slice(),prompt:"",started:false,previous:session.calibration};
  session.calibration=defaultCalibration();
  $("calibrateBtn").textContent="Cancel";
  nextCalibrationPhase(performance.now());
}

function nextCalibrationPhase(now){
  const state=session.calibrating;
  if(!state)return;
  const next=state.queue.shift();
  if(!next){finishCalibration();return}
  state.current=next;state.prompt=`${next.prompt} Hold for one second.`;
  calibrator.begin(next.phase,now);
  renderCalibration();setStatus(state.prompt);
}

function advanceCalibration(hand,now,imageWidth,imageHeight){
  const state=session.calibrating;
  if(!state)return;
  const progress=calibrator.observe(hand,now,imageWidth,imageHeight);
  if(!progress.collecting)nextCalibrationPhase(now);
}

function finishCalibration(){
  const result=calibrator.finish();
  session.calibration={...result,region:result.region};
  session.calibrating=null;
  $("calibrateBtn").textContent="Calibrate";
  $("resetCalibrationBtn").disabled=!result.calibrated;
  renderCalibration();
  const notes=[result.pause.accepted?null:result.pause.reason,result.pinch.accepted?null:result.pinch.reason].filter(Boolean);
  setStatus(notes.length?`Calibration kept defaults. ${notes[0]}`:"Calibration applied for this session.");
  tutorial.report("calibrated")&&renderTutorial();
}

$("calibrateBtn").onclick=()=>{
  if(session.calibrating){
    session.calibration=session.calibrating.previous||defaultCalibration();
    session.calibrating=null;
    $("calibrateBtn").textContent="Calibrate";
    $("resetCalibrationBtn").disabled=!session.calibration.calibrated;
    renderCalibration();setStatus("Calibration cancelled. Previous thresholds kept.");
    return;
  }
  startCalibration();
};
$("cornerBtn").onclick=()=>{
  if(!session.lastLandmark){setStatus("No hand detected yet. Hold your hand in view, then set the corner.");return}
  const count=calibrator.captureCorner(session.lastLandmark);
  if(count<2){setStatus("First corner recorded. Move to the opposite corner and press Set corner again.");return}
  const result=calibrator.finish();
  // An accepted region counts as calibration on its own, so carry the flag and
  // enable Reset; otherwise the region could never be cleared from the UI.
  session.calibration={...session.calibration,region:result.region,regionAccepted:result.regionAccepted,calibrated:session.calibration.calibrated||result.regionAccepted};
  $("resetCalibrationBtn").disabled=!session.calibration.calibrated;
  renderCalibration();
  setStatus(result.regionAccepted?"Input area set for this session.":"Those corners are too close together, so the full camera area is kept.");
};
$("resetCalibrationBtn").onclick=()=>{
  calibrator.reset();session.calibration=defaultCalibration();session.calibrating=null;
  $("calibrateBtn").textContent="Calibrate";$("resetCalibrationBtn").disabled=true;
  renderCalibration();setStatus("Calibration reset to defaults.");
};

/* ---------- tutorial ---------- */

function renderTutorial(){
  const step=tutorial.current,card=$("tutorialCard");
  $("tutorialBtn").textContent=tutorial.active?"Stop tutorial":"Start tutorial";
  $("tutorialSkip").hidden=!step?.skippable;
  if(!step){
    card.hidden=true;
    if(tutorial.progress.done)setStatus("Tutorial complete. Every step is available again from Start tutorial.");
    return;
  }
  const{index,total}=tutorial.progress;
  card.hidden=false;
  $("tutorialTitle").textContent=`Step ${index+1} of ${total}: ${step.title}`;
  $("tutorialHint").textContent=step.hint;
  return true;
}
$("tutorialBtn").onclick=()=>{tutorial.active?tutorial.stop():tutorial.start();renderTutorial()};
$("tutorialSkip").onclick=()=>{tutorial.skip();renderTutorial()};

/* ---------- lifecycle ---------- */

window.addEventListener("resize",render);
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden)return;
  cancelInteraction();
  if(camera.running)camera.stop();
});
window.addEventListener("beforeunload",()=>{stopWatchdog();autosave.flush();camera.stop()});

(async()=>{
  renderCalibration();renderTutorial();render();
  const recovered=await autosave.load();
  if(!recovered)return;
  const count=recovered.document.nodes.length+recovered.document.strokes.length+recovered.document.edges.length;
  if(!count)return;
  const when=recovered.savedAt?new Date(recovered.savedAt).toLocaleString():"an earlier session";
  if(confirm(`Restore the locally recovered diagram from ${when}? Choosing Cancel discards it.`)){
    store.replace(recovered.document);
    setStatus("Restored the locally recovered diagram.");
  }else{
    await autosave.clear();
    setStatus("Discarded the local recovery copy.");
  }
})();

// Exposed for browser tests so replay fixtures can drive the same lifecycle.
window.drawingBoard={store,session,gesture,selection,setTool,render,
  document:()=>store.doc,
  replay(frames,config={}){for(const frame of frames)gesture.update(frame.results,frame.time,{stageWidth:stage.clientWidth,stageHeight:stage.clientHeight,tau:1,armed:true,tool:session.tool,calibration:session.calibration,...config})},
};
