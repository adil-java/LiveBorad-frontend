import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import type { CallParticipant } from '../api/types';
import { useToast } from '../components/Toasts';
import { getAudioContext } from './audioLevel';
import { connectHub, currentConnectionId, getHub, onHubReconnected } from '../realtime/hub';

/**
 * Voice/video calls with WebRTC. Audio and video go directly between browsers; the hub only relays the
 * signalling messages (offer, answer, ICE candidates) and tracks who is in the call.
 *
 * Rules that keep negotiation simple:
 * - Whoever joins sends an offer to everyone already in the call; existing participants only answer.
 * - Every connection is created with three transceivers up front, always in this order: microphone audio,
 *   video (camera or screen), and screen audio. Muting, the camera and screen sharing (with its sound) just swap
 *   the sender's track (replaceTrack), so no renegotiation is ever needed.
 */

/** Transceiver positions; identical on both sides because they follow the order of the offer's media sections. */
const SLOT = { mic: 0, video: 1, screenAudio: 2 } as const;
type Slot = keyof typeof SLOT;

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream;
  initiator: boolean;
  /** ICE candidates that arrived before the remote description; applied once it is set. */
  pending: RTCIceCandidateInit[];
  /** Signals for one peer are handled strictly in order. */
  queue: Promise<void>;
}

export type PeerStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** RTP audio level (0–1, linear) above which a remote participant counts as speaking. Speech is roughly 0.03–0.3. */
const REMOTE_SPEAKING_LEVEL = 0.02;
const SPEAKING_HOLD_MS = 450;

/** SignalR wraps server errors; show only the HubException message. */
export function hubErrorMessage(e: unknown): string {
  const message = errorMessage(e);
  const marker = 'HubException: ';
  return message.includes(marker) ? message.slice(message.indexOf(marker) + marker.length) : message;
}

function mediaErrorMessage(e: unknown, device: string): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError') return `${device} access was blocked. Allow it in the browser's site settings.`;
  if (name === 'NotFoundError') return `No ${device.toLowerCase()} found.`;
  if (name === 'NotReadableError') return `Your ${device.toLowerCase()} is being used by another app.`;
  return `Couldn't use your ${device.toLowerCase()}: ${errorMessage(e)}`;
}

export function useCall(boardId: string) {
  const toast = useToast();
  const [participants, setParticipants] = useState<CallParticipant[]>([]);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [localVideo, setLocalVideo] = useState<MediaStream | null>(null);
  /** Our microphone track, exposed so the UI can show when we're speaking. */
  const [localAudio, setLocalAudio] = useState<MediaStreamTrack | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStatus, setPeerStatus] = useState<Record<string, PeerStatus>>({});
  /** connectionId -> currently speaking, measured from the incoming audio's RTP levels. */
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  const peers = useRef(new Map<string, Peer>());
  const joinedRef = useRef(false);
  const iceServers = useRef<RTCIceServer[] | null>(null);
  const audioTrack = useRef<MediaStreamTrack | null>(null);
  const cameraTrack = useRef<MediaStreamTrack | null>(null);
  const screenTrack = useRef<MediaStreamTrack | null>(null);
  /** Sound captured with the shared screen (e.g. a Chrome tab's audio), sent alongside the microphone. */
  const screenAudioTrack = useRef<MediaStreamTrack | null>(null);
  const flags = useRef({ micOn: false, cameraOn: false, screenOn: false });
  const shownNoAudioTip = useRef(false);

  // ---- Helpers ----

  const outgoingVideo = () => screenTrack.current ?? cameraTrack.current;

  const refreshLocalPreview = () => {
    const track = outgoingVideo();
    setLocalVideo(track ? new MediaStream([track]) : null);
  };

  const sendSignal = (to: string, type: 'offer' | 'answer' | 'candidate', payload: unknown) => {
    getHub().invoke('SendSignal', to, type, JSON.stringify(payload)).catch(() => undefined);
  };

  const publishState = () => {
    const f = flags.current;
    const hub = getHub();
    if (joinedRef.current && hub.state === 'Connected')
      hub.invoke('UpdateCallState', f.micOn, f.cameraOn, f.screenOn).catch(() => undefined);
  };

  const slotTrack = (index: number): MediaStreamTrack | null =>
    index === SLOT.mic ? audioTrack.current : index === SLOT.video ? outgoingVideo() : index === SLOT.screenAudio ? screenAudioTrack.current : null;

  const replaceTrack = (slot: Slot, track: MediaStreamTrack | null) => {
    for (const { pc } of peers.current.values()) {
      const t = pc.getTransceivers()[SLOT[slot]];
      if (t && t.currentDirection !== 'stopped') t.sender.replaceTrack(track).catch(() => undefined);
    }
  };

  const closePeer = (id: string) => {
    const peer = peers.current.get(id);
    if (!peer) return;
    peer.pc.close();
    peers.current.delete(id);
    setRemoteStreams(({ [id]: _, ...rest }) => rest);
    setPeerStatus(({ [id]: _, ...rest }) => rest);
  };

  const createPeer = (id: string, initiator: boolean): Peer => {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current ?? [] });
    const peer: Peer = { pc, stream: new MediaStream(), initiator, pending: [], queue: Promise.resolve() };
    peers.current.set(id, peer);
    setPeerStatus((s) => ({ ...s, [id]: 'connecting' }));

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(id, 'candidate', e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      peer.stream.addTrack(e.track);
      setRemoteStreams((s) => ({ ...s, [id]: peer.stream }));
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const status: PeerStatus =
        state === 'connected' ? 'connected' : state === 'failed' ? 'failed' : state === 'disconnected' ? 'reconnecting' : 'connecting';
      setPeerStatus((s) => (id in s ? { ...s, [id]: status } : s));
      // The side that made the original offer also drives ICE restarts, so the pair never both offer at once.
      if (state === 'failed' && peer.initiator) void offer(id, peer, true);
    };

    if (initiator) {
      pc.addTransceiver(audioTrack.current ?? 'audio', { direction: 'sendrecv' }); // SLOT.mic
      pc.addTransceiver(outgoingVideo() ?? 'video', { direction: 'sendrecv' }); // SLOT.video
      pc.addTransceiver(screenAudioTrack.current ?? 'audio', { direction: 'sendrecv' }); // SLOT.screenAudio
    }
    return peer;
  };

  const offer = async (id: string, peer: Peer, iceRestart = false) => {
    try {
      const description = await peer.pc.createOffer({ iceRestart });
      await peer.pc.setLocalDescription(description);
      sendSignal(id, 'offer', peer.pc.localDescription);
    } catch {
      setPeerStatus((s) => ({ ...s, [id]: 'failed' }));
    }
  };

  const flushCandidates = async (peer: Peer) => {
    for (const candidate of peer.pending.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => undefined);
  };

  const handleSignal = async (from: string, type: string, payload: string) => {
    if (!joinedRef.current) return;
    const data = JSON.parse(payload);

    if (type === 'offer') {
      const peer = peers.current.get(from) ?? createPeer(from, false);
      await peer.pc.setRemoteDescription(data);
      // The offer created the transceivers on this side; attach what we're sending and make them two-way.
      const transceivers = peer.pc.getTransceivers();
      for (let i = 0; i < transceivers.length; i++) {
        transceivers[i].direction = 'sendrecv';
        await transceivers[i].sender.replaceTrack(slotTrack(i));
      }
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      sendSignal(from, 'answer', peer.pc.localDescription);
      await flushCandidates(peer);
    } else {
      const peer = peers.current.get(from);
      if (!peer) return;
      if (type === 'answer') {
        await peer.pc.setRemoteDescription(data);
        await flushCandidates(peer);
      } else if (type === 'candidate') {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data).catch(() => undefined);
        else peer.pending.push(data);
      }
    }
  };

  /** Ends the call on this side only: closes connections and releases the camera and microphone. */
  const teardown = useCallback(() => {
    joinedRef.current = false;
    for (const id of [...peers.current.keys()]) closePeer(id);
    for (const ref of [audioTrack, cameraTrack, screenTrack, screenAudioTrack]) {
      ref.current?.stop();
      ref.current = null;
    }
    flags.current = { micOn: false, cameraOn: false, screenOn: false };
    setJoined(false);
    setMicOn(false);
    setCameraOn(false);
    setScreenOn(false);
    setLocalVideo(null);
    setLocalAudio(null);
    setRemoteStreams({});
    setPeerStatus({});
    setSpeaking({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Who is speaking: read each incoming audio stream's level from WebRTC itself (RTP audio-level header).
  // This avoids routing remote audio through Web Audio, which can silence playback in some browsers (Safari).
  useEffect(() => {
    if (!joined) return;
    const lastLoud = new Map<string, number>();
    const timer = setInterval(() => {
      const now = performance.now();
      const next: Record<string, boolean> = {};
      for (const [id, { pc }] of peers.current) {
        const receiver = pc.getTransceivers()[SLOT.mic]?.receiver; // the voice, not shared-screen sound
        const source = receiver?.getSynchronizationSources?.()[0];
        const fresh = source && Date.now() - source.timestamp < 1000;
        if (fresh && (source.audioLevel ?? 0) > REMOTE_SPEAKING_LEVEL) lastLoud.set(id, now);
        next[id] = now - (lastLoud.get(id) ?? -Infinity) < SPEAKING_HOLD_MS;
      }
      setSpeaking((current) => {
        const ids = new Set([...Object.keys(current), ...Object.keys(next)]);
        for (const id of ids) if (!!current[id] !== !!next[id]) return next;
        return current;
      });
    }, 150);
    return () => clearInterval(timer);
  }, [joined]);

  // ---- Hub subscriptions (always on, so the board shows a running call even when you're not in it) ----

  useEffect(() => {
    const hub = getHub();
    const queues = new Map<string, Promise<void>>();

    const onParticipants = (id: string, list: CallParticipant[]) => {
      if (id !== boardId) return;
      setParticipants(list);
      if (!joinedRef.current) return;
      const me = currentConnectionId();
      const present = new Set(list.map((p) => p.connectionId));
      if (me && !present.has(me)) {
        teardown(); // removed from the board, or the server restarted
        return;
      }
      for (const peerId of peers.current.keys()) if (!present.has(peerId)) closePeer(peerId);
    };

    const onSignal = (id: string, from: string, type: string, payload: string) => {
      if (id !== boardId) return;
      const next = (queues.get(from) ?? Promise.resolve()).then(() => handleSignal(from, type, payload)).catch(() => undefined);
      queues.set(from, next);
    };

    hub.on('CallParticipantsChanged', onParticipants);
    hub.on('CallSignal', onSignal);

    // A dropped hub connection gets a new connection ID, and the server already removed the old one from the call.
    const offReconnect = onHubReconnected(() => {
      if (!joinedRef.current) return;
      teardown();
      toast('Your connection dropped, so you left the call. Join again when ready.', 'info');
    });

    return () => {
      hub.off('CallParticipantsChanged', onParticipants);
      hub.off('CallSignal', onSignal);
      offReconnect();
      if (joinedRef.current) {
        hub.invoke('LeaveCall').catch(() => undefined);
        teardown();
      }
      setParticipants([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, teardown, toast]);

  // Hanging up when the tab closes lets others see you leave straight away.
  useEffect(() => {
    const onUnload = () => {
      if (joinedRef.current) getHub().send('LeaveCall').catch(() => undefined);
    };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);

  // ---- Actions ----

  const join = useCallback(async () => {
    if (joinedRef.current || joining) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      toast('This browser does not support calls. Calls also need HTTPS (or localhost).', 'error');
      return;
    }
    setJoining(true);
    getAudioContext(); // unlock audio metering while we still have the click's user gesture
    try {
      iceServers.current ??= (await api.iceServers()).map((s) => ({
        urls: s.urls,
        username: s.username ?? undefined,
        credential: s.credential ?? undefined,
      }));

      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        audioTrack.current = media.getAudioTracks()[0] ?? null;
        setLocalAudio(audioTrack.current);
      } catch (e) {
        toast(`${mediaErrorMessage(e, 'Microphone')} You joined muted.`, 'info');
      }
      flags.current = { micOn: !!audioTrack.current, cameraOn: false, screenOn: false };
      setMicOn(!!audioTrack.current);

      const hub = await connectHub();
      const existing = await hub.invoke<CallParticipant[]>('JoinCall', flags.current.micOn, false);
      joinedRef.current = true;
      setJoined(true);
      for (const p of existing) await offer(p.connectionId, createPeer(p.connectionId, true));
    } catch (e) {
      teardown();
      toast(hubErrorMessage(e), 'error');
    } finally {
      setJoining(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joining, teardown, toast]);

  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    getHub().invoke('LeaveCall').catch(() => undefined);
    teardown();
  }, [teardown]);

  const toggleMic = useCallback(async () => {
    if (!audioTrack.current) {
      try {
        const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        audioTrack.current = media.getAudioTracks()[0];
        setLocalAudio(audioTrack.current);
        replaceTrack('mic', audioTrack.current);
      } catch (e) {
        toast(mediaErrorMessage(e, 'Microphone'), 'error');
        return;
      }
    } else {
      // Muting just disables the track: the connection keeps running and unmuting is instant.
      audioTrack.current.enabled = !audioTrack.current.enabled;
    }
    flags.current.micOn = audioTrack.current.enabled;
    setMicOn(flags.current.micOn);
    publishState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const toggleCamera = useCallback(async () => {
    if (cameraTrack.current) {
      cameraTrack.current.stop();
      cameraTrack.current = null;
    } else {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
        });
        cameraTrack.current = media.getVideoTracks()[0];
      } catch (e) {
        toast(mediaErrorMessage(e, 'Camera'), 'error');
        return;
      }
    }
    if (!screenTrack.current) replaceTrack('video', cameraTrack.current);
    flags.current.cameraOn = !!cameraTrack.current;
    setCameraOn(flags.current.cameraOn);
    refreshLocalPreview();
    publishState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const stopScreenShare = useCallback(() => {
    screenTrack.current?.stop();
    screenTrack.current = null;
    screenAudioTrack.current?.stop();
    screenAudioTrack.current = null;
    replaceTrack('video', cameraTrack.current);
    replaceTrack('screenAudio', null);
    flags.current.screenOn = false;
    setScreenOn(false);
    refreshLocalPreview();
    publishState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (screenTrack.current) {
      stopScreenShare();
      return;
    }
    try {
      const media = await captureScreen();
      const track = media.getVideoTracks()[0];
      track.contentHint = 'detail'; // favour sharp text over smooth motion
      track.onended = stopScreenShare; // the browser's own "Stop sharing" button
      screenTrack.current = track;
      screenAudioTrack.current = media.getAudioTracks()[0] ?? null;
      if (!screenAudioTrack.current && !shownNoAudioTip.current) {
        shownNoAudioTip.current = true;
        toast(
          "Sharing without sound. To include sound, use Chrome or Edge and share a tab with \"Share tab audio\" on (on Windows you can also share system audio).",
          'info',
        );
      }
    } catch (e) {
      const { name, message } = e as { name?: string; message?: string };
      if (name === 'NotAllowedError' && /system/i.test(message ?? '')) {
        // Chrome on macOS: the browser itself lacks the OS permission to record the screen.
        toast(
          'Your computer is blocking screen sharing for this browser. On a Mac: System Settings → Privacy & Security → Screen Recording (called "Screen & System Audio Recording" on newer macOS) → turn on your browser, then quit and reopen it.',
          'error',
        );
      } else if (name !== 'NotAllowedError' && name !== 'AbortError') {
        toast(mediaErrorMessage(e, 'Screen'), 'error'); // NotAllowedError/AbortError otherwise mean "cancelled"
      }
      return;
    }
    replaceTrack('video', screenTrack.current);
    replaceTrack('screenAudio', screenAudioTrack.current);
    flags.current.screenOn = true;
    setScreenOn(true);
    refreshLocalPreview();
    publishState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopScreenShare, toast]);

  return {
    participants,
    joined,
    joining,
    micOn,
    cameraOn,
    screenOn,
    localVideo,
    localAudio,
    remoteStreams,
    peerStatus,
    speaking,
    canShareScreen: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
    join,
    leave,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
  };
}

export type CallApi = ReturnType<typeof useCall>;

/**
 * Asks for the screen with its sound where the browser supports it (Chrome/Edge: tab audio, and system audio on
 * Windows/ChromeOS). Audio processing is turned off so music and videos aren't treated as a voice.
 * Browsers that reject audio capture outright get a video-only retry.
 */
async function captureScreen(): Promise<MediaStream> {
  const video = { frameRate: { ideal: 15 } };
  const withAudio = {
    video,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
  } as DisplayMediaStreamOptions;
  try {
    return await navigator.mediaDevices.getDisplayMedia(withAudio);
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'TypeError' || name === 'NotSupportedError') return navigator.mediaDevices.getDisplayMedia({ video });
    throw e;
  }
}
