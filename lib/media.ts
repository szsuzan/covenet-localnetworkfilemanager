import { execFile } from "node:child_process";
import path from "node:path";

export type MediaInfo = {
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  duration: number;
  width: number | null;
  height: number | null;
  directPlay: boolean;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
};

type ProbeResult = {
  format?: { format_name?: string; duration?: string };
  streams?: ProbeStream[];
};

export function probe(file: string): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", file],
      { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null);
        try {
          const data = JSON.parse(stdout) as ProbeResult;
          const video = data.streams?.find((s) => s.codec_type === "video");
          const audio = data.streams?.find((s) => s.codec_type === "audio");
          const container = data.format?.format_name || "";
          const videoCodec = video?.codec_name || null;
          const audioCodec = audio?.codec_name || null;
          const duration = Number(data.format?.duration || 0);

          // ffprobe reports mkv as "matroska,webm", so trust the extension.
          const ext = path.extname(file).slice(1).toLowerCase();
          const okContainer = [
            "mp4", "m4v", "mov", "webm", "ogv", "ogg", "mp3", "m4a", "wav", "flac",
          ].includes(ext);
          const okVideo =
            !videoCodec ||
            ["h264", "vp8", "vp9", "av1"].includes(videoCodec);
          const okAudio =
            !audioCodec ||
            ["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le", "pcm_s24le"].includes(audioCodec);

          resolve({
            container,
            videoCodec,
            audioCodec,
            duration,
            width: video?.width ?? null,
            height: video?.height ?? null,
            directPlay: okContainer && okVideo && okAudio,
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}
