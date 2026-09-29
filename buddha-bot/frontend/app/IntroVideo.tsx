"use client";
import { useEffect, useRef, useState } from 'react';

export default function IntroVideo({ onComplete }: { onComplete: () => void }) {
 const video = useRef<HTMLVideoElement>(null);
 const [blocked, setBlocked] = useState(false);
 const [loading, setLoading] = useState(true);
 const [muted, setMuted] = useState(true);
 useEffect(() => {
  const element = video.current;
  if (!element) return;
  let active = true, scheduled = false;
  let firstFrame = 0, secondFrame = 0;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
   onComplete();
   return;
  }
  function startWhenReady() {
   if (!element || scheduled || document.readyState !== 'complete' ||
       document.visibilityState !== 'visible' || element.readyState < 3) return;
   scheduled = true;
   // Give the mounted overlay a paint before starting at the first frame.
   firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
     if (!active) return;
     if (document.visibilityState !== 'visible') {scheduled = false; return;}
     element.currentTime = 0;
     setLoading(false);
     element.play().catch(() => {if (active) setBlocked(true);});
    });
   });
  }
  window.addEventListener('load', startWhenReady);
  element.addEventListener('canplay', startWhenReady);
  document.addEventListener('visibilitychange', startWhenReady);
  startWhenReady();
  return () => {
   active = false;
   cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame);
   window.removeEventListener('load', startWhenReady);
   element.removeEventListener('canplay', startWhenReady);
   document.removeEventListener('visibilitychange', startWhenReady);
   element.pause();
  };
 }, [onComplete]);
 async function play() {
  try { await video.current?.play(); setBlocked(false); }
  catch { setBlocked(true); }
 }
 return <section className="intro" aria-label="Echo introduction" aria-busy={loading}>
  <video ref={video} src="/video/intro.mp4" muted={muted} playsInline preload="auto"
   onEnded={onComplete} onError={onComplete}
   onPlaying={() => {setLoading(false); setBlocked(false);}}
   onPause={() => {if (!loading) setBlocked(true);}} />
  {loading && <p className="intro-loading" role="status">Loading intro…</p>}
  <div className="intro-controls">
   {blocked && !loading && <button type="button" onClick={play}>Play intro</button>}
   <button type="button" onClick={() => {if (video.current) video.current.muted = !muted; setMuted(!muted);}}>{muted ? 'Enable sound' : 'Mute sound'}</button>
   <button type="button" onClick={onComplete}>Skip intro</button>
  </div>
 </section>;
}
