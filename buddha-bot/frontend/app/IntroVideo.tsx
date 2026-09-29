"use client";
import { useEffect, useRef, useState } from 'react';

export default function IntroVideo({ onComplete }: { onComplete: () => void }) {
 const video = useRef<HTMLVideoElement>(null);
 const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const [blocked, setBlocked] = useState(false);
 const [loading, setLoading] = useState(true);
 const [muted, setMuted] = useState(true);
 function clearLoadingTimer() {
  if (loadTimer.current) clearTimeout(loadTimer.current);
 }
 useEffect(() => {
  const element = video.current;
  if (!element) return;
  let active = true, scheduled = false;
  let firstFrame = 0, secondFrame = 0;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
   onComplete();
   return;
  }
  function start() {
   if (scheduled || document.visibilityState !== 'visible') return;
   scheduled = true;
   // React has mounted the page. Paint the intro before requesting playback.
   // play() handles buffering; waiting for window.load/canplay can stall on mobile.
   firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
     if (!active) return;
     if (document.visibilityState !== 'visible') {scheduled = false; return;}
     loadTimer.current = setTimeout(() => {
      if (active) {setLoading(false); setBlocked(true);}
     }, 10000);
     element!.play().catch(() => {
      if (active) {clearLoadingTimer(); setLoading(false); setBlocked(true);}
     });
    });
   });
  }
  document.addEventListener('visibilitychange', start);
  start();
  return () => {
   active = false;
   clearLoadingTimer();
   cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
   document.removeEventListener('visibilitychange', start);
   element.pause();
  };
 }, [onComplete]);
 async function play() {
  clearLoadingTimer();
  setLoading(false);
  const element = video.current;
  if (!element) return;
  if (element.error || element.networkState === 3) element.load();
  try { await element.play(); setBlocked(false); }
  catch { setBlocked(true); }
 }
 return <section className="intro" aria-label="Echo introduction" aria-busy={loading}>
  <video ref={video} src="/video/intro.mp4" muted={muted} playsInline preload="auto"
   onEnded={onComplete} onError={() => {clearLoadingTimer(); onComplete();}}
   onPlaying={() => {clearLoadingTimer(); setLoading(false); setBlocked(false);}}
   onPause={() => {if (!loading) setBlocked(true);}} />
  {loading && <p className="intro-loading" role="status">Loading intro…</p>}
  <div className="intro-controls">
   {(blocked || loading) && <button type="button" onClick={play}>Play intro</button>}
   <button type="button" onClick={() => {if (video.current) video.current.muted = !muted; setMuted(!muted);}}>{muted ? 'Enable sound' : 'Mute sound'}</button>
   <button type="button" onClick={onComplete}>Skip intro</button>
  </div>
 </section>;
}
