// Synthetic MediaPipe-shaped landmark frames for gesture replay tests.
export const IMAGE={width:640,height:480};

// Builds 21 landmarks with an exact palm size and exact finger-pair ratios.
// index is the fingertip position in normalized image coordinates.
export function hand({index={x:.5,y:.5},pauseRatio=1,pinchRatio=1,palmPixels=100,image=IMAGE}={}){
  const points=Array.from({length:21},()=>({x:.5,y:.9,z:0}));
  const palmY=palmPixels/image.height;
  points[0]={x:.5,y:.85,z:0};                      // wrist
  points[9]={x:.5,y:.85-palmY,z:0};                // middle-finger knuckle
  points[8]={x:index.x,y:index.y,z:0};             // index fingertip
  points[4]={x:index.x+pinchRatio*palmPixels/image.width,y:index.y,z:0};   // thumb tip
  points[20]={x:points[4].x+pauseRatio*palmPixels/image.width,y:index.y,z:0}; // pinky tip
  return points;
}

export const frame=options=>({multiHandLandmarks:[hand(options)]});
export const emptyFrame=()=>({multiHandLandmarks:[]});

// Convenience config matching a 640x480 camera on a 640x480 stage.
export const CONFIG={
  mirror:false,imageWidth:IMAGE.width,imageHeight:IMAGE.height,
  stageWidth:640,stageHeight:480,tau:1,armed:true,tool:"freehand",
};

// Records every action callback the controller makes, in order.
export function recorder(target=null){
  const calls=[];
  const log=name=>(...args)=>{calls.push({name,args});return name==="target"?target:undefined};
  return{
    calls,
    names:()=>calls.map(c=>c.name),
    of:name=>calls.filter(c=>c.name===name),
    actions:{
      state:log("state"),cursor:log("cursor"),target:log("target"),select:log("select"),
      begin:log("begin"),move:log("move"),end:log("end"),
      dragBegin:log("dragBegin"),dragMove:log("dragMove"),dragEnd:log("dragEnd"),
      cancel:log("cancel"),calibrationFrame:log("calibrationFrame"),
    },
  };
}
