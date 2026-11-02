"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "./types";
import ThemeToggle from "./ThemeToggle";
import {
  ClockIcon,
  FolderIcon,
  HomeIcon,
  KeyIcon,
  LockIcon,
  LogoutIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
} from "./icons";

export type ShellSection =
  | "files"
  | "recent"
  | "favorites"
  | "trash"
  | "admin"
  | "security";

export default function PageShell({
  user,
  active,
  children,
}: {
  user: SessionUser;
  active: ShellSection;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  async function signOut() {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    router.replace("/login");
    router.refresh();
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/files?q=${encodeURIComponent(value)}` : "/files");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand sidebar-brand" href="/files">
          <div className="brand-mark">C</div>
          <span>Cove</span>
        </a>

        <nav className="side-nav">
          <div className="side-label">Library</div>
          <a className={`side-link ${active === "files" ? "active" : ""}`} href="/files">
            <HomeIcon />
            <span>Files</span>
          </a>
          <a
            className={`side-link ${active === "recent" ? "active" : ""}`}
            href="/files?view=recent"
          >
            <ClockIcon />
            <span>Recent</span>
          </a>
          <a
            className={`side-link ${active === "favorites" ? "active" : ""}`}
            href="/files?view=favorites"
          >
            <StarIcon />
            <span>Favorites</span>
          </a>

          <div className="side-label">Spaces</div>
          <a className="side-link" href="/files?path=public">
            <FolderIcon />
            <span>Public</span>
          </a>
          <a className="side-link" href="/files?path=private">
            <LockIcon />
            <span>Private</span>
          </a>

          <div className="side-label">Manage</div>
          <a className={`side-link ${active === "trash" ? "active" : ""}`} href="/trash">
            <TrashIcon />
            <span>Trash</span>
          </a>
          {user.role === "admin" ? (
            <a className={`side-link ${active === "admin" ? "active" : ""}`} href="/admin">
              <UsersIcon />
              <span>Admin</span>
            </a>
          ) : null}
          <a
            className={`side-link ${active === "security" ? "active" : ""}`}
            href="/security"
          >
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
            <button className="icon-btn" onClick={() => void signOut()} title="Sign out">
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
          <form className="search" onSubmit={search}>
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files and folders  ( / )"
              aria-label="Search"
            />
          </form>
          <div className="grow" />
          <ThemeToggle />
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
                    <UsersIcon /> Admin
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

        <main className="container">{children}</main>
      </div>

      <nav className="mobile-nav" aria-label="Primary">
        <a className={active === "files" ? "active" : ""} href="/files">
          <HomeIcon />
          <span>Files</span>
        </a>
        <a className={active === "recent" ? "active" : ""} href="/files?view=recent">
          <ClockIcon />
          <span>Recent</span>
        </a>
        <a className={active === "favorites" ? "active" : ""} href="/files?view=favorites">
          <StarIcon />
          <span>Favorites</span>
        </a>
        <a className={active === "trash" ? "active" : ""} href="/trash">
          <TrashIcon />
          <span>Trash</span>
        </a>
      </nav>
    </div>
  );
}
