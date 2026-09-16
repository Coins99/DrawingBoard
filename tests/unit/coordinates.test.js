import{test}from"node:test";
import assert from"node:assert/strict";
import{MIN_REGION,cameraToStage,containRect,docToStage,landmarkDistance,normalizeRegion,stageToDoc,zoomAbout}from"../../DrawingBoard/src/coordinates.js";

const close=(a,b,epsilon=1e-9)=>assert.ok(Math.abs(a-b)<=epsilon,`${a} !== ${b}`);

test("stageToDoc inverts docToStage for any pan and zoom",()=>{
  for(const viewport of[{panX:0,panY:0,zoom:1},{panX:-120,panY:75,zoom:2.5},{panX:33,panY:-9,zoom:.25}]){
    const point={x:137.5,y:-42.25};
    const round=stageToDoc(docToStage(point,viewport),viewport);
    close(round.x,point.x,1e-9);close(round.y,point.y,1e-9);
  }
});

test("a 4:3 camera fills a 4:3 stage with no letterbox",()=>{
  const box=containRect(640,480,800,600);
  assert.deepEqual([box.offsetX,box.offsetY],[0,0]);
  close(box.width,800);close(box.height,600);
});

test("a 16:9 camera on a 4:3 stage letterboxes vertically",()=>{
  const box=containRect(1920,1080,800,600);
  close(box.width,800);close(box.height,450);
  close(box.offsetX,0);close(box.offsetY,75);
});

test("a 4:3 camera on a 16:9 stage pillarboxes horizontally",()=>{
  const box=containRect(640,480,1600,900);
  close(box.height,900);close(box.width,1200);
  close(box.offsetX,200);close(box.offsetY,0);
});

test("containRect rejects degenerate sizes",()=>{
  for(const args of[[0,480,800,600],[640,0,800,600],[640,480,0,600],[640,480,800,0]])
    assert.equal(containRect(...args),null);
});

test("cameraToStage maps corners into the contained rectangle",()=>{
  const config={imageWidth:640,imageHeight:480,stageWidth:1600,stageHeight:900};
  const topLeft=cameraToStage(0,0,config),bottomRight=cameraToStage(1,1,config);
  close(topLeft.x,200);close(topLeft.y,0);
  close(bottomRight.x,1400);close(bottomRight.y,900);
});

test("mirroring is applied exactly once",()=>{
  const config={imageWidth:640,imageHeight:480,stageWidth:640,stageHeight:480};
  const plain=cameraToStage(.25,.5,config);
  const mirrored=cameraToStage(.25,.5,{...config,mirror:true});
  close(plain.x,160);close(mirrored.x,480);
  close(plain.y,mirrored.y);
});

test("aspect mapping is independent of stage pixel size at the same ratio",()=>{
  const small=cameraToStage(.3,.7,{imageWidth:640,imageHeight:480,stageWidth:400,stageHeight:300});
  const large=cameraToStage(.3,.7,{imageWidth:640,imageHeight:480,stageWidth:800,stageHeight:600});
  close(small.x*2,large.x,1e-9);close(small.y*2,large.y,1e-9);
});

test("a calibrated region remaps the usable area and flags points outside it",()=>{
  const config={imageWidth:640,imageHeight:480,stageWidth:640,stageHeight:480,region:{x:.25,y:.25,width:.5,height:.5}};
  const center=cameraToStage(.5,.5,config);
  close(center.x,320);close(center.y,240);
  const corner=cameraToStage(.25,.25,config);
  close(corner.x,0);close(corner.y,0);
  assert.equal(corner.inside,true);
  assert.equal(cameraToStage(.1,.5,config).inside,false);
  assert.equal(cameraToStage(.5,.95,config).inside,false);
});

test("normalizeRegion accepts swapped corners and rejects tiny rectangles",()=>{
  const region=normalizeRegion({x:.8,y:.9},{x:.2,y:.3});
  assert.deepEqual(region,{x:.2,y:.3,width:.6000000000000001,height:.6000000000000001});
  assert.equal(normalizeRegion({x:.5,y:.5},{x:.5+MIN_REGION/2,y:.9}),null);
  assert.equal(normalizeRegion(null,{x:0,y:0}),null);
});

test("landmarkDistance corrects for the image aspect ratio",()=>{
  const horizontal=landmarkDistance({x:0,y:0},{x:.1,y:0},640,480);
  const vertical=landmarkDistance({x:0,y:0},{x:0,y:.1},640,480);
  close(horizontal,64);close(vertical,48);
});

test("zoomAbout keeps the document point under the anchor fixed",()=>{
  const viewport={panX:40,panY:-15,zoom:1};
  const anchor={x:250,y:180};
  const before=stageToDoc(anchor,viewport);
  const next=zoomAbout(viewport,anchor,2.4);
  const after=stageToDoc(anchor,next);
  close(after.x,before.x,1e-9);close(after.y,before.y,1e-9);
});

test("zoomAbout clamps to the supported range",()=>{
  const viewport={panX:0,panY:0,zoom:1},anchor={x:0,y:0};
  assert.equal(zoomAbout(viewport,anchor,100).zoom,4);
  assert.equal(zoomAbout(viewport,anchor,.01).zoom,.25);
});
