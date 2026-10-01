const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
const appFile = path.join(process.cwd(), "src", "App.tsx");
if (!fs.existsSync(serverFile)) process.exit(0);

let text = fs.readFileSync(serverFile, "utf8");
const marker = "  const requestedApp = appAliases.find(([pattern]) => pattern.test(request))?.[1];";
const signature = "// Multi-action open-and-type support";
const secondSignature = "// Multi-action type-in-app support";
const visionClickSignature = "// Vision-assisted click fallback";

if (!text.includes(marker)) throw new Error("[multi-action] Could not find requestedApp insertion point in server.ts");

if (!text.includes(signature)) {
  const block = [
    "  // Multi-action open-and-type support",
    "  const openAndTypeMatch = commandText.match(/^(?:please\s+)?(?:open|launch|start|run)\s+(notepad|calculator|paint|explorer|files|terminal|task manager|taskmgr|chrome|edge|brave|firefox)(?:\s+and\s+then|\s+then|\s+and)\s+(?:type|enter|write)\s+(.+)$/i);",
    "  if (openAndTypeMatch) {",
    "    const openTypeApps: Record<string, string> = { notepad: \"notepad\", calculator: \"calculator\", paint: \"paint\", explorer: \"explorer\", files: \"explorer\", terminal: \"terminal\", \"task manager\": \"taskmgr\", taskmgr: \"taskmgr\", chrome: \"chrome\", edge: \"edge\", brave: \"brave\", firefox: \"firefox\" };",
    "    const openTypeApp = openTypeApps[openAndTypeMatch[1].toLowerCase()];",
    "    const openTypeText = openAndTypeMatch[2].replace(/\s+(?:and\s+)?(?:press|hit)\s+enter\s*$/i, \"\").trim();",
    "    if (openTypeApp && openTypeText) {",
    "      return { ...parsed, spokenResponse: \"Opening \" + openTypeApp + \" and typing your text.\", spokenReply: \"Opening \" + openTypeApp + \" and typing your text.\", action: { type: \"MULTI_STEP_PLAN\", description: \"Open \" + openTypeApp + \" and type text\", multiStepPlan: { planTitle: \"Open and type\", spokenIntro: \"I will open \" + openTypeApp + \", focus it, and type your text.\", steps: [ { stepNumber: 1, description: \"Open \" + openTypeApp, actionType: \"LAUNCH_APP\", params: { app: openTypeApp }, status: \"pending\", estimatedDurationMs: 1200 }, { stepNumber: 2, description: \"Type the requested text\", actionType: \"TYPE_INPUT\", params: { text: openTypeText }, status: \"pending\", estimatedDurationMs: 500 } ], spokenCompletion: \"Done.\", currentStepIndex: 0, status: \"idle\" } } };",
    "    }",
    "  }",
    "",
  ].join("\n");
  text = text.replace(marker, marker + "\n" + block);
}

if (!text.includes(secondSignature)) {
  const secondBlock = [
    "  // Multi-action type-in-app support",
    "  // Handles a follow-up command such as: \"Type Fart in Notepad\".",
    "  // Focus the target app before TYPE_INPUT so a second voice command cannot type into the wrong window.",
    "  const typeInAppMatch = commandText.match(/^(?:please\s+)?(?:type|enter|write)\s+(.+?)\s+(?:in|into|inside)\s+(notepad|calculator|paint|explorer|files|terminal|task manager|taskmgr|chrome|edge|brave|firefox)\s*$/i);",
    "  if (typeInAppMatch) {",
    "    const typeInAppAliases: Record<string, string> = { notepad: \"notepad\", calculator: \"calculator\", paint: \"paint\", explorer: \"explorer\", files: \"explorer\", terminal: \"terminal\", \"task manager\": \"taskmgr\", taskmgr: \"taskmgr\", chrome: \"chrome\", edge: \"edge\", brave: \"brave\", firefox: \"firefox\" };",
    "    const typeInApp = typeInAppAliases[typeInAppMatch[2].toLowerCase()];",
    "    const typeInAppText = typeInAppMatch[1].replace(/\s+(?:and\s+)?(?:press|hit)\s+enter\s*$/i, \"\").trim();",
    "    if (typeInApp && typeInAppText) {",
    "      return { ...parsed, spokenResponse: \"Typing in \" + typeInApp + \".\", spokenReply: \"Typing in \" + typeInApp + \".\", action: { type: \"MULTI_STEP_PLAN\", description: \"Focus \" + typeInApp + \" and type text\", multiStepPlan: { planTitle: \"Type in app\", spokenIntro: \"I will focus \" + typeInApp + \" and type your text.\", steps: [ { stepNumber: 1, description: \"Focus \" + typeInApp, actionType: \"FOCUS_APP\", params: { app: typeInApp }, status: \"pending\", estimatedDurationMs: 400 }, { stepNumber: 2, description: \"Type the requested text\", actionType: \"TYPE_INPUT\", params: { text: typeInAppText }, status: \"pending\", estimatedDurationMs: 500 } ], spokenCompletion: \"Done.\", currentStepIndex: 0, status: \"idle\" } } };",
    "    }",
    "  }",
    "",
  ].join("\n");
  const insertionPoint = "  const asksToOpen = /\b(open|launch|start|load|run)\b/.test(request);";
  if (!text.includes(insertionPoint)) throw new Error("[multi-action] Could not find type-in-app insertion point in server.ts");
  text = text.replace(insertionPoint, secondBlock + insertionPoint);
}

if (!text.includes(visionClickSignature)) {
  const visionBlock = [
    "  // Vision-assisted click fallback",
    "  const visionClickMatch = commandText.match(/^(?:please\s+)?(?:click|press|select|tap|open)\s+(?:on\s+)?(?:the\s+)?(.+?)\s*$/i);",
    "  if (visionClickMatch && !targetPoint && !coordinateClickMatch) {",
    "    const targetLabel = visionClickMatch[1].trim().replace(/^(?:the|a|an)\s+/i, \"\");",
    "    if (targetLabel && !/\b(?:and\s+)?(?:type|enter|write|search)\b/i.test(targetLabel)) {",
    "      return { ...parsed, spokenResponse: `I will look at the screen and click ${targetLabel}.`, spokenReply: `I will look at the screen and click ${targetLabel}.`, action: { type: \"MULTI_STEP_PLAN\", description: `Find ${targetLabel} on the screen and click it`, multiStepPlan: { planTitle: `Click ${targetLabel}`, spokenIntro: `I will inspect the screen, find ${targetLabel}, and click it.`, steps: [ { stepNumber: 1, description: `Find ${targetLabel} on the live screen`, actionType: \"CLICK_BUTTON\", params: { targetLabel, visionResolve: true }, status: \"pending\", estimatedDurationMs: 1800 } ], spokenCompletion: `${targetLabel} was clicked.`, currentStepIndex: 0, status: \"idle\" } } };",
    "    }",
    "  }",
    "",
  ].join("\n");
  const clickInsertion = "  if (coordinateClickMatch) {";
  if (!text.includes(clickInsertion)) throw new Error("[multi-action] Could not find coordinate-click insertion point in server.ts");
  text = text.replace(clickInsertion, visionBlock + clickInsertion);
}

fs.writeFileSync(serverFile, text, "utf8");

if (fs.existsSync(appFile)) {
  let appText = fs.readFileSync(appFile, "utf8");
  const appSignature = "// Vision-assisted screen click resolution";
  const clickMapping = '      CLICK_BUTTON: { action: "CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },';
  const clickMappingReplacement = '      CLICK_BUTTON: { action: "CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace, targetLabel: params.targetLabel } },';
  if (!appText.includes(appSignature)) {
    if (appText.includes(clickMapping)) appText = appText.replace(clickMapping, clickMappingReplacement);
    const validationNeedle = '      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {\n        throw new Error(`This action needs screen coordinates. Ask ${assistantName} to inspect the screen first, then try again.`);\n      }';
    const validationReplacement = `      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
        if (normalizedType === "CLICK_BUTTON" && params.targetLabel) {
          const targetLabel = String(params.targetLabel).trim();
          console.log("[VISION CLICK] resolving target:", targetLabel);
          const imageData = await VisionService.captureScreen();
          const visionResponse = await fetch("/api/vision/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageData, instruction: \`Find the visible UI control matching "\${targetLabel}". Return exact screenshot-pixel coordinates. Prioritize buttons, links, tabs, menus, and text controls.\` }),
          });
          if (!visionResponse.ok) throw new Error("Screen vision analysis failed while locating the requested control.");
          const vision = await visionResponse.json();
          const elements = Array.isArray(vision?.detectedElements) ? vision.detectedElements : [];
          const wanted = targetLabel.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          const wantedTokens = wanted.split(/\s+/).filter(Boolean);
          const scored = elements.map((element: any) => {
            const label = String(element?.label || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
            if (!label) return { element, score: 0 };
            const labelTokens = new Set(label.split(/\s+/).filter(Boolean));
            const overlap = wantedTokens.filter((token) => labelTokens.has(token)).length;
            let score = wantedTokens.length ? overlap / wantedTokens.length : 0;
            if (label === wanted) score += 1;
            if (label.includes(wanted) || wanted.includes(label)) score += 0.5;
            if (["button", "link", "tab", "menu", "input"].includes(String(element?.type || "").toLowerCase())) score += 0.15;
            return { element, score };
          }).sort((a: any, b: any) => b.score - a.score);
          const best = scored[0]?.element;
          const bestPoint = best?.center || (best?.boundingBox ? { x: best.boundingBox.x + best.boundingBox.width / 2, y: best.boundingBox.y + best.boundingBox.height / 2 } : null);
          if (!bestPoint || !Number.isFinite(Number(bestPoint.x)) || !Number.isFinite(Number(bestPoint.y)) || (scored[0]?.score || 0) < 0.5) throw new Error(\`I could not confidently find "\${targetLabel}" on the current screen.\`);
          mapped.params.x = Number(bestPoint.x);
          mapped.params.y = Number(bestPoint.y);
          mapped.params.coordinateSpace = "vision";
          console.log("[VISION CLICK] target=", targetLabel, "label=", best?.label, "x=", mapped.params.x, "y=", mapped.params.y);
        } else {
          throw new Error(\`This action needs screen coordinates. Ask \${assistantName} to inspect the screen first, then try again.\`);
        }
      }`;
    if (!appText.includes(validationNeedle)) throw new Error("[multi-action] Could not find CLICK_BUTTON coordinate validation in src/App.tsx");
    appText = appText.replace(validationNeedle, validationReplacement);
    appText = appText.replace('    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {', '    // Vision-assisted screen click resolution\n    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {');
    fs.writeFileSync(appFile, appText, "utf8");
    console.log("[multi-action] Vision-assisted screen clicking installed.");
  }
}

console.log("[multi-action] Open-and-type, follow-up typing, and vision-assisted clicking installed.");
