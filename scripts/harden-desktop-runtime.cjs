const fs = require('fs');
const path = require('path');
const root = process.cwd();

function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function write(file, text) { fs.writeFileSync(path.join(root, file), text, 'utf8'); }
function log(message) { console.log(`[desktop-runtime] ${message}`); }

let main = read('electron/main.cjs');
if (!main.includes('const computerControl = require("./computer-control.cjs");')) {
  main = main.replace(
    'const path = require("path");\n',
    'const path = require("path");\nconst computerControl = require("./computer-control.cjs");\nconst { getVisionCanvasSize, createCoordinateMap, formatCoordinateMap, mapPointFromCoordinateMap, parseCoordinateMap } = computerControl;\n'
  );
  log('installed canonical computer-control helpers');
}

if (!main.includes('timeout: timeoutMs')) {
  const pattern = /function runPowerShell\(script, args = \[\]\) \{[\s\S]*?\n\}\n/;
  const replacement = `function runPowerShell(script, args = [], timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script, ...args], { windowsHide: true, timeout: timeoutMs, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.code === "ETIMEDOUT") reject(new Error("Windows desktop action timed out after " + timeoutMs + "ms."));
        else reject(new Error(stderr.trim() || error.message));
      } else resolve(stdout.trim());
    });
    child.on("error", reject);
  });
}
`;
  if (pattern.test(main)) {
    main = main.replace(pattern, replacement);
    log('added PowerShell desktop-action timeout');
  } else {
    log('PowerShell helper not found; timeout patch skipped');
  }
}

if (!main.includes('ipcMain.handle("desktop-capture-screen-info"')) {
  const marker = 'ipcMain.handle("desktop-capture-screen", async (event) => {';
  const index = main.indexOf(marker);
  if (index >= 0) {
    const handlerEnd = main.indexOf('\n});', index);
    if (handlerEnd >= 0) {
      const insertAt = handlerEnd + 4;
      const infoHandler = `\n\nipcMain.handle("desktop-capture-screen-info", async () => {\n  if (typeof captureDesktopRegion !== "function") throw new Error("Desktop region capture is unavailable.");\n  return captureDesktopRegion({ x: 0, y: 0, width: AI_SCREEN_WIDTH, height: AI_SCREEN_HEIGHT });\n});`;
      main = main.slice(0, insertAt) + infoHandler + main.slice(insertAt);
      log('added screen-frame metadata IPC');
    }
  }
}

if (!main.includes('mapPointFromCoordinateMap(params.x')) {
  const marker = '  const display = screen.getPrimaryDisplay();\n';
  const actionIndex = main.indexOf(marker, main.indexOf('async function executeDesktopAction'));
  if (actionIndex >= 0) {
    const insertAt = actionIndex + marker.length;
    const block = `  const mapVisionPoint = (xValue, yValue) => {\n    if (params.coordMap) return mapPointFromCoordinateMap(xValue, yValue, params.coordMap);\n    return { x: Math.round(Number(xValue) * display.size.width / AI_SCREEN_WIDTH), y: Math.round(Number(yValue) * display.size.height / AI_SCREEN_HEIGHT) };\n  };\n`;
    main = main.slice(0, insertAt) + block + main.slice(insertAt);
    const oldX = '  const x = Number(params.x) || 0;\n  const y = Number(params.y) || 0;\n';
    const mappedX = '  const point = params.coordinateSpace === "vision" ? mapVisionPoint(params.x, params.y) : { x: Number(params.x) || 0, y: Number(params.y) || 0 };\n  const x = point.x;\n  const y = point.y;\n';
    if (main.includes(oldX)) main = main.replace(oldX, mappedX);
    log('wired vision coordinate-map pointer conversion');
  }
}
write('electron/main.cjs', main);

let preload = read('electron/preload.cjs');
if (!preload.includes('captureScreenRegion:')) {
  preload = preload.replace(
    '  captureScreenInfo: () => ipcRenderer.invoke("desktop-capture-screen-info"),\n',
    '  captureScreenInfo: () => ipcRenderer.invoke("desktop-capture-screen-info"),\n  captureScreenRegion: (region) => ipcRenderer.invoke("desktop-capture-screen-region", region),\n'
  );
  write('electron/preload.cjs', preload);
  log('exposed region capture through preload');
}

let app = read('src/App.tsx');
if (!app.includes('coordMap: params.coordMap || activeVision?.coordMap')) {
  app = app.replace(/coordinateSpace: params\.coordinateSpace \}/g, 'coordinateSpace: params.coordinateSpace, coordMap: params.coordMap || activeVision?.coordMap }');
  log('attached current vision coordinate maps to pointer actions');
}
if (!app.includes('Desktop action timed out after')) {
  const old = '    await (window as any).magicDesktop.execute(mapped.action, mapped.params);\n';
  const replacement = `    const timeoutMs = Math.min(20000, Math.max(5000, Number(mapped.params.ms || mapped.params.estimatedDurationMs || 0) * 4 || 5000));\n    await Promise.race([\n      (window as any).magicDesktop.execute(mapped.action, mapped.params),\n      new Promise((_, reject) => window.setTimeout(() => reject(new Error("Desktop action timed out after " + timeoutMs + "ms.")), timeoutMs)),\n    ]);\n`;
  if (app.includes(old)) {
    app = app.replace(old, replacement);
    log('added renderer-side desktop-action timeout');
  }
}
if (!app.includes('VisionService.captureScreenFrame()')) {
  app = app.replace('      const base64Image = await VisionService.captureScreen();\n', '      const frame = await VisionService.captureScreenFrame();\n      const base64Image = frame.image;\n');
  app = app.replace(
    '          imageData: base64Image,\n          instruction:',
    '          imageData: base64Image,\n          sourceWidth: frame.sourceWidth,\n          sourceHeight: frame.sourceHeight,\n          visionWidth: frame.visionWidth,\n          visionHeight: frame.visionHeight,\n          coordMap: frame.coordMap,\n          coordMapString: frame.coordMapString,\n          instruction:'
  );
  app = app.replace(
    '      setActiveVision(visionResult);\n',
    '      visionResult = { ...visionResult, visionWidth: frame.visionWidth, visionHeight: frame.visionHeight, sourceWidth: frame.sourceWidth, sourceHeight: frame.sourceHeight, coordinateSpace: "vision", coordMap: frame.coordMap, coordMapString: frame.coordMapString };\n      setActiveVision(visionResult);\n'
  );
  log('preserved screenshot coordinate metadata through vision analysis');
}
write('src/App.tsx', app);

log('complete');
