import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallParticipant } from '../api/types';
import { useToast } from '../components/Toasts';
import { Avatar } from '../components/ui';
import { currentConnectionId } from '../realtime/hub';
import { useSpeaking } from './audioLevel';
import type { CallApi, PeerStatus } from './useCall';

/**
 * The floating call window: video tiles for everyone in the call, plus mic/camera/screen/leave controls.
 *
 * Audio and video are played by separate elements: every <video> is muted (so it may always autoplay), and each
 * remote participant's sound comes from its own hidden <audio>. If the browser blocks sound until the user taps
 * (common on phones), a "Tap to turn on sound" button appears instead of silently playing nothing.
 */
export function CallDock({
  call,
  myUserId,
  myName,
  variant = 'dock',
}: {
  call: CallApi;
  myUserId: string;
  myName: string;
  /** "dock" floats over a board; "page" fills a room page. */
  variant?: 'dock' | 'page';
}) {
  const [expanded, setExpanded] = useState(false);
  const toast = useToast();
  const me = currentConnectionId();
  const others = call.participants.filter((p) => p.connectionId !== me);
  const meSpeaking = useSpeaking(call.localAudio, call.micOn);

  // Spotlight: one tile shown large with the rest in a strip. Someone else's screen share takes it automatically;
  // a pinned tile (📌) overrides that. 'me' means our own tile.
  const [pinned, setPinned] = useState<string | null>(null);
  const pinnedValid = pinned === 'me' || others.some((p) => p.connectionId === pinned);
  const sharer = others.find((p) => p.screenSharing && call.remoteStreams[p.connectionId])?.connectionId ?? null;
  const spotlight = (pinnedValid ? pinned : null) ?? sharer;
  const togglePin = (id: string) => setPinned((current) => (current === id || (current === null && spotlight === id) ? 'none' : id));
  const effectiveSpotlight = pinned === 'none' ? null : spotlight;
  // A new screen share gets the spotlight again even if the grid was chosen for an earlier one.
  const [lastSharer, setLastSharer] = useState(sharer);
  if (sharer !== lastSharer) {
    setLastSharer(sharer);
    if (pinned === 'none' && sharer) setPinned(null);
  }

  const audioElements = useRef(new Map<string, HTMLAudioElement>());
  const [soundBlocked, setSoundBlocked] = useState(false);

  const registerAudio = useCallback((id: string, el: HTMLAudioElement | null) => {
    if (el) audioElements.current.set(id, el);
    else audioElements.current.delete(id);
  }, []);

  const unblockSound = () => {
    // Called from a tap, which is the user gesture browsers require before playing sound.
    Promise.all([...audioElements.current.values()].map((el) => el.play())).then(
      () => setSoundBlocked(false),
      () => toast("The browser is still blocking sound. Check that the tab isn't muted.", 'error'),
    );
  };

  return (
    <section className={`call-dock ${variant === 'page' ? 'page' : expanded ? 'expanded' : ''}`} aria-label="Call">
      {variant === 'dock' && (
        <header className="call-header">
          <span className="call-title">
            <span className="call-live-dot" aria-hidden="true" />
            Call · {others.length + 1} {others.length === 0 ? 'person' : 'people'}
          </span>
          <button className="icon-button" onClick={() => setExpanded((x) => !x)} title={expanded ? 'Make smaller' : 'Make bigger'}>
            {expanded ? '⤡' : '⤢'}
          </button>
        </header>
      )}

      {soundBlocked && (
        <button className="call-unblock" onClick={unblockSound}>
          🔊 Tap to turn on sound
        </button>
      )}

      {(() => {
        const tiles = [
          {
            key: 'me',
            node: (
              <Tile
                id={myUserId}
                name={`${myName} (you)`}
                stream={call.localVideo}
                showVideo={!!call.localVideo}
                micOn={call.micOn}
                screenSharing={call.screenOn}
                speaking={meSpeaking}
                mirrored={call.cameraOn && !call.screenOn}
                pinned={effectiveSpotlight === 'me'}
                onTogglePin={others.length > 0 ? () => togglePin('me') : undefined}
              />
            ),
          },
          ...others.map((p) => ({
            key: p.connectionId,
            node: (
              <RemoteTile
                participant={p}
                stream={call.remoteStreams[p.connectionId]}
                status={call.peerStatus[p.connectionId]}
                speaking={!!call.speaking[p.connectionId] && p.micOn}
                pinned={effectiveSpotlight === p.connectionId}
                onTogglePin={() => togglePin(p.connectionId)}
              />
            ),
          })),
        ];
        const main = effectiveSpotlight ? tiles.find((t) => t.key === effectiveSpotlight) : undefined;

        if (main) {
          return (
            <div className="call-grid spotlight">
              <div className="call-spotlight-main" key={main.key}>
                {main.node}
              </div>
              <div className="call-strip">
                {tiles
                  .filter((t) => t !== main)
                  .map((t) => (
                    <div className="call-strip-item" key={t.key}>
                      {t.node}
                    </div>
                  ))}
              </div>
            </div>
          );
        }
        return (
          <div className={`call-grid count-${Math.min(others.length + 1, 6)}`}>
            {tiles.map((t) => (
              <div className="call-grid-item" key={t.key}>
                {t.node}
              </div>
            ))}
          </div>
        );
      })()}

      {/* One audio element per incoming sound (voice, shared-screen sound), independent of how tiles are shown. */}
      {others.flatMap((p) =>
        (call.remoteStreams[p.connectionId]?.getAudioTracks() ?? []).map((track) => (
          <RemoteAudio key={track.id} track={track} register={registerAudio} onBlocked={() => setSoundBlocked(true)} />
        )),
      )}

      {others.length === 0 && <p className="call-waiting muted small">Waiting for others to join…</p>}

      <div className="call-controls">
        <ControlButton on={call.micOn} onClick={() => void call.toggleMic()} label={call.micOn ? 'Mute' : 'Unmute'} icon={call.micOn ? '🎙️' : '🔇'} />
        <ControlButton on={call.cameraOn} onClick={() => void call.toggleCamera()} label={call.cameraOn ? 'Stop video' : 'Start video'} icon={call.cameraOn ? '📷' : '🚫'} />
        {call.canShareScreen ? (
          <ControlButton on={call.screenOn} onClick={() => void call.toggleScreenShare()} label={call.screenOn ? 'Stop sharing' : 'Share screen'} icon="🖥️" />
        ) : (
          // Phone browsers (iPhone, iPad, Android) don't let websites capture the screen; explain instead of hiding.
          <button
            className="call-control unavailable"
            aria-disabled="true"
            title="Screen sharing isn't available in this browser"
            onClick={() => toast("Phone and tablet browsers don't allow websites to share the screen. Join from a computer to share.", 'info')}
          >
            <span aria-hidden="true">🖥️</span>
            <span className="call-control-label">Share screen</span>
          </button>
        )}
        <button className="call-control leave" onClick={call.leave} title="Leave call">
          <span aria-hidden="true">📞</span>
          <span className="call-control-label">Leave</span>
        </button>
      </div>
    </section>
  );
}

function ControlButton({ on, onClick, label, icon }: { on: boolean; onClick(): void; label: string; icon: string }) {
  return (
    <button className={`call-control ${on ? 'on' : 'off'}`} onClick={onClick} title={label} aria-pressed={on}>
      <span aria-hidden="true">{icon}</span>
      <span className="call-control-label">{label}</span>
    </button>
  );
}

function RemoteAudio({
  track,
  register,
  onBlocked,
}: {
  track: MediaStreamTrack;
  register(id: string, el: HTMLAudioElement | null): void;
  onBlocked(): void;
}) {
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    register(track.id, el);
    el.srcObject = new MediaStream([track]);
    el.play().catch((e: { name?: string }) => {
      if (e?.name === 'NotAllowedError') onBlocked(); // autoplay policy: needs a tap
    });
    return () => register(track.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, register]);

  return <audio ref={audio} autoPlay />;
}

function RemoteTile({
  participant,
  stream,
  status,
  speaking,
  pinned,
  onTogglePin,
}: {
  participant: CallParticipant;
  stream?: MediaStream;
  status?: PeerStatus;
  speaking: boolean;
  pinned: boolean;
  onTogglePin(): void;
}) {
  const showVideo = !!stream && (participant.cameraOn || participant.screenSharing);
  return (
    <Tile
      id={participant.userId}
      name={participant.displayName}
      stream={stream ?? null}
      showVideo={showVideo}
      micOn={participant.micOn}
      screenSharing={participant.screenSharing}
      speaking={speaking}
      status={status}
      pinned={pinned}
      onTogglePin={onTogglePin}
    />
  );
}

const STATUS_LABEL: Record<PeerStatus, string | null> = {
  connecting: 'Connecting…',
  connected: null,
  reconnecting: 'Reconnecting…',
  failed: "Can't connect. A network may be blocking calls",
};

function Tile({
  id,
  name,
  stream,
  showVideo,
  micOn,
  screenSharing,
  speaking,
  mirrored,
  status,
  pinned,
  onTogglePin,
}: {
  id: string;
  name: string;
  stream: MediaStream | null;
  showVideo: boolean;
  micOn: boolean;
  screenSharing: boolean;
  speaking: boolean;
  mirrored?: boolean;
  status?: PeerStatus;
  pinned?: boolean;
  onTogglePin?(): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(!!root.current && document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    const enterVideoOnly = () =>
      // iPhone Safari can only put a <video> itself into full screen (its native player).
      (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
    const el = root.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(enterVideoOnly);
    else enterVideoOnly();
  };

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream && showVideo) el.play().catch(() => undefined); // muted video may always autoplay
  }, [stream, showVideo]);

  const label = status ? STATUS_LABEL[status] : null;

  return (
    <div
      ref={root}
      className={`call-tile ${screenSharing ? 'sharing' : ''} ${speaking ? 'speaking' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
      onDoubleClick={showVideo ? toggleFullscreen : undefined}
    >
      {/* Always muted: sound is played by RemoteAudio, and our own preview must never echo. */}
      <video ref={video} autoPlay playsInline muted className={`${mirrored ? 'mirrored' : ''} ${showVideo ? '' : 'hidden-video'}`} />
      {!showVideo && (
        <div className="call-tile-avatar">
          <Avatar id={id} name={name} size={48} />
        </div>
      )}
      {label && <div className="call-tile-status">{label}</div>}
      <div className="call-tile-actions">
        {onTogglePin && !fullscreen && (
          <button
            className={`tile-action ${pinned ? 'active' : ''}`}
            onClick={onTogglePin}
            title={pinned ? 'Back to grid' : 'Show large'}
            aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
          >
            📌
          </button>
        )}
        {showVideo && (
          <button
            className="tile-action"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={fullscreen ? 'Exit full screen' : `Show ${name} full screen`}
          >
            {fullscreen ? '🗗' : '⛶'}
          </button>
        )}
      </div>
      <div className="call-tile-name">
        {speaking && <SpeakingBars />}
        {!micOn && <span title="Muted">🔇</span>}
        {screenSharing && <span title="Sharing screen">🖥️</span>}
        <span>{name}</span>
      </div>
    </div>
  );
}

function SpeakingBars() {
  return (
    <span className="speaking-bars" aria-label="Speaking">
      <span />
      <span />
      <span />
    </span>
  );
}
