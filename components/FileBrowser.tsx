"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Item, SessionUser } from "./types";
import Viewer from "./Viewer";
import { PromptDialog } from "./Dialogs";
import ConfirmDialog from "./ConfirmDialog";
import ThemeToggle from "./ThemeToggle";
import {
  CameraIcon,
  CloseIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  FolderUpIcon,
  GridIcon,
  HomeIcon,
  KindIcon,
  ListIcon,
  LockIcon,
  LogoutIcon,
  PlusIcon,
  ScissorsIcon,
  SearchIcon,
  StarFilledIcon,
  StarIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  KeyIcon,
} from "./icons";
import { formatBytes, formatDate } from "./format";

const CHUNK = 8 * 1024 * 1024;
const PAGE_SIZE = 200;

type Mode = "files" | "recent" | "favorites";

type Task = {
  id: string;
  file: File;
  name: string;
  size: number;
  loaded: number;
  dir: string;
  status: "uploading" | "paused" | "done" | "error";
  error?: string;
};

type DialogState = { mode: "mkdir" } | { mode: "rename"; item: Item } | null;

type Dropped = { file: File; dir: string };

function fnv(seed: number, input: string) {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic id, so re-selecting the same file after a reload resumes from the server part. */
function uploadIdFor(dir: string, file: File) {
  const source = `${dir}|${file.name}|${file.size}|${file.lastModified}`;
  return [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => fnv(seed, source))
    .join("");
}

async function collectEntry(entry: FileSystemEntry, dir: string, out: Dropped[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ file, dir });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const folderDir = dir ? `${dir}/${entry.name}` : entry.name;
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) await collectEntry(child, folderDir, out);
    }
  }
}

async function collectDropped(data: DataTransfer, baseDir: string) {
  const out: Dropped[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(data.items)) {
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }
    ).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    for (const file of Array.from(data.files)) out.push({ file, dir: baseDir });
    return out;
  }
  for (const entry of entries) await collectEntry(entry, baseDir, out);
  return out;
}

export default function FileBrowser({
  user,
  initialPath = "",
  initialView,
}: {
  user: SessionUser;
  initialPath?: string;
  initialView?: string;
}) {
  const router = useRouter();
  const [path, setPath] = useState(initialPath);
  const [mode, setMode] = useState<Mode>(
    initialView === "recent" ? "recent" : initialView === "favorites" ? "favorites" : "files",
  );
  const [items, setItems] = useState<Item[]>([]);
  const [special, setSpecial] = useState<Item[]>([]);
  const [specialLoading, setSpecialLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sort, setSort] = useState<"name" | "date" | "size">("name");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Item[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [viewer, setViewer] = useState<Item | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clipboard, setClipboard] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [favoritePaths, setFavoritePaths] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragOverPath, setDragOverPath] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    action: () => Promise<void> | void;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const toastSeq = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const abortRefs = useRef(new Map<string, AbortController>());
  const pathRef = useRef(path);
  pathRef.current = path;

  async function load(target: string, quiet = false) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(target)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not open this folder");
        return;
      }
      setItems(data.items || []);
      setSelected(new Set());
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  async function loadFavorites() {
    try {
      const res = await fetch("/api/favorites");
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFavoritePaths(new Set<string>(data.paths || []));
    } catch {
      /* ignore */
    }
  }

  async function refreshCurrent() {
    if (mode === "files") await load(pathRef.current, true);
    else setRefreshKey((value) => value + 1);
  }

  useEffect(() => {
    void loadFavorites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode !== "files") return;
    void load(path);
    setVisibleCount(PAGE_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, mode]);

  useEffect(() => {
    if (mode === "files") {
      setSpecial([]);
      return;
    }
    let cancelled = false;
    setSpecialLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/${mode}`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setSpecial(data.items || []);
      } catch {
        if (!cancelled) setSpecial([]);
      } finally {
        if (!cancelled) setSpecialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, refreshKey]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => ({}));
        setSearchResults(data.items || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const sorted = [...items].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (sort === "date") return b.mtime - a.mtime;
    if (sort === "size") return b.size - a.size;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  const displayed = searchResults ?? (mode === "files" ? sorted : special);
  const visible = displayed.slice(0, visibleCount);
  const crumbParts = path ? path.split("/") : [];
  const atRoot = path === "";
  const inPublic = path === "public" || path.startsWith("public/");
  const inPrivate = path === "private" || path.startsWith("private/");

  function updateUrl(nextMode: Mode, target: string) {
    const url =
      nextMode === "files"
        ? target
          ? `/files?path=${encodeURIComponent(target)}`
          : "/files"
        : `/files?view=${nextMode}`;
    window.history.replaceState(null, "", url);
  }

  function navigate(target: string) {
    setMode("files");
    setPath(target);
    setQuery("");
    setSearchResults(null);
    setViewer(null);
    setSelected(new Set());
    setVisibleCount(PAGE_SIZE);
    updateUrl("files", target);
  }

  function switchMode(next: Mode) {
    setMode(next);
    setQuery("");
    setSearchResults(null);
    setViewer(null);
    setSelected(new Set());
    setVisibleCount(PAGE_SIZE);
    updateUrl(next, pathRef.current);
  }

  function openItem(item: Item) {
    if (item.isDir) navigate(item.path);
    else setViewer(item);
  }

  async function mutate(body: Record<string, unknown>) {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Operation failed");
    return data;
  }

  async function operation(body: Record<string, unknown>) {
    await mutate(body);
    await refreshCurrent();
  }

  function patchTask(id: string, partial: Partial<Task>) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, ...partial } : task)),
    );
  }

  function toast(text: string) {
    const id = ++toastSeq.current;
    setToasts((current) => [...current, { id, text }]);
    setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
    }, 4000);
  }

  async function uploadOne(task: Task) {
    const controller = new AbortController();
    abortRefs.current.set(task.id, controller);
    patchTask(task.id, { status: "uploading", error: undefined });

    try {
      const init = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "init",
          id: task.id,
          dir: task.dir,
          name: task.name,
          size: task.size,
        }),
        signal: controller.signal,
      });
      const initData = await init.json().catch(() => ({}));
      if (!init.ok) throw new Error(initData.error || "Could not start upload");

      let offset = Number(initData.offset || 0);
      patchTask(task.id, { loaded: offset });

      while (offset < task.size) {
        if (controller.signal.aborted) throw new DOMException("paused", "AbortError");
        const blob = task.file.slice(offset, offset + CHUNK);
        const res = await fetch(
          `/api/upload?id=${encodeURIComponent(task.id)}&offset=${offset}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: blob,
            signal: controller.signal,
          },
        );
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && typeof data.offset === "number") {
          offset = data.offset;
          patchTask(task.id, { loaded: offset });
          continue;
        }
        if (!res.ok) throw new Error(data.error || "Upload failed");
        offset = Number(data.offset);
        patchTask(task.id, { loaded: offset });
      }

      const done = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", id: task.id }),
        signal: controller.signal,
      });
      const doneData = await done.json().catch(() => ({}));
      if (!done.ok) throw new Error(doneData.error || "Could not finish upload");
      patchTask(task.id, { status: "done", loaded: task.size });
    } catch (uploadError) {
      if (controller.signal.aborted) {
        patchTask(task.id, { status: "paused" });
      } else {
        patchTask(task.id, {
          status: "error",
          error: uploadError instanceof Error ? uploadError.message : "Upload failed",
        });
      }
    } finally {
      abortRefs.current.delete(task.id);
    }
  }

  function startUploads(entries: Dropped[]) {
    if (!user.canUpload || entries.length === 0) return;
    if (!path) {
      setError("Open Public or Private before uploading");
      return;
    }
    const created: Task[] = entries.map(({ file, dir }) => ({
      id: uploadIdFor(dir, file),
      file,
      name: file.name,
      size: file.size,
      loaded: 0,
      dir,
      status: "uploading",
    }));
    setTasks((current) => [...current, ...created]);
    void (async () => {
      for (const task of created) await uploadOne(task);
      await refreshCurrent();
    })();
  }

  function pauseTask(task: Task) {
    abortRefs.current.get(task.id)?.abort();
    patchTask(task.id, { status: "paused" });
  }

  async function cancelTask(task: Task) {
    abortRefs.current.get(task.id)?.abort();
    setTasks((current) => current.filter((entry) => entry.id !== task.id));
    await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort", id: task.id }),
    }).catch(() => {});
  }

  async function submitDialog(value: string) {
    if (!dialog) return;
    setDialogBusy(true);
    setDialogError("");
    try {
      if (dialog.mode === "mkdir") {
        await operation({ action: "mkdir", dir: path, name: value });
      } else {
        await operation({ action: "rename", path: dialog.item.path, name: value });
      }
      setDialog(null);
    } catch (dialogSubmitError) {
      setDialogError(dialogSubmitError instanceof Error ? dialogSubmitError.message : "Failed");
    } finally {
      setDialogBusy(false);
    }
  }

  async function removeItem(item: Item) {
    setConfirm({
      title: "Move to trash",
      message: `Move “${item.name}” to the trash? You can restore it within 30 days.`,
      action: async () => {
        await mutate({ action: "delete", path: item.path });
        if (viewer?.path === item.path) setViewer(null);
        toast("Moved to trash");
        await refreshCurrent();
      },
    });
  }

  function toggleSelect(itemPath: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemPath)) next.delete(itemPath);
      else next.add(itemPath);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(displayed.map((item) => item.path)));
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    setError("");
    try {
      await confirm.action();
      setConfirm(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Operation failed");
    } finally {
      setConfirmBusy(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (event.key === "/" && !typing && !viewer && !dialog && !confirm) {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !typing && !viewer) {
        event.preventDefault();
        setSelected(new Set(displayed.map((item) => item.path)));
      }
      if (event.key === "Delete" && !typing && !viewer && selected.size > 0) {
        event.preventDefault();
        void bulkDelete();
      }
      if (event.key === "Escape" && !viewer && !dialog && !confirm && selected.size > 0) {
        setSelected(new Set());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed, viewer, dialog, confirm, selected]);

  async function bulkDelete() {
    if (selected.size === 0) return;
    const paths = Array.from(selected);
    setConfirm({
      title: "Move to trash",
      message: `Move ${paths.length} item(s) to the trash? You can restore them within 30 days.`,
      action: async () => {
        let firstError = "";
        for (const target of paths) {
          try {
            await mutate({ action: "delete", path: target });
          } catch (deleteError) {
            firstError ||= deleteError instanceof Error ? deleteError.message : "Could not delete";
          }
        }
        setSelected(new Set());
        if (firstError) {
          setError(firstError);
        } else {
          toast(`Moved ${paths.length} item(s) to trash`);
        }
        await refreshCurrent();
      },
    });
  }

  function cutSelected() {
    setClipboard(displayed.filter((item) => selected.has(item.path)));
    setSelected(new Set());
  }

  async function paste() {
    if (clipboard.length === 0 || !path) return;
    let firstError = "";
    let moved = 0;
    for (const item of clipboard) {
      try {
        await mutate({ action: "move", path: item.path, destDir: path });
        moved += 1;
      } catch (pasteError) {
        firstError ||= pasteError instanceof Error ? pasteError.message : "Could not move";
      }
    }
    setClipboard([]);
    if (firstError) setError(firstError);
    if (moved) toast(`Moved ${moved} item(s)`);
    await refreshCurrent();
  }

  function downloadSelected() {
    if (selected.size === 0) return;
    const query = Array.from(selected)
      .map((itemPath) => `path=${encodeURIComponent(itemPath)}`)
      .join("&");
    window.location.assign(`/api/zip?${query}`);
  }

  async function moveInto(draggedPath: string, folderPath: string) {
    if (!draggedPath || draggedPath === folderPath) return;
    try {
      await mutate({ action: "move", path: draggedPath, destDir: folderPath });
      toast("Moved");
      await refreshCurrent();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move");
    }
  }

  async function toggleFavorite(item: Item) {
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update favorite");
      setFavoritePaths((current) => {
        const next = new Set(current);
        if (data.favorite) next.add(item.path);
        else next.delete(item.path);
        return next;
      });
      toast(data.favorite ? "Added to favorites" : "Removed from favorites");
      if (mode === "favorites") setRefreshKey((value) => value + 1);
    } catch (favoriteError) {
      setError(favoriteError instanceof Error ? favoriteError.message : "Could not update favorite");
    }
  }

  async function signOut() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.replace("/login");
    router.refresh();
  }

  function onDragEnter(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current += 1;
    if (event.dataTransfer.types.includes("Files")) setDragging(true);
  }

  function onDragLeave(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }

  async function onDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    setDragOverPath("");
    if (event.dataTransfer.types.includes("application/x-vault-item")) return;
    if (!user.canUpload || atRoot) {
      if (atRoot) setError("Open Public or Private before uploading");
      return;
    }
    const entries = await collectDropped(event.dataTransfer, path);
    startUploads(entries);
  }

  function Thumb({ item }: { item: Item }) {
    const [failed, setFailed] = useState(false);
    const preview = (item.kind === "image" || item.kind === "video") && !failed;
    return (
      <div className={`thumb ${item.kind}`}>
        {preview ? (
          <img
            loading="lazy"
            alt=""
            src={`/api/thumb?path=${encodeURIComponent(item.path)}`}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="kind-icon">
            <KindIcon kind={item.kind} size={24} />
          </div>
        )}
        {item.kind === "video" ? (
          <span className="badge">
            {item.position && item.duration ? `${Math.round((item.position / item.duration) * 100)}%` : "VIDEO"}
          </span>
        ) : null}
      </div>
    );
  }

  function ItemActions({ item }: { item: Item }) {
    return (
      <>
        {!item.isDir ? (
          <button
            className={`icon-btn action-favorite ${favoritePaths.has(item.path) ? "active" : ""}`}
            title={favoritePaths.has(item.path) ? "Remove favorite" : "Favorite"}
            onClick={(event) => {
              event.stopPropagation();
              void toggleFavorite(item);
            }}
          >
            {favoritePaths.has(item.path) ? <StarFilledIcon /> : <StarIcon />}
          </button>
        ) : null}
        {!item.isDir ? (
          <a
            className="icon-btn"
            title="Download"
            href={`/api/stream?path=${encodeURIComponent(item.path)}&download=1`}
            onClick={(event) => event.stopPropagation()}
          >
            <DownloadIcon />
          </a>
        ) : (
          <a
            className="icon-btn"
            title="Download folder as ZIP"
            href={`/api/zip?path=${encodeURIComponent(item.path)}`}
            onClick={(event) => event.stopPropagation()}
          >
            <DownloadIcon />
          </a>
        )}
        <button
          className="icon-btn"
          title="Rename"
          onClick={(event) => {
            event.stopPropagation();
            setDialog({ mode: "rename", item });
          }}
        >
          <EditIcon />
        </button>
        <button
          className="icon-btn action-cut"
          title="Cut"
          onClick={(event) => {
            event.stopPropagation();
            setClipboard([item]);
          }}
        >
          <ScissorsIcon />
        </button>
        <button
          className="icon-btn"
          title="Move to trash"
          onClick={(event) => {
            event.stopPropagation();
            void removeItem(item);
          }}
        >
          <TrashIcon />
        </button>
      </>
    );
  }

  return (
    <div
      className="app-shell"
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <aside className="sidebar">
        <a className="brand sidebar-brand" href="/files">
          <div className="brand-mark">C</div>
          <span>Cove</span>
        </a>

        <nav className="side-nav">
          <div className="side-label">Library</div>
          <button
            className={`side-link ${mode === "files" && !inPublic && !inPrivate ? "active" : ""}`}
            onClick={() => navigate("")}
          >
            <HomeIcon />
            <span>Files</span>
          </button>
          <button
            className={`side-link ${mode === "recent" ? "active" : ""}`}
            onClick={() => switchMode("recent")}
          >
            <ClockIcon />
            <span>Recent</span>
          </button>
          <button
            className={`side-link ${mode === "favorites" ? "active" : ""}`}
            onClick={() => switchMode("favorites")}
          >
            <StarIcon />
            <span>Favorites</span>
          </button>

          <div className="side-label">Spaces</div>
          <button
            className={`side-link ${inPublic ? "active" : ""}`}
            onClick={() => navigate("public")}
          >
            <FolderIcon />
            <span>Public</span>
          </button>
          <button
            className={`side-link ${inPrivate ? "active" : ""}`}
            onClick={() => navigate("private")}
          >
            <LockIcon />
            <span>Private</span>
          </button>

          <div className="side-label">Manage</div>
          <a className="side-link" href="/trash">
            <TrashIcon />
            <span>Trash</span>
          </a>
          {user.role === "admin" ? (
            <a className="side-link" href="/admin">
              <UsersIcon />
              <span>Admin</span>
            </a>
          ) : null}
          <a className="side-link" href="/security">
            <KeyIcon />
            <span>Security</span>
          </a>
        </nav>

        <div className="sidebar-foot">
          <div className="side-user">
            <span className="avatar">{user.username.slice(0, 1)}</span>
            <div className="side-user-meta">
              <strong>{user.username}</strong>
              <span>{user.role === "admin" ? "Administrator" : "Member"}</span>
            </div>
            <button
              className="icon-btn"
              onClick={() => void signOut()}
              title="Sign out"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <a className="brand mobile-brand" href="/files">
            <div className="brand-mark">C</div>
            <span>Cove</span>
          </a>
          <div className="search">
          <SearchIcon />
          <input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search files and folders  ( / )"
            aria-label="Search"
          />
        </div>
        <div className="grow" />
        <ThemeToggle />
        {user.role === "admin" ? (
          <a className="icon-btn" href="/admin" title="Manage users">
            <UsersIcon />
          </a>
        ) : null}
        <div className="user-menu" ref={menuRef}>
          <button className="user-chip" onClick={() => setMenuOpen((value) => !value)}>
            <span className="avatar">{user.username.slice(0, 1)}</span>
            <span>{user.username}</span>
          </button>
          {menuOpen ? (
            <div className="dropdown">
              <a href="/trash" onClick={() => setMenuOpen(false)}>
                <TrashIcon /> Trash
              </a>
              <a href="/security" onClick={() => setMenuOpen(false)}>
                <KeyIcon /> Security
              </a>
              {user.role === "admin" ? (
                <a href="/admin" onClick={() => setMenuOpen(false)}>
                  <UsersIcon /> Manage users
                </a>
              ) : null}
              <div className="sep" />
              <button onClick={() => void signOut()}>
                <LogoutIcon /> Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main className="container">
        <div className="toolbar">
          {mode === "files" ? (
            <div className="crumbs">
              <span className={path ? "crumb" : "crumb current"} onClick={() => navigate("")}>
                Home
              </span>
              {crumbParts.map((part, index) => {
                const target = crumbParts.slice(0, index + 1).join("/");
                const current = index === crumbParts.length - 1;
                const label =
                  index === 0
                    ? part === "public"
                      ? "Public"
                      : part === "private"
                        ? "Private"
                        : part
                    : part;
                return (
                  <span key={target} style={{ display: "contents" }}>
                    <span className="crumb-sep">/</span>
                    <span
                      className={current ? "crumb current" : "crumb"}
                      onClick={() => !current && navigate(target)}
                    >
                      {label}
                    </span>
                  </span>
                );
              })}
              {inPublic ? <span className="pill">Public · everyone</span> : null}
              {inPrivate ? <span className="pill admin">Private · only you</span> : null}
            </div>
          ) : (
            <div className="crumbs">
              <span className="crumb current">
                {mode === "recent" ? "Recent uploads" : "Favorites"}
              </span>
            </div>
          )}

          <div className="toolbar-actions">
            {mode === "files" && clipboard.length > 0 ? (
              <button
                className="btn small"
                onClick={() => void paste()}
                disabled={atRoot}
                title={atRoot ? "Open Public or Private first" : undefined}
              >
                <ScissorsIcon /> Paste {clipboard.length > 1 ? `${clipboard.length} items` : "“" + clipboard[0].name + "”"}
                <span
                  className="muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    setClipboard([]);
                  }}
                >
                  <CloseIcon width={14} height={14} />
                </span>
              </button>
            ) : null}
            {mode === "files" ? (
              <>
                <button
                  className="btn small"
                  onClick={() => setDialog({ mode: "mkdir" })}
                  disabled={atRoot}
                  title={atRoot ? "Open Public or Private first" : undefined}
                >
                  <PlusIcon /> New folder
                </button>
                {user.canUpload ? (
                  <>
                    <button
                      className="btn small primary"
                      onClick={() => fileInput.current?.click()}
                      disabled={atRoot}
                      title={atRoot ? "Open Public or Private first" : undefined}
                    >
                      <UploadIcon /> Upload
                    </button>
                    <button
                      className="icon-btn"
                      title="Upload folder"
                      disabled={atRoot}
                      onClick={() => folderInput.current?.click()}
                    >
                      <FolderUpIcon />
                    </button>
                    <button
                      className="icon-btn"
                      title="Take photo / record video"
                      disabled={atRoot}
                      onClick={() => cameraInput.current?.click()}
                    >
                      <CameraIcon />
                    </button>
                  </>
                ) : null}
              </>
            ) : null}
            <select
              className="sort-select"
              value={sort}
              onChange={(event) => setSort(event.target.value as "name" | "date" | "size")}
              aria-label="Sort by"
            >
              <option value="name">Name</option>
              <option value="date">Newest</option>
              <option value="size">Largest</option>
            </select>
            <div className="segmented">
              <button
                className={`icon-btn ${view === "grid" ? "active" : ""}`}
                onClick={() => setView("grid")}
                title="Grid view"
              >
                <GridIcon />
              </button>
              <button
                className={`icon-btn ${view === "list" ? "active" : ""}`}
                onClick={() => setView("list")}
                title="List view"
              >
                <ListIcon />
              </button>
            </div>
          </div>
        </div>

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) {
              startUploads(Array.from(event.target.files).map((file) => ({ file, dir: path })));
            }
            event.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(event) => {
            if (event.target.files) {
              const entries = Array.from(event.target.files).map((file) => {
                const relative = (file as File & { webkitRelativePath?: string })
                  .webkitRelativePath || file.name;
                const dirs = relative.split("/").slice(0, -1);
                return { file, dir: [path, ...dirs].filter(Boolean).join("/") };
              });
              startUploads(entries);
            }
            event.target.value = "";
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          hidden
          onChange={(event) => {
            if (event.target.files?.[0]) {
              startUploads([{ file: event.target.files[0], dir: path }]);
            }
            event.target.value = "";
          }}
        />

        {error ? <div className="banner">{error}</div> : null}
        {atRoot && mode === "files" && !searchResults ? (
          <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            Public is visible to everyone. Private is visible only to you.
          </div>
        ) : null}

        {selected.size > 0 ? (
          <div className="selection-bar">
            <strong>{selected.size} selected</strong>
            <button className="btn small" onClick={downloadSelected}>
              <DownloadIcon /> Download ZIP
            </button>
            <button className="btn small" onClick={cutSelected}>
              <ScissorsIcon /> Cut
            </button>
            <button className="btn small danger" onClick={() => void bulkDelete()}>
              <TrashIcon /> Delete
            </button>
            <button className="btn small ghost" onClick={selectAll}>
              Select all
            </button>
            <span className="grow" />
            <button className="btn small ghost" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        ) : null}

        {searchResults ? (
          <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
            {searching ? "Searching…" : `${searchResults.length} result(s) for “${query.trim()}”`}
          </div>
        ) : null}

        {loading || (mode !== "files" && specialLoading) ? (
          <div className="skeleton-grid">
            {Array.from({ length: 12 }).map((_, index) => (
              <div className="skeleton" key={index} />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="empty">
            <KindIcon kind={mode === "favorites" ? "other" : "folder"} size={34} />
            <strong>
              {searchResults
                ? "No matches"
                : mode === "recent"
                  ? "Nothing recent"
                  : mode === "favorites"
                    ? "No favorites yet"
                    : "This folder is empty"}
            </strong>
            <span>
              {searchResults
                ? "Try a different search."
                : mode === "favorites"
                  ? "Star a file to see it here."
                  : user.canUpload && mode === "files"
                    ? "Drag files here or use the Upload button."
                    : "Nothing here yet."}
            </span>
            {!searchResults && mode === "files" && user.canUpload ? (
              <button className="btn primary" onClick={() => fileInput.current?.click()} disabled={atRoot}>
                <UploadIcon /> Upload files
              </button>
            ) : null}
          </div>
        ) : view === "grid" ? (
          <div className="grid">
            {visible.map((item) => (
              <div
                className={`card ${selected.has(item.path) ? "selected" : ""} ${
                  dragOverPath === item.path ? "drop-target" : ""
                }`}
                key={item.path}
                onClick={() => openItem(item)}
                role="button"
                tabIndex={0}
                draggable={mode === "files"}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-vault-item", item.path);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (!item.isDir) return;
                  if (event.dataTransfer.types.includes("application/x-vault-item")) {
                    event.preventDefault();
                    setDragOverPath(item.path);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverPath === item.path) setDragOverPath("");
                }}
                onDrop={(event) => {
                  if (!item.isDir) return;
                  const dragged = event.dataTransfer.getData("application/x-vault-item");
                  if (!dragged) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDragOverPath("");
                  void moveInto(dragged, item.path);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openItem(item);
                }}
              >
                <label className="select-box" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.path)}
                    onChange={() => toggleSelect(item.path)}
                    aria-label={`Select ${item.name}`}
                  />
                </label>
                <div className="card-actions">
                  <ItemActions item={item} />
                </div>
                <Thumb item={item} />
                <div className="card-body">
                  <div className="card-name" title={item.name}>
                    {item.name}
                  </div>
                  <div className="card-meta">
                    {item.isDir ? "Folder" : formatBytes(item.size)} · {formatDate(item.mtime)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="list">
            <div className="list-head">
              <div>Name</div>
              <div>Size</div>
              <div>Modified</div>
              <div />
            </div>
            {visible.map((item) => (
              <div
                className={`list-row ${selected.has(item.path) ? "selected" : ""} ${
                  dragOverPath === item.path ? "drop-target" : ""
                }`}
                key={item.path}
                onClick={() => openItem(item)}
                draggable={mode === "files"}
                onDragStart={(event) => {
                  event.dataTransfer.setData("application/x-vault-item", item.path);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (!item.isDir) return;
                  if (event.dataTransfer.types.includes("application/x-vault-item")) {
                    event.preventDefault();
                    setDragOverPath(item.path);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverPath === item.path) setDragOverPath("");
                }}
                onDrop={(event) => {
                  if (!item.isDir) return;
                  const dragged = event.dataTransfer.getData("application/x-vault-item");
                  if (!dragged) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setDragOverPath("");
                  void moveInto(dragged, item.path);
                }}
              >
                <div className="list-name">
                  <input
                    type="checkbox"
                    className="row-check"
                    checked={selected.has(item.path)}
                    onChange={() => toggleSelect(item.path)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Select ${item.name}`}
                  />
                  <span style={{ color: item.isDir ? "var(--accent)" : "var(--muted)" }}>
                    <KindIcon kind={item.kind} size={18} />
                  </span>
                  <span title={item.name}>{item.name}</span>
                </div>
                <div className="muted">{item.isDir ? "—" : formatBytes(item.size)}</div>
                <div className="muted">{formatDate(item.mtime)}</div>
                <div className="list-actions">
                  <ItemActions item={item} />
                </div>
              </div>
            ))}
          </div>
        )}

        {displayed.length > visibleCount ? (
          <div className="show-more">
            <button className="btn" onClick={() => setVisibleCount((value) => value + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, displayed.length - visibleCount)} more
            </button>
          </div>
        ) : null}
      </main>
      </div>

      <nav className="mobile-nav" aria-label="Primary">
        <button
          className={mode === "files" ? "active" : ""}
          onClick={() => navigate("")}
        >
          <HomeIcon />
          <span>Files</span>
        </button>
        <button
          className={mode === "recent" ? "active" : ""}
          onClick={() => switchMode("recent")}
        >
          <ClockIcon />
          <span>Recent</span>
        </button>
        <button
          className={mode === "favorites" ? "active" : ""}
          onClick={() => switchMode("favorites")}
        >
          <StarIcon />
          <span>Favorites</span>
        </button>
        <a href="/trash">
          <TrashIcon />
          <span>Trash</span>
        </a>
      </nav>

      {tasks.length > 0 ? (
        <div className="uploads">
          <div className="uploads-head">
            <span>Uploads</span>
            <span className="grow" />
            <button
              className="icon-btn"
              onClick={() =>
                setTasks((current) =>
                  current.filter((task) => task.status === "uploading" || task.status === "paused"),
                )
              }
              title="Clear finished"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="uploads-list">
            {tasks.map((task) => (
              <div
                className={`upload-row ${task.status === "error" ? "error" : ""}`}
                key={task.id}
              >
                <div className="upload-top">
                  <span className="upload-name" title={`${task.dir}/${task.name}`}>
                    {task.name}
                  </span>
                  {task.status === "done" ? (
                    <span style={{ color: "var(--ok)", fontSize: 12 }}>Done</span>
                  ) : task.status === "error" ? (
                    <>
                      <button className="btn ghost small" onClick={() => void uploadOne(task)}>
                        Retry
                      </button>
                      <button className="icon-btn" onClick={() => void cancelTask(task)} title="Cancel">
                        <CloseIcon width={14} height={14} />
                      </button>
                    </>
                  ) : task.status === "paused" ? (
                    <>
                      <button className="btn ghost small" onClick={() => void uploadOne(task)}>
                        Resume
                      </button>
                      <button className="icon-btn" onClick={() => void cancelTask(task)} title="Cancel">
                        <CloseIcon width={14} height={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        {formatBytes(task.loaded)} / {formatBytes(task.size)}
                      </span>
                      <button className="btn ghost small" onClick={() => pauseTask(task)}>
                        Pause
                      </button>
                      <button className="icon-btn" onClick={() => void cancelTask(task)} title="Cancel">
                        <CloseIcon width={14} height={14} />
                      </button>
                    </>
                  )}
                </div>
                {task.status === "error" ? (
                  <div className="form-error" style={{ marginTop: 4 }}>
                    {task.error}
                  </div>
                ) : (
                  <div className="progress">
                    <span
                      style={{
                        width: `${task.size ? Math.min(100, (task.loaded / task.size) * 100) : 100}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {viewer ? (
        <Viewer
          items={displayed}
          current={viewer}
          onClose={() => setViewer(null)}
          onSelect={(item) => setViewer(item)}
        />
      ) : null}

      {dialog ? (
        <PromptDialog
          title={dialog.mode === "mkdir" ? "New folder" : "Rename"}
          label={dialog.mode === "mkdir" ? "Folder name" : "New name"}
          initial={dialog.mode === "rename" ? dialog.item.name : ""}
          confirmLabel={dialog.mode === "mkdir" ? "Create" : "Rename"}
          busy={dialogBusy}
          error={dialogError}
          onSubmit={(value) => void submitDialog(value)}
          onClose={() => {
            setDialog(null);
            setDialogError("");
          }}
        />
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          busy={confirmBusy}
          onConfirm={() => void runConfirm()}
          onClose={() => setConfirm(null)}
        />
      ) : null}

      {toasts.length > 0 ? (
        <div className="toasts" aria-live="polite">
          {toasts.map((entry) => (
            <div className="toast" key={entry.id}>
              {entry.text}
            </div>
          ))}
        </div>
      ) : null}

      {dragging && user.canUpload ? (
        <div className="drop-overlay">
          <div className="drop-box">
            <UploadIcon width={34} height={34} />
            <div>
              {atRoot
                ? "Open Public or Private before uploading"
                : `Drop files or folders to upload to ${
                    inPublic ? "Public" : "Private"
                  }${
                    path.split("/").length > 1
                      ? `/${path.split("/").slice(1).join("/")}`
                      : ""
                  }`}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
