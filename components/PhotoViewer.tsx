"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "./types";
import {
  ChevronLeft,
  ChevronRight,
  CloseIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  RotateIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./icons";

function imageUrl(item: Item) {
  if (/\.(heic|heif|tiff?)$/i.test(item.name)) {
    return `/api/preview?path=${encodeURIComponent(item.path)}&v=${item.mtime}`;
  }
  return `/api/stream?path=${encodeURIComponent(item.path)}&v=${item.mtime}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function PhotoViewer({
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
  const images = items.filter((item) => item.kind === "image");
  const index = images.findIndex((item) => item.path === current.path);
  const previous = index > 0 ? images[index - 1] : null;
  const next = index >= 0 && index < images.length - 1 ? images[index + 1] : null;

  const stageRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  const nextRef = useRef<Item | null>(next);
  const firstRef = useRef<Item | null>(images[0] || null);
  onSelectRef.current = onSelect;
  nextRef.current = next;
  firstRef.current = images[0] || null;

  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [slideshow, setSlideshow] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [dragging, setDragging] = useState(false);

  const showUi = useCallback(() => {
    setUiVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiVisible(false), 3000);
  }, []);

  useEffect(() => {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    showUi();
  }, [current.path, showUi]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // Slideshow: loop through the images, restarting after navigation.
  useEffect(() => {
    if (!slideshow) return;
    const timer = window.setInterval(() => {
      const target = nextRef.current || firstRef.current;
      if (target) onSelectRef.current(target);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [slideshow, current.path]);

  // Preload neighbours for instant navigation.
  useEffect(() => {
    for (const item of [previous, next]) {
      if (!item) continue;
      const image = new Image();
      image.src = imageUrl(item);
    }
  }, [previous, next]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      switch (event.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (previous) onSelect(previous);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (next) onSelect(next);
          break;
        case "+":
        case "=":
          event.preventDefault();
          setScale((value) => clamp(value * 1.2, 1, 5));
          break;
        case "-":
          event.preventDefault();
          setScale((value) => {
            const nextScale = clamp(value / 1.2, 1, 5);
            if (nextScale === 1) setOffset({ x: 0, y: 0 });
            return nextScale;
          });
          break;
        case "0":
          setScale(1);
          setOffset({ x: 0, y: 0 });
          break;
        case "r":
        case "R":
          setRotation((value) => (value + 90) % 360);
          break;
        case " ":
          event.preventDefault();
          setSlideshow((value) => !value);
          break;
        default:
          break;
      }
      showUi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSelect, previous, next, showUi]);

  function holdUi() {
    setUiVisible(true);
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function zoom(factor: number) {
    setScale((value) => {
      const nextScale = clamp(value * factor, 1, 5);
      if (nextScale === 1) setOffset({ x: 0, y: 0 });
      return nextScale;
    });
    showUi();
  }

  function reset() {
    setScale(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    showUi();
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (scale <= 1) return;
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      ox: offset.x,
      oy: offset.y,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const stage = stageRef.current;
    const limitX = stage ? ((scale - 1) * stage.clientWidth) / 2 : 1000;
    const limitY = stage ? ((scale - 1) * stage.clientHeight) / 2 : 1000;
    setOffset({
      x: clamp(dragStart.current.ox + event.clientX - dragStart.current.x, -limitX, limitX),
      y: clamp(dragStart.current.oy + event.clientY - dragStart.current.y, -limitY, limitY),
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`photo-viewer ${uiVisible ? "" : "hide-ui"}`}
      onMouseMove={showUi}
      onTouchStart={showUi}
      onWheel={(event) => {
        event.preventDefault();
        zoom(event.deltaY < 0 ? 1.12 : 0.9);
      }}
    >
      <div className="photo-top" onMouseEnter={holdUi} onMouseLeave={showUi}>
        <div className="photo-heading">
          <span className="photo-name">{current.name}</span>
          {index >= 0 ? (
            <span className="photo-counter">
              {index + 1} / {images.length}
            </span>
          ) : null}
        </div>
        <div className="photo-actions">
          <a
            className="photo-icon-btn"
            href={`/api/stream?path=${encodeURIComponent(current.path)}&download=1`}
            title="Download original"
          >
            <DownloadIcon />
          </a>
          <button className="photo-icon-btn" onClick={onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div
        className="photo-stage"
        ref={stageRef}
        style={{ cursor: scale > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (scale === 1) {
            setScale(2);
          } else {
            reset();
          }
          showUi();
        }}
      >
        <img
          className="photo-img"
          src={imageUrl(current)}
          alt={current.name}
          draggable={false}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transition: dragging ? "none" : "transform 0.18s ease",
          }}
        />
      </div>

      {previous ? (
        <button
          className="photo-arrow left"
          onClick={() => onSelect(previous)}
          onMouseEnter={holdUi}
          onMouseLeave={showUi}
          title="Previous"
        >
          <ChevronLeft />
        </button>
      ) : null}
      {next ? (
        <button
          className="photo-arrow right"
          onClick={() => onSelect(next)}
          onMouseEnter={holdUi}
          onMouseLeave={showUi}
          title="Next"
        >
          <ChevronRight />
        </button>
      ) : null}

      <div className="photo-toolbar" onMouseEnter={holdUi} onMouseLeave={showUi}>
        <button className="photo-tool-btn" onClick={() => zoom(0.8)} title="Zoom out">
          <ZoomOutIcon />
        </button>
        <span className="photo-zoom">{Math.round(scale * 100)}%</span>
        <button className="photo-tool-btn" onClick={() => zoom(1.25)} title="Zoom in">
          <ZoomInIcon />
        </button>
        <span className="photo-divider" />
        <button className="photo-tool-btn" onClick={reset} title="Reset zoom">
          <span style={{ fontSize: 11, fontWeight: 700 }}>1:1</span>
        </button>
        <button
          className="photo-tool-btn"
          onClick={() => {
            setRotation((value) => (value + 90) % 360);
            showUi();
          }}
          title="Rotate"
        >
          <RotateIcon />
        </button>
        <span className="photo-divider" />
        <button
          className={`photo-tool-btn ${slideshow ? "active" : ""}`}
          onClick={() => {
            setSlideshow((value) => !value);
            showUi();
          }}
          title={slideshow ? "Pause slideshow" : "Start slideshow"}
        >
          {slideshow ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
    </div>
  );
}
