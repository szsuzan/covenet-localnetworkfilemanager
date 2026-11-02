"use client";

import { useEffect, useState } from "react";
import type { Item } from "./types";
import VideoPlayer from "./VideoPlayer";
import PhotoViewer from "./PhotoViewer";
import PdfViewer from "./PdfViewer";
import { ChevronLeft, ChevronRight, CloseIcon, DownloadIcon } from "./icons";

const VIEWABLE = ["image", "video", "audio", "pdf", "text"];

function TextPreview({ item }: { item: Item }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (item.size > 2 * 1024 * 1024) {
      setError("File is too large to preview");
      return;
    }
    fetch(`/api/stream?path=${encodeURIComponent(item.path)}`)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("Could not read file"))))
      .then((value) => {
        if (!cancelled) setText(value);
      })
      .catch(() => {
        if (!cancelled) setError("Could not read file");
      });
    return () => {
      cancelled = true;
    };
  }, [item.path, item.size]);

  if (error) return <div className="player-status">{error}</div>;
  if (text === null) return <div className="player-status">Loading…</div>;
  return <pre className="text-preview">{text}</pre>;
}

export default function Viewer({
  items,
  current,
  onClose,
  onSelect,
}: {
  items: Item[];
  current: Item;
  onClose: () => void;
  onSelect: (item: Item) => void;
}) {
  const siblings = items.filter((item) => !item.isDir && VIEWABLE.includes(item.kind));
  const index = siblings.findIndex((item) => item.path === current.path);
  const previous = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const stream = `/api/stream?path=${encodeURIComponent(current.path)}`;
  const download = `${stream}&download=1`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The PDF and photo viewers handle their own keys, but closing is safe.
        if (current.kind !== "image") onClose();
        return;
      }
      if (current.kind === "image" || current.kind === "pdf") return;
      if (event.key === "ArrowLeft" && previous) onSelect(previous);
      if (event.key === "ArrowRight" && next) onSelect(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelect, previous, next, current.kind]);

  if (current.kind === "image") {
    return (
      <PhotoViewer
        items={items}
        current={current}
        onClose={onClose}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="viewer">
      <div className="viewer-head">
        <div className="viewer-title">{current.name}</div>
        {index >= 0 && current.kind !== "pdf" ? (
          <span className="muted" style={{ fontSize: 12 }}>
            {index + 1} / {siblings.length}
          </span>
        ) : null}
        <a className="icon-btn" href={download} title="Download">
          <DownloadIcon />
        </a>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <CloseIcon />
        </button>
      </div>

      <div className="viewer-stage">
        {current.kind === "video" ? (
          <VideoPlayer key={current.path} item={current} />
        ) : current.kind === "audio" ? (
          <audio controls autoPlay src={stream} />
        ) : current.kind === "pdf" ? (
          <PdfViewer key={current.path} item={current} />
        ) : current.kind === "text" ? (
          <TextPreview item={current} />
        ) : (
          <div className="player-status">
            <div>No preview for this file type.</div>
            <a className="btn" href={download}>
              Download
            </a>
          </div>
        )}

        {current.kind !== "pdf" && previous ? (
          <button className="nav-arrow left" onClick={() => onSelect(previous)} title="Previous">
            <ChevronLeft />
          </button>
        ) : null}
        {current.kind !== "pdf" && next ? (
          <button className="nav-arrow right" onClick={() => onSelect(next)} title="Next">
            <ChevronRight />
          </button>
        ) : null}
      </div>
    </div>
  );
}
