// Timestamp-driven gesture state machine. It never touches document state; it only
// calls the action callbacks the editor supplies.
import{cameraToStage,landmarkDistance,FULL_REGION}from"./coordinates.js";
import{DEFAULT_THRESHOLDS,MIN_PALM_PIXELS}from"./calibration.js";

export const STABLE_MS=100,DWELL_MS=600,DWELL_SLOP=12,LOSS_GAP_MS=250,STALL_MS=600;
export const STATES={idle:"idle",pointing:"pointing",drawing:"drawing",dragging:"dragging",unavailable:"unavailable"};

export class GestureController{
  constructor(actions){this.actions=actions;this.reset()}

  reset(){
    this.state=STATES.idle;
    this.filtered=null;this.lastFrameAt=0;this.lastSeenAt=0;this.lastSmoothedAt=0;
    this.pause=false;this.pauseCandidate=null;this.pinch=false;this.pinchCandidate=null;
    this.penReady=false;this.pinchReady=false;this.dwell=null;this.seeded=false;this.epoch=(this.epoch||0)+1;
  }

  // Hysteresis with a stable-for dwell so jitter cannot toggle a latch.
  stable(name,next,now,duration=STABLE_MS){
    const key=name+"Candidate";
    if(next===this[name]){this[key]=null;return false}
    const pending=this[key];
    if(!pending||pending.value!==next){this[key]={value:next,since:now};return false}
    if(now-pending.since>=duration){this[name]=next;this[key]=null;return true}
    return false;
  }

  // Called when the hand is gone, stalled, or the frame gap is too large.
  lose(reason,now=this.lastFrameAt){
    if(this.state===STATES.drawing)this.actions.end(reason,now);
    else if(this.state===STATES.dragging)this.actions.cancel?.(reason);
    this.reset();
    this.actions.state(STATES.idle,reason);
  }

  // Watchdog for a tracking callback that simply stops arriving.
  checkStall(now){
    if(this.state===STATES.idle||!this.lastSeenAt)return false;
    if(now-this.lastSeenAt<STALL_MS)return false;
    this.lose("stalled",now);return true;
  }

  update(results,now,config={}){
    // Out-of-order frames carry no new information.
    if(this.lastFrameAt&&now<=this.lastFrameAt)return;
    if(this.lastFrameAt&&now-this.lastFrameAt>LOSS_GAP_MS)this.lose("gap",this.lastFrameAt);
    this.lastFrameAt=now;

    const hand=results?.multiHandLandmarks?.[0];
    if(!hand||hand.length<21){if(this.state!==STATES.idle)this.lose("noHand",now);else this.actions.state(STATES.idle,"noHand");return}

    const imageWidth=results?.image?.width||config.imageWidth||640;
    const imageHeight=results?.image?.height||config.imageHeight||480;
    const palm=landmarkDistance(hand[0],hand[9],imageWidth,imageHeight);
    if(!Number.isFinite(palm)||palm<MIN_PALM_PIXELS*imageHeight/480){
      if(this.state===STATES.drawing)this.actions.end("palmInvalid",now);
      else if(this.state===STATES.dragging)this.actions.cancel?.("palmInvalid");
      this.filtered=null;this.state=STATES.unavailable;this.lastSeenAt=now;
      this.actions.state(STATES.unavailable,"palmInvalid");return;
    }
    this.lastSeenAt=now;

    const calibration=config.calibration||{},pauseLimits=calibration.pause||DEFAULT_THRESHOLDS,pinchLimits=calibration.pinch||DEFAULT_THRESHOLDS;
    const pauseRatio=landmarkDistance(hand[4],hand[20],imageWidth,imageHeight)/palm;
    const pinchRatio=landmarkDistance(hand[4],hand[8],imageWidth,imageHeight)/palm;
    const pauseNext=this.pause?pauseRatio<pauseLimits.release:pauseRatio<=pauseLimits.enter;
    const pinchNext=this.pinch?pinchRatio<pinchLimits.release:pinchRatio<=pinchLimits.enter;
    if(!this.seeded){
      // Seed the latches from the first valid frame. Without this, a hand that
      // appears already pinching or already pen-up reads as the opposite state
      // for the length of the hysteresis window and can trigger an unwanted edit.
      this.seeded=true;this.pause=pauseNext;this.pinch=pinchNext;
    }else{
      this.stable("pause",pauseNext,now);
      this.stable("pinch",pinchNext,now);
    }

    const mapped=cameraToStage(hand[8].x,hand[8].y,{
      mirror:!!config.mirror,imageWidth,imageHeight,
      stageWidth:config.stageWidth,stageHeight:config.stageHeight,
      region:calibration.region||FULL_REGION,
    });
    if(!mapped){this.actions.state(this.state,"noStage");return}

    const gap=this.lastSmoothedAt?Math.max(1,now-this.lastSmoothedAt):16;
    const tau=Math.max(1,Number(config.tau)||45);
    const alpha=1-Math.exp(-gap/tau);
    this.filtered=this.filtered?{x:this.filtered.x+alpha*(mapped.x-this.filtered.x),y:this.filtered.y+alpha*(mapped.y-this.filtered.y)}:{x:mapped.x,y:mapped.y};
    this.lastSmoothedAt=now;
    this.actions.cursor(this.filtered,hand,mapped.inside);

    if(config.calibrating){this.actions.calibrationFrame?.(hand,now,imageWidth,imageHeight);this.state=STATES.pointing;this.actions.state(STATES.pointing,"calibrating");return}

    // Leaving the usable input area ends the edit instead of clamping to a border.
    if(!mapped.inside){
      if(this.state===STATES.drawing){this.actions.end("outOfRegion",now);this.penReady=false}
      else if(this.state===STATES.dragging){this.actions.cancel?.("outOfRegion");this.pinchReady=false}
      this.state=STATES.pointing;this.dwell=null;this.actions.state(STATES.pointing,"outOfRegion");return;
    }

    if(!config.armed){
      if(this.state===STATES.drawing)this.actions.end("disarmed",now);
      else if(this.state===STATES.dragging)this.actions.cancel?.("disarmed");
      this.state=STATES.pointing;this.dwell=null;this.penReady=false;this.pinchReady=false;
      this.actions.state(STATES.pointing,"disarmed");return;
    }

    // A pinch already closed when the hand appeared must open before it can grab.
    if(!this.pinch)this.pinchReady=true;
    // A stroke may only start after an explicit pen-up, so reacquisition never
    // joins a new stroke onto an old one.
    if(this.pause)this.penReady=true;

    if(config.tool==="select")this.updateSelect(now);
    else this.updateDraw(now);
    this.actions.state(this.state);
  }

  updateSelect(now){
    if(this.state===STATES.dragging){
      if(!this.pinch){this.actions.dragEnd(this.filtered);this.state=STATES.pointing;this.pinchReady=false}
      else this.actions.dragMove(this.filtered);
      return;
    }
    const target=this.actions.target(this.filtered);
    if(target){
      const moved=this.dwell&&Math.hypot(this.filtered.x-this.dwell.origin.x,this.filtered.y-this.dwell.origin.y)>DWELL_SLOP;
      if(!this.dwell||this.dwell.id!==target.id||moved)this.dwell={id:target.id,origin:{...this.filtered},since:now,fired:false};
      if(!this.dwell.fired&&now-this.dwell.since>=DWELL_MS){this.dwell.fired=true;this.actions.select(target)}
    }else this.dwell=null;
    if(target&&this.pinch&&this.pinchReady){
      this.actions.select(target);this.actions.dragBegin(this.filtered);
      this.state=STATES.dragging;this.pinchReady=false;return;
    }
    this.state=STATES.pointing;
  }

  updateDraw(now){
    this.dwell=null;
    if(this.state===STATES.drawing){
      if(this.pause){this.actions.end("penUp",now);this.state=STATES.pointing;this.penReady=true}
      else this.actions.move(this.filtered,now);
      return;
    }
    if(!this.pause&&this.penReady){
      this.actions.begin(this.filtered,now);this.state=STATES.drawing;this.penReady=false;return;
    }
    this.state=STATES.pointing;
  }
}
