// Regression tests for defects found in review. Each one failed before its fix.
import{test}from"node:test";
import assert from"node:assert/strict";
import{Autosave,withFallback}from"../../DrawingBoard/src/autosave.js";
import{CameraController}from"../../DrawingBoard/src/camera.js";
import{MAX_PNG_PIXELS,MAX_PNG_SIDE,pngTargetSize}from"../../DrawingBoard/src/io.js";
import{createDocument,defaultStyle,validateDocument}from"../../DrawingBoard/src/document.js";
import{HANDLES,resizeBounds}from"../../DrawingBoard/src/geometry.js";

const rect=(id="n1")=>({id,kind:"rectangle",x:0,y:0,width:60,height:40,label:"",style:defaultStyle()});
const port=(nodeId,name)=>({type:"port",nodeId,port:name});
const edge=(extra={})=>({id:"e1",from:port("n1","north"),to:port("n1","south"),routing:"straight",label:"",style:defaultStyle(),...extra});

test("every circle handle can shrink the shape",()=>{
  const circle={kind:"circle",x:0,y:0,width:80,height:80};
  // A handle on one axis used to be floored by the untouched axis, so the
  // east, west, north and south handles could not shrink a circle at all.
  const inward={e:{x:-30,y:0},w:{x:30,y:0},n:{x:0,y:30},s:{x:0,y:-30},
    nw:{x:30,y:0},ne:{x:-30,y:0},se:{x:-30,y:0},sw:{x:30,y:0}};
  for(const handle of HANDLES){
    const result=resizeBounds(circle,handle,inward[handle]);
    assert.equal(result.width,result.height,`${handle} broke the aspect`);
    assert.ok(result.width<80,`${handle} could not shrink: ${result.width}`);
    assert.ok(result.width>=8,`${handle} went below the minimum`);
  }
});

test("a corner handle on a circle follows the larger requested delta",()=>{
  const circle={kind:"circle",x:0,y:0,width:60,height:60};
  assert.equal(resizeBounds(circle,"se",{x:40,y:5}).width,100);
  assert.equal(resizeBounds(circle,"se",{x:5,y:40}).width,100);
});

test("a collection that is present but not an array is rejected, not emptied",()=>{
  const base={...createDocument("x"),nodes:[],strokes:[],edges:[]};
  for(const broken of[{nodes:{a:1}},{strokes:"oops"},{edges:42},{nodes:null}]){
    const result=validateDocument({...base,...broken});
    assert.equal(result.ok,false,JSON.stringify(broken));
    assert.match(result.errors.join(" "),/must be an array/);
  }
  assert.equal(validateDocument(base).ok,true);
});

test("a missing collection is still treated as empty",()=>{
  const result=validateDocument({schemaVersion:1,title:"x"});
  assert.equal(result.ok,true);
  assert.deepEqual([result.document.nodes,result.document.strokes,result.document.edges],[[],[],[]]);
});

test("an edge that starts and ends at the same place is rejected",()=>{
  const withNode=extra=>({...createDocument("x"),nodes:[rect()],strokes:[],edges:[edge(extra)]});
  assert.equal(validateDocument(withNode()).ok,true);
  assert.equal(validateDocument(withNode({to:port("n1","north")})).ok,false);
  assert.equal(validateDocument({...createDocument("x"),nodes:[],strokes:[],
    edges:[edge({from:{type:"point",x:5,y:5},to:{type:"point",x:5,y:5}})]}).ok,false);
  assert.equal(validateDocument({...createDocument("x"),nodes:[],strokes:[],
    edges:[edge({from:{type:"point",x:5,y:5},to:{type:"point",x:5,y:6}})]}).ok,true);
});

test("clear cannot be overtaken by a write that is already in flight",async()=>{
  let record;
  const backend={
    name:"slow",
    put:value=>new Promise(resolve=>setTimeout(()=>{record=value;resolve()},40)),
    get:async()=>record,
    remove:async()=>{record=undefined},
  };
  const autosave=new Autosave({backend,debounce:0});
  autosave.schedule({...createDocument("Old work"),nodes:[rect()]},1);
  autosave.flush();
  await autosave.clear();
  assert.equal(await autosave.load(),null);
  // The discarded record must not come back once the pending write settles.
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(await autosave.load(),null);
});

test("a write after clear still lands",async()=>{
  const autosave=new Autosave({backend:{name:"memory",
    put:async value=>{autosave._record=value},get:async()=>autosave._record,remove:async()=>{autosave._record=undefined}},debounce:0});
  autosave.schedule({...createDocument("First"),nodes:[rect()]},1);
  await autosave.flush();
  await autosave.clear();
  autosave.schedule({...createDocument("Second"),nodes:[rect()]},2);
  await autosave.flush();
  assert.equal((await autosave.load()).document.title,"Second");
});

test("an oversized export is scaled below one tenth rather than clamped",()=>{
  // Coordinates run to +/-1e6, so a valid diagram can be millions of units wide.
  // A 0.1 floor on the scale factor produced a canvas the browser refused to draw.
  const{width,height,applied}=pngTargetSize(2_000_000,1200,2);
  assert.ok(applied<.1,`factor was not reduced: ${applied}`);
  assert.ok(width<=MAX_PNG_SIDE&&height<=MAX_PNG_SIDE,`${width}x${height} exceeds the side cap`);
  assert.ok(width*height<=MAX_PNG_PIXELS);
  assert.ok(width>=1&&height>=1);
  // Ordinary diagrams still get the requested factor.
  assert.equal(pngTargetSize(800,600,2).applied,2);
});

test("a backend that fails asynchronously falls back to the secondary",async()=>{
  // indexedDB.open() rejects long after pickBackend() returned, so the synchronous
  // try around the constructor never saw the failure and recovery was lost entirely.
  const failing={name:"indexeddb",put:async()=>{throw new Error("storage blocked")},
    get:async()=>{throw new Error("storage blocked")},remove:async()=>{throw new Error("storage blocked")}};
  let record;
  const secondary={name:"localstorage",put:async value=>{record=value},get:async()=>record,remove:async()=>{record=undefined}};
  const backend=withFallback(failing,secondary);
  const autosave=new Autosave({backend,debounce:0});
  autosave.schedule({...createDocument("Recovered"),nodes:[rect()]},1);
  await autosave.flush();
  assert.equal(autosave.available,true);
  assert.equal(backend.name,"localstorage");
  assert.equal((await autosave.load()).document.title,"Recovered");
});

test("the camera stream is released when the model fails to load",async()=>{
  const stopped=[];
  const track={kind:"video",stop(){stopped.push(this)},addEventListener(){}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const globals={navigator:{mediaDevices:{getUserMedia:async()=>stream}},window:{},
    requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{}};
  const saved=new Map();
  for(const[key,value]of Object.entries(globals)){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  }
  try{
    // window.Hands is missing, as when the CDN is blocked. The controller used to
    // throw before storing the stream, so stop() had no tracks and the camera
    // stayed live while the UI reported it as unavailable.
    const camera=new CameraController({srcObject:null,play:async()=>{},readyState:0},()=>{},()=>{});
    await assert.rejects(camera.start(),/hand-tracking model/);
    assert.equal(stopped.length,1);
    assert.equal(camera.stream,null);
  }finally{
    for(const[key,descriptor]of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];
  }
});
