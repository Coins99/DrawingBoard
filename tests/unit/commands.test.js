import{test}from"node:test";
import assert from"node:assert/strict";
import{HistoryStore,createDocument,defaultStyle}from"../../DrawingBoard/src/document.js";
import{DUPLICATE_OFFSET,addEdge,addNode,addStroke,convertStrokes,deleteSelection,duplicateSelection,moveSelection,setBounds,setLabel}from"../../DrawingBoard/src/commands.js";
import{pointAtPort,resolveEndpoint}from"../../DrawingBoard/src/geometry.js";

const rect=(id,x=0,y=0)=>({id,kind:"rectangle",x,y,width:80,height:60,label:"",style:defaultStyle()});
const port=(nodeId,name)=>({type:"port",nodeId,port:name});

function twoConnectedNodes(){
  const store=new HistoryStore(createDocument());
  store.execute("Build",doc=>{
    addNode(doc,rect("a",0,0));
    addNode(doc,rect("b",200,0));
    addEdge(doc,{id:"e1",from:port("a","east"),to:port("b","west")});
  });
  return store;
}

test("deleting a node removes its edges in one reversible transaction",()=>{
  const store=twoConnectedNodes();
  store.execute("Delete",doc=>deleteSelection(doc,["a"]));
  assert.deepEqual(store.doc.nodes.map(n=>n.id),["b"]);
  assert.equal(store.doc.edges.length,0);
  store.undo();
  assert.deepEqual(store.doc.nodes.map(n=>n.id),["a","b"]);
  assert.equal(store.doc.edges.length,1);
  assert.deepEqual(store.doc.edges[0].from,port("a","east"));
});

test("moving a node carries its attached edge without translating it twice",()=>{
  const store=twoConnectedNodes();
  const before=resolveEndpoint(store.doc,store.doc.edges[0].from);
  store.execute("Move",doc=>moveSelection(doc,["a","e1"],30,10));
  const after=resolveEndpoint(store.doc,store.doc.edges[0].from);
  assert.deepEqual(after,{x:before.x+30,y:before.y+10});
  assert.deepEqual(store.doc.edges[0].from,port("a","east"));
});

test("moving only a free-point edge translates its endpoints once",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Build",doc=>addEdge(doc,{id:"e1",from:{type:"point",x:0,y:0},to:{type:"point",x:50,y:50}}));
  store.execute("Move",doc=>moveSelection(doc,["e1"],5,7));
  assert.deepEqual(store.doc.edges[0].from,{type:"point",x:5,y:7});
  assert.deepEqual(store.doc.edges[0].to,{type:"point",x:55,y:57});
});

test("resizing a node moves its ports with it",()=>{
  const store=twoConnectedNodes();
  store.execute("Resize",doc=>setBounds(doc,"a",{x:0,y:0,width:160,height:60}));
  assert.deepEqual(resolveEndpoint(store.doc,store.doc.edges[0].from),pointAtPort(store.doc.nodes[0],"east"));
  assert.equal(resolveEndpoint(store.doc,store.doc.edges[0].from).x,160);
});

test("setBounds keeps circles square and enforces the minimum size",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Build",doc=>addNode(doc,{...rect("c"),kind:"circle",width:60,height:60}));
  store.execute("Resize",doc=>setBounds(doc,"c",{x:0,y:0,width:120,height:20}));
  assert.equal(store.doc.nodes[0].width,120);
  assert.equal(store.doc.nodes[0].height,120);
  store.execute("Shrink",doc=>setBounds(doc,"c",{x:0,y:0,width:1,height:1}));
  assert.equal(store.doc.nodes[0].width,8);
});

test("duplicate creates new ids, offsets copies and copies internal edges only",()=>{
  const store=twoConnectedNodes();
  store.execute("Add outside",doc=>{
    addNode(doc,rect("c",400,0));
    addEdge(doc,{id:"e2",from:port("b","east"),to:port("c","west")});
  });
  let created=[];
  let counter=0;
  store.execute("Duplicate",doc=>{created=duplicateSelection(doc,["a","b"],{newId:prefix=>`${prefix}-copy-${++counter}`})});
  assert.equal(created.length,3);
  const copies=store.doc.nodes.filter(n=>n.id.includes("copy"));
  assert.equal(copies.length,2);
  assert.equal(copies[0].x,DUPLICATE_OFFSET);
  const copiedEdges=store.doc.edges.filter(e=>e.id.includes("copy"));
  assert.equal(copiedEdges.length,1);
  // e1 (a->b) copies because both nodes copy; e2 (b->c) does not.
  assert.equal(copiedEdges[0].from.nodeId,copies[0].id);
  assert.equal(copiedEdges[0].to.nodeId,copies[1].id);
});

test("duplicating a selected edge freezes uncopied endpoints as points",()=>{
  const store=twoConnectedNodes();
  let counter=0;
  store.execute("Duplicate",doc=>duplicateSelection(doc,["a","e1"],{newId:prefix=>`${prefix}-copy-${++counter}`}));
  const copy=store.doc.edges.find(e=>e.id.includes("copy"));
  assert.equal(copy.from.type,"port");
  assert.equal(copy.to.type,"point");
  const original=pointAtPort(store.doc.nodes.find(n=>n.id==="b"),"west");
  assert.deepEqual(copy.to,{type:"point",x:original.x+DUPLICATE_OFFSET,y:original.y+DUPLICATE_OFFSET});
});

test("duplicated strokes do not alias the original samples",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Build",doc=>addStroke(doc,{id:"s1",points:[{x:0,y:0,t:0},{x:10,y:10,t:5}]}));
  let counter=0;
  store.execute("Duplicate",doc=>duplicateSelection(doc,["s1"],{newId:p=>`${p}-copy-${++counter}`}));
  const[original,copy]=store.doc.strokes;
  assert.notEqual(original.points,copy.points);
  assert.equal(copy.points[0].x,DUPLICATE_OFFSET);
  assert.equal(original.points[0].x,0);
});

test("convertStrokes replaces the sources atomically and undo restores the samples",()=>{
  const store=new HistoryStore(createDocument());
  const points=[{x:0,y:0,t:0},{x:12,y:3,t:8},{x:30,y:1,t:16}];
  store.execute("Draw",doc=>addStroke(doc,{id:"s1",points}));
  store.execute("Convert",doc=>convertStrokes(doc,["s1"],{node:rect("n1",5,5)}));
  assert.equal(store.doc.strokes.length,0);
  assert.equal(store.doc.nodes.length,1);
  store.undo();
  assert.deepEqual(store.doc.strokes[0].points,points);
  assert.equal(store.doc.nodes.length,0);
});

test("convertStrokes refuses when a source stroke is missing",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Draw",doc=>addStroke(doc,{id:"s1",points:[{x:0,y:0,t:0},{x:9,y:9,t:4}]}));
  let outcome=null;
  store.execute("Convert",doc=>{outcome=convertStrokes(doc,["s1","missing"],{node:rect("n1")})});
  assert.equal(outcome,false);
  assert.equal(store.doc.strokes.length,1);
  assert.equal(store.doc.nodes.length,0);
});

test("a two-stroke conversion removes both sources and adds one edge",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Draw",doc=>{
    addStroke(doc,{id:"shaft",points:[{x:0,y:0,t:0},{x:100,y:0,t:10}]});
    addStroke(doc,{id:"head",points:[{x:80,y:-10,t:20},{x:100,y:0,t:24},{x:80,y:10,t:28}]});
  });
  store.execute("Convert",doc=>convertStrokes(doc,["shaft","head"],{edge:{id:"e1",from:{type:"point",x:0,y:0},to:{type:"point",x:100,y:0}}}));
  assert.equal(store.doc.strokes.length,0);
  assert.equal(store.doc.edges.length,1);
  store.undo();
  assert.equal(store.doc.strokes.length,2);
});

test("setLabel truncates at the schema limit",()=>{
  const store=new HistoryStore(createDocument());
  store.execute("Build",doc=>addNode(doc,rect("n1")));
  store.execute("Label",doc=>setLabel(doc,"n1","x".repeat(900)));
  assert.equal(store.doc.nodes[0].label.length,500);
});
