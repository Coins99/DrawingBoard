import{test}from"node:test";
import assert from"node:assert/strict";
import{createDocument,defaultStyle}from"../../DrawingBoard/src/document.js";
import{PORTS,alignmentGuides,anyBounds,containsNode,handleAt,handlePoints,hitTest,marqueeSelect,nearestPort,normalizeRect,pointAtPort,polylineDistance,resizeBounds,resolveEndpoint,routeEdge,snap}from"../../DrawingBoard/src/geometry.js";

const rect=(id,x,y,width=80,height=60,kind="rectangle")=>({id,kind,x,y,width,height,label:"",style:defaultStyle()});
const doc=extra=>({...createDocument(),nodes:[],strokes:[],edges:[],...extra});

test("all four ports sit on the shape boundary",()=>{
  const node=rect("a",100,50,80,60);
  assert.deepEqual(pointAtPort(node,"north"),{x:140,y:50});
  assert.deepEqual(pointAtPort(node,"east"),{x:180,y:80});
  assert.deepEqual(pointAtPort(node,"south"),{x:140,y:110});
  assert.deepEqual(pointAtPort(node,"west"),{x:100,y:80});
  for(const port of PORTS)assert.ok(pointAtPort(node,port));
});

test("circle hit testing follows the ellipse, not its bounding box",()=>{
  const circle=rect("c",0,0,100,100,"circle");
  assert.equal(containsNode(circle,{x:50,y:50}),true);
  assert.equal(containsNode(circle,{x:50,y:1}),true);
  assert.equal(containsNode(circle,{x:5,y:5}),false);
  assert.equal(containsNode(circle,{x:5,y:5},20),true);
});

test("diamond hit testing follows the rhombus edges",()=>{
  const diamond=rect("d",0,0,100,100,"diamond");
  assert.equal(containsNode(diamond,{x:50,y:50}),true);
  assert.equal(containsNode(diamond,{x:50,y:2}),true);
  assert.equal(containsNode(diamond,{x:10,y:10}),false);
  assert.equal(containsNode(diamond,{x:99,y:99}),false);
});

test("hit testing resolves nodes before strokes and strokes before edges",()=>{
  const document=doc({
    nodes:[rect("n1",0,0,100,100)],
    strokes:[{id:"s1",points:[{x:50,y:50,t:0},{x:60,y:60,t:1}],style:defaultStyle()}],
    edges:[{id:"e1",from:{type:"point",x:50,y:50},to:{type:"point",x:200,y:50},routing:"straight",label:"",style:defaultStyle()}],
  });
  assert.deepEqual(hitTest(document,{x:55,y:55}),{type:"node",id:"n1"});
  assert.deepEqual(hitTest(document,{x:150,y:50}),{type:"edge",id:"e1"});
  assert.equal(hitTest(document,{x:400,y:400}),null);
});

test("topmost object wins inside one collection",()=>{
  const document=doc({nodes:[rect("under",0,0,100,100),rect("over",10,10,50,50)]});
  assert.deepEqual(hitTest(document,{x:30,y:30}),{type:"node",id:"over"});
});

test("orthogonal routing leaves ports outward and collapses collinear points",()=>{
  const document=doc({
    nodes:[rect("a",0,0,80,60),rect("b",300,0,80,60)],
    edges:[{id:"e1",from:{type:"port",nodeId:"a",port:"east"},to:{type:"port",nodeId:"b",port:"west"},routing:"orthogonal",label:"",style:defaultStyle()}],
  });
  const route=routeEdge(document,document.edges[0]);
  assert.deepEqual(route[0],{x:80,y:30});
  assert.deepEqual(route.at(-1),{x:300,y:30});
  // Same y on both ports, so the elbow collapses to a straight run.
  assert.equal(route.every(p=>p.y===30),true);
  assert.equal(route.length,2);
});

test("orthogonal routing bends when the ports are offset",()=>{
  const document=doc({
    nodes:[rect("a",0,0,80,60),rect("b",300,200,80,60)],
    edges:[{id:"e1",from:{type:"port",nodeId:"a",port:"east"},to:{type:"port",nodeId:"b",port:"west"},routing:"orthogonal",label:"",style:defaultStyle()}],
  });
  const route=routeEdge(document,document.edges[0]);
  assert.ok(route.length>2);
  for(let i=1;i<route.length;i++){
    const horizontal=Math.abs(route[i].y-route[i-1].y)<1e-9;
    const vertical=Math.abs(route[i].x-route[i-1].x)<1e-9;
    assert.ok(horizontal||vertical,`segment ${i} is not axis-aligned`);
  }
});

test("a dangling endpoint resolves to the origin instead of throwing",()=>{
  const document=doc({edges:[{id:"e1",from:{type:"port",nodeId:"gone",port:"north"},to:{type:"point",x:5,y:5},routing:"straight",label:"",style:defaultStyle()}]});
  assert.deepEqual(resolveEndpoint(document,document.edges[0].from),{x:0,y:0});
});

test("nearestPort respects the tolerance and picks the closest port",()=>{
  const document=doc({nodes:[rect("a",0,0,80,60)]});
  assert.equal(nearestPort(document,{x:1000,y:1000},20),null);
  assert.equal(nearestPort(document,{x:82,y:31},20).port,"east");
  assert.equal(nearestPort(document,{x:41,y:2},20).port,"north");
});

test("polylineDistance measures to the nearest segment",()=>{
  const points=[{x:0,y:0},{x:100,y:0},{x:100,y:100}];
  assert.equal(polylineDistance({x:50,y:5},points),5);
  assert.equal(polylineDistance({x:105,y:50},points),5);
  assert.equal(polylineDistance({x:0,y:0},[{x:0,y:0}]),0);
});

test("resize handles sit at the corners and edge midpoints",()=>{
  const node=rect("a",10,20,100,60);
  const points=handlePoints(node);
  assert.deepEqual(points.nw,{x:10,y:20});
  assert.deepEqual(points.se,{x:110,y:80});
  assert.deepEqual(points.n,{x:60,y:20});
  assert.equal(handleAt(node,{x:110,y:80},4),"se");
  assert.equal(handleAt(node,{x:60,y:50},4),null);
});

test("resizeBounds enforces the minimum size and never inverts the shape",()=>{
  const node=rect("a",0,0,100,60);
  assert.deepEqual(resizeBounds(node,"se",{x:20,y:10}),{x:0,y:0,width:120,height:70});
  assert.deepEqual(resizeBounds(node,"nw",{x:10,y:5}),{x:10,y:5,width:90,height:55});
  const collapsed=resizeBounds(node,"se",{x:-500,y:-500});
  assert.equal(collapsed.width,8);
  assert.equal(collapsed.height,8);
  const flipped=resizeBounds(node,"nw",{x:500,y:500});
  assert.equal(flipped.x,92);
  assert.equal(flipped.width,8);
});

test("resizing a circle keeps it square and anchored to the dragged corner",()=>{
  const circle=rect("c",0,0,60,60,"circle");
  const grown=resizeBounds(circle,"se",{x:40,y:5});
  assert.equal(grown.width,grown.height);
  assert.equal(grown.width,100);
  const fromNw=resizeBounds(circle,"nw",{x:-40,y:-5});
  assert.equal(fromNw.width,100);
  assert.equal(fromNw.x,-40);
  assert.equal(fromNw.y,-40);
});

test("marquee selects only fully contained objects",()=>{
  const document=doc({
    nodes:[rect("inside",20,20,40,40),rect("straddling",180,20,80,40)],
    strokes:[{id:"s1",points:[{x:30,y:80,t:0},{x:70,y:90,t:1}],style:defaultStyle()}],
  });
  const ids=marqueeSelect(document,normalizeRect({x:0,y:0},{x:150,y:150}));
  assert.deepEqual(ids.sort(),["inside","s1"]);
});

test("marquee includes an edge only when its whole route fits",()=>{
  const document=doc({edges:[{id:"e1",from:{type:"point",x:10,y:10},to:{type:"point",x:90,y:90},routing:"straight",label:"",style:defaultStyle()}]});
  assert.deepEqual(marqueeSelect(document,{x:0,y:0,width:100,height:100}),["e1"]);
  assert.deepEqual(marqueeSelect(document,{x:0,y:0,width:50,height:50}),[]);
});

test("alignment guides snap to a neighbour and report the guide line",()=>{
  const document=doc({nodes:[rect("fixed",100,100,80,60)]});
  const result=alignmentGuides(document,["moving"],{x:104,y:200,width:80,height:60},6);
  assert.equal(result.dx,-4);
  assert.deepEqual(result.guides,[{axis:"x",position:100}]);
});

test("alignment guides ignore the objects being moved and stay silent when far away",()=>{
  const document=doc({nodes:[rect("moving",100,100,80,60)]});
  assert.deepEqual(alignmentGuides(document,["moving"],{x:104,y:104,width:80,height:60},6),{dx:0,dy:0,guides:[]});
  const other=doc({nodes:[rect("fixed",100,100,80,60)]});
  assert.deepEqual(alignmentGuides(other,["moving"],{x:400,y:400,width:80,height:60},6).guides,[]);
});

test("anyBounds covers nodes, strokes and routed edges",()=>{
  const document=doc({
    nodes:[rect("n1",0,0,50,50)],
    strokes:[{id:"s1",points:[{x:10,y:10,t:0},{x:40,y:70,t:1}],style:defaultStyle()}],
    edges:[{id:"e1",from:{type:"point",x:5,y:5},to:{type:"point",x:95,y:25},routing:"straight",label:"",style:defaultStyle()}],
  });
  assert.deepEqual(anyBounds(document,document.nodes[0]),{x:0,y:0,width:50,height:50});
  assert.deepEqual(anyBounds(document,document.strokes[0]),{x:10,y:10,width:30,height:60});
  assert.deepEqual(anyBounds(document,document.edges[0]),{x:5,y:5,width:90,height:20});
});

test("snap rounds to the grid",()=>{
  assert.equal(snap(14),10);
  assert.equal(snap(15),20);
  assert.equal(snap(-14),-10);
  assert.equal(snap(7,5),5);
});
