import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { apiUser, fail, originOk } from "@/lib/api";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HELPER = "/usr/local/bin/cove-hotspot";
const CON = "Cove-Hotspot";
const SAVED = path.join(process.cwd(), "data", "hotspot.json");
const NMCLI = "/usr/bin/nmcli";

type Saved = { ssid: string; password: string };

type HotspotStatus = {
  available: boolean;
  running: boolean;
  ssid: string;
  password: string;
  ip: string;
  url: string;
  wifiQr: string | null;
  urlQr: string | null;
  setupCommand: string;
  error?: string;
};

function run(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 25_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || stdout || error.message).trim();
          reject(new Error(detail || "Command failed"));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function readSaved(): Saved | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SAVED, "utf8")) as Saved;
    if (!parsed?.ssid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function escapeWifi(value: string) {
  return value.replace(/([\\;,":])/g, "\\$1");
}

async function status(): Promise<HotspotStatus> {
  const available =
    fs.existsSync(HELPER) && fs.existsSync("/usr/bin/dnsmasq");
  const setupCommand = `sudo ${path.join(process.cwd(), "scripts", "install-hotspot.sh")}`;
  const saved = readSaved();

  let running = false;
  let ssid = saved?.ssid || "Cove";
  let ip = "";
  let error = "";

  if (available) {
    try {
      const active = await run(NMCLI, [
        "-t",
        "-f",
        "NAME",
        "connection",
        "show",
        "--active",
      ]);
      running = active.stdout
        .split("\n")
        .map((line) => line.trim())
        .includes(CON);

      if (running) {
        const actualSsid = await run(NMCLI, [
          "-g",
          "802-11-wireless.ssid",
          "connection",
          "show",
          CON,
        ]).catch(() => ({ stdout: "", stderr: "" }));
        if (actualSsid.stdout.trim()) ssid = actualSsid.stdout.trim();

        const address = await run(NMCLI, [
          "-g",
          "IP4.ADDRESS",
          "connection",
          "show",
          CON,
        ]).catch(() => ({ stdout: "", stderr: "" }));
        ip = address.stdout.trim().split(/\s/)[0]?.split("/")[0] || "";
      }
    } catch (statusError) {
      error = statusError instanceof Error ? statusError.message : "Status failed";
    }
  }

  const password =
    running && saved && saved.ssid === ssid ? saved.password : running ? "" : saved?.password || "";
  const url = ip ? `https://${ip}:3000` : "";

  let wifiQr: string | null = null;
  let urlQr: string | null = null;
  if (running) {
    if (password) {
      wifiQr = await QRCode.toDataURL(
        `WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(password)};H:false;;`,
        { margin: 1, width: 220 },
      );
    }
    if (url) {
      urlQr = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    }
  }

  return {
    available,
    running,
    ssid,
    password,
    ip,
    url,
    wifiQr,
    urlQr,
    setupCommand,
    ...(error ? { error } : {}),
  };
}

async function requireAdmin() {
  const user = await apiUser();
  if (!user) return { error: fail("Not signed in", 401) };
  if (user.role !== "admin") return { error: fail("Admin only", 403) };
  return { user };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  return NextResponse.json(await status());
}

export async function POST(req: NextRequest) {
  if (!originOk(req)) return fail("Bad origin", 403);
  const guard = await requireAdmin();
  if (guard.error) return guard.error;
  const admin = guard.user!;

  const body = (await req.json().catch(() => null)) as
    | { action?: string; ssid?: string; password?: string }
    | null;
  if (!body?.action) return fail("Missing action");

  if (body.action === "start") {
    const ssid = (body.ssid || "").trim();
    const password = body.password || "";
    if (!ssid || ssid.length > 32 || /[\x00-\x1f\x7f]/.test(ssid)) {
      return fail("SSID must be 1-32 characters");
    }
    if (password.length < 8 || password.length > 63) {
      return fail("Hotspot password must be 8-63 characters");
    }
    if (!fs.existsSync(HELPER)) return fail("Hotspot helper is not installed", 409);

    // A second start request used to delete and recreate the active AP.
    const alreadyRunning = await status();
    if (alreadyRunning.running) return NextResponse.json(alreadyRunning);

    try {
      await run("sudo", ["-n", HELPER, "start", ssid, password]);
      fs.mkdirSync(path.dirname(SAVED), { recursive: true });
      fs.writeFileSync(SAVED, JSON.stringify({ ssid, password }), { mode: 0o600 });
      audit(admin, "admin.hotspot.start", ssid, req);
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : "Could not start hotspot";
      return fail(
        message.includes("password is required")
          ? "Hotspot helper needs the one-time sudo setup"
          : message,
        409,
      );
    }

    // Give NetworkManager a moment to assign the hotspot address.
    let current = await status();
    for (let attempt = 0; attempt < 4 && !current.ip; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current = await status();
    }
    return NextResponse.json(current);
  }

  if (body.action === "stop") {
    try {
      await run("sudo", ["-n", HELPER, "stop"]);
      fs.rmSync(SAVED, { force: true });
      audit(admin, "admin.hotspot.stop", null, req);
    } catch (stopError) {
      const message = stopError instanceof Error ? stopError.message : "Could not stop hotspot";
      return fail(message, 409);
    }
    return NextResponse.json(await status());
  }

  return fail("Unknown action");
}
