import { useEffect, useState } from 'react';

/** Average loudness (RMS, 0–1) above which someone counts as speaking. Speech is ~0.05–0.2; room noise ~0.005. */
const SPEAKING_THRESHOLD = 0.03;
/** Keep the highlight briefly after the voice drops, so it doesn't flicker between words. */
const HOLD_MS = 450;
const SAMPLE_EVERY_MS = 100;

let context: AudioContext | null = null;

/**
 * One shared AudioContext for level metering. Browsers only start audio after a user gesture,
 * so call this from a click handler (joining the call) to unlock it.
 */
export function getAudioContext(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  if (context.state === 'suspended') context.resume().catch(() => undefined);
  return context;
}

/** True while the given audio track is carrying speech. Analysis only: nothing is played through this context. */
export function useSpeaking(track: MediaStreamTrack | null | undefined, enabled: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const audio = enabled && track && track.readyState === 'live' ? getAudioContext() : null;
    if (!audio || !track) {
      setSpeaking(false);
      return;
    }

    const source = audio.createMediaStreamSource(new MediaStream([track]));
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let lastLoud = 0;
    let current = false;
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const now = performance.now();
      if (Math.sqrt(sum / samples.length) > SPEAKING_THRESHOLD) lastLoud = now;
      const next = now - lastLoud < HOLD_MS;
      if (next !== current) {
        current = next;
        setSpeaking(next);
      }
    }, SAMPLE_EVERY_MS);

    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      setSpeaking(false);
    };
  }, [track, enabled]);

  return speaking;
}
