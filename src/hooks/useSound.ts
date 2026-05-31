import { useCallback, useRef, useEffect } from 'react';

// Using Web Audio API for zero network overhead and maximum performance
export function useSound() {
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    // Initialize lazily to avoid auto-play policy issues until needed
    const initAudio = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    };
    document.addEventListener('click', initAudio, { once: true });
    return () => {
      document.removeEventListener('click', initAudio);
    };
  }, []);

  const playTone = useCallback((freq: number, type: OscillatorType, duration: number, vol = 0.1) => {
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    
    // Resume context if suspended
    if (ctx.state === 'suspended') {
        ctx.resume();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    // Envelope
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  }, []);

  const playClick = useCallback(() => {
    playTone(800, 'sine', 0.1, 0.05);
  }, [playTone]);

  const playToggleOn = useCallback(() => {
    playTone(600, 'square', 0.1, 0.02);
    setTimeout(() => playTone(1200, 'square', 0.15, 0.02), 50);
  }, [playTone]);

  const playToggleOff = useCallback(() => {
    playTone(1200, 'square', 0.1, 0.02);
    setTimeout(() => playTone(600, 'square', 0.15, 0.02), 50);
  }, [playTone]);

  const playSave = useCallback(() => {
    // A resonant chime
    playTone(1046.50, 'sine', 0.4, 0.1); // C6
    setTimeout(() => playTone(1318.51, 'sine', 0.6, 0.1), 100); // E6
    setTimeout(() => playTone(1567.98, 'sine', 0.8, 0.1), 200); // G6
  }, [playTone]);

  return { playClick, playToggleOn, playToggleOff, playSave };
}
