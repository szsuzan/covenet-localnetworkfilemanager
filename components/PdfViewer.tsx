"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Item } from "./types";
import {
  ChevronLeft,
  ChevronRight,
  DownloadIcon,
  MaximizeIcon,
  MinimizeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./icons";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function PdfViewer({ item }: { item: Item }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTask = useRef<{ cancel(): void } | null>(null);
  const loadTask = useRef<{ destroy(): Promise<void> } | null>(null);

  const src = `/api/stream?path=${encodeURIComponent(item.path)}&v=${item.mtime}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setProgress(0);
    setPage(1);
    setPageCount(0);
    setZoom(1);
    setDoc(null);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({
          url: src,
          withCredentials: true,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });
        loadTask.current = task;
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (total) setProgress(loaded / total);
        };
        const pdf = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setDoc(pdf);
        setPageCount(pdf.numPages);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not open this PDF");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      void loadTask.current?.destroy();
      loadTask.current = null;
    };
  }, [item.path, src]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width || stage.clientWidth);
      setHeight(entries[0]?.contentRect.height || stage.clientHeight);
    });
    observer.observe(stage);
    setWidth(stage.clientWidth);
    setHeight(stage.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    if (!doc || width <= 0 || height <= 0) return;
    let cancelled = false;

    (async () => {
      renderTask.current?.cancel();
      setRendering(true);
      try {
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        // Fit the whole page at 100% zoom, not just its width.
        const fit = Math.max(
          0.1,
          Math.min((width - 8) / base.width, (height - 8) / base.height),
        );
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min(fit * zoom, 4.5 / dpr);
        const viewport = pdfPage.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const task = pdfPage.render({ canvas, viewport });
        renderTask.current = task;
        await task.promise;
      } catch (renderError) {
        if ((renderError as { name?: string }).name !== "RenderingCancelledException") {
          if (!cancelled) {
            setError(
              renderError instanceof Error ? renderError.message : "Could not render this page",
            );
          }
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
      renderTask.current?.cancel();
    };
  }, [doc, height, page, width, zoom]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          setPage((value) => Math.max(1, value - 1));
          break;
        case "ArrowRight":
          event.preventDefault();
          setPage((value) => Math.min(pageCount || value, value + 1));
          break;
        case "+":
        case "=":
          event.preventDefault();
          setZoom((value) => clamp(value * 1.2, 0.5, 3));
          break;
        case "-":
          event.preventDefault();
          setZoom((value) => clamp(value / 1.2, 0.5, 3));
          break;
        case "0":
          setZoom(1);
          break;
        case "f":
        case "F":
          void toggleFullscreen();
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount]);

  async function toggleFullscreen() {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.fullscreenEnabled) await shell.requestFullscreen();
    } catch {
      /* ignore */
    }
  }

  if (error) {
    return (
      <div className="pdf-status">
        <div className="pdf-status-title">Could not open this PDF</div>
        <div className="pdf-status-text">{error}</div>
        <a className="btn" href={src}>
          Open original
        </a>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={`pdf-shell ${fullscreen ? "is-fullscreen" : ""}`}
    >
      <div className="pdf-stage" ref={stageRef}>
        {loading ? (
          <div className="pdf-loading">
            <div className="vp-spinner" />
            <span>Loading PDF… {progress ? `${Math.round(progress * 100)}%` : ""}</span>
          </div>
        ) : (
          <div className="pdf-page">
            <canvas ref={canvasRef} />
            {rendering ? <div className="pdf-rendering">Rendering…</div> : null}
          </div>
        )}
      </div>

      <div className="pdf-toolbar">
        <button
          className="pdf-btn"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
          title="Previous page"
        >
          <ChevronLeft />
        </button>
        <span className="pdf-pages">
          {page} / {pageCount || "—"}
        </span>
        <button
          className="pdf-btn"
          onClick={() => setPage((value) => Math.min(pageCount || value, value + 1))}
          disabled={!pageCount || page >= pageCount}
          title="Next page"
        >
          <ChevronRight />
        </button>

        <span className="pdf-divider" />

        <button className="pdf-btn" onClick={() => setZoom((value) => clamp(value / 1.2, 0.5, 3))} title="Zoom out">
          <ZoomOutIcon />
        </button>
        <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
        <button className="pdf-btn" onClick={() => setZoom((value) => clamp(value * 1.2, 0.5, 3))} title="Zoom in">
          <ZoomInIcon />
        </button>
        <button className="pdf-btn pdf-fit" onClick={() => setZoom(1)} title="Fit to width">
          Fit
        </button>

        <span className="pdf-divider" />

        <a className="pdf-btn" href={src} download={item.name} title="Download PDF">
          <DownloadIcon />
        </a>
        <button className="pdf-btn" onClick={() => void toggleFullscreen()} title="Fullscreen">
          {fullscreen ? <MinimizeIcon /> : <MaximizeIcon />}
        </button>
      </div>
    </div>
  );
}
