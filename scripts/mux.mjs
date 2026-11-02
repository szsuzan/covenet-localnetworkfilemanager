import net from "node:net";

const LISTEN_PORT = Number(process.env.MUX_PORT) || 3000;
const TLS_HOST = "127.0.0.1";
const TLS_PORT = Number(process.env.MUX_TLS_PORT) || 3443;

/**
 * One external port, two protocols:
 *   - TLS ClientHello (0x16)  -> proxied to Caddy with a PROXY header
 *   - anything else (HTTP)    -> 308 redirect to the same host/path over HTTPS
 */
const server = net.createServer((socket) => {
  socket.setTimeout(20_000);
  socket.on("timeout", () => socket.destroy());

  socket.once("data", (first) => {
    if (first[0] === 0x16) {
      const upstream = net.connect(TLS_PORT, TLS_HOST);
      const remote = socket.remoteAddress || "127.0.0.1";
      const local = socket.localAddress || "127.0.0.1";
      const family = remote.includes(":") ? "TCP6" : "TCP4";
      const header = `PROXY ${family} ${remote} ${local} ${socket.remotePort} ${socket.localPort}\r\n`;

      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
      socket.on("close", () => upstream.destroy());

      upstream.write(Buffer.concat([Buffer.from(header, "ascii"), first]));
      socket.pipe(upstream);
      upstream.pipe(socket);
      return;
    }

    const text = first.toString("latin1");
    const line = text.split("\r\n")[0] || "";
    const rawTarget = line.split(" ")[1] || "/";
    const target = /^\/[^\s]*$/.test(rawTarget) ? rawTarget : "/";
    const address = socket.localAddress || "127.0.0.1";
    const host = address.includes(":") ? `[${address}]` : address;
    const location = `https://${host}:${LISTEN_PORT}${target}`;

    socket.end(
      "HTTP/1.1 308 Permanent Redirect\r\n" +
        `Location: ${location}\r\n` +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n\r\n",
    );
  });
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(
    `[mux] listening on :${LISTEN_PORT} — TLS to ${TLS_HOST}:${TLS_PORT}, HTTP redirects to HTTPS`,
  );
});
