// Browser regression tests for defects found in review. Each one failed before its fix.
import{expect,test}from"@playwright/test";
import{buildFrames,circlePath,clickOnStage,dragOnStage,documentState,drawNode,openEditor,stageBox}from"./helpers.js";

test.beforeEach(async({page})=>{await openEditor(page)});

// Replays a circle so a recognition proposal is on screen.
async function proposeCircle(page){
  await page.evaluate(({builderSource})=>{
    const stage=document.getElementById("stage");
    const size={stageWidth:stage.clientWidth,stageHeight:stage.clientHeight};
    const build=new Function("size",`return (${builderSource})(size)`);
    const{frames}=build(size);
    window.drawingBoard.setTool("freehand");
    window.drawingBoard.replay(frames,{tool:"freehand",mirror:false,imageWidth:640,imageHeight:480,tau:1,armed:true,...size});
  },{builderSource:`(size)=>{
    const buildFrames=${buildFrames.toString()};
    const circlePath=${circlePath.toString()};
    const radius=Math.min(size.stageWidth,size.stageHeight)*.22;
    return buildFrames(circlePath({x:size.stageWidth/2,y:size.stageHeight/2},radius,56),{...size,step:50,holdFrames:6,startTime:1000});
  }`});
  await expect(page.locator("#candidate")).toBeVisible();
}

test("Enter accepts a proposal even though the Accept button holds focus",async({page})=>{
  // A node is created first so something is selected: the label-editing Enter
  // branch used to swallow the key and move focus to the label field instead.
  await drawNode(page,"rectangle",{x:60,y:320},{x:160,y:390});
  await proposeCircle(page);
  expect(await page.evaluate(()=>document.activeElement?.id)).toBe("acceptCandidate");
  await page.keyboard.press("Enter");
  await expect(page.locator("#candidate")).toBeHidden();
  const after=await documentState(page);
  expect(after.strokes).toHaveLength(0);
  expect(after.nodes).toHaveLength(2);
  expect(after.nodes[1].kind).toBe("circle");
});

test("Escape rejects a proposal from the panel and from the stage",async({page})=>{
  await proposeCircle(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#candidate")).toBeHidden();
  const after=await documentState(page);
  expect(after.nodes).toHaveLength(0);
  expect(after.strokes).toHaveLength(1);
});

test("a visible proposal suspends the tool shortcuts",async({page})=>{
  await proposeCircle(page);
  await page.keyboard.press("r");
  expect(await page.evaluate(()=>window.drawingBoard.session.tool)).toBe("freehand");
  await expect(page.locator("#candidate")).toBeVisible();
});

test("deleting mid-drag leaves no ghost and commits no move",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:220,y:200});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:150});
  const box=await stageBox(page);
  await page.mouse.move(box.x+150,box.y+150);
  await page.mouse.down();
  await page.mouse.move(box.x+300,box.y+150);
  await page.keyboard.press("Delete");
  const mid=await page.evaluate(()=>({docNodes:window.drawingBoard.document().nodes.length,
    rendered:document.querySelectorAll("#nodes .diagram-node").length}));
  expect(mid).toEqual({docNodes:0,rendered:0});
  await page.mouse.up();
  const after=await page.evaluate(()=>({docNodes:window.drawingBoard.document().nodes.length,
    rendered:document.querySelectorAll("#nodes .diagram-node").length,undo:!document.getElementById("undoBtn").disabled}));
  expect(after.docNodes).toBe(0);
  expect(after.rendered).toBe(0);
  // Undo must bring back the node, not a move applied to a deleted node.
  await page.click("#undoBtn");
  expect((await documentState(page)).nodes).toHaveLength(1);
  expect((await documentState(page)).nodes[0].x).toBe(100);
});

test("undoing mid-drag leaves no ghost",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:220,y:200});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:150});
  const box=await stageBox(page);
  await page.mouse.move(box.x+150,box.y+150);
  await page.mouse.down();
  await page.mouse.move(box.x+320,box.y+250);
  await page.keyboard.press("Control+z");
  await page.mouse.up();
  const after=await page.evaluate(()=>({docNodes:window.drawingBoard.document().nodes.length,
    rendered:document.querySelectorAll("#nodes .diagram-node").length}));
  expect(after).toEqual({docNodes:0,rendered:0});
});

test("hidden inspector panels are really hidden",async({page})=>{
  const display=id=>page.evaluate(target=>{
    const element=document.getElementById(target);
    return{hidden:element.hidden,display:getComputedStyle(element).display};
  },id);
  expect((await display("inspectorForm")).display).toBe("none");

  await drawNode(page,"rectangle",{x:100,y:100},{x:220,y:200});
  expect(await display("inspectorForm")).toEqual({hidden:false,display:"grid"});
  expect((await display("routingField")).display).toBe("none");
  expect((await display("nodeFields")).display).toBe("grid");

  await page.click('[data-tool="connector"]');
  await dragOnStage(page,{x:400,y:300},{x:520,y:360});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:460,y:330});
  expect((await documentState(page)).edges).toHaveLength(1);
  expect((await display("nodeFields")).display).toBe("none");
  expect((await display("fillField")).display).toBe("none");
  expect((await display("routingField")).display).toBe("grid");
});

test("an in-progress label survives an unrelated repaint",async({page})=>{
  await drawNode(page,"rectangle",{x:100,y:100},{x:260,y:200});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:150,y:150});
  await page.fill("#labelInput","Hello world");
  // Clicking a view toggle moves focus out of the form and repaints.
  await page.click("#guideToggle");
  expect(await page.inputValue("#labelInput")).toBe("Hello world");
  await page.evaluate(()=>window.drawingBoard.render());
  expect(await page.inputValue("#labelInput")).toBe("Hello world");
  // Applying commits the edit and hands the field back to the document.
  await page.click("#inspectorForm button.primary");
  expect((await documentState(page)).nodes[0].label).toBe("Hello world");
  // Selecting something else discards an unapplied edit rather than carrying it over.
  await drawNode(page,"rectangle",{x:400,y:300},{x:520,y:380});
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:440,y:330});
  await page.fill("#labelInput","Not applied");
  await clickOnStage(page,{x:150,y:150});
  expect(await page.inputValue("#labelInput")).toBe("Hello world");
});

test("a circle shrinks when its east handle is dragged inward",async({page})=>{
  await drawNode(page,"circle",{x:120,y:120},{x:280,y:280});
  const before=(await documentState(page)).nodes[0];
  expect(before.kind).toBe("circle");
  await page.click('[data-tool="select"]');
  await clickOnStage(page,{x:before.x+before.width/2,y:before.y+before.height/2});
  await dragOnStage(page,{x:before.x+before.width,y:before.y+before.height/2},{x:before.x+before.width-60,y:before.y+before.height/2});
  const after=(await documentState(page)).nodes[0];
  expect(after.width).toBeLessThan(before.width-40);
  expect(after.width).toBe(after.height);
});
