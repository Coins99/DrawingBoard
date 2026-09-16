// Regression tests for defects found in review. Each one failed before its fix.
import{test}from"node:test";
import assert from"node:assert/strict";
import{Autosave}from"../../DrawingBoard/src/autosave.js";
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
