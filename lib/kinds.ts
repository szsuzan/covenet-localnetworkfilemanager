import path from "node:path";

export type Kind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "text"
  | "archive"
  | "other";

const GROUPS: Record<Exclude<Kind, "folder" | "other">, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "ico", "heic", "heif", "tif", "tiff"],
  video: ["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "ogv", "3gp"],
  audio: ["mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac", "wma"],
  pdf: ["pdf"],
  text: ["txt", "md", "json", "csv", "log", "nfo", "srt", "vtt", "yml", "yaml", "xml", "ini", "conf"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"],
};

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml",
  ico: "image/x-icon", heic: "image/heic", heif: "image/heif", tif: "image/tiff", tiff: "image/tiff",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
  webm: "video/webm", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  mpg: "video/mpeg", mpeg: "video/mpeg", ts: "video/mp2t", m2ts: "video/mp2t",
  ogv: "video/ogg", "3gp": "video/3gpp",
  mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg",
  oga: "audio/ogg", opus: "audio/opus", m4a: "audio/mp4", aac: "audio/aac", wma: "audio/x-ms-wma",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
  json: "application/json", csv: "text/csv", log: "text/plain; charset=utf-8",
  nfo: "text/plain; charset=utf-8", srt: "text/plain; charset=utf-8",
  vtt: "text/vtt; charset=utf-8", yml: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8", xml: "application/xml", ini: "text/plain; charset=utf-8",
  conf: "text/plain; charset=utf-8",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  tar: "application/x-tar", gz: "application/gzip", bz2: "application/x-bzip2",
  xz: "application/x-xz",
};

export function extension(name: string) {
  return path.extname(name).slice(1).toLowerCase();
}

export function kindOf(name: string, isDir = false): Kind {
  if (isDir) return "folder";
  const ext = extension(name);
  for (const [kind, list] of Object.entries(GROUPS)) {
    if (list.includes(ext)) return kind as Kind;
  }
  return "other";
}

export function mimeOf(name: string) {
  return MIME[extension(name)] || "application/octet-stream";
}
