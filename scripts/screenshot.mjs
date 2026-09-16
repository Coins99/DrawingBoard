#!/usr/bin/env node
// Regenerates the README demo image from the real editor, so the picture cannot
// drift away from the code. Needs the development dependencies:
//   npm install && npx playwright install chromium && node scripts/screenshot.mjs
import{chromium}from"@playwright/test";
import{spawn}from"node:child_process";
import{mkdir}from"node:fs/promises";
import{resolve}from"node:path";
import{fileURLToPath}from"node:url";

const ROOT=resolve(fileURLToPath(import.meta.url),"..","..");
const PORT=4322;
const URL_=`http://127.0.0.1:${PORT}/DrawingBoard/index.html`;
const OUTPUT=resolve(ROOT,"img","demo.png");

const style=(stroke,fill)=>({stroke,fill,strokeWidth:2});
const node=(id,kind,x,y,width,height,label,stroke,fill)=>({id,kind,x,y,width,height,label,style:style(stroke,fill)});
const port=(nodeId,name)=>({type:"port",nodeId,port:name});
const edge=(id,from,to,label="",routing="straight")=>({id,from,to,routing,label,style:style("#64748b","#ffffff")});

// A five-node flowchart, one recognized-then-edited shape per kind, plus a
// freehand stroke that has not been converted yet.
const DEMO={
  schemaVersion:1,
  title:"Release review",
  nodes:[
    node("start","rectangle",60,40,170,64,"Collect strokes","#2563eb","#eff4ff"),
    node("check","diamond",40,170,210,120,"Recognized?","#f97316","#fff7ed"),
    node("convert","rectangle",330,180,180,64,"Convert to shape","#2563eb","#eff4ff"),
    node("keep","rectangle",330,300,180,64,"Keep freehand","#94a3b8","#f8fafc"),
    node("done","circle",600,210,110,110,"Export","#16a34a","#f0fdf4"),
  ],
  strokes:[{
    id:"sketch",
    points:Array.from({length:40},(_,i)=>{
      const angle=i/39*Math.PI*2;
      return{x:640+Math.cos(angle)*44,y:430+Math.sin(angle)*44,t:i*16};
    }),
    style:{stroke:"#334155",fill:"none",strokeWidth:2},
  }],
  edges:[
    edge("e1",port("start","south"),port("check","north")),
    edge("e2",port("check","east"),port("convert","west"),"yes"),
    edge("e3",port("check","south"),port("keep","west"),"no","orthogonal"),
    edge("e4",port("convert","east"),port("done","west")),
    edge("e5",port("keep","east"),port("done","south"),"","orthogonal"),
  ],
};

const wait=ms=>new Promise(done=>setTimeout(done,ms));

async function reachable(url,attempts=40){
  for(let i=0;i<attempts;i++){
    try{
      const response=await fetch(url);
      if(response.ok)return true;
    }catch{/* not up yet */}
    await wait(250);
  }
  return false;
}

const server=spawn(process.execPath,[resolve(ROOT,"scripts","serve.mjs"),"--no-open","--port",String(PORT)],{cwd:ROOT,stdio:"ignore"});
let browser;
try{
  if(!await reachable(URL_))throw new Error("The local server did not start.");
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2});
  // The demo image must not depend on a CDN or a camera.
  await page.route(/cdn\.jsdelivr\.net/,route=>route.abort());
  page.on("dialog",dialog=>dialog.dismiss().catch(()=>{}));
  await page.goto(URL_);
  await page.waitForFunction(()=>!!window.drawingBoard);
  await page.evaluate(demo=>{
    window.drawingBoard.store.replace(demo);
    // One shape selected, so the resize handles and the inspector are both visible.
    window.drawingBoard.selection.clear();
    window.drawingBoard.selection.add("check");
    window.drawingBoard.render();
    document.getElementById("status").textContent="Converted 4 strokes. One stroke kept as freehand.";
    document.getElementById("saveState").textContent="Recovery saved";
  },DEMO);
  await page.waitForTimeout(400);
  await mkdir(resolve(ROOT,"img"),{recursive:true});
  await page.screenshot({path:OUTPUT});
  console.log(`Wrote ${OUTPUT}`);
}finally{
  await browser?.close();
  server.kill();
}
