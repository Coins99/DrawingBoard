import{test}from"node:test";
import assert from"node:assert/strict";
import{HISTORY_LIMIT,HistoryStore,createDocument,defaultStyle}from"../../DrawingBoard/src/document.js";
import{addNode}from"../../DrawingBoard/src/commands.js";

const rect=(id,x=0)=>({id,kind:"rectangle",x,y:0,width:60,height:40,label:"",style:defaultStyle()});

test("execute commits, reports success and notifies subscribers",()=>{
  const store=new HistoryStore(createDocument());
  const seen=[];
  store.subscribe((doc,self)=>seen.push(self.lastLabel));
  assert.equal(store.execute("Add rectangle",doc=>addNode(doc,rect("n1"))),true);
  assert.equal(store.doc.nodes.length,1);
  assert.deepEqual(seen,["Add rectangle"]);
});

test("a mutation that changes nothing adds no history entry",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add rectangle",doc=>addNode(doc,rect("n1")));
  assert.equal(store.execute("No change",()=>{}),false);
  assert.equal(store.undoStack.length,1);
});

test("an invalid mutation throws and leaves the document untouched",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add rectangle",doc=>addNode(doc,rect("n1")));
  const before=JSON.stringify(store.doc);
  assert.throws(()=>store.execute("Break it",doc=>{doc.nodes[0].width=-5}));
  assert.equal(JSON.stringify(store.doc),before);
  assert.equal(store.undoStack.length,1);
});

test("undo and redo restore exact states",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1",10)));
  store.execute("Add b",doc=>addNode(doc,rect("n2",80)));
  assert.equal(store.doc.nodes.length,2);
  store.undo();
  assert.deepEqual(store.doc.nodes.map(n=>n.id),["n1"]);
  store.undo();
  assert.equal(store.doc.nodes.length,0);
  assert.equal(store.canUndo,false);
  store.redo();store.redo();
  assert.deepEqual(store.doc.nodes.map(n=>n.id),["n1","n2"]);
  assert.equal(store.canRedo,false);
});

test("a new edit clears the redo stack",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1")));
  store.undo();
  assert.equal(store.canRedo,true);
  store.execute("Add b",doc=>addNode(doc,rect("n2")));
  assert.equal(store.canRedo,false);
});

test("undo does not alias the live document",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1")));
  store.execute("Move a",doc=>{doc.nodes[0].x=500});
  store.undo();
  store.doc.nodes[0].x=-999;
  store.redo();
  assert.equal(store.doc.nodes[0].x,500);
});

test("amend folds repeated actions into one undo entry",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1",0)));
  store.amend("Nudge selection",doc=>{doc.nodes[0].x+=1});
  store.amend("Nudge selection",doc=>{doc.nodes[0].x+=1});
  store.amend("Nudge selection",doc=>{doc.nodes[0].x+=1});
  assert.equal(store.doc.nodes[0].x,3);
  assert.equal(store.undoStack.length,2);
  store.undo();
  assert.equal(store.doc.nodes[0].x,0);
});

test("amend after a different label starts a new entry",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1")));
  store.amend("Nudge selection",doc=>{doc.nodes[0].x+=5});
  store.execute("Other",doc=>{doc.nodes[0].y+=5});
  store.amend("Nudge selection",doc=>{doc.nodes[0].x+=5});
  assert.equal(store.undoStack.length,4);
});

test("history is capped and drops the oldest entry",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1")));
  for(let i=0;i<HISTORY_LIMIT+5;i++)store.execute(`Move ${i}`,doc=>{doc.nodes[0].x+=1});
  assert.equal(store.undoStack.length,HISTORY_LIMIT);
  assert.equal(store.undoStack[0].label!=="Add a",true);
});

test("replace validates and clears history",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Add a",doc=>addNode(doc,rect("n1")));
  store.replace({...createDocument("Other"),nodes:[rect("n9")]});
  assert.equal(store.canUndo,false);
  assert.equal(store.doc.title,"Other");
  assert.throws(()=>store.replace({schemaVersion:9}));
  assert.equal(store.doc.title,"Other");
});

test("revision advances on every emit",()=>{
  const store=new HistoryStore(createDocument());
  const start=store.revision;
  store.execute("Add a",doc=>addNode(doc,rect("n1")));
  store.undo();
  store.redo();
  assert.equal(store.revision,start+3);
});
