// Development evaluation set. Every sample is synthetic and single-source, so
// results from it are a boundary check on the classifier, not a measurement of
// how well recognition works for real users. A real dataset needs recorded
// strokes from several people, split by person before any threshold tuning.
import{arrowHead,circle,diamond,figureEight,line,rectangle,rotate,scribble,spiral,zigzag}from"./strokes.js";

export const DATASET_PROVENANCE={
  source:"synthetic",
  participants:0,
  sessions:0,
  conditions:"generated deterministically from seeded noise; no camera involved",
  caveat:"Synthetic fixtures cannot establish recognition quality for real input.",
};

const sample=(id,expected,strokes,notes)=>({id,expected,strokes,notes,participantId:"synthetic",sessionId:"fixtures"});

function shapeSamples(){
  const out=[];
  const noises=[0,1.5,3,4.5,6];
  noises.forEach((noise,i)=>{
    out.push(sample(`circle-${i}`,"circle",[circle({noise,seed:100+i})]));
    out.push(sample(`circle-small-${i}`,"circle",[circle({cx:120,cy:120,r:38,noise,seed:130+i})]));
    out.push(sample(`circle-oval-${i}`,"circle",[circle({r:80,squash:.85,noise,seed:160+i})],"within the accepted aspect band"));
    out.push(sample(`rectangle-${i}`,"rectangle",[rectangle({noise,seed:200+i})]));
    out.push(sample(`rectangle-tall-${i}`,"rectangle",[rectangle({width:90,height:180,noise,seed:230+i})]));
    out.push(sample(`rectangle-square-${i}`,"rectangle",[rectangle({width:140,height:140,noise,seed:260+i})]));
    out.push(sample(`diamond-${i}`,"diamond",[diamond({noise,seed:300+i})]));
    out.push(sample(`diamond-wide-${i}`,"diamond",[diamond({width:220,height:110,noise,seed:330+i})],"stretched rhombus"));
    out.push(sample(`diamond-tall-${i}`,"diamond",[diamond({width:110,height:200,noise,seed:360+i})]));
  });
  return out;
}

function arrowSamples(){
  const out=[];
  const cases=[
    {name:"right",from:{x:80,y:200},to:{x:300,y:200}},
    {name:"down",from:{x:200,y:80},to:{x:200,y:300}},
    {name:"diagonal",from:{x:90,y:90},to:{x:280,y:250}},
    {name:"left",from:{x:320,y:180},to:{x:110,y:180}},
    {name:"up",from:{x:180,y:320},to:{x:180,y:110}},
  ];
  cases.forEach((item,index)=>{
    [0,2,4].forEach((noise,j)=>{
      out.push(sample(`arrow-${item.name}-${j}`,"arrow",[
        line({from:item.from,to:item.to,noise,seed:400+index*10+j}),
        arrowHead({tip:item.to,shaftFrom:item.from,noise,seed:430+index*10+j}),
      ]));
    });
  });
  return out;
}

function unknownSamples(){
  const out=[];
  [0,2,4].forEach((noise,i)=>{
    out.push(sample(`spiral-${i}`,"unknown",[spiral({noise,seed:500+i})]));
    out.push(sample(`zigzag-${i}`,"unknown",[zigzag({noise,seed:530+i})]));
    out.push(sample(`figure-eight-${i}`,"unknown",[figureEight({noise,seed:560+i})]));
    out.push(sample(`arc-${i}`,"unknown",[circle({sweep:190,noise,seed:590+i})],"partial arc, not closed"));
    out.push(sample(`arc-wide-${i}`,"unknown",[circle({sweep:260,noise,seed:620+i})]));
    out.push(sample(`line-${i}`,"unknown",[line({noise,seed:650+i})]));
    out.push(sample(`triangle-${i}`,"unknown",[
      [{x:200,y:100},{x:290,y:250},{x:110,y:250},{x:200,y:100}].flatMap((p,index,all)=>
        index?line({from:all[index-1],to:p,samples:18,noise,seed:680+i+index}):[]),
    ],"three-sided shapes are out of scope"));
  });
  out.push(sample("scribble-0","unknown",[scribble({seed:700})]));
  out.push(sample("scribble-1","unknown",[scribble({seed:701,size:140})]));
  out.push(sample("rotated-rectangle-0","unknown",[rotate(rectangle({seed:720}),35)],"strongly rotated rectangles stay unknown"));
  out.push(sample("rotated-rectangle-1","unknown",[rotate(rectangle({seed:721,width:200,height:90}),52)]));
  out.push(sample("tiny-0","unknown",[circle({r:6,seed:740})],"below the minimum diagonal"));
  out.push(sample("degenerate-0","unknown",[[{x:10,y:10},{x:10,y:10}]],"zero-length input"));
  return out;
}

export const DATASET=[...shapeSamples(),...arrowSamples(),...unknownSamples()];
export const CLASSES=["circle","rectangle","diamond","arrow","unknown"];
