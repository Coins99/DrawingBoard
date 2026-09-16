import{test}from"node:test";
import assert from"node:assert/strict";
import{Autosave,createMemoryBackend,localStorageBackend}from"../../DrawingBoard/src/autosave.js";
import{createDocument,defaultStyle}from"../../DrawingBoard/src/document.js";

const rect=(id,x=0)=>({id,kind:"rectangle",x,y:0,width:60,height:40,label:"",style:defaultStyle()});
const docWith=(...nodes)=>({...createDocument("Saved"),nodes});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test("a scheduled save is debounced and lands once",async()=>{
  const backend=createMemoryBackend();
  const writes=[];
  const wrapped={...backend,put:async record=>{writes.push(record);return backend.put(record)}};
  const autosave=new Autosave({backend:wrapped,debounce:5});
  autosave.schedule(docWith(rect("a")),1);
  autosave.schedule(docWith(rect("a",10)),2);
  autosave.schedule(docWith(rect("a",20)),3);
  await autosave.flush();
  assert.equal(writes.length,1);
  assert.equal(writes[0].revision,3);
  assert.equal(writes[0].document.nodes[0].x,20);
});

test("status reports pending then saved",async()=>{
  const states=[];
  const autosave=new Autosave({backend:createMemoryBackend(),debounce:5,onStatus:state=>states.push(state)});
  autosave.schedule(docWith(rect("a")),1);
  await autosave.flush();
  assert.deepEqual(states,["pending","saved"]);
});

test("an older write cannot overtake a newer one",async()=>{
  const backend=createMemoryBackend();
  const autosave=new Autosave({backend,debounce:0});
  autosave.schedule(docWith(rect("a",99)),5);
  await autosave.flush();
  // Simulate a late save carrying a stale revision.
  autosave.schedule(docWith(rect("a",1)),2);
  await autosave.flush();
  const record=await backend.get();
  assert.equal(record.revision,5);
  assert.equal(record.document.nodes[0].x,99);
});

test("writes are serialized in order even when the backend resolves slowly",async()=>{
  const order=[];
  let delay=20;
  const backend={
    name:"slow",
    put:record=>new Promise(resolve=>{const wait=delay;delay=0;setTimeout(()=>{order.push(record.revision);resolve()},wait)}),
    get:async()=>undefined,remove:async()=>{},
  };
  const autosave=new Autosave({backend,debounce:0});
  autosave.schedule(docWith(rect("a",1)),1);
  autosave.flush();
  autosave.schedule(docWith(rect("a",2)),2);
  await autosave.flush();
  assert.deepEqual(order,[1,2]);
});

test("saved is reported only after the write resolves",async()=>{
  let release;
  const backend={name:"gated",put:()=>new Promise(resolve=>{release=resolve}),get:async()=>undefined,remove:async()=>{}};
  const states=[];
  const autosave=new Autosave({backend,debounce:0,onStatus:state=>states.push(state)});
  autosave.schedule(docWith(rect("a")),1);
  const pending=autosave.flush();
  await settle();
  assert.deepEqual(states,["pending"]);
  release();
  await pending;
  assert.deepEqual(states,["pending","saved"]);
});

test("a failing backend reports an error and keeps the editor usable",async()=>{
  const backend={name:"broken",put:async()=>{throw new Error("quota exceeded")},get:async()=>undefined,remove:async()=>{}};
  const seen=[];
  const autosave=new Autosave({backend,debounce:0,onStatus:(state,detail)=>seen.push([state,detail?.error?.message])});
  autosave.schedule(docWith(rect("a")),1);
  await autosave.flush();
  assert.deepEqual(seen,[["pending",undefined],["error","quota exceeded"]]);
  assert.equal(autosave.available,false);
});

test("no backend reports unavailable and never throws",async()=>{
  const seen=[];
  const autosave=new Autosave({backend:null,onStatus:state=>seen.push(state)});
  autosave.schedule(docWith(rect("a")),1);
  await autosave.flush();
  assert.equal(await autosave.load(),null);
  await autosave.clear();
  assert.deepEqual(seen,["unavailable","unavailable"]);
});

test("load validates the stored document and returns the timestamp",async()=>{
  const backend=createMemoryBackend();
  const autosave=new Autosave({backend,debounce:0,now:()=>1700000000000});
  autosave.schedule(docWith(rect("a",42)),1);
  await autosave.flush();
  const loaded=await autosave.load();
  assert.equal(loaded.document.nodes[0].x,42);
  assert.equal(loaded.savedAt,1700000000000);
  assert.equal(loaded.revision,1);
});

test("load discards a damaged or foreign record",async()=>{
  const backend=createMemoryBackend();
  await backend.put({revision:1,savedAt:1,document:{schemaVersion:99,nodes:[]}});
  assert.equal(await new Autosave({backend}).load(),null);
  await backend.put({revision:1,savedAt:1});
  assert.equal(await new Autosave({backend}).load(),null);
  await backend.put({revision:1,savedAt:1,document:{...createDocument(),nodes:[rect("dup"),rect("dup")]}});
  assert.equal(await new Autosave({backend}).load(),null);
});

test("load survives a backend that throws",async()=>{
  const backend={name:"broken",put:async()=>{},get:async()=>{throw new Error("closed")},remove:async()=>{}};
  assert.equal(await new Autosave({backend}).load(),null);
});

test("clear cancels a pending save and removes the record",async()=>{
  const backend=createMemoryBackend();
  const autosave=new Autosave({backend,debounce:50});
  autosave.schedule(docWith(rect("a")),1);
  await autosave.clear();
  await autosave.flush();
  assert.equal(await backend.get(),undefined);
});

test("the localStorage backend round-trips through a minimal storage object",async()=>{
  const map=new Map();
  const storage={getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};
  const backend=localStorageBackend(storage);
  const autosave=new Autosave({backend,debounce:0});
  autosave.schedule(docWith(rect("a",7)),1);
  await autosave.flush();
  assert.equal(map.size,1);
  assert.equal((await autosave.load()).document.nodes[0].x,7);
  await autosave.clear();
  assert.equal(map.size,0);
  assert.equal(localStorageBackend(null),null);
});
