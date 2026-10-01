const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

class NativeComputerControl {
  constructor() {
    this.child = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
  }

  executablePath() {
    if (process.platform !== "win32") {
      throw new Error("The native computer-control sidecar is currently packaged for Windows only.");
    }
    const packaged = path.join(process.resourcesPath || "", "bin", "ma9ic-computer-control.exe");
    const dev = path.join(__dirname, "..", "native", "bin", "ma9ic-computer-control.exe");
    if (fs.existsSync(packaged)) return packaged;
    if (fs.existsSync(dev)) return dev;
    throw new Error(`Native computer-control sidecar not found. Build it with npm run native:build. Expected: ${dev}`);
  }

  ensureStarted() {
    if (this.child && !this.child.killed) return;
    const exe = this.executablePath();
    this.child = spawn(exe, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => console.warn("[native-computer]", chunk.trim()));
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("exit", (code, signal) => {
      this.child = null;
      this.failAll(new Error(`Native computer-control sidecar exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`));
    });
  }

  onData(chunk) {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "Native computer-control operation failed."));
    }
  }

  failAll(error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  execute(action, params = {}) {
    this.ensureStarted();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.stdin.write(JSON.stringify({ id, action, params }) + "\n");
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  screenshot(params = {}) {
    return this.execute("SCREENSHOT", params);
  }

  shutdown() {
    if (!this.child) return;
    try {
      this.child.stdin.write(JSON.stringify({ id: this.nextId++, action: "SHUTDOWN", params: {} }) + "\n");
    } catch {}
    const child = this.child;
    this.child = null;
    setTimeout(() => { try { child.kill(); } catch {} }, 500);
    this.failAll(new Error("Native computer-control sidecar shut down."));
  }
}

module.exports = { NativeComputerControl };
