const fs = require("fs");
const path = require("path");

const root = process.cwd();
const mainPath = path.join(root, "electron", "main.cjs");
const appPath = path.join(root, "src", "App.tsx");
const serverPath = path.join(root, "server.ts");

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
  return fs.readFileSync(file, "utf8");
}
function write(file, text) { fs.writeFileSync(file, text, "utf8"); }
function once(text, marker, replacement, label) {
  if (!text.includes(marker)) throw new Error(`Patch marker missing for ${label}`);
  if (text.includes(replacement)) return text;
  return text.replace(marker, replacement);
}

let main = read(mainPath);
const helperMarker = 'async function executeDesktopAction(action, params = {}) {';
const helper = String.raw`
async function captureDesktopRegion(params = {}) {
  const display = screen.getPrimaryDisplay();
  const visionSize = getVisionCanvasSize(display, AI_SCREEN_WIDTH);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: display.size.width, height: display.size.height },
    fetchWindowIcons: false,
  });
  const source = sources.find((candidate) => candidate.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error("Windows did not return a desktop screenshot.");
  const full = source.thumbnail.resize({ width: visionSize.width, height: visionSize.height, quality: "good" });
  const requested = params.region || params;
  const x = Math.max(0, Math.round(Number(requested.x) || 0));
  const y = Math.max(0, Math.round(Number(requested.y) || 0));
  const width = Math.max(1, Math.round(Number(requested.width) || visionSize.width));
  const height = Math.max(1, Math.round(Number(requested.height) || visionSize.height));
  const right = Math.min(visionSize.width, x + width);
  const bottom = Math.min(visionSize.height, y + height);
  if (right <= x || bottom <= y) throw new Error("The requested screenshot region is outside the desktop.");
  const cropped = full.crop({ x, y, width: right - x, height: bottom - y });
  const fullMap = createCoordinateMap(display, screen, visionSize.width, visionSize.height);
  const cropWidth = right - x;
  const cropHeight = bottom - y;
  const coordMap = {
    version: 1,
    coordinateSpace: "vision",
    captureX: Math.round(fullMap.captureX + (x / visionSize.width) * fullMap.captureWidth),
    captureY: Math.round(fullMap.captureY + (y / visionSize.height) * fullMap.captureHeight),
    captureWidth: Math.max(1, Math.round((cropWidth / visionSize.width) * fullMap.captureWidth)),
    captureHeight: Math.max(1, Math.round((cropHeight / visionSize.height) * fullMap.captureHeight)),
    imageWidth: cropWidth,
    imageHeight: cropHeight,
  };
  return {
    image: "data:image/jpeg;base64," + cropped.toJPEG(70).toString("base64"),
    visionWidth: cropWidth,
    visionHeight: cropHeight,
    sourceWidth: display.size.width,
    sourceHeight: display.size.height,
    sourceScaleFactor: Number(display.scaleFactor) || 1,
    coordinateSpace: "vision",
    coordMap,
    coordMapString: formatCoordinateMap(coordMap),
    region: { x, y, width: cropWidth, height: cropHeight },
  };
}

`;
if (!main.includes("async function captureDesktopRegion(")) main = main.replace(helperMarker, helper + helperMarker);

const actionMarker = '  const supportedInputActions = new Set([';
const actionBlock = String.raw`  if (action === "CAPTURE_REGION" || action === "SCREENSHOT_REGION" || action === "ZOOM") {
    return await captureDesktopRegion(params);
  }

`;
if (!main.includes('action === "CAPTURE_REGION"')) main = main.replace(actionMarker, actionBlock + actionMarker);
write(mainPath, main);

let app = read(appPath);
const mapMarker = '      WAIT: { action: "WAIT", params: { ms: params.ms || params.estimatedDurationMs || 500 } },';
const mapReplacement = mapMarker + String.raw`
      SCREENSHOT_REGION: { action: "CAPTURE_REGION", params: { region: params.region || { x: params.x, y: params.y, width: params.width, height: params.height } } },
      ZOOM_SCREEN: { action: "CAPTURE_REGION", params: { region: params.region || { x: params.x, y: params.y, width: params.width, height: params.height } } },`;
if (!app.includes("SCREENSHOT_REGION:")) app = once(app, mapMarker, mapReplacement, "App desktop action map");

const execMarker = '    if (normalizedType === "VISION_CLICK_TARGET") {';
const zoomBlock = String.raw`    if (normalizedType === "SCREENSHOT_REGION" || normalizedType === "ZOOM_SCREEN") {
      const regionResult = await (window as any).magicDesktop.execute("CAPTURE_REGION", {
        region: params.region || { x: params.x, y: params.y, width: params.width, height: params.height },
      });
      if (!regionResult?.image) throw new Error("Desktop region capture returned no image.");
      const response = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: regionResult.image,
          sourceWidth: regionResult.sourceWidth,
          sourceHeight: regionResult.sourceHeight,
          visionWidth: regionResult.visionWidth,
          visionHeight: regionResult.visionHeight,
          coordinateSpace: "vision",
          coordMap: regionResult.coordMap,
          coordMapString: regionResult.coordMapString,
          prompt: params.prompt || "Analyze this zoomed desktop region in detail. Prioritize readable text, buttons, inputs, menus, tabs, and other actionable controls. Return exact pixel coordinates for the cropped screenshot.",
        }),
      });
      if (!response.ok) throw new Error("Vision analysis failed for the zoomed desktop region.");
      const vision = await response.json();
      setActiveVision(vision);
      setVisionThumbnail(regionResult.image);
      return { ok: true, ...regionResult, vision };
    }

`;
if (!app.includes('normalizedType === "SCREENSHOT_REGION"')) app = once(app, execMarker, zoomBlock + execMarker, "App zoom execution");
write(appPath, app);

let server = read(serverPath);
const promptMarker = '- "SCREEN_ANALYSIS": {},';
const promptReplacement = promptMarker + `
- "SCREENSHOT_REGION": { "region": { "x": number, "y": number, "width": number, "height": number }, "prompt"?: string }
- "ZOOM_SCREEN": { "region": { "x": number, "y": number, "width": number, "height": number }, "prompt"?: string }`;
if (!server.includes('SCREENSHOT_REGION":')) server = once(server, promptMarker, promptReplacement, "Server action schema");
const stepMarker = '"FETCH_WEB_CONTENT" | "VERIFY_STATE",';
const stepReplacement = '"FETCH_WEB_CONTENT" | "VERIFY_STATE" | "SCREENSHOT_REGION" | "ZOOM_SCREEN",';
if (!server.includes(stepReplacement)) server = once(server, stepMarker, stepReplacement, "Server plan action types");
write(serverPath, server);

console.log("[computer-agent-upgrade] applied");
