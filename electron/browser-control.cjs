"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DEFAULT_PORTS = { chrome: 9222, brave: 9223, edge: 9224 };
const sessions = new Map();
const processes = new Set();
let stopped = false;
let nextCommandId = 1;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function normalizeBrowser(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["google chrome", "chrome browser"].includes(raw)) return "chrome";
  if (["brave browser"].includes(raw)) return "brave";
  if (["microsoft edge", "edge browser"].includes(raw)) return "edge";
  return raw || "chrome";
}

function requestJson(url, timeoutMs = 1200) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error("CDP HTTP " + response.statusCode));
        try { resolve(JSON.parse(body)); } catch { reject(new Error("CDP returned invalid JSON.")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("CDP request timed out.")));
    request.on("error", reject);
  });
}

async function listTargets(port) {
  const result = await requestJson("http://127.0.0.1:" + port + "/json/list");
  return Array.isArray(result) ? result : [];
}

function pickTarget(targets, expectedUrl) {
  const pages = targets.filter((target) => target && target.type === "page" && target.webSocketDebuggerUrl);
  if (!pages.length) return null;
  const wanted = String(expectedUrl || "").trim();
  if (wanted) {
    const exact = pages.find((target) => target.url === wanted);
    if (exact) return exact;
    try {
      const host = new URL(wanted).hostname;
      const sameHost = pages.find((target) => {
        try { return new URL(target.url).hostname === host; } catch { return false; }
      });
      if (sameHost) return sameHost;
    } catch {}
  }
  return pages[0];
}

function connectTarget(target) {
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP target has no WebSocket endpoint.");
  if (typeof WebSocket !== "function") throw new Error("This Electron runtime does not expose a WebSocket client.");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let opened = false;

  const connection = {
    socket,
    target,
    command(method, params = {}, timeoutMs = 15000) {
      if (stopped) return Promise.reject(new Error("Computer control is stopped."));
      return new Promise((resolve, reject) => {
        const id = nextCommandId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("CDP command timed out: " + method));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP connection stopped."));
      }
      pending.clear();
      try { socket.close(); } catch {}
    },
  };

  socket.addEventListener("open", () => { opened = true; });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data || "")); } catch { return; }
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(message.error.message || "CDP command failed."));
    else entry.resolve(message.result || {});
  });
  socket.addEventListener("close", () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("CDP browser connection closed."));
    }
    pending.clear();
  });
  socket.addEventListener("error", (error) => {
    if (!opened) console.warn("[CDP] websocket error", error?.message || error);
  });

  return connection;
}

async function waitForTarget(port, expectedUrl = "", timeoutMs = 8000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (stopped) throw new Error("Computer control is stopped.");
    try {
      const target = pickTarget(await listTargets(port), expectedUrl);
      if (target) return target;
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw lastError || new Error("No debuggable browser page appeared on port " + port + ".");
}

function profileDir(appDataDir, browser) {
  return path.join(appDataDir, "browser-cdp-profiles", normalizeBrowser(browser));
}

async function ensureBrowser({ browser, executable, appDataDir, url = "about:blank" }) {
  const name = normalizeBrowser(browser);
  const port = DEFAULT_PORTS[name];
  if (!port) throw new Error("CDP is not configured for browser: " + name);

  try {
    const target = await waitForTarget(port, "", 500);
    return { browser: name, port, target, managed: false };
  } catch {}

  if (!executable) throw new Error("No executable was supplied for " + name + ".");
  const userDataDir = profileDir(appDataDir, name);
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + userDataDir,
    "--no-first-run",
    "--no-default-browser-check",
    url || "about:blank",
  ];
  const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: false });
  processes.add(child);
  child.once("exit", () => processes.delete(child));
  child.unref();

  const target = await waitForTarget(port, url, 10000);
  return { browser: name, port, target, managed: true };
}

async function getSession(options) {
  const browser = normalizeBrowser(options.browser);
  const current = sessions.get(browser);
  if (current) {
    try {
      const target = pickTarget(await listTargets(current.port), options.url);
      if (target && target.webSocketDebuggerUrl === current.target.webSocketDebuggerUrl) return current;
      if (target) {
        current.connection?.close();
        current.target = target;
        current.connection = connectTarget(target);
        return current;
      }
    } catch {}
  }
  const info = await ensureBrowser(options);
  const session = { ...info, connection: connectTarget(info.target) };
  sessions.set(browser, session);
  return session;
}

async function evaluate(session, expression) {
  const result = await session.connection.command("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function navigate(options) {
  const session = await getSession(options);
  await session.connection.command("Page.enable");
  await session.connection.command("Page.navigate", { url: String(options.url) });
  await sleep(Math.min(1500, Math.max(250, Number(options.waitMs) || 700)));
  return { ok: true, mode: "browser", transport: "cdp", browser: session.browser, url: String(options.url), targetId: session.target.id };
}

async function getPage(options = {}) {
  const session = await getSession(options);
  const data = await evaluate(session, '(() => ({title:document.title||"", url:location.href||"", text:(document.body?.innerText||"").slice(0,12000)}))()');
  return { ok: true, mode: "browser", transport: "cdp", browser: session.browser, ...data };
}

function quoteJs(value) { return JSON.stringify(String(value ?? "")); }

async function clickText(options = {}) {
  const session = await getSession(options);
  const text = String(options.text || options.targetLabel || "").trim();
  if (!text) throw new Error("Browser click requires target text.");
  const script = '(() => { const wanted=' + quoteJs(text) + '.toLowerCase(); const nodes=[...document.querySelectorAll("button,a,[role=\'button\'],input[type=\'button\'],input[type=\'submit\'],label")]; const match=nodes.find(node=>{const value=String(node.innerText||node.value||node.getAttribute("aria-label")||node.getAttribute("title")||"").trim().toLowerCase(); return value===wanted||value.includes(wanted);}); if(!match)return {ok:false,error:"No matching browser control was found."}; match.scrollIntoView({block:"center",inline:"center"}); match.click(); return {ok:true,tag:match.tagName,text:String(match.innerText||match.value||match.getAttribute("aria-label")||"").trim()}; })()';
  const result = await evaluate(session, script);
  if (!result?.ok) throw new Error(result?.error || "Browser click failed.");
  return { ok: true, mode: "browser", transport: "cdp", browser: session.browser, ...result };
}

async function typeInto(options = {}) {
  const session = await getSession(options);
  const selector = String(options.selector || "").trim();
  const text = String(options.text || "");
  if (!selector) throw new Error("Browser type requires a CSS selector.");
  if (text.length > 4000) throw new Error("Browser text input is limited to 4000 characters.");
  const script = '(() => { const el=document.querySelector(' + quoteJs(selector) + '); if(!el)return {ok:false,error:"No matching browser input was found."}; el.focus(); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set||Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set; if(setter)setter.call(el,' + quoteJs(text) + '); else el.value=' + quoteJs(text) + '; el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); return {ok:true}; })()';
  const result = await evaluate(session, script);
  if (!result?.ok) throw new Error(result?.error || "Browser type failed.");
  return { ok: true, mode: "browser", transport: "cdp", browser: session.browser };
}

async function screenshot(options = {}) {
  const session = await getSession(options);
  const result = await session.connection.command("Page.captureScreenshot", { format: "jpeg", quality: Math.min(90, Math.max(40, Number(options.quality) || 70)), fromSurface: true });
  return { ok: true, mode: "browser", transport: "cdp", browser: session.browser, image: "data:image/jpeg;base64," + result.data };
}

function stopAll(reason = "User requested stop.") {
  stopped = true;
  for (const session of sessions.values()) { try { session.connection?.close(); } catch {} }
  sessions.clear();
  for (const child of processes) { try { child.kill(); } catch {} }
  processes.clear();
  return { ok: true, stopped: true, reason };
}

function resume() { stopped = false; }

module.exports = { DEFAULT_PORTS, ensureBrowser, navigate, getPage, clickText, typeInto, screenshot, stopAll, resume };
