const ts = require('typescript');
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
function load(file){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const ctx={exports:{},TextDecoder};vm.runInNewContext(source,ctx);return ctx.exports;}
const {consume}=load('lib/stream.ts');
const {transition}=load('lib/machine.ts');
(async()=>{
 const wire='data: {"type":"delta","text":"Hello 🌙"}\n\ndata: {"type":"done"}\n\n'; const bytes=new TextEncoder().encode(wire);
 for(let n=1;n<bytes.length;n++){
 const events=[];const stream=new ReadableStream({start(c){c.enqueue(bytes.slice(0,n));c.enqueue(bytes.slice(n));c.close();}});
 await consume(new Response(stream),e=>events.push(e));assert.equal(events[0].text,'Hello 🌙');assert.equal(events.length,2);
 }
 await assert.rejects(()=>consume(new Response('data: {"type":"delta","text":"partial"}\n\n'),()=>{}),/ended early/);
 await assert.rejects(()=>consume(new Response('',{status:409}),()=>{}),/another response/);
 let state='idle';for(const [action,expected] of [['focus','attention'],['submit','thinking'],['delta','talking'],['finish','idle'],['amused','amused'],['settle','idle']]){state=transition(state,{type:action});assert.equal(state,expected)}
 console.log('PASS: SSE at every byte split including UTF-8, incomplete-stream failure, busy response, all sprite transitions');
})().catch(e=>{console.error(e);process.exit(1)});
