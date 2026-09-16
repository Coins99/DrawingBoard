// File save, open and export. Exports are built from a fresh standalone SVG, so
// camera pixels, handles, guides and candidate previews are never included.
import{validateDocument}from"./document.js";
import{standaloneSvg}from"./render.js";

export const MAX_IMPORT_BYTES=5*1024*1024,MAX_PNG_PIXELS=16_000_000,MAX_PNG_SIDE=8192;

export function download(blob,name){
  const url=URL.createObjectURL(blob),anchor=document.createElement("a");
  anchor.href=url;anchor.download=name;anchor.rel="noopener";
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

const safeName=title=>(String(title||"diagram").trim().replace(/[^\w.-]+/g,"-").replace(/^-+|-+$/g,"")||"diagram").slice(0,60);

export function saveJson(doc){
  download(new Blob([JSON.stringify(doc,null,2)],{type:"application/json"}),`${safeName(doc.title)}.diagram.json`);
}

export async function openJson(file){
  if(file.size>MAX_IMPORT_BYTES)throw new Error("Diagram is larger than 5 MiB.");
  let parsed;
  try{parsed=JSON.parse(await file.text())}catch{throw new Error("File is not valid JSON.")}
  const checked=validateDocument(parsed);
  if(!checked.ok)throw new Error(checked.errors.slice(0,3).join(" "));
  return checked.document;
}

export function exportSvg(doc){
  download(new Blob([standaloneSvg(doc)],{type:"image/svg+xml"}),`${safeName(doc.title)}.svg`);
}

// Pick the raster size that stays inside both caps. There is no lower bound on the
// factor: a widely spread diagram needs an arbitrarily small one, and a floor here
// used to produce a canvas far past MAX_PNG_SIDE that the browser then refused.
export function pngTargetSize(rawWidth,rawHeight,scale=2){
  const baseWidth=Math.max(1,rawWidth||1),baseHeight=Math.max(1,rawHeight||1);
  const limit=Math.min(scale,MAX_PNG_SIDE/baseWidth,MAX_PNG_SIDE/baseHeight,Math.sqrt(MAX_PNG_PIXELS/(baseWidth*baseHeight)));
  const applied=Number.isFinite(limit)&&limit>0?limit:1;
  return{applied,width:Math.max(1,Math.floor(baseWidth*applied)),height:Math.max(1,Math.floor(baseHeight*applied))};
}

// Rasterize the exported SVG. Oversized output is scaled down rather than refused.
export async function exportPng(doc,{scale=2,background="#ffffff"}={}){
  const markup=standaloneSvg(doc);
  const url=URL.createObjectURL(new Blob([markup],{type:"image/svg+xml"}));
  const image=new Image();
  try{
    await new Promise((resolve,reject)=>{
      image.onload=resolve;
      image.onerror=()=>reject(new Error("Could not rasterize the diagram."));
      image.src=url;
    });
    const{width,height,applied}=pngTargetSize(image.naturalWidth||image.width,image.naturalHeight||image.height,scale);
    const canvas=document.createElement("canvas");
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext("2d");
    if(background){ctx.fillStyle=background;ctx.fillRect(0,0,width,height)}
    ctx.drawImage(image,0,0,width,height);
    const png=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if(!png)throw new Error("PNG export failed.");
    download(png,`${safeName(doc.title)}.png`);
    return{width,height,scale:applied,reduced:applied<scale};
  }finally{URL.revokeObjectURL(url)}
}
