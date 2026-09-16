// Debounced local recovery save. IndexedDB is the primary backend with a
// localStorage fallback; writes are serialized so a slow old save can never
// overwrite a newer one, and "saved" is reported only after the write completes.
import{validateDocument}from"./document.js";

export const DB_NAME="drawingboard",STORE_NAME="documents",RECORD_KEY="recovery-v1",DEBOUNCE_MS=500;

export function indexedDbBackend(factory=globalThis.indexedDB){
  if(!factory)return null;
  let opening=null;
  const open=()=>opening||(opening=new Promise((resolve,reject)=>{
    const request=factory.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE_NAME))db.createObjectStore(STORE_NAME)};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error("IndexedDB unavailable."));
    request.onblocked=()=>reject(new Error("IndexedDB is blocked by another tab."));
  }).catch(error=>{opening=null;throw error}));
  const run=(mode,action)=>open().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_NAME,mode),store=tx.objectStore(STORE_NAME);
    let result;
    try{result=action(store)}catch(error){reject(error);return}
    // Resolve on transaction completion, not on the request callback.
    tx.oncomplete=()=>resolve(result&&"result"in result?result.result:undefined);
    tx.onerror=()=>reject(tx.error||new Error("Autosave transaction failed."));
    tx.onabort=()=>reject(tx.error||new Error("Autosave transaction aborted."));
  }));
  return{
    name:"indexeddb",
    put:record=>run("readwrite",store=>store.put(record,RECORD_KEY)),
    get:()=>run("readonly",store=>store.get(RECORD_KEY)),
    remove:()=>run("readwrite",store=>store.delete(RECORD_KEY)),
  };
}

export function localStorageBackend(storage=globalThis.localStorage){
  if(!storage)return null;
  const key=`${DB_NAME}-${RECORD_KEY}`;
  return{
    name:"localstorage",
    put:async record=>{storage.setItem(key,JSON.stringify(record))},
    get:async()=>{const raw=storage.getItem(key);return raw?JSON.parse(raw):undefined},
    remove:async()=>{storage.removeItem(key)},
  };
}

export function createMemoryBackend(){
  let record;
  return{name:"memory",put:async value=>{record=value},get:async()=>record,remove:async()=>{record=undefined}};
}

export function pickBackend(){
  try{const idb=indexedDbBackend();if(idb)return idb}catch{/* fall through */}
  try{const local=localStorageBackend();if(local)return local}catch{/* fall through */}
  return null;
}

export class Autosave{
  constructor({backend=pickBackend(),debounce=DEBOUNCE_MS,now=()=>Date.now(),onStatus=()=>{}}={}){
    this.backend=backend;this.debounce=debounce;this.now=now;this.onStatus=onStatus;
    this.timer=0;this.pending=null;this.chain=Promise.resolve();this.writtenRevision=-1;this.available=!!backend;
    if(!backend)this.onStatus("unavailable");
  }
  // Called after every committed edit, undo and redo.
  schedule(doc,revision){
    if(!this.backend){this.onStatus("unavailable");return}
    this.pending={doc,revision};
    this.onStatus("pending");
    clearTimeout(this.timer);
    this.timer=setTimeout(()=>this.flush(),this.debounce);
  }
  flush(){
    clearTimeout(this.timer);this.timer=0;
    const pending=this.pending;
    if(!this.backend||!pending)return this.chain;
    this.pending=null;
    this.chain=this.chain.then(async()=>{
      // A newer write already landed; this one carries nothing.
      if(pending.revision<=this.writtenRevision)return;
      try{
        await this.backend.put({revision:pending.revision,savedAt:this.now(),document:pending.doc});
        this.writtenRevision=pending.revision;
        this.onStatus("saved",{savedAt:this.now(),revision:pending.revision});
      }catch(error){
        this.available=false;
        this.onStatus("error",{error});
      }
    });
    return this.chain;
  }
  async load(){
    if(!this.backend)return null;
    try{
      const record=await this.backend.get();
      if(!record?.document)return null;
      const checked=validateDocument(record.document);
      if(!checked.ok)return null;
      return{document:checked.document,savedAt:record.savedAt??null,revision:record.revision??0};
    }catch{return null}
  }
  async clear(){
    clearTimeout(this.timer);this.timer=0;this.pending=null;
    if(!this.backend)return;
    // Join the write chain. Removing concurrently lets an in-flight put land
    // afterwards and resurrect the record the user just discarded.
    this.chain=this.chain.then(()=>this.backend.remove()).catch(()=>{});
    await this.chain;
    this.writtenRevision=-1;
  }
}
