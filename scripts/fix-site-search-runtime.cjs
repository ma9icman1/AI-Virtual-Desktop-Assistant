const fs = require("fs");
const path = require("path");

const root = process.cwd();
const serverFile = path.join(root, "server.ts");
const appFile = path.join(root, "src", "App.tsx");

// The site-search plans historically used "~" for Enter. That reaches the
// native key handler as a literal tilde, so normalize every generated plan to
// the real Enter key.
if (fs.existsSync(serverFile)) {
  let server = fs.readFileSync(serverFile, "utf8");
  const before = server;
  server = server.replace(/params:\s*\{\s*key:\s*["']~["']\s*\}/g, 'params: { key: "ENTER" }');
  server = server.replace(/key:\s*["']~["']/g, 'key: "ENTER"');
  if (server !== before) {
    fs.writeFileSync(serverFile, server, "utf8");
    console.log("[site-search-runtime] normalized site-search Enter key");
  } else {
    console.log("[site-search-runtime] Enter key already normalized");
  }
}

// Strengthen the live-screen vision click resolver. It must prefer a real,
// visible search control and reject the common bad model result near (0,0).
if (fs.existsSync(appFile)) {
  let app = fs.readFileSync(appFile, "utf8");
  const oldPrompt = 'Identify the exact visible clickable input/control matching this target. Return detectedElements with label, type, boundingBox, and center coordinates in screenshot pixels. Prefer the search box/search bar when the target mentions search. Do not guess coordinates.';
  const newPrompt = 'Identify the exact visible clickable control matching the target in the CURRENT SCREENSHOT. Return detectedElements with label, type, boundingBox, and center coordinates in the ACTUAL SCREENSHOT PIXEL COORDINATE SYSTEM. If the target is a search bar, return only the site/page search input, not the browser toolbar, logo, menu, or arbitrary text. Do not return normalized 0-1 or 0-1000 coordinates. Do not guess. Never use a point near the top-left corner such as (0,0) unless the target is visibly there.';
  if (app.includes(oldPrompt)) {
    app = app.replace(oldPrompt, newPrompt);
    console.log("[site-search-runtime] strengthened vision prompt");
  }

  // Add a retry when the model returns a suspicious top-left point for a search
  // target. A second focused vision pass is much safer than clicking a random
  // coordinate and then typing into the wrong control.
  const pointMarker = '      const point = target?.center || (target?.boundingBox';
  const retryMarker = '      const point = target?.center || (target?.boundingBox';
  if (app.includes(pointMarker) && !app.includes('[VISION CLICK TARGET] retry')) {
    const retry = `      let resolvedTarget = target;\n      let resolvedPoint = target?.center || (target?.boundingBox\n        ? {\n            x: target.boundingBox.x + target.boundingBox.width / 2,\n            y: target.boundingBox.y + target.boundingBox.height / 2,\n          }\n        : null);\n\n      if (targetWords.includes("search") && (!resolvedPoint || Number(resolvedPoint.x) < 50 || Number(resolvedPoint.y) < 50)) {\n        console.log("[VISION CLICK TARGET] retry", { reason: "suspicious top-left search coordinate", resolvedPoint });\n        const retryResponse = await fetch("/api/vision/analyze", {\n          method: "POST",\n          headers: { "Content-Type": "application/json" },\n          body: JSON.stringify({\n            imageBase64: imageData,\n            prompt: "Find the SEARCH BAR/SEARCH INPUT belonging to the current website page in this screenshot. Ignore browser chrome, address bar, tabs, logos, menus, and decorative text. Return exactly one detectedElements item for the visible page search input with its center in actual screenshot pixels. Do not use normalized coordinates and do not guess. The search input will be a visible rectangular text field where a user can type a query."\n          })\n        });\n        if (retryResponse.ok) {\n          const retryVision = await retryResponse.json();\n          const retryElements = Array.isArray(retryVision?.detectedElements)\n            ? retryVision.detectedElements\n            : (Array.isArray(retryVision?.elements) ? retryVision.elements : []);\n          const retryTarget = retryElements.find((element: any) => {\n            const label = String(element?.label || "").toLowerCase();\n            const type = String(element?.type || "").toLowerCase();\n            return /search|query|find/.test(label + " " + type);\n          }) || retryElements.find((element: any) => element?.center || element?.boundingBox);\n          const retryPoint = retryTarget?.center || (retryTarget?.boundingBox\n            ? {\n                x: retryTarget.boundingBox.x + retryTarget.boundingBox.width / 2,\n                y: retryTarget.boundingBox.y + retryTarget.boundingBox.height / 2,\n              }\n            : null);\n          if (retryPoint && Number(retryPoint.x) >= 50 && Number(retryPoint.y) >= 50) {\n            resolvedTarget = retryTarget;\n            resolvedPoint = retryPoint;\n          }\n        }\n      }\n\n`;
    // Replace the original point declaration with the safer resolvedTarget/
    // resolvedPoint declarations. The following target/point references are
    // then redirected to the resolved values.
    app = app.replace(pointMarker, retry + '      const point = resolvedPoint;');
    app = app.replace('      console.log("[VISION CLICK TARGET] matched", { label: target?.label, type: target?.type, point });', '      console.log("[VISION CLICK TARGET] matched", { label: resolvedTarget?.label, type: resolvedTarget?.type, point });');
    console.log("[site-search-runtime] added suspicious-coordinate vision retry");
  }

  fs.writeFileSync(appFile, app, "utf8");
}

console.log("[site-search-runtime] complete");
