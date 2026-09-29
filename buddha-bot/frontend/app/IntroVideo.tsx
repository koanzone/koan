"use client";
import { useEffect, useRef, useState } from 'react';

export default function IntroVideo({ onComplete }: { onComplete: () => void }) {
 const video = useRef<HTMLVideoElement>(null);
 const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const [blocked, setBlocked] = useState(false);
 const [muted, setMuted] = useState(true);
 useEffect(() => {
  const element = video.current;
  let active = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
   onComplete();
   return;
  }
  // Do not strand the visitor if loading never completes.
  loadTimer.current = setTimeout(onComplete, 15000);
  element?.play().catch(() => { if (active) setBlocked(true); });
  return () => {
   active = false;
   if (loadTimer.current) clearTimeout(loadTimer.current);
   element?.pause();
  };
 }, [onComplete]);
 async function play() {
  try { await video.current?.play(); setBlocked(false); }
  catch { onComplete(); }
 }
 return <section className="intro" aria-label="Echo introduction">
  <video ref={video} src="/video/intro.mp4" autoPlay muted={muted} playsInline preload="auto"
   onEnded={onComplete} onError={onComplete}
   onPlaying={() => {setBlocked(false); if (loadTimer.current) clearTimeout(loadTimer.current);}}
   onPause={() => setBlocked(true)} />
  <div className="intro-controls">
   {blocked && <button type="button" onClick={play}>Play intro</button>}
   <button type="button" onClick={() => {if (video.current) video.current.muted = !muted; setMuted(!muted);}}>{muted ? 'Enable sound' : 'Mute sound'}</button>
   <button type="button" onClick={onComplete}>Skip intro</button>
  </div>
 </section>;
}
