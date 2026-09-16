import{test}from"node:test";
import assert from"node:assert/strict";
import{LIMITS,createDocument,defaultStyle,validateDocument}from"../../DrawingBoard/src/document.js";

const node=(id="n1",extra={})=>({id,kind:"rectangle",x:10,y:20,width:100,height:50,label:"",style:defaultStyle(),...extra});
const doc=(extra={})=>({...createDocument("Test"),...extra});

test("accepts a minimal document and strips unknown fields",()=>{
  const result=validateDocument({...doc({nodes:[node("n1",{extraField:"dropped"})]})});
  assert.equal(result.ok,true);
  assert.equal(result.document.nodes.length,1);
  assert.equal("extraField"in result.document.nodes[0],false);
});

test("rejects a non-object document",()=>{
  for(const input of[null,42,"text",[]])assert.equal(validateDocument(input).ok,false);
});

test("rejects an unsupported schema version",()=>{
  const result=validateDocument({...doc(),schemaVersion:2});
  assert.equal(result.ok,false);
  assert.match(result.errors.join(" "),/schemaVersion/);
});

test("rejects duplicate ids across collections",()=>{
  const result=validateDocument(doc({
    nodes:[node("same")],
    strokes:[{id:"same",points:[{x:0,y:0,t:0},{x:1,y:1,t:1}],style:{...defaultStyle(),fill:"none"}}],
  }));
  assert.equal(result.ok,false);
  assert.match(result.errors.join(" "),/duplicate/i);
});

test("rejects dangling edge endpoints",()=>{
  const result=validateDocument(doc({
    nodes:[node("n1")],
    edges:[{id:"e1",from:{type:"port",nodeId:"missing",port:"north"},to:{type:"port",nodeId:"n1",port:"south"},routing:"straight",label:"",style:defaultStyle()}],
  }));
  assert.equal(result.ok,false);
});

test("rejects an unknown port name",()=>{
  const result=validateDocument(doc({
    nodes:[node("n1"),node("n2")],
    edges:[{id:"e1",from:{type:"port",nodeId:"n1",port:"up"},to:{type:"port",nodeId:"n2",port:"south"},routing:"straight",label:"",style:defaultStyle()}],
  }));
  assert.equal(result.ok,false);
});

test("rejects nonfinite and out-of-range coordinates",()=>{
  for(const bad of[NaN,Infinity,1e9,-1e9]){
    assert.equal(validateDocument(doc({nodes:[node("n1",{x:bad})]})).ok,false,`x=${bad}`);
  }
});

test("rejects undersized nodes and unequal circles",()=>{
  assert.equal(validateDocument(doc({nodes:[node("n1",{width:2})]})).ok,false);
  assert.equal(validateDocument(doc({nodes:[node("n1",{kind:"circle",width:50,height:60})]})).ok,false);
  assert.equal(validateDocument(doc({nodes:[node("n1",{kind:"circle",width:50,height:50})]})).ok,true);
});

test("rejects style values that are not plain hex colors",()=>{
  for(const stroke of["url(#x)","red","javascript:alert(1)","#12345","#1234567"]){
    const result=validateDocument(doc({nodes:[node("n1",{style:{...defaultStyle(),stroke}})]}));
    assert.equal(result.ok,false,`stroke=${stroke}`);
  }
  assert.equal(validateDocument(doc({nodes:[node("n1",{style:{stroke:"#334155",fill:"none",strokeWidth:2}})]})).ok,true);
});

test("rejects out-of-range stroke widths",()=>{
  assert.equal(validateDocument(doc({nodes:[node("n1",{style:{...defaultStyle(),strokeWidth:0}})]})).ok,false);
  assert.equal(validateDocument(doc({nodes:[node("n1",{style:{...defaultStyle(),strokeWidth:40}})]})).ok,false);
});

test("keeps label text literally, including markup characters",()=>{
  const label='<script>alert("x")</script>';
  const result=validateDocument(doc({nodes:[node("n1",{label})]}));
  assert.equal(result.ok,true);
  assert.equal(result.document.nodes[0].label,label);
});

test("rejects overlong labels and titles",()=>{
  assert.equal(validateDocument(doc({nodes:[node("n1",{label:"a".repeat(501)})]})).ok,false);
  assert.equal(validateDocument({...doc(),title:"t".repeat(201)}).ok,false);
});

test("rejects strokes with fewer than two samples or non-monotonic time",()=>{
  const style={...defaultStyle(),fill:"none"};
  assert.equal(validateDocument(doc({strokes:[{id:"s1",points:[{x:0,y:0,t:0}],style}]})).ok,false);
  assert.equal(validateDocument(doc({strokes:[{id:"s1",points:[{x:0,y:0,t:5},{x:1,y:1,t:1}],style}]})).ok,false);
  assert.equal(validateDocument(doc({strokes:[{id:"s1",points:[{x:0,y:0,t:0},{x:1,y:1,t:5}],style}]})).ok,true);
});

test("enforces the object count limit",()=>{
  const nodes=Array.from({length:LIMITS.objects+1},(_,i)=>node(`n${i}`));
  assert.equal(validateDocument(doc({nodes})).ok,false);
});

test("enforces the total stroke point limit",()=>{
  const style={...defaultStyle(),fill:"none"};
  const points=Array.from({length:LIMITS.pointsPerStroke},(_,i)=>({x:i,y:0,t:i}));
  const count=Math.ceil(LIMITS.points/LIMITS.pointsPerStroke)+1;
  const strokes=Array.from({length:count},(_,i)=>({id:`s${i}`,points,style}));
  const result=validateDocument(doc({strokes}));
  assert.equal(result.ok,false);
  assert.match(result.errors.join(" "),/stroke points/);
});

test("copies nested values so the validated document does not alias the input",()=>{
  const input=doc({nodes:[node("n1")]});
  const result=validateDocument(input);
  result.document.nodes[0].style.stroke="#000000";
  result.document.nodes[0].x=999;
  assert.equal(input.nodes[0].style.stroke,"#334155");
  assert.equal(input.nodes[0].x,10);
});
