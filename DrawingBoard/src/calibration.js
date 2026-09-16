// Session-local gesture calibration. Pure functions plus a small sample collector;
// nothing here is written to diagram files.
import{landmarkDistance,normalizeRegion,FULL_REGION}from"./coordinates.js";

export const DEFAULT_THRESHOLDS={enter:.25,release:.4};
export const MIN_GAP=.1,SAMPLE_MS=1000,MIN_SAMPLES=12,MIN_PALM_PIXELS=20;

export function percentile(values,fraction){
  const sorted=values.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if(!sorted.length)return NaN;
  const index=(sorted.length-1)*Math.min(1,Math.max(0,fraction)),low=Math.floor(index),high=Math.ceil(index);
  return low===high?sorted[low]:sorted[low]+(sorted[high]-sorted[low])*(index-low);
}

// Palm-relative ratio for a finger pair. Returns null when the palm is too small
// to trust, so invalid frames never enter the calibration sample.
export function palmRatio(hand,a,b,imageWidth,imageHeight){
  if(!hand||hand.length<21)return null;
  const palm=landmarkDistance(hand[0],hand[9],imageWidth,imageHeight);
  const minimum=MIN_PALM_PIXELS*imageHeight/480;
  if(!Number.isFinite(palm)||palm<minimum)return null;
  const span=landmarkDistance(hand[a],hand[b],imageWidth,imageHeight);
  return Number.isFinite(span)?span/palm:null;
}

// contact = fingers touching (small ratios); released = fingers apart (large ratios).
export function deriveThresholds(contact,released){
  const usableContact=contact.filter(Number.isFinite),usableReleased=released.filter(Number.isFinite);
  if(usableContact.length<MIN_SAMPLES||usableReleased.length<MIN_SAMPLES)
    return{...DEFAULT_THRESHOLDS,accepted:false,reason:"Not enough valid samples. Keep your hand in frame and try again."};
  const high=percentile(usableContact,.9),low=percentile(usableReleased,.1),gap=low-high;
  if(!(gap>=MIN_GAP))
    return{...DEFAULT_THRESHOLDS,accepted:false,reason:"Touching and released distances overlap. Reposition your hand and try again.",gap};
  return{enter:high+gap/3,release:high+gap*2/3,accepted:true,gap,samples:{contact:usableContact.length,released:usableReleased.length}};
}

export const defaultCalibration=()=>({pause:{...DEFAULT_THRESHOLDS},pinch:{...DEFAULT_THRESHOLDS},region:{...FULL_REGION},calibrated:false});

export class Calibrator{
  constructor(){this.reset()}
  reset(){this.phase=null;this.startedAt=0;this.samples={pauseContact:[],pauseReleased:[],pinchContact:[],pinchReleased:[]};this.corners=[];this.result=defaultCalibration();return this.result}
  // phase is one of the sample bucket names; returns remaining milliseconds.
  begin(phase,now){if(!(phase in this.samples))throw new Error(`Unknown calibration phase: ${phase}`);this.phase=phase;this.startedAt=now;this.samples[phase]=[];return SAMPLE_MS}
  // Feed one tracked frame. Returns {collecting, remaining, accepted}.
  observe(hand,now,imageWidth=640,imageHeight=480){
    if(!this.phase)return{collecting:false,remaining:0,accepted:0};
    const phase=this.phase,[a,b]=phase.startsWith("pause")?[4,20]:[4,8];
    const ratio=palmRatio(hand,a,b,imageWidth,imageHeight);
    if(ratio!==null)this.samples[phase].push(ratio);
    const remaining=Math.max(0,SAMPLE_MS-(now-this.startedAt));
    if(!remaining)this.phase=null;
    return{collecting:remaining>0,remaining,accepted:this.samples[phase].length};
  }
  captureCorner(point){this.corners.push({x:point.x,y:point.y});if(this.corners.length>2)this.corners.shift();return this.corners.length}
  // Fold collected samples into thresholds. Defaults survive an unusable sample set.
  finish(){
    const pause=deriveThresholds(this.samples.pauseContact,this.samples.pauseReleased);
    const pinch=deriveThresholds(this.samples.pinchContact,this.samples.pinchReleased);
    const region=this.corners.length===2?normalizeRegion(this.corners[0],this.corners[1]):null;
    this.result={pause,pinch,region:region||{...FULL_REGION},regionAccepted:!!region,calibrated:pause.accepted||pinch.accepted||!!region};
    return this.result;
  }
}
