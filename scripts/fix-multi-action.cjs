const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
const appFile = path.join(process.cwd(), "src", "App.tsx");

if (!fs.existsSync(serverFile)) process.exit(0);

const serverText = fs.readFileSync(serverFile, "utf8");
const hasOpenAndType = serverText.includes("// Multi-action open-and-type support");
const hasTypeInApp = serverText.includes("// Multi-action type-in-app support");

// These handlers are already part of the current server implementation. The old
// repair script tried to patch App.tsx as a side effect and could fail whenever
// another build repair had already reformatted that validation block. Keep this
// step idempotent: verify the server handlers and let the dedicated vision patch
// handle vision-click changes separately.
if (!hasOpenAndType || !hasTypeInApp) {
  console.warn("[multi-action] Existing multi-action handlers are incomplete; leaving server.ts unchanged so the build can continue safely.");
} else {
  console.log("[multi-action] Open-and-type and follow-up type-in-app support already present; skipped.");
}

if (fs.existsSync(appFile)) {
  const appText = fs.readFileSync(appFile, "utf8");
  const hasVisionClickPatch = appText.includes("// Vision-assisted screen click resolution");
  const hasTargetLabel = appText.includes("targetLabel: params.targetLabel");
  if (hasVisionClickPatch && hasTargetLabel) {
    console.log("[multi-action] Vision click resolver already present; skipped.");
  } else {
    console.log("[multi-action] Vision click resolver is handled by fix-vision-click-v2.cjs; skipped here.");
  }
}
