import{expect,test}from"@playwright/test";
import{readFile}from"node:fs/promises";
import{clickOnStage,dragOnStage,documentState,drawNode,openEditor,sessionState,setLabel,stageBox}from"./helpers.js";

test.beforeEach(async({page})=>{await openEditor(page)});

test("the editor loads and stays usable when the tracking model is blocked",async({page})=>{
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#cameraBtn")).toHaveText("Enable camera");
  await expect(page.locator("#armToggle")).toBeDisabled();
  await drawNode(page,"rectangle",{x:80,y:80},{x:220,y:180});
  expect((await documentState(page)).nodes).toHaveLength(1);
});

test("builds a three-node flowchart with labels and connectors",async({page})=>{
  await drawNode(page,"rectangle",{x:60,y:60},{x:200,y:140});
  await setLabel(page,"Start");
  await drawNode(page,"diamond",{x:280,y:60},{x:420,y:150});
  await setLabel(page,"Decision");
  await drawNode(page,"circle",{x:500,y:60},{x:620,y:180});
  await setLabel(page,"End");

  const afterNodes=await documentState(page);
  expect(afterNodes.nodes).toHaveLength(3);
  expect(afterNodes.nodes.map(n=>n.label)).toEqual(["Start","Decision","End"]);
  expect(afterNodes.nodes[2].width).toBe(afterNodes.nodes[2].height);

  await page.click('[data-tool="connector"]');
  const[start,decision,end]=afterNodes.nodes;
  await dragOnStage(page,{x:start.x+start.width,y:start.y+start.height/2},{x:decision.x,y:decision.y+decision.height/2});
  await dragOnStage(page,{x:decision.x+decision.width,y:decision.y+decision.height/2},{x:end.x,y:end.y+end.height/2});

  const withEdges=await documentState(page);
  expect(withEdges.edges).toHaveLength(2);
  for(const edge of withEdges.edges){
    expect(edge.from.type).toBe("port");
    expect(edge.to.type).toBe("port");
  }
  await expect(page.locator("#objectList li")).toHaveCount(5);
});

test("a connector follows the node it is attached to",async({page})=>{
  await drawNode(page,"rectangle",{x:60,y:200},{x:180,y:280});
  await drawNode(page,"rectangle",{x:400,y:200},{x:520,y:280});
  const nodes=(await documentState(page)).nodes;
  await page.click('[data-tool="connector"]');
  await dragOnStage(page,{x:nodes[0].x+nodes[0].width,y:nodes[0].y+nodes[0].height/2},{x:nodes[1].x,y:nodes[1].y+nodes[1].height/2});
  expect((await documentState(page)).edges).toHaveLength(1);

  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:nodes[0].x+30,y:nodes[0].y+30});
  await dragOnStage(page,{x:nodes[0].x+30,y:nodes[0].y+30},{x:nodes[0].x+30,y:nodes[0].y+130});

  const moved=(await documentState(page)).nodes.find(n=>n.id===nodes[0].id);
  expect(moved.y).toBeGreaterThan(nodes[0].y+50);
  const edge=(await documentState(page)).edges[0];
  expect(edge.from).toEqual({type:"port",nodeId:nodes[0].id,port:"east"});
});

test("a resize handle changes only the dragged shape",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:260,y:220});
  const before=(await documentState(page)).nodes[0];
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:before.x+20,y:before.y+20});
  await expect(page.locator(".resize-handle")).toHaveCount(8);
  await dragOnStage(page,{x:before.x+before.width,y:before.y+before.height},{x:before.x+before.width+80,y:before.y+before.height+40});
  const after=(await documentState(page)).nodes[0];
  expect(after.width).toBeGreaterThan(before.width+50);
  expect(after.height).toBeGreaterThan(before.height+20);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
});

test("duplicate, delete and undo all keep the document valid",async({page})=>{
  await drawNode(page,"rectangle",{x:80,y:80},{x:200,y:160});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:120,y:120});
  await page.keyboard.press("Control+d");
  expect((await documentState(page)).nodes).toHaveLength(2);
  await page.keyboard.press("Delete");
  expect((await documentState(page)).nodes).toHaveLength(1);
  await page.click("#undoBtn");
  expect((await documentState(page)).nodes).toHaveLength(2);
  await page.click("#undoBtn");
  expect((await documentState(page)).nodes).toHaveLength(1);
});

test("marquee selection picks up every fully enclosed shape",async({page})=>{
  await drawNode(page,"rectangle",{x:60,y:60},{x:140,y:120});
  await drawNode(page,"rectangle",{x:180,y:60},{x:260,y:120});
  await drawNode(page,"rectangle",{x:500,y:300},{x:580,y:360});
  await page.click('[data-tool="select"]');
  await dragOnStage(page,{x:40,y:40},{x:320,y:200});
  expect((await sessionState(page)).selection).toHaveLength(2);
  await page.keyboard.press("Delete");
  expect((await documentState(page)).nodes).toHaveLength(1);
});

test("arrow keys nudge the selection and collapse into one undo step",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:200,y:180});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:140});
  const before=(await documentState(page)).nodes[0];
  await page.locator("#stage").focus();
  for(let i=0;i<5;i++)await page.keyboard.press("ArrowRight");
  const nudged=(await documentState(page)).nodes[0];
  expect(nudged.x).toBe(before.x+5);
  await page.keyboard.press("Shift+ArrowDown");
  expect((await documentState(page)).nodes[0].y).toBe(before.y+10);
  await page.click("#undoBtn");
  expect((await documentState(page)).nodes[0].x).toBe(before.x);
});

test("pan and zoom never change stored geometry",async({page})=>{
  await drawNode(page,"rectangle",{x:120,y:120},{x:240,y:220});
  const before=(await documentState(page)).nodes[0];
  await page.click('[data-tool="select"]');
  await dragOnStage(page,{x:400,y:300},{x:500,y:360},{modifier:"Space"});
  const panned=await sessionState(page);
  expect(panned.viewport.panX).not.toBe(0);

  const box=await stageBox(page);
  await page.mouse.move(box.x+400,box.y+300);
  await page.mouse.wheel(0,-240);
  const zoomed=await sessionState(page);
  expect(zoomed.viewport.zoom).toBeGreaterThan(1);
  await expect(page.locator("#zoomLabel")).not.toHaveText("100%");

  expect((await documentState(page)).nodes[0]).toEqual(before);
  await page.click("#zoomReset");
  await expect(page.locator("#zoomLabel")).toHaveText("100%");
});

test("the inspector edits label, position, size and colour",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:220,y:200});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:150});
  await page.fill("#labelInput","Step one");
  await page.fill("#xInput","300");
  await page.fill("#yInput","240");
  await page.fill("#widthInput","150");
  await page.fill("#heightInput","90");
  await page.click("#inspectorForm button.primary");
  const node=(await documentState(page)).nodes[0];
  expect(node).toMatchObject({label:"Step one",x:300,y:240,width:150,height:90});
});

test("a rejected inspector value leaves the document unchanged",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:220,y:200});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:150});
  const before=(await documentState(page)).nodes[0];
  await page.fill("#xInput","99999999");
  await page.click("#inspectorForm button.primary");
  await expect(page.locator("#status")).toContainText("rejected");
  expect((await documentState(page)).nodes[0]).toEqual(before);
});

test("labels are rendered as text, never as markup",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:300,y:200});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:150});
  await setLabel(page,"<img src=x onerror=alert(1)>");
  await expect(page.locator("#nodes text")).toHaveText("<img src=x onerror=alert(1)>");
  expect(await page.locator("#nodes img").count()).toBe(0);
});

test("saving produces a JSON file that reopens to the same diagram",async({page})=>{
  await drawNode(page,"rectangle",{x:60,y:60},{x:200,y:140});
  await drawNode(page,"circle",{x:280,y:60},{x:380,y:160});
  const before=await documentState(page);
  const download=await Promise.all([page.waitForEvent("download"),page.click("#saveBtn")]).then(([event])=>event);
  const path=await download.path();
  expect(path).toBeTruthy();
  await page.click("#newBtn");
  expect((await documentState(page)).nodes).toHaveLength(0);
  await page.setInputFiles("#fileInput",path);
  await expect(page.locator("#status")).toContainText("Opened");
  const after=await documentState(page);
  expect(after.nodes).toEqual(before.nodes);
});

test("SVG and PNG exports download and exclude editor chrome",async({page})=>{
  await drawNode(page,"rectangle",{x:80,y:80},{x:240,y:180});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:120,y:120});
  await setLabel(page,"Exported");

  const svg=await Promise.all([page.waitForEvent("download"),page.click("#svgBtn")]).then(([event])=>event);
  expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  const markup=await readFile(await svg.path(),"utf8");
  expect(markup).toContain("Exported");
  expect(markup).toContain("xmlns=\"http://www.w3.org/2000/svg\"");
  for(const excluded of["resize-handle","alignment-guide","selection-box","<video","<canvas","foreignObject","<image"])
    expect(markup).not.toContain(excluded);

  const png=await Promise.all([page.waitForEvent("download"),page.click("#pngBtn")]).then(([event])=>event);
  expect(png.suggestedFilename()).toMatch(/\.png$/);
  await expect(page.locator("#status")).toContainText("Exported PNG");
});

test("opening a damaged file reports the reason and keeps the diagram",async({page})=>{
  await drawNode(page,"rectangle",{x:80,y:80},{x:240,y:180});
  const before=await documentState(page);
  await page.setInputFiles("#fileInput",{name:"broken.diagram.json",mimeType:"application/json",buffer:Buffer.from("{ not json")});
  await expect(page.locator("#status")).toContainText("Open failed");
  expect(await documentState(page)).toEqual(before);

  await page.setInputFiles("#fileInput",{name:"dangling.diagram.json",mimeType:"application/json",
    buffer:Buffer.from(JSON.stringify({schemaVersion:1,title:"x",nodes:[],strokes:[],
      edges:[{id:"e1",from:{type:"port",nodeId:"gone",port:"north"},to:{type:"point",x:1,y:1},routing:"straight",label:"",style:{stroke:"#334155",fill:"#ffffff",strokeWidth:2}}]}))});
  await expect(page.locator("#status")).toContainText("Open failed");
  expect(await documentState(page)).toEqual(before);
});

test("keyboard shortcuts switch tools and Escape cancels a draft",async({page})=>{
  await page.locator("#stage").focus();
  for(const[key,tool]of[["r","rectangle"],["o","circle"],["d","diamond"],["c","connector"],["p","freehand"],["v","select"]]){
    await page.keyboard.press(key);
    expect((await sessionState(page)).tool).toBe(tool);
  }
  await page.keyboard.press("r");
  const box=await stageBox(page);
  await page.mouse.move(box.x+100,box.y+100);
  await page.mouse.down();
  await page.mouse.move(box.x+200,box.y+200);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect((await documentState(page)).nodes).toHaveLength(0);
});
