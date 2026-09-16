import{expect,test}from"@playwright/test";
import{buildFrames,circlePath,documentState,headPath,linePath,openEditor,sessionState}from"./helpers.js";

// These tests replay landmark frames through the real gesture state machine. They
// exercise the software path only and are not a substitute for a camera check.
// Frames must keep advancing across replays; the controller drops any frame whose
// timestamp is not newer than the last one it saw.
async function replay(page,pathBuilder,{tool="freehand",step=50}={}){
  return page.evaluate(async({tool,step,builderSource})=>{
    const stage=document.getElementById("stage");
    const size={stageWidth:stage.clientWidth,stageHeight:stage.clientHeight};
    const startTime=window.__replayClock??1000;
    const build=new Function("size","startTime",`return (${builderSource})(size,startTime)`);
    const{frames,nextTime}=build(size,startTime);
    window.__replayClock=nextTime+step;
    window.drawingBoard.setTool(tool);
    window.drawingBoard.replay(frames,{tool,mirror:false,imageWidth:640,imageHeight:480,tau:1,armed:true,...size});
    return{frames:frames.length,startTime,nextTime};
  },{tool,step,builderSource:pathBuilder});
}

// The builder runs inside the page, so it is passed as source text.
function builder(pathExpression,options={}){
  const config=JSON.stringify({step:50,holdFrames:6,...options});
  return`(size,startTime)=>{
    const buildFrames=${buildFrames.toString()};
    const circlePath=${circlePath.toString()};
    const linePath=${linePath.toString()};
    const headPath=${headPath.toString()};
    const path=(${pathExpression})(size);
    return buildFrames(path,{...size,startTime,...${config}});
  }`;
}

test.beforeEach(async({page})=>{await openEditor(page)});

test("a replayed circle becomes a stroke and offers a circle proposal",async({page})=>{
  await replay(page,builder(`size=>{
    const radius=Math.min(size.stageWidth,size.stageHeight)*.22;
    return circlePath({x:size.stageWidth/2,y:size.stageHeight/2},radius,56);
  }`));
  const afterDraw=await documentState(page);
  expect(afterDraw.strokes).toHaveLength(1);
  await expect(page.locator("#candidate")).toBeVisible();
  await expect(page.locator("#candidateText")).toContainText("circle");

  await page.click("#acceptCandidate");
  const converted=await documentState(page);
  expect(converted.strokes).toHaveLength(0);
  expect(converted.nodes).toHaveLength(1);
  expect(converted.nodes[0].kind).toBe("circle");
  expect(converted.nodes[0].width).toBe(converted.nodes[0].height);
});

test("rejecting a proposal keeps the original samples",async({page})=>{
  await replay(page,builder(`size=>{
    const radius=Math.min(size.stageWidth,size.stageHeight)*.22;
    return circlePath({x:size.stageWidth/2,y:size.stageHeight/2},radius,56);
  }`));
  const before=(await documentState(page)).strokes[0];
  await page.click("#rejectCandidate");
  await expect(page.locator("#candidate")).toBeHidden();
  const after=await documentState(page);
  expect(after.nodes).toHaveLength(0);
  expect(after.strokes[0].points).toEqual(before.points);
});

test("accepting a conversion is one undo step that restores the stroke",async({page})=>{
  await replay(page,builder(`size=>{
    const radius=Math.min(size.stageWidth,size.stageHeight)*.22;
    return circlePath({x:size.stageWidth/2,y:size.stageHeight/2},radius,56);
  }`));
  const stroke=(await documentState(page)).strokes[0];
  await page.click("#acceptCandidate");
  await page.click("#undoBtn");
  const restored=await documentState(page);
  expect(restored.nodes).toHaveLength(0);
  expect(restored.strokes).toHaveLength(1);
  expect(restored.strokes[0].points).toEqual(stroke.points);
});

test("two strokes drawn in sequence are proposed as one arrow",async({page})=>{
  const tail={x:120,y:420},tip={x:520,y:420};
  await replay(page,builder(`size=>linePath({x:120,y:420},{x:520,y:420},28)`));
  expect((await documentState(page)).strokes).toHaveLength(1);
  await expect(page.locator("#candidate")).toBeHidden();

  await replay(page,builder(`size=>headPath({x:520,y:420},{x:120,y:420},56,32,14)`));
  const afterHead=await documentState(page);
  expect(afterHead.strokes).toHaveLength(2);
  await expect(page.locator("#candidateText")).toContainText("arrow");

  await page.click("#acceptCandidate");
  const converted=await documentState(page);
  expect(converted.strokes).toHaveLength(0);
  expect(converted.edges).toHaveLength(1);
  expect(converted.edges[0].from.type).toBe("point");
  expect(Math.abs(converted.edges[0].to.x-tip.x)).toBeLessThan(12);
  // The pen-down latch needs two stable frames, so the recorded tail starts a
  // little inside the replayed path. The direction and tip still match.
  expect(Math.abs(converted.edges[0].from.x-tail.x)).toBeLessThan(40);
  expect(Math.abs(converted.edges[0].from.y-tail.y)).toBeLessThan(6);
  expect(converted.edges[0].to.x).toBeGreaterThan(converted.edges[0].from.x);

  await page.click("#undoBtn");
  expect((await documentState(page)).strokes).toHaveLength(2);
});

test("a stroke drawn after an edit is not paired with the earlier one",async({page})=>{
  await replay(page,builder(`size=>linePath({x:120,y:420},{x:520,y:420},28)`));
  // Any committed edit breaks the pairing window.
  await page.click('[data-tool="rectangle"]');
  await page.click('[data-tool="freehand"]');
  await replay(page,builder(`size=>headPath({x:520,y:420},{x:120,y:420},56,32,14)`));
  await expect(page.locator("#candidate")).toBeHidden();
  expect((await documentState(page)).strokes).toHaveLength(2);
});

test("dwell selects a shape and a pinch drags it with its connector attached",async({page})=>{
  await page.click('[data-tool="rectangle"]');
  const box=await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x+120,box.y+120);
  await page.mouse.down();
  await page.mouse.move(box.x+260,box.y+220);
  await page.mouse.up();
  await page.click('[data-tool="circle"]');
  await page.mouse.move(box.x+480,box.y+140);
  await page.mouse.down();
  await page.mouse.move(box.x+600,box.y+260);
  await page.mouse.up();

  const nodes=(await documentState(page)).nodes;
  await page.click('[data-tool="connector"]');
  await page.mouse.move(box.x+nodes[0].x+nodes[0].width,box.y+nodes[0].y+nodes[0].height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+nodes[1].x,box.y+nodes[1].y+nodes[1].height/2);
  await page.mouse.up();
  expect((await documentState(page)).edges).toHaveLength(1);

  const result=await page.evaluate(({target})=>{
    const stage=document.getElementById("stage");
    const size={stageWidth:stage.clientWidth,stageHeight:stage.clientHeight};
    const scale=Math.min(size.stageWidth/640,size.stageHeight/480);
    const width=640*scale,height=480*scale;
    const offsetX=(size.stageWidth-width)/2,offsetY=(size.stageHeight-height)/2;
    const normalize=point=>({x:(point.x-offsetX)/width,y:(point.y-offsetY)/height});
    const landmarks=(point,pinchRatio)=>{
      const list=Array.from({length:21},()=>({x:.5,y:.9,z:0}));
      list[0]={x:.5,y:.85,z:0};
      list[9]={x:.5,y:.85-100/480,z:0};
      list[8]={x:point.x,y:point.y,z:0};
      list[4]={x:point.x+pinchRatio*100/640,y:point.y,z:0};
      list[20]={x:list[4].x+.9*100/640,y:point.y,z:0};
      return list;
    };
    const frames=[];
    let time=2000;
    const push=(point,pinchRatio)=>{frames.push({results:{multiHandLandmarks:[landmarks(normalize(point),pinchRatio)]},time});time+=50};
    // Hover with an open hand long enough for the dwell timer, then pinch and move.
    for(let i=0;i<20;i++)push(target,.9);
    for(let i=0;i<6;i++)push(target,.15);
    for(let i=1;i<=10;i++)push({x:target.x,y:target.y+i*12},.15);
    for(let i=0;i<6;i++)push({x:target.x,y:target.y+120},.9);

    window.drawingBoard.setTool("select");
    window.drawingBoard.replay(frames,{tool:"select",mirror:false,imageWidth:640,imageHeight:480,tau:1,armed:true,...size});
    return{selection:[...window.drawingBoard.selection],document:window.drawingBoard.document()};
  },{target:{x:nodes[0].x+nodes[0].width/2,y:nodes[0].y+nodes[0].height/2}});

  expect(result.selection).toContain(nodes[0].id);
  const moved=result.document.nodes.find(n=>n.id===nodes[0].id);
  expect(moved.y).toBeGreaterThan(nodes[0].y+60);
  expect(result.document.edges[0].from).toEqual({type:"port",nodeId:nodes[0].id,port:"east"});
  const state=await sessionState(page);
  expect(state.selection).toContain(nodes[0].id);
});

test("losing the hand mid-stroke still finishes the stroke",async({page})=>{
  const finished=await page.evaluate(()=>{
    const stage=document.getElementById("stage");
    const size={stageWidth:stage.clientWidth,stageHeight:stage.clientHeight};
    const scale=Math.min(size.stageWidth/640,size.stageHeight/480);
    const width=640*scale,height=480*scale;
    const offsetX=(size.stageWidth-width)/2,offsetY=(size.stageHeight-height)/2;
    const landmarks=(x,y,pauseRatio)=>{
      const u=(x-offsetX)/width,v=(y-offsetY)/height;
      const list=Array.from({length:21},()=>({x:.5,y:.9,z:0}));
      list[0]={x:.5,y:.85,z:0};
      list[9]={x:.5,y:.85-100/480,z:0};
      list[8]={x:u,y:v,z:0};
      list[4]={x:u+.9*100/640,y:v,z:0};
      list[20]={x:list[4].x+pauseRatio*100/640,y:v,z:0};
      return list;
    };
    const frames=[];
    let time=3000;
    const push=(x,y,pauseRatio)=>{frames.push({results:{multiHandLandmarks:[landmarks(x,y,pauseRatio)]},time});time+=50};
    for(let i=0;i<6;i++)push(140,300,.15);
    for(let i=0;i<20;i++)push(140+i*10,300+i*4,.9);
    frames.push({results:{multiHandLandmarks:[]},time});

    window.drawingBoard.setTool("freehand");
    window.drawingBoard.replay(frames,{tool:"freehand",mirror:false,imageWidth:640,imageHeight:480,tau:1,armed:true,...size});
    return window.drawingBoard.document().strokes.length;
  });
  expect(finished).toBe(1);
  expect((await documentState(page)).strokes[0].points.length).toBeGreaterThan(2);
});
