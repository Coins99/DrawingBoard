#!/usr/bin/env node
// Dependency-free static server for DrawingBoard. Nothing is installed to run the
// editor: this file only uses the Node standard library. `npm install` is needed
// only for the test suites.
import{createServer}from"node:http";
import{createReadStream,statSync}from"node:fs";
import{spawn}from"node:child_process";
import{extname,join,normalize,resolve,sep}from"node:path";
import{fileURLToPath}from"node:url";

const ROOT=resolve(fileURLToPath(import.meta.url),"..","..");
const ENTRY="/DrawingBoard/index.html";
const DEFAULT_PORT=4173;
const PORT_ATTEMPTS=10;

const TYPES={
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",".svg":"image/svg+xml",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",
  ".webp":"image/webp",".ico":"image/x-icon",".wasm":"application/wasm",
  ".woff2":"font/woff2",".map":"application/json; charset=utf-8",
  ".txt":"text/plain; charset=utf-8",".md":"text/markdown; charset=utf-8",
};

const HELP=`Usage: node scripts/serve.mjs [OPTIONS]

  Serve DrawingBoard and open it in your browser.

Options:
  --port PORT    Serve on PORT instead of ${DEFAULT_PORT}.
  --host HOST    Bind to HOST instead of 127.0.0.1.
  --no-open      Start the server without opening a browser.
  --help, -h     Show this message and exit.
`;

function parseArgs(argv){
  const options={port:DEFAULT_PORT,host:"127.0.0.1",open:true};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(arg==="--help"||arg==="-h"){process.stdout.write(HELP);process.exit(0)}
    else if(arg==="--no-open")options.open=false;
    else if(arg==="--port"||arg==="-p"){
      const value=Number(argv[++i]);
      if(!Number.isInteger(value)||value<1||value>65535){console.error(`Not a usable port: ${argv[i]}`);process.exit(2)}
      options.port=value;
    }
    else if(arg.startsWith("--port="))options.port=Number(arg.slice(7));
    else if(arg==="--host")options.host=argv[++i];
    else if(arg.startsWith("--host="))options.host=arg.slice(7);
    else{console.error(`Unknown option: ${arg}\n\n${HELP}`);process.exit(2)}
  }
  if(!Number.isInteger(options.port)||options.port<1||options.port>65535){console.error("Not a usable port.");process.exit(2)}
  return options;
}

// Resolves a request path to a file inside ROOT, or null if it escapes.
function resolveRequest(urlPath){
  let decoded;
  try{decoded=decodeURIComponent(urlPath.split("?")[0].split("#")[0])}catch{return null}
  if(decoded.includes("\0"))return null;
  if(decoded==="/"||decoded==="")decoded=ENTRY;
  const target=resolve(join(ROOT,normalize(decoded)));
  if(target!==ROOT&&!target.startsWith(ROOT+sep))return null;
  return target;
}

function send(response,status,body,headers={}){
  response.writeHead(status,{"content-type":"text/plain; charset=utf-8",...headers});
  response.end(body);
}

const server=createServer((request,response)=>{
  if(request.method!=="GET"&&request.method!=="HEAD")return send(response,405,"Method not allowed.",{allow:"GET, HEAD"});
  const target=resolveRequest(request.url||"/");
  if(!target)return send(response,400,"Bad request.");

  let stats;
  try{stats=statSync(target)}catch{return send(response,404,`Not found: ${request.url}`)}
  if(stats.isDirectory()){
    const index=join(target,"index.html");
    try{statSync(index)}catch{return send(response,404,`Not found: ${request.url}`)}
    return stream(response,index,request.method);
  }
  return stream(response,target,request.method);
});

function stream(response,file,method){
  const type=TYPES[extname(file).toLowerCase()]||"application/octet-stream";
  // No-store keeps an edited file from being served from cache during development.
  response.writeHead(200,{"content-type":type,"cache-control":"no-store"});
  if(method==="HEAD")return response.end();
  const body=createReadStream(file);
  body.on("error",()=>{response.destroy()});
  body.pipe(response);
}

function openBrowser(url){
  const command=process.platform==="win32"?["cmd",["/c","start","",url]]
    :process.platform==="darwin"?["open",[url]]
    :["xdg-open",[url]];
  try{
    const child=spawn(command[0],command[1],{stdio:"ignore",detached:true});
    child.on("error",()=>console.log("Could not open a browser automatically. Open the link above."));
    child.unref();
  }catch{
    console.log("Could not open a browser automatically. Open the link above.");
  }
}

// Tries the requested port, then the next few, so a stale server is not fatal.
function listen(options,attempt=0){
  const port=options.port+attempt;
  server.once("error",error=>{
    if(error.code==="EADDRINUSE"&&attempt<PORT_ATTEMPTS){
      console.log(`Port ${port} is busy, trying ${port+1}.`);
      return listen(options,attempt+1);
    }
    console.error(error.code==="EADDRINUSE"
      ?`Ports ${options.port} to ${port} are all busy. Pass --port to choose another.`
      :`Could not start the server: ${error.message}`);
    process.exit(1);
  });
  server.listen(port,options.host,()=>{
    const url=`http://${options.host}:${port}${ENTRY}`;
    console.log(`DrawingBoard is running at ${url}`);
    console.log("Press Ctrl+C to stop.");
    if(options.open)openBrowser(url);
  });
}

for(const signal of["SIGINT","SIGTERM"])
  process.on(signal,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),500)});

listen(parseArgs(process.argv.slice(2)));
