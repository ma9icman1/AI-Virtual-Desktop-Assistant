"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

const file = "electron/main.cjs";
const text = fs.readFileSync(file, "utf8");
const oldMarker = "// [direct-site-open-v3]";
const marker = "// [direct-site-open-v4]";

const anchor = `async function executeDesktopAction(action, params = {}) {`;
if (!text.includes(anchor)) {
  throw new Error("[direct-site-open] required executeDesktopAction function anchor is missing");
}

const patch = `  ${marker}
  // Open website URLs directly through the requested browser when one was
  // specified. Do not silently fall back to the Windows default browser for
  // explicit Chrome/Brave/Edge requests.
  if (action === "NAVIGATE_URL") {
    const rawUrl = String(params.url || "").trim();
    if (!rawUrl) throw new Error("NAVIGATE_URL requires a URL.");

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("Invalid URL: " + rawUrl);
    }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      throw new Error("Only valid HTTP and HTTPS URLs are allowed.");
    }

    const requestedBrowser = String(params.browser || "")
      .trim()
      .toLowerCase()
      .replace(/\\s+browser$/i, "");
    const browserAliases = {
      "microsoft edge": "edge",
      "google chrome": "chrome",
      "brave browser": "brave",
      "mozilla firefox": "firefox",
      "opera browser": "opera",
      "vivaldi browser": "vivaldi",
    };
    const targetBrowser = browserAliases[requestedBrowser] || requestedBrowser;

    if (targetBrowser === "firefox") {
      throw new Error("Firefox browser automation is not supported in this version of ma9icAI. Use Chrome, Brave, or Edge.");
    }

    let launchedBrowser = "default-browser";
    if (targetBrowser && targetBrowser !== "browser") {
      const executable = resolveBrowserExecutable(targetBrowser);
      if (!executable) {
        throw new Error("Could not find the requested browser: " + requestedBrowser + ".");
      }

      const child = spawn(executable, [url.toString()], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      await new Promise((resolve, reject) => {
        child.once("error", (error) => reject(new Error("Windows could not navigate " + targetBrowser + ": " + error.message)));
        child.once("spawn", resolve);
      });
      child.unref();
      launchedBrowser = targetBrowser;
    } else {
      const errorMessage = await shell.openExternal(url.toString());
      if (errorMessage) {
        throw new Error("Windows could not open the default browser: " + errorMessage);
      }
    }

    const expectedHost = normalizedHostname(url.toString());
    let webpage = {
      ok: true,
      detected: false,
      browser: "",
      title: "",
      url: "",
      expectedHost,
      elapsedMs: 0,
    };
    try {
      webpage = await detectWebpage({
        timeoutMs: 15000,
        intervalMs: 350,
        expectedHost,
      });
    } catch (verificationError) {
      console.warn("[WEB NAV] Browser verification unavailable after launch; continuing with desktop vision.", verificationError);
    }

    const observedBrowser = normalizeProcessName(webpage.browser);
    const observedHost = normalizedHostname(webpage.url);
    const browserMatches = !targetBrowser || targetBrowser === "browser"
      || !observedBrowser
      || observedBrowser === targetBrowser;
    const hostMatches = !observedHost || observedHost === expectedHost;

    if (!webpage.detected || !browserMatches || !hostMatches) {
      console.warn("[WEB NAV] Soft verification: launch succeeded but live browser verification was incomplete.", {
        requestedUrl: url.toString(),
        expectedHost,
        targetBrowser: launchedBrowser,
        detected: Boolean(webpage.detected),
        observedBrowser: observedBrowser || null,
        observedUrl: webpage.url || null,
      });
    }

    if (desktopPermission === "one_action") desktopPermission = "none";
    return {
      ok: true,
      verified: Boolean(webpage.detected && browserMatches && hostMatches),
      launched: true,
      url: url.toString(),
      browser: launchedBrowser,
      webpage,
      verification: {
        expectedHost,
        observedHost,
        observedBrowser,
        browserMatches,
        hostMatches,
      },
    };
  }
`;

let updated;
if (text.includes(marker)) {
  console.log("[direct-site-open] v4 already installed; skipped");
  process.exit(0);
}

if (text.includes(oldMarker)) {
  const start = text.indexOf(oldMarker);
  // The old v3 block is a generated block and its exact DEBUG ACTION line has
  // changed across revisions. Find the first ordinary console.log after the
  // marker instead of depending on one exact template-literal spelling.
  const consoleAnchor = "\n  console.log(";
  const end = text.indexOf(consoleAnchor, start);
  if (end < 0) {
    throw new Error("[direct-site-open] existing v3 block end anchor is missing; refusing to modify files.");
  }
  const blockStart = text.lastIndexOf("\n", start) + 1;
  updated = text.slice(0, blockStart) + patch + text.slice(end + 1);
} else {
  updated = text.replace(anchor, anchor + "\n" + patch);
}

fs.writeFileSync(file, updated, "utf8");

try {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
} catch {
  throw new Error("[direct-site-open] electron/main.cjs syntax validation failed after patching");
}

console.log("[direct-site-open] browser-aware NAVIGATE_URL execution installed and syntax validated");
