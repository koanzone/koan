const ts=require('typescript'),fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=ts.transpileModule(fs.readFileSync('app/IntroVideo.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
function setup(reject=false){
 const frames=new Map(),timers=new Map(),listeners={},states=[];let id=0,effect,ref=0,calls=0;
 const element={readyState:0,play(){calls++;return reject?Promise.reject(Error('blocked')):Promise.resolve()},pause(){}};
 const doc={readyState:'loading',visibilityState:'visible',addEventListener(k,f){listeners[k]=f},removeEventListener(k){delete listeners[k]}};
 const react={useRef:()=>({current:ref++===0?element:null}),useState:v=>{const i=states.length;states.push(v);return[v,x=>{states[i]=x}]},useEffect:f=>{effect=f}};
 const ctx={exports:{},require:n=>n==='react'?react:{jsx:()=>null,jsxs:()=>null},document:doc,matchMedia:()=>({matches:false}),requestAnimationFrame:f=>{frames.set(++id,f);return id},cancelAnimationFrame:i=>frames.delete(i),setTimeout:f=>{timers.set(++id,f);return id},clearTimeout:i=>timers.delete(i)};
 vm.runInNewContext(source,ctx);ctx.exports.default({onComplete:()=>assert.fail('must not skip on slow loading')});const cleanup=effect();
 function frame(){const work=[...frames.values()];frames.clear();work.forEach(f=>f())}
 return{frames,timers,states,doc,frame,cleanup,get calls(){return calls}};
}
(async()=>{
 let s=setup();assert.equal(s.calls,0);s.frame();assert.equal(s.calls,0);s.frame();assert.equal(s.calls,1,'request playback even when document is loading and readyState is zero');
 for(const f of s.timers.values())f();assert.equal(s.states[0],true);assert.equal(s.states[1],false);s.cleanup();
 s=setup(true);s.frame();s.frame();await Promise.resolve();assert.equal(s.states[0],true);assert.equal(s.states[1],false);s.cleanup();
 s=setup();s.cleanup();s.frame();s.frame();assert.equal(s.calls,0);
 console.log('PASS: intro waits for paint, starts without load/canplay, offers retry on delay or rejection, and cancels on unmount');
})().catch(e=>{console.error(e);process.exit(1)});
