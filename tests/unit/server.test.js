import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {createServer} from "node:net";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

const ROOT=resolve(fileURLToPath(import.meta.url),"..","..","..");

async function availablePort(){
  const probe=createServer();
  probe.listen(0,"127.0.0.1");
  await once(probe,"listening");
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  return port;
}

test("static server serves the editor without exposing repository files",{timeout:10000},async()=>{
  const port=await availablePort();
  const server=spawn(process.execPath,["scripts/serve.mjs","--no-open","--port",String(port)],{
    cwd:ROOT,stdio:["ignore","pipe","pipe"],
  });
  let output="";
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error(`Server did not start: ${output}`)),5000);
    server.stdout.on("data",chunk=>{
      output+=chunk;
      if(output.includes("DrawingBoard is running at")){
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on("data",chunk=>{output+=chunk});
    server.once("error",reject);
    server.once("exit",code=>reject(new Error(`Server exited with ${code}: ${output}`)));
  });

  try{
    await ready;
    for(const path of["/","/DrawingBoard/index.html","/DrawingBoard/app.js","/DrawingBoard/src/gestures.js"]){
      const response=await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status,200,path);
    }
    for(const path of["/.git/HEAD","/package.json","/README.md","/DrawingBoard/%2e%2e/package.json","/nope.js"]){
      const response=await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status,404,path);
    }
  }finally{
    if(server.exitCode===null){
      server.kill();
      await once(server,"exit");
    }
  }
});
