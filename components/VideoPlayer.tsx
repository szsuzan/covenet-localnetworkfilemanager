"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "./types";
import {
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  ReplayIcon,
  SettingsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  VolumeIcon,
  VolumeOffIcon,
} from "./icons";

type Mode = "probing" | "direct" | "preparing" | "hls" | "error";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

export default function VideoPlayer({ item }: { item: Item }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  const [mode, setMode] = useState<Mode>("probing");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [key, setKey] = useState("");
  const [hlsStart, setHlsStart] = useState(0);
  const [forceHls, setForceHls] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  const src = `/api/stream?path=${encodeURIComponent(item.path)}&v=${item.mtime}`;
  const poster = `/api/thumb?path=${encodeURIComponent(item.path)}&v=${item.mtime}`;
  const positionKey = `pos:${item.path}`;

  const saveProgress = useCallback(
    (keepalive = false) => {
      const video = videoRef.current;
      const offset = mode === "hls" ? hlsStart : 0;
      const position = offset + (video?.currentTime || 0);
      const total = sourceDuration || (video ? offset + video.duration : 0);
      if (!video || !total || !Number.isFinite(total) || position < 1) {
        return;
      }
      try {
        localStorage.setItem(positionKey, String(position));
      } catch {
        /* ignore */
      }
      void fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: item.path,
          position,
          duration: total,
        }),
        keepalive,
      }).catch(() => {});
    },
    [hlsStart, item.path, mode, positionKey, sourceDuration],
  );

  const restorePosition = useCallback(async () => {
    const video = videoRef.current;
    if (!video || restored.current) return;
    restored.current = true;
    let saved = 0;
    try {
      const res = await fetch(`/api/watch?path=${encodeURIComponent(item.path)}`);
      const data = await res.json().catch(() => ({}));
      saved = Number(data.position) || 0;
    } catch {
      /* fall back to local */
    }
    if (!saved) {
      try {
        saved = Number(localStorage.getItem(positionKey) || 0);
      } catch {
        saved = 0;
      }
    }
    const total = sourceDuration || (mode === "hls" ? hlsStart + video.duration : video.duration);
    if (saved > 1 && Number.isFinite(total) && total > 0) {
      // Ignore only the final ~10% so short clips still resume.
      const endGuard = Math.min(10, total * 0.1);
      if (saved < total - endGuard) {
        if (mode === "hls") {
          seekTo(saved);
        } else {
          video.currentTime = saved;
          setCurrent(saved);
        }
      }
    }
  }, [hlsStart, item.path, mode, positionKey, sourceDuration]);

  async function prepareHls(start = 0) {
    const offset = Math.max(0, Math.floor(start));
    setHlsStart(offset);
    setMode("preparing");
    setError("");
    setElapsed(0);
    setKey("");
    try {
      const res = await fetch("/api/hls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, start: offset }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.key) {
        setError(data?.error || "Could not prepare this video");
        setMode("error");
        return;
      }
      setKey(data.key);
    } catch {
      setError("Could not reach the server");
      setMode("error");
    }
  }

  // Probe once per file (or after a direct-play failure).
  useEffect(() => {
    setForceHls(false);
    restored.current = false;
  }, [item.path]);

  useEffect(() => {
    let cancelled = false;
    setMode("probing");
    setError("");
    setKey("");
    setHlsStart(0);
    setElapsed(0);
    setCurrent(0);
    setDuration(0);
    setSourceDuration(0);
    setWaiting(true);

    (async () => {
      try {
        const res = await fetch(`/api/media?path=${encodeURIComponent(item.path)}`);
        const info = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !info) {
          setError(info?.error || "Could not read this video");
          setMode("error");
          return;
        }
        const probedDuration = Number(info.duration);
        if (Number.isFinite(probedDuration) && probedDuration > 0) {
          setSourceDuration(probedDuration);
        }
        if (info.directPlay && !forceHls) {
          setMode("direct");
        } else {
          await prepareHls();
        }
      } catch {
        if (!cancelled) {
          setError("Could not reach the server");
          setMode("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.path, forceHls]);

  // Poll for the first HLS segment; 1s keeps startup snappy.
  useEffect(() => {
    if (mode !== "preparing" || !key) return;
    const timer = window.setInterval(async () => {
      setElapsed((value) => value + 1);
      try {
        const res = await fetch(`/api/hls/${key}`);
        const data = await res.json().catch(() => null);
        if (data?.ready) setMode("hls");
      } catch {
        /* keep waiting */
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, key]);

  // Attach hls.js once segments are available.
  useEffect(() => {
    if (mode !== "hls" || !key) return;
    const video = videoRef.current;
    if (!video) return;

    let instance: { destroy(): void } | null = null;
    let cancelled = false;
    const url = `/api/hls/${key}/index.m3u8`;

    (async () => {
      const mod = await import("hls.js");
      if (cancelled) return;
      const Hls = mod.default;
      if (Hls.isSupported()) {
        const hls = new Hls({
          startPosition: 0,
          maxBufferLength: 20,
          maxMaxBufferLength: 60,
          backBufferLength: 30,
          enableWorker: true,
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError("Playback failed. Try downloading the file.");
            setMode("error");
          }
        });
        instance = hls;
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
      } else {
        setError("This browser cannot play the transcoded stream");
        setMode("error");
      }
    })();

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [mode, key]);

  // Restore playback speed/volume.
  useEffect(() => {
    try {
      const savedRate = Number(localStorage.getItem("cove-rate") || 0);
      if (SPEEDS.includes(savedRate)) setRate(savedRate);
      const savedVolume = Number(localStorage.getItem("cove-volume") || 1);
      if (Number.isFinite(savedVolume)) setVolume(Math.min(1, Math.max(0, savedVolume)));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted, mode]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    try {
      localStorage.setItem("cove-rate", String(rate));
    } catch {
      /* ignore */
    }
  }, [rate, mode]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    setPipSupported(document.pictureInPictureEnabled);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const target = video as unknown as {
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    };
    const begin = () => setFullscreen(true);
    const end = () => setFullscreen(false);
    target.addEventListener("webkitbeginfullscreen", begin);
    target.addEventListener("webkitendfullscreen", end);
    return () => {
      target.removeEventListener("webkitbeginfullscreen", begin);
      target.removeEventListener("webkitendfullscreen", end);
    };
  }, [mode]);

  // Keep controls visible while paused or a menu is open.
  useEffect(() => {
    if (!playing || settingsOpen) {
      setControlsVisible(true);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      return;
    }
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3000);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [playing, settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onClick = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [settingsOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused) saveProgress();
    }, 5000);
    return () => {
      window.clearInterval(timer);
      saveProgress(true);
    };
  }, [saveProgress]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const video = videoRef.current;
      if (!video) return;

      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          void togglePlay();
          break;
        case "arrowleft":
          event.preventDefault();
          seekBy(-10);
          break;
        case "arrowright":
          event.preventDefault();
          seekBy(10);
          break;
        case "arrowup":
          event.preventDefault();
          changeVolume(0.1);
          break;
        case "arrowdown":
          event.preventDefault();
          changeVolume(-0.1);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "p":
          void togglePip();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, volume, muted, fullscreen]);

  function showControls() {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (playing) {
      hideTimer.current = window.setTimeout(() => setControlsVisible(false), 3000);
    }
  }

  function holdControls() {
    setControlsVisible(true);
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
    showControls();
  }

  function seekTo(value: number) {
    const video = videoRef.current;
    if (!video) return;
    const total =
      sourceDuration ||
      (mode === "hls" ? hlsStart + video.duration : video.duration) ||
      0;
    const target = Math.min(Math.max(0, value), total);

    if (mode === "hls") {
      const local = target - hlsStart;
      const available = Number.isFinite(video.duration) ? video.duration : 0;
      if (!available || local < -0.5 || local > available + 0.5) {
        // Start a new transcode near the target instead of waiting for the
        // sequentially transcoded stream to reach it.
        const start = Math.max(0, Math.floor(target - 2));
        setCurrent(target);
        setWaiting(true);
        void prepareHls(start);
        return;
      }
      video.currentTime = Math.min(Math.max(0, local), available);
      setCurrent(target);
      return;
    }

    video.currentTime = Math.min(target, video.duration || target);
    setCurrent(video.currentTime);
  }

  function seekBy(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    const offset = mode === "hls" ? hlsStart : 0;
    seekTo(offset + video.currentTime + delta);
    showControls();
  }

  function changeVolume(delta: number) {
    const next = Math.min(1, Math.max(0, volume + delta));
    setVolume(next);
    setMuted(next === 0);
    try {
      localStorage.setItem("cove-volume", String(next));
    } catch {
      /* ignore */
    }
    showControls();
  }

  function toggleMute() {
    setMuted((value) => !value);
    showControls();
  }

  async function toggleFullscreen() {
    const shell = shellRef.current;
    const video = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!shell) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.fullscreenEnabled) {
        await shell.requestFullscreen();
      } else {
        // iOS Safari only supports native video fullscreen.
        video?.webkitEnterFullscreen?.();
      }
    } catch {
      video?.webkitEnterFullscreen?.();
    }
    showControls();
  }

  async function togglePip() {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* ignore */
    }
  }

  function syncProgress() {
    const video = videoRef.current;
    if (!video) return;
    const offset = mode === "hls" ? hlsStart : 0;
    setCurrent(offset + video.currentTime);
    setDuration(Number.isFinite(video.duration) ? offset + video.duration : 0);
    if (video.buffered.length > 0) {
      setBuffered(offset + video.buffered.end(video.buffered.length - 1));
    }
    setMuted(video.muted);
    setVolume(video.volume);
  }

  if (mode === "error") {
    return (
      <div className="vp-status">
        <div className="vp-status-title">Could not play this video</div>
        <div className="vp-status-text">{error || "The format may be unsupported."}</div>
        <a className="btn" href={`${src}&download=1`}>
          Download original
        </a>
      </div>
    );
  }

  if (mode === "probing" || mode === "preparing") {
    return (
      <div className="vp-status">
        <div className="vp-spinner" />
        <div className="vp-status-title">
          {mode === "probing" ? "Checking video format…" : "Preparing stream…"}
        </div>
        {mode === "preparing" ? (
          <div className="vp-status-text">
            Transcoding on the server — playback starts automatically.
            {elapsed > 0 ? ` ${Math.round(elapsed)}s` : ""}
          </div>
        ) : null}
      </div>
    );
  }

  const totalDuration = Math.max(duration, sourceDuration);
  const progress = totalDuration > 0 ? Math.min(100, (current / totalDuration) * 100) : 0;
  const bufferedPct = totalDuration > 0 ? Math.min(100, (buffered / totalDuration) * 100) : 0;

  return (
    <div
      ref={shellRef}
      className={`vp ${controlsVisible ? "" : "is-hidden"} ${fullscreen ? "is-fullscreen" : ""}`}
      tabIndex={0}
      onMouseMove={showControls}
      onMouseLeave={() => playing && !settingsOpen && setControlsVisible(false)}
      onTouchStart={showControls}
      onDoubleClick={() => void toggleFullscreen()}
    >
      <video
        ref={videoRef}
        key={mode}
        className="vp-video"
        src={mode === "direct" ? src : undefined}
        poster={poster}
        autoPlay
        preload="auto"
        playsInline
        onClick={togglePlay}
        onLoadedMetadata={() => {
          syncProgress();
          void restorePosition();
        }}
        onTimeUpdate={syncProgress}
        onProgress={syncProgress}
        onDurationChange={syncProgress}
        onPlay={() => {
          setPlaying(true);
          setWaiting(false);
          showControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
          saveProgress();
        }}
        onEnded={() => {
          const video = videoRef.current;
          setPlaying(false);
          setControlsVisible(true);
          setCurrent(hlsStart + (video?.duration || 0));
          saveProgress();
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onError={() => {
          if (mode === "direct" && !forceHls) setForceHls(true);
        }}
      />

      {waiting && !error ? <div className="vp-spinner vp-spinner-center" /> : null}

      {!playing && !waiting ? (
        <button className="vp-center" onClick={togglePlay} aria-label="Play">
          {current > 0 && duration > 0 && current >= duration - 0.5 ? (
            <ReplayIcon width={26} height={26} />
          ) : (
            <PlayIcon width={28} height={28} />
          )}
        </button>
      ) : null}

      <div
        className="vp-controls"
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={holdControls}
        onMouseLeave={showControls}
      >
        <div className="vp-progress">
          <input
            className="vp-seek"
            type="range"
            min={0}
            max={totalDuration || 0}
            step={0.1}
            value={Math.min(current, totalDuration || 0)}
            aria-label="Seek"
            style={
              {
                "--progress": `${progress}%`,
                "--buffered": `${bufferedPct}%`,
              } as React.CSSProperties
            }
            onChange={(event) => seekTo(Number(event.target.value))}
          />
        </div>

        <div className="vp-buttons">
          <button className="vp-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="vp-btn" onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
            <SkipBackIcon />
          </button>
          <button className="vp-btn" onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
            <SkipForwardIcon />
          </button>
          <span className="vp-time">
            {formatTime(current)} <span>/</span> {formatTime(totalDuration)}
          </span>

          <div className="vp-grow" />

          <div className="vp-volume">
            <button className="vp-btn" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted || volume === 0 ? <VolumeOffIcon /> : <VolumeIcon />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => changeVolume(Number(event.target.value) - volume)}
            />
          </div>

          <div className="vp-settings" ref={settingsRef}>
            <button
              className="vp-btn"
              onClick={() => setSettingsOpen((value) => !value)}
              aria-label="Playback settings"
            >
              <SettingsIcon />
            </button>
            {settingsOpen ? (
              <div className="vp-menu">
                <div className="vp-menu-title">Playback speed</div>
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    className={speed === rate ? "active" : ""}
                    onClick={() => {
                      setRate(speed);
                      setSettingsOpen(false);
                    }}
                  >
                    {speed === 1 ? "Normal" : `${speed}×`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {pipSupported ? (
            <button className="vp-btn" onClick={() => void togglePip()} aria-label="Picture in picture">
              <PipIcon />
            </button>
          ) : null}

          <button
            className="vp-btn"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}
