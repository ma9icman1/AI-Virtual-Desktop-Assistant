const fs = require("fs");
const path = require("path");

const appFile = path.join(process.cwd(), "src", "App.tsx");
if (!fs.existsSync(appFile)) process.exit(0);

let text = fs.readFileSync(appFile, "utf8");

// The first vision-click patch sent the wrong field names to /api/vision/analyze.
// VisionService uses { imageBase64, prompt }; keep the click resolver consistent.
text = text.replace(
  'body: JSON.stringify({ imageData, instruction:',
  'body: JSON.stringify({ imageBase64: imageData, prompt:'
);

// Accept the common alternate response property too, without changing the public VisionDetection type.
text = text.replace(
  'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : [];',
  'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);'
);

// Add explicit diagnostics so failures tell us whether capture, vision, matching, or clicking failed.
if (!text.includes('[VISION CLICK] screenshot captured')) {
  text = text.replace(
    'const imageData = await VisionService.captureScreen();',
    'const imageData = await VisionService.captureScreen();\n          console.log("[VISION CLICK] screenshot captured", { bytes: imageData?.length || 0 });'
  );
}

if (!text.includes('[VISION CLICK] vision elements')) {
  text = text.replace(
    'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);',
    'const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : (Array.isArray(vision?.elements) ? vision.elements : []);\n          console.log("[VISION CLICK] vision elements", elements.length, elements.map((e: any) => ({ label: e?.label, type: e?.type, center: e?.center, boundingBox: e?.boundingBox })));'
  );
}

fs.writeFileSync(appFile, text, "utf8");
console.log("[vision-click-v2] Fixed vision request payload and added diagnostics.");
