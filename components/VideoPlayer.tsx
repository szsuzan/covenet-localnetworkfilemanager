"use client";

import { useEffect, useRef, useState } from "react";
import type { Item } from "./types";

type Mode = "probing" | "direct" | "preparing" | "hls" | "error";

export default function VideoPlayer({ item }: { item: Item }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("probing");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [key, setKey] = useState("");
  const [forceHls, setForceHls] = useState(false);
  const src = `/api/stream?path=${encodeURIComponent(item.path)}`;
  const poster = `/api/thumb?path=${encodeURIComponent(item.path)}`;
  const positionKey = `pos:${item.path}`;

  function saveProgress(keepalive = false) {
    const video = videoRef.current;
    if (!video || !video.duration || video.currentTime < 1) return;
    try {
      localStorage.setItem(positionKey, String(video.currentTime));
    } catch {
      /* ignore */
    }
    void fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: item.path,
        position: video.currentTime,
        duration: video.duration,
      }),
      keepalive,
    }).catch(() => {});
  }

  async function restorePosition() {
    const video = videoRef.current;
    if (!video) return;
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
    if (saved > 5 && video.duration && saved < video.duration - 10) {
      video.currentTime = saved;
    }
  }

  async function prepareHls() {
    setMode("preparing");
    setError("");
    setElapsed(0);
    try {
      const res = await fetch("/api/hls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path }),
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

  useEffect(() => {
    setForceHls(false);
  }, [item.path]);

  useEffect(() => {
    let cancelled = false;
    setMode("probing");
    setError("");
    setKey("");
    setElapsed(0);

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

  // Poll until the first HLS segment exists.
  useEffect(() => {
    if (mode !== "preparing" || !key) return;
    const timer = setInterval(async () => {
      setElapsed((value) => value + 1.5);
      try {
        const res = await fetch(`/api/hls/${key}`);
        const data = await res.json().catch(() => null);
        if (data?.ready) setMode("hls");
      } catch {
        /* keep waiting */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [mode, key]);

  // Attach hls.js once segments are ready.
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
        const hls = new Hls({ startPosition: 0, maxBufferLength: 30 });
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

  useEffect(() => {
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused) saveProgress();
    }, 5000);
    return () => {
      clearInterval(timer);
      saveProgress(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.path]);

  if (mode === "error") {
    return (
      <div className="player-box">
        <div className="player-status">
          <div style={{ color: "var(--danger)" }}>{error || "Could not play this video"}</div>
          <a className="btn" href={`${src}&download=1`}>
            Download original
          </a>
        </div>
      </div>
    );
  }

  if (mode === "probing" || mode === "preparing") {
    return (
      <div className="player-box">
        <div className="player-status">
          <div className="spinner" />
          <div>
            {mode === "probing"
              ? "Checking video format…"
              : `Preparing stream… ${Math.round(elapsed)}s`}
          </div>
          {mode === "preparing" ? (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              The server is transcoding this format. Playback starts automatically.
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="player-box">
      <video
        ref={videoRef}
        key={mode}
        src={mode === "direct" ? src : undefined}
        poster={poster}
        controls
        autoPlay
        playsInline
        preload="metadata"
        onLoadedMetadata={restorePosition}
        onPause={() => saveProgress()}
        onEnded={() => saveProgress()}
        onError={() => {
          if (mode === "direct" && !forceHls) setForceHls(true);
        }}
      />
    </div>
  );
}
