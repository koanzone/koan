"use client";
import { useEffect, useReducer, useRef, useState } from 'react';
import { consume } from '../lib/stream';
import { transition } from '../lib/machine';
type Message = {role: 'user' | 'assistant'; content: string};
const opening: Message = {role: 'assistant', content: 'Who are you?'};
export default function Home() {
 const [messages, setMessages] = useState<Message[]>([]);
 const [draft, setDraft] = useState('');
 const [state, dispatch] = useReducer(transition, 'idle');
 const [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
 const [error, setError] = useState(''), [notice, setNotice] = useState('');
 const [retry, setRetry] = useState<Message[] | null>(null);
 const [reduced, setReduced] = useState(false), [missing, setMissing] = useState(false);
 const scroll = useRef<HTMLDivElement>(null), controller = useRef<AbortController | null>(null);
 const inFlight = useRef(false), reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 useEffect(() => {
  const timer = setTimeout(() => {setMessages([opening]); setReady(true);}, 900);
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () => setReduced(media.matches); motion(); media.addEventListener('change', motion);
  const viewport = window.visualViewport;
  const resize = () => {
   const height = viewport?.height ?? innerHeight;
   document.documentElement.style.setProperty('--app-height', `${height}px`);
   document.documentElement.dataset.keyboard = String(innerHeight - height > 140);
  };
  resize(); viewport?.addEventListener('resize', resize);
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => {});
  return () => {clearTimeout(timer); controller.current?.abort(); if (reactionTimer.current) clearTimeout(reactionTimer.current); media.removeEventListener('change',motion); viewport?.removeEventListener('resize',resize);};
 }, []);
 useEffect(() => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [messages]);
 async function send(history: Message[]) {
  if (inFlight.current) return;
  inFlight.current = true;
  if (reactionTimer.current) clearTimeout(reactionTimer.current);
  setBusy(true); setError(''); setNotice(''); setRetry(null); dispatch({type:'submit'});
  const abort = new AbortController(); controller.current = abort;
  let answer = '', failed = false, amused = false;
  setMessages([...history, {role:'assistant',content:''}]);
  const timeout = setTimeout(() => abort.abort(), 300000);
  try {
   await consume(await fetch('/api/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({messages:history}), signal:abort.signal}), event => {
    if (event.type === 'delta' && event.text) {
     answer += event.text; dispatch({type:'delta'});
     setMessages([...history, {role:'assistant',content:answer}]);
    }
    if (event.type === 'state' && event.state === 'thinking') dispatch({type:'submit'});
    if (event.type === 'expression' && event.expression === 'amused') amused = true;
    if (event.type === 'notice') setNotice(event.message || 'Response limit reached.');
    if (event.type === 'error') throw new Error(event.message || 'The response failed.');
   });
  } catch (e) {
   failed = true; setRetry(history);
   setError(abort.signal.aborted ? 'Response stopped. You can retry.' : e instanceof Error ? e.message : 'Something interrupted the response.');
  } finally {
   clearTimeout(timeout); controller.current = null; inFlight.current = false; setBusy(false);
   if (!answer) setMessages(history);
   dispatch({type:'finish'});
   if (amused && !failed) {dispatch({type:'amused'}); reactionTimer.current = setTimeout(() => dispatch({type:'settle'}), 1500);}
  }
 }
 return <main className="app">
  <section className="conversation" aria-label="Conversation">
   <header><span className="brand">BUDDHA BOT<span className="brand-dot">·</span></span></header>
   <div className="transcript" ref={scroll} role="log" aria-label="Messages" aria-live="off" aria-busy={busy}>
    <div className="message-column">
     {messages.map((message,i) => message.content && <article key={i} className={`message ${message.role}`}><span className="speaker">{message.role === 'user' ? 'YOU' : 'ECHO'}</span><p>{message.content}</p></article>)}
    </div>
   </div>
   <div className="composer-wrap">
    {error && <div role="alert" className="error">{error} {retry && <><button className="text-button" onClick={() => send(retry)}>Retry</button><button className="text-button" onClick={() => {setMessages(retry.slice(0,-1)); setDraft(retry.at(-1)?.content || ""); setRetry(null); setError("");}}>Edit reply</button></>}</div>}
    {notice && <p className="notice">{notice}</p>}
    <form onSubmit={e => {e.preventDefault(); const text=draft.trim(); if (!text || busy || !ready) return; setDraft(''); send([...messages.filter(m => m.content), {role:'user',content:text}]);}}>
     <textarea aria-label="Your reply" placeholder={ready ? 'Open your mind...' : 'A moment…'} value={draft} rows={1} maxLength={12000} disabled={busy || !ready || !!retry} onChange={e => setDraft(e.target.value)} onFocus={() => dispatch({type:'focus'})} onBlur={() => dispatch({type:'blur'})} onKeyDown={e => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
     {busy ? <button type="button" onClick={() => controller.current?.abort()} aria-label="Stop response">■</button> : <button type="submit" disabled={!draft.trim() || !ready || !!retry} aria-label="Send reply">↑</button>}
    </form>
   </div>
  </section>
  <section className={`stage ${state}`} aria-label={`Echo is ${state}`}>
   <div className="stage-line"/><div className="sprite-frame">
    {missing ? <div className="placeholder">◯<small>Echo · {state}</small></div> : <img src={reduced ? '/guide/still.png' : `/guide/${state}.gif`} alt="Android contemplative guide in a violet-lit temple" onError={() => setMissing(true)} />}
   </div>
   <div className="stage-caption"><span className="presence-dot"/>{state === 'attention' ? 'LISTENING' : state === 'idle' ? 'HERE WITH YOU' : state.toUpperCase()}</div>
  </section>
  <span className="sr-only" role="status">{busy ? 'Echo is considering your reply.' : messages.at(-1)?.role === 'assistant' ? messages.at(-1)?.content : ''}</span>
 </main>;
}
