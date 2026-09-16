// Shared browser-test helpers. The MediaPipe CDN is blocked in every test so the
// editor must work with no model available; gesture tests drive the state machine
// through replayed landmark frames instead of a camera.
export const PAGE="/DrawingBoard/index.html";

export async function openEditor(page){
  await page.route(/cdn\.jsdelivr\.net/,route=>route.abort());
  page.on("dialog",dialog=>dialog.dismiss().catch(()=>{}));
  await page.goto(PAGE);
  await page.waitForFunction(()=>!!window.drawingBoard);
  return page.locator("#stage");
}

export const documentState=page=>page.evaluate(()=>window.drawingBoard.document());
export const sessionState=page=>page.evaluate(()=>({tool:window.drawingBoard.session.tool,viewport:window.drawingBoard.session.viewport,selection:[...window.drawingBoard.selection]}));

export async function stageBox(page){
  const box=await page.locator("#stage").boundingBox();
  if(!box)throw new Error("The stage is not visible.");
  return box;
}

// Drags from one stage-relative point to another with intermediate moves so the
// editor sees a real pointer stream.
export async function dragOnStage(page,from,to,{steps=12,modifier=null}={}){
  const box=await stageBox(page);
  if(modifier)await page.keyboard.down(modifier);
  await page.mouse.move(box.x+from.x,box.y+from.y);
  await page.mouse.down();
  for(let i=1;i<=steps;i++){
    const t=i/steps;
    await page.mouse.move(box.x+from.x+(to.x-from.x)*t,box.y+from.y+(to.y-from.y)*t);
  }
  await page.mouse.up();
  if(modifier)await page.keyboard.up(modifier);
}

export async function clickOnStage(page,point){
  const box=await stageBox(page);
  await page.mouse.click(box.x+point.x,box.y+point.y);
}

export async function drawNode(page,tool,from,to){
  await page.click(`[data-tool="${tool}"]`);
  await dragOnStage(page,from,to);
}

export async function setLabel(page,text){
  await page.fill("#labelInput",text);
  await page.click("#inspectorForm button[type=submit], #inspectorForm button.primary");
}

// Builds replay frames that move the fingertip along stage-space points.
// The conversion mirrors src/coordinates.js so the fixture stays independent of it.
export function buildFrames(path,{stageWidth,stageHeight,imageWidth=640,imageHeight=480,step=50,startTime=1000,holdFrames=6,pauseRatioDown=.9,pauseRatioUp=.15}){
  const scale=Math.min(stageWidth/imageWidth,stageHeight/imageHeight);
  const width=imageWidth*scale,height=imageHeight*scale;
  const offsetX=(stageWidth-width)/2,offsetY=(stageHeight-height)/2;
  const toNormalized=point=>({x:(point.x-offsetX)/width,y:(point.y-offsetY)/height});
  const palmPixels=100;
  const landmarks=(point,pauseRatio)=>{
    const list=Array.from({length:21},()=>({x:.5,y:.9,z:0}));
    list[0]={x:.5,y:.85,z:0};
    list[9]={x:.5,y:.85-palmPixels/imageHeight,z:0};
    list[8]={x:point.x,y:point.y,z:0};
    list[4]={x:point.x+.9*palmPixels/imageWidth,y:point.y,z:0};
    list[20]={x:list[4].x+pauseRatio*palmPixels/imageWidth,y:point.y,z:0};
    return list;
  };
  const frames=[];
  let time=startTime;
  const push=(point,pauseRatio)=>{frames.push({results:{multiHandLandmarks:[landmarks(point,pauseRatio)]},time});time+=step};
  const first=toNormalized(path[0]);
  for(let i=0;i<holdFrames;i++)push(first,pauseRatioUp);
  for(const point of path)push(toNormalized(point),pauseRatioDown);
  const last=toNormalized(path.at(-1));
  for(let i=0;i<holdFrames;i++)push(last,pauseRatioUp);
  return{frames,nextTime:time};
}

export function circlePath(center,radius,samples=48){
  return Array.from({length:samples+1},(_,i)=>{
    const angle=i/samples*Math.PI*2;
    return{x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius};
  });
}

export function linePath(from,to,samples=24){
  return Array.from({length:samples+1},(_,i)=>({x:from.x+(to.x-from.x)*i/samples,y:from.y+(to.y-from.y)*i/samples}));
}

export function headPath(tip,shaftFrom,size=56,spread=32,samples=12){
  const angle=Math.atan2(tip.y-shaftFrom.y,tip.x-shaftFrom.x)+Math.PI;
  const arm=offset=>({x:tip.x+Math.cos(angle+offset)*size,y:tip.y+Math.sin(angle+offset)*size});
  const a=arm(spread*Math.PI/180),b=arm(-spread*Math.PI/180);
  return[...linePath(a,tip,samples),...linePath(tip,b,samples).slice(1)];
}
