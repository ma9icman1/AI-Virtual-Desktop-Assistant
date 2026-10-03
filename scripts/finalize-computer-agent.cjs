const fs = require("fs");
const path = require("path");
const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function write(file, text) {
  fs.writeFileSync(path.join(root, file), text);
}

function once(file, marker, replacement, label) {
  const text = read(file);
  if (text.includes(marker)) return false;
  if (!text.includes(replacement.before)) {
    throw new Error(`Patch marker missing for ${label}`);
  }
  write(file, text.replace(replacement.before, replacement.after));
  return true;
}

let changed = 0;

changed += once(
  "electron/main.cjs",
  'require("./computer-control.cjs")',
  {
    before: 'const path = require("path");\n',
    after: 'const path = require("path");\nconst computerControl = require("./computer-control.cjs");\n',
  },
  "computer-control import"
) ? 1 : 0;

changed += once(
  "electron/main.cjs",
  "function runPowerShell(script, args = [], timeoutMs = 15000)",
  {
    before: `function runPowerShell(script, args = []) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script, ...args], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout.trim());
    });
  });
}
`,
    after: `function runPowerShell(script, args = [], timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script, ...args], { windowsHide: true, timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.code === "ETIMEDOUT") reject(new Error("Windows desktop action timed out after " + timeoutMs + "ms."));
        else reject(new Error(stderr.trim() || error.message));
      } else resolve(stdout.trim());
    });
    child.on("error", (error) => reject(error));
  });
}
`,
  },
  "PowerShell timeout"
) ? 1 : 0;

changed += once(
  "electron/main.cjs",
  "mapPointFromCoordinateMap",
  {
    before: `  const display = screen.getPrimaryDisplay();
  const scalePoint = (value, axisSize, aiSize) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return params.coordinateSpace === "vision"
      ? Math.round(numeric * axisSize / aiSize)
      : Math.round(numeric);
  };
  const x = scalePoint(params.x, display.size.width, AI_SCREEN_WIDTH);
  const y = scalePoint(params.y, display.size.height, AI_SCREEN_HEIGHT);
`,
    after: `  const display = screen.getPrimaryDisplay();
  const scalePoint = (value, axisSize, aiSize) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * axisSize / aiSize);
  };
  const mapVisionPoint = (xValue, yValue) => {
    if (params.coordMap) return computerControl.mapPointFromCoordinateMap(xValue, yValue, params.coordMap);
    return {
      x: scalePoint(xValue, display.size.width, AI_SCREEN_WIDTH),
      y: scalePoint(yValue, display.size.height, AI_SCREEN_HEIGHT),
    };
  };
  const mappedPoint = params.coordinateSpace === "vision"
    ? mapVisionPoint(params.x, params.y)
    : { x: Number(params.x) || 0, y: Number(params.y) || 0 };
  const x = mappedPoint.x;
  const y = mappedPoint.y;
`,
  },
  "coordinate map execution"
) ? 1 : 0;

changed += once(
  "electron/main.cjs",
  'const mappedEndPoint = params.coordinateSpace === "vision"',
  {
    before: `  const endX = scalePoint(params.endX, display.size.width, AI_SCREEN_WIDTH);
  const endY = scalePoint(params.endY, display.size.height, AI_SCREEN_HEIGHT);
  const actionArgs = [action, String(x), String(y), String(params.text || params.key || params.app || params.ms || ""), String(endX), String(endY)];
`,
    after: `  const mappedEndPoint = params.coordinateSpace === "vision"
    ? mapVisionPoint(params.endX, params.endY)
    : { x: Number(params.endX) || 0, y: Number(params.endY) || 0 };
  const endX = mappedEndPoint.x;
  const endY = mappedEndPoint.y;
  const actionArgs = [action, String(x), String(y), String(params.text || params.key || params.app || params.ms || ""), String(endX), String(endY)];
`,
  },
  "coordinate map drag destination"
) ? 1 : 0;

changed += once(
  "electron/main.cjs",
  "desktop-capture-screen-info",
  {
    before: `ipcMain.handle("desktop-capture-screen", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const wasVisible = window && !window.isDestroyed() && window.isVisible();
  if (wasVisible) {
    window.hide();
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  try {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: display.size.width, height: display.size.height },
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error("Windows did not return a desktop screenshot.");
    }
    const normalized = source.thumbnail.resize({ width: AI_SCREEN_WIDTH, height: AI_SCREEN_HEIGHT, quality: "good" });
    return "data:image/jpeg;base64," + normalized.toJPEG(60).toString("base64");
  } finally {
    if (wasVisible && window && !window.isDestroyed()) window.show();
  }
});
`,
    after: `async function captureDesktopFrame(event, region = null) {
  const window = BrowserWindow.fromWebContents(event.sender);
  const wasVisible = window && !window.isDestroyed() && window.isVisible();
  if (wasVisible) {
    window.hide();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    const display = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: display.size.width, height: display.size.height },
      fetchWindowIcons: false,
    });
    const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error("Windows did not return a desktop screenshot.");

    const physical = computerControl.getDisplayPhysicalRect(display, screen);
    let image = source.thumbnail;
    let captureRect = physical;
    if (region) {
      const map = computerControl.parseCoordinateMap(region.coordMap || region);
      if (!map) throw new Error("A valid coordinate map is required for a zoomed screenshot.");
      const topLeft = computerControl.mapPointFromCoordinateMap(region.x, region.y, map);
      const bottomRight = computerControl.mapPointFromCoordinateMap(region.x + region.width, region.y + region.height, map);
      const x = Math.max(0, Math.min(physical.width - 1, topLeft.x - physical.x));
      const y = Math.max(0, Math.min(physical.height - 1, topLeft.y - physical.y));
      const width = Math.max(1, Math.min(physical.width - x, bottomRight.x - topLeft.x));
      const height = Math.max(1, Math.min(physical.height - y, bottomRight.y - topLeft.y));
      image = image.crop({ x, y, width, height });
      captureRect = { x: physical.x + x, y: physical.y + y, width, height };
    }

    const vision = computerControl.getVisionCanvasSize({ size: captureRect });
    const normalized = image.resize({ width: vision.width, height: vision.height, quality: "good" });
    const coordMap = { version: 1, coordinateSpace: "vision", captureX: captureRect.x, captureY: captureRect.y, captureWidth: captureRect.width, captureHeight: captureRect.height, imageWidth: vision.width, imageHeight: vision.height };
    return {
      image: "data:image/jpeg;base64," + normalized.toJPEG(62).toString("base64"),
      sourceWidth: physical.width,
      sourceHeight: physical.height,
      visionWidth: vision.width,
      visionHeight: vision.height,
      coordMap,
      coordMapString: computerControl.formatCoordinateMap(coordMap),
    };
  } finally {
    if (wasVisible && window && !window.isDestroyed()) window.show();
  }
}

ipcMain.handle("desktop-capture-screen", async (event) => {
  const frame = await captureDesktopFrame(event);
  return frame.image;
});
ipcMain.handle("desktop-capture-screen-info", async (event) => captureDesktopFrame(event));
ipcMain.handle("desktop-capture-screen-region", async (event, region) => captureDesktopFrame(event, region));
`,
  },
  "desktop capture metadata and region zoom"
) ? 1 : 0;

changed += once(
  "electron/preload.cjs",
  "captureScreenRegion:",
  {
    before: '  captureScreenInfo: () => ipcRenderer.invoke("desktop-capture-screen-info"),\n',
    after: '  captureScreenInfo: () => ipcRenderer.invoke("desktop-capture-screen-info"),\n  captureScreenRegion: (region) => ipcRenderer.invoke("desktop-capture-screen-region", region),\n',
  },
  "preload region capture"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "coordMap: params.coordMap || activeVision?.coordMap",
  {
    before: '        MOVE_MOUSE: { action: "MOVE_MOUSE", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },\n',
    after: '        MOVE_MOUSE: { action: "MOVE_MOUSE", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace, coordMap: params.coordMap || activeVision?.coordMap } },\n',
  },
  "vision map in move action"
) ? 1 : 0;

for (const action of ["CLICK_BUTTON", "DOUBLE_CLICK", "RIGHT_CLICK", "DRAG", "SCROLL"]) {
  const before = {
    CLICK_BUTTON: '        CLICK_BUTTON: { action: "CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },\n',
    DOUBLE_CLICK: '        DOUBLE_CLICK: { action: "DOUBLE_CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },\n',
    RIGHT_CLICK: '        RIGHT_CLICK: { action: "RIGHT_CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },\n',
    DRAG: '        DRAG: { action: "DRAG", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, endX: params.endX, endY: params.endY, coordinateSpace: params.coordinateSpace } },\n',
    SCROLL: '        SCROLL: { action: "SCROLL", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, key: params.key || "{PAGEDOWN}", coordinateSpace: params.coordinateSpace } },\n',
  }[action];
  const after = before.replace(
    "coordinateSpace: params.coordinateSpace",
    "coordinateSpace: params.coordinateSpace, coordMap: params.coordMap || activeVision?.coordMap"
  );
  changed += once(
    "src/App.tsx",
    `coordMap: ${action}`,
    { before, after },
    `${action} vision map`
  ) ? 1 : 0;
}

changed += once(
  "src/App.tsx",
  "Desktop action timed out after",
  {
    before: '    await (window as any).magicDesktop.execute(mapped.action, mapped.params);\n',
    after: `    const timeoutMs = Math.min(20000, Math.max(5000, Number(mapped.params.ms || mapped.params.estimatedDurationMs || 0) * 4 || 5000));
    await Promise.race([
      (window as any).magicDesktop.execute(mapped.action, mapped.params),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Desktop action timed out after " + timeoutMs + "ms.")), timeoutMs)),
    ]);
`,
  },
  "renderer action timeout"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "VisionService.captureScreenFrame()",
  {
    before: `      const base64Image = await VisionService.captureScreen();
      setVisionThumbnail(base64Image);
      const response = await fetch("/api/vision/analyze", {
`,
    after: `      const frame = await VisionService.captureScreenFrame();
      const base64Image = frame.image;
      setVisionThumbnail(base64Image);
      const response = await fetch("/api/vision/analyze", {
`,
  },
  "vision frame capture"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "coordMap: frame.coordMap",
  {
    before: `          body: JSON.stringify({
          imageData: base64Image,
          instruction:
`,
    after: `          body: JSON.stringify({
          imageData: base64Image,
          sourceWidth: frame.sourceWidth,
          sourceHeight: frame.sourceHeight,
          visionWidth: frame.visionWidth,
          visionHeight: frame.visionHeight,
          coordMap: frame.coordMap,
          coordMapString: frame.coordMapString,
          instruction:
`,
  },
  "vision metadata request"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "visionResult = { ...visionResult, visionWidth: frame.visionWidth",
  {
    before: `      setActiveVision(visionResult);
`,
    after: `      visionResult = { ...visionResult, visionWidth: frame.visionWidth, visionHeight: frame.visionHeight, sourceWidth: frame.sourceWidth, sourceHeight: frame.sourceHeight, coordinateSpace: "vision", coordMap: frame.coordMap, coordMapString: frame.coordMapString };
      setActiveVision(visionResult);
`,
  },
  "vision metadata merge"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "visionContextForPlan",
  {
    before: `  const executePlanSequence = useCallback(
    async (plan: MultiStepPlan) => {`,
    after: `  const executePlanSequence = useCallback(
    async (plan: MultiStepPlan, visionContextForPlan?: VisionDetection | null) => {`,
  },
  "plan vision context parameter"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "coordMap: planVisionContext",
  {
    before: `            coordinateSpace: plan.steps[i].params?.coordinateSpace,
          });`,
    after: `            coordinateSpace: plan.steps[i].params?.coordinateSpace,
            coordMap: plan.steps[i].params?.coordMap || visionContextForPlan?.coordMap,
          });`,
  },
  "plan coordinate map propagation"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "executePlanSequence(plan, visionOverride ?? activeVision)",
  {
    before: '            executePlanSequence(plan);\n          }\n        } else if (data.action?.type === "REMEMBER"',
    after: '            executePlanSequence(plan, visionOverride ?? activeVision);\n          }\n        } else if (data.action?.type === "REMEMBER"',
  },
  "vision plan execution context"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "executePlanSequence(plan, visionOverride ?? activeVision) second",
  {
    before: '            executePlanSequence(plan);\n          }\n        }\n      } catch (err) {',
    after: '            executePlanSequence(plan, visionOverride ?? activeVision);\n          }\n        }\n      } catch (err) {',
  },
  "vision plan execution context second"
) ? 1 : 0;

changed += once(
  "src/App.tsx",
  "executeDesktopAction, activeVision",
  {
    before: "    [executeDesktopAction]\n  );",
    after: "    [executeDesktopAction, activeVision]\n  );",
  },
  "execute plan vision dependency"
) ? 1 : 0;

console.log(`[computer-agent-finalize] applied ${changed} patch(es); already-applied patches are skipped.`);
