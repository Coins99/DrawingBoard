// Short guided walkthrough. It only tracks progress; the editor renders it and
// reports events, so the tutorial never touches the document or the camera.
export const TUTORIAL_STEPS=[
  {id:"camera",title:"Enable the camera",hint:"Press Enable camera. Mouse editing keeps working if you skip this.",event:"cameraReady",skippable:true},
  {id:"calibrate",title:"Calibrate your pen gesture",hint:"Run Calibrate and follow the two prompts. Defaults are kept if the samples overlap.",event:"calibrated",skippable:true},
  {id:"draw",title:"Draw a shape",hint:"Pick Freehand, then draw a rectangle, circle or diamond.",event:"strokeAdded"},
  {id:"lift",title:"Lift the pen",hint:"Touch your thumb to your pinky to finish the stroke.",event:"penUp",skippable:true},
  {id:"accept",title:"Accept the proposal",hint:"Press Enter to convert the stroke, or Escape to keep it freehand.",event:"candidateResolved"},
  {id:"connect",title:"Connect two shapes",hint:"Pick Connector and drag from one port to another.",event:"edgeAdded"},
  {id:"select",title:"Select a shape",hint:"Switch to Select and click a shape, or dwell on it with your hand.",event:"selected"},
  {id:"drag",title:"Move it",hint:"Drag the shape, or pinch and move your hand. Connectors follow.",event:"moved"},
  {id:"export",title:"Export the diagram",hint:"Press Export SVG. The file opens on its own, without the camera view.",event:"exported"},
];

export class Tutorial{
  constructor(steps=TUTORIAL_STEPS){this.steps=steps;this.index=0;this.active=false;this.completed=new Set()}
  start(){this.active=true;this.index=0;this.completed.clear();return this.current}
  stop(){this.active=false;return null}
  get current(){return this.active?this.steps[this.index]??null:null}
  get progress(){return{index:Math.min(this.index,this.steps.length),total:this.steps.length,done:this.index>=this.steps.length}}
  // Returns true when the reported event advanced the walkthrough.
  report(event){
    const step=this.current;
    if(!step||step.event!==event)return false;
    this.completed.add(step.id);
    this.index++;
    if(this.index>=this.steps.length)this.active=false;
    return true;
  }
  skip(){
    const step=this.current;
    if(!step?.skippable)return false;
    this.index++;
    if(this.index>=this.steps.length)this.active=false;
    return true;
  }
}
