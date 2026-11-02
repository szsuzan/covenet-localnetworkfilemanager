"use client";

import { useEffect, useRef, useState } from "react";
import type { Item } from "./types";
import { formatBytes, formatDate } from "./format";
import {
  ChevronLeft,
  ChevronRight,
  FolderIcon,
  ImageIcon,
  KindIcon,
  LockIcon,
  UploadIcon,
  VideoIcon,
} from "./icons";

type Album = {
  name: string;
  path: string;
  count: number;
  updated: number;
  covers: string[];
};

type HomeData = {
  videos: Item[];
  albums: Album[];
  files: Item[];
  folders: Item[];
  counts: { videos: number; albums: number; files: number; folders: number };
  videoLabel: string;
  videoPath: string;
  albumPath: string;
};

function thumb(path: string) {
  return `/api/thumb?path=${encodeURIComponent(path)}`;
}

function parentLabel(path: string) {
  const parts = path.split("/");
  return parts.length > 2 ? parts.slice(1, -1).join("/") : "Public";
}

export default function PublicHome({
  canUpload,
  refreshToken,
  onUpload,
  onNavigate,
  onOpen,
}: {
  canUpload: boolean;
  refreshToken: number;
  onUpload: () => void;
  onNavigate: (path: string) => void;
  onOpen: (item: Item) => void;
}) {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const url = `/api/home${refreshToken > 0 ? "?fresh=1" : ""}`;
    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load the public library");
        return body as HomeData;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  function scrollMovies(direction: number) {
    const row = rowRef.current;
    if (!row) return;
    row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: "smooth" });
  }

  if (loading) {
    return (
      <div className="home">
        <div className="home-hero home-skeleton-hero" />
        <div className="home-section">
          <div className="section-head">
            <div className="skeleton skeleton-line" />
          </div>
          <div className="movie-row">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="skeleton skeleton-movie" key={index} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="empty">
        <FolderIcon width={34} height={34} />
        <strong>Could not load the public library</strong>
        <span>{error || "Try refreshing the page."}</span>
      </div>
    );
  }

  const { videos, albums, files, folders, counts } = data;
  const previews = [
    ...albums.flatMap((album) => album.covers.slice(0, 1)),
    ...videos.map((video) => video.path),
  ].slice(0, 3);
  const empty =
    counts.videos === 0 &&
    counts.albums === 0 &&
    counts.files === 0 &&
    counts.folders === 0;

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-kicker">Public library</span>
          <h1>
            Shared with everyone,
            <br />
            kept in one place.
          </h1>
          <p>
            Movies, photo albums and files from the public space — all in one
            calm overview.
          </p>
          <div className="home-actions">
            {canUpload ? (
              <button className="btn primary" onClick={onUpload}>
                <UploadIcon /> Upload to Public
              </button>
            ) : null}
            <button className="btn" onClick={() => onNavigate("public")}>
              <FolderIcon /> Browse folders
            </button>
            <button className="btn ghost" onClick={() => onNavigate("private")}>
              <LockIcon /> My private space
            </button>
          </div>
          <div className="home-stats">
            <span>
              <strong>{counts.videos}</strong> video{counts.videos === 1 ? "" : "s"}
            </span>
            <span>
              <strong>{counts.albums}</strong> album{counts.albums === 1 ? "" : "s"}
            </span>
            <span>
              <strong>{counts.files}</strong> file{counts.files === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="home-hero-art" aria-hidden="true">
          {previews.length > 0 ? (
            previews.map((preview, index) => (
              <span className={`home-art-tile tile-${index}`} key={preview}>
                <img src={thumb(preview)} alt="" />
              </span>
            ))
          ) : (
            <>
              <span className="home-art-glow" />
              <span className="home-art-ring" />
            </>
          )}
        </div>
      </section>

      {empty ? (
        <div className="home-empty">
          <span className="home-empty-icon">
            <FolderIcon width={28} height={28} />
          </span>
          <h2>Public is quiet</h2>
          <p>
            Upload movies, photos or documents to share them with everyone on the
            network.
          </p>
          <div className="home-actions">
            {canUpload ? (
              <button className="btn primary" onClick={onUpload}>
                <UploadIcon /> Upload to Public
              </button>
            ) : null}
            <button className="btn" onClick={() => onNavigate("private")}>
              <LockIcon /> Open my private space
            </button>
          </div>
        </div>
      ) : null}

      {videos.length > 0 ? (
        <section className="home-section">
          <div className="section-head">
            <div>
              <h2>{data.videoLabel}</h2>
              <p>Recently added videos in the public space</p>
            </div>
            <div className="section-actions">
              <button
                className="icon-btn"
                title="Scroll left"
                onClick={() => scrollMovies(-1)}
              >
                <ChevronLeft />
              </button>
              <button
                className="icon-btn"
                title="Scroll right"
                onClick={() => scrollMovies(1)}
              >
                <ChevronRight />
              </button>
              <button className="btn small ghost" onClick={() => onNavigate(data.videoPath)}>
                View all
              </button>
            </div>
          </div>
          <div className="movie-row" ref={rowRef}>
            {videos.map((video) => (
              <button className="movie-card" key={video.path} onClick={() => onOpen(video)}>
                <div className="movie-thumb">
                  <VideoIcon className="movie-fallback" width={26} height={26} />
                  <img
                    src={thumb(video.path)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                  <span className="movie-play">▶</span>
                </div>
                <div className="movie-name" title={video.name}>
                  {video.name.replace(/\.[^.]+$/, "")}
                </div>
                <div className="movie-meta">
                  {formatBytes(video.size)} · {parentLabel(video.path)}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {albums.length > 0 ? (
        <section className="home-section">
          <div className="section-head">
            <div>
              <h2>Photo albums</h2>
              <p>Folders shared with everyone</p>
            </div>
            <button className="btn small ghost" onClick={() => onNavigate(data.albumPath)}>
              View all
            </button>
          </div>
          <div className="album-grid">
            {albums.map((album) => (
              <button
                className={`album-card covers-${album.covers.length}`}
                key={album.path}
                onClick={() => onNavigate(album.path)}
              >
                <div className="album-cover">
                  {album.covers.length > 0 ? (
                    album.covers.map((cover) => (
                      <img
                        key={cover}
                        src={thumb(cover)}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ))
                  ) : (
                    <ImageIcon width={24} height={24} />
                  )}
                  <span className="album-count">{album.count}</span>
                </div>
                <div className="album-body">
                  <div className="album-name">{album.name}</div>
                  <div className="album-meta">
                    {album.count} photo{album.count === 1 ? "" : "s"} ·{" "}
                    {formatDate(album.updated)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {files.length > 0 ? (
        <section className="home-section">
          <div className="section-head">
            <div>
              <h2>Other files</h2>
              <p>Documents, archives and everything else</p>
            </div>
            <button className="btn small ghost" onClick={() => onNavigate("public")}>
              View all
            </button>
          </div>
          <div className="home-files panel">
            {files.map((file) => (
              <button className="home-file-row" key={file.path} onClick={() => onOpen(file)}>
                <span className="home-file-icon">
                  <KindIcon kind={file.kind} size={18} />
                </span>
                <span className="home-file-name">
                  {file.name}
                  <small>{parentLabel(file.path)}</small>
                </span>
                <span className="home-file-size">{formatBytes(file.size)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {folders.length > 0 ? (
        <section className="home-section">
          <div className="section-head">
            <div>
              <h2>Folders</h2>
              <p>Jump into a shared folder</p>
            </div>
          </div>
          <div className="folder-chips">
            {folders.map((folder) => (
              <button
                className="folder-chip"
                key={folder.path}
                onClick={() => onNavigate(folder.path)}
              >
                <FolderIcon width={17} height={17} />
                {folder.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
