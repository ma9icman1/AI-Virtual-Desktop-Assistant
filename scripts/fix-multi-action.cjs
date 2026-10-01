const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
if (!fs.existsSync(serverFile)) process.exit(0);

let text = fs.readFileSync(serverFile, "utf8");
const marker = "  const requestedApp = appAliases.find(([pattern]) => pattern.test(request))?.[1];";
const signature = "// Multi-action open-and-type support";
const secondSignature = "// Multi-action type-in-app support";

if (!text.includes(marker)) {
  throw new Error("[multi-action] Could not find requestedApp insertion point in server.ts");
}

if (!text.includes(signature)) {
  const block = [
    "  // Multi-action open-and-type support",
    "  const openAndTypeMatch = commandText.match(/^(?:please\\s+)?(?:open|launch|start|run)\\s+(notepad|calculator|paint|explorer|files|terminal|task manager|taskmgr|chrome|edge|brave|firefox)(?:\\s+and\\s+then|\\s+then|\\s+and)\\s+(?:type|enter|write)\\s+(.+)$/i);",
    "  if (openAndTypeMatch) {",
    "    const openTypeApps: Record<string, string> = { notepad: \"notepad\", calculator: \"calculator\", paint: \"paint\", explorer: \"explorer\", files: \"explorer\", terminal: \"terminal\", \"task manager\": \"taskmgr\", taskmgr: \"taskmgr\", chrome: \"chrome\", edge: \"edge\", brave: \"brave\", firefox: \"firefox\" };",
    "    const openTypeApp = openTypeApps[openAndTypeMatch[1].toLowerCase()];",
    "    const openTypeText = openAndTypeMatch[2].replace(/\\s+(?:and\\s+)?(?:press|hit)\\s+enter\\s*$/i, \"\").trim();",
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
    "  const typeInAppMatch = commandText.match(/^(?:please\\s+)?(?:type|enter|write)\\s+(.+?)\\s+(?:in|into|inside)\\s+(notepad|calculator|paint|explorer|files|terminal|task manager|taskmgr|chrome|edge|brave|firefox)\\s*$/i);",
    "  if (typeInAppMatch) {",
    "    const typeInAppAliases: Record<string, string> = { notepad: \"notepad\", calculator: \"calculator\", paint: \"paint\", explorer: \"explorer\", files: \"explorer\", terminal: \"terminal\", \"task manager\": \"taskmgr\", taskmgr: \"taskmgr\", chrome: \"chrome\", edge: \"edge\", brave: \"brave\", firefox: \"firefox\" };",
    "    const typeInApp = typeInAppAliases[typeInAppMatch[2].toLowerCase()];",
    "    const typeInAppText = typeInAppMatch[1].replace(/\\s+(?:and\\s+)?(?:press|hit)\\s+enter\\s*$/i, \"\").trim();",
    "    if (typeInApp && typeInAppText) {",
    "      return { ...parsed, spokenResponse: \"Typing in \" + typeInApp + \".\", spokenReply: \"Typing in \" + typeInApp + \".\", action: { type: \"MULTI_STEP_PLAN\", description: \"Focus \" + typeInApp + \" and type text\", multiStepPlan: { planTitle: \"Type in app\", spokenIntro: \"I will focus \" + typeInApp + \" and type your text.\", steps: [ { stepNumber: 1, description: \"Focus \" + typeInApp, actionType: \"FOCUS_APP\", params: { app: typeInApp }, status: \"pending\", estimatedDurationMs: 400 }, { stepNumber: 2, description: \"Type the requested text\", actionType: \"TYPE_INPUT\", params: { text: typeInAppText }, status: \"pending\", estimatedDurationMs: 500 } ], spokenCompletion: \"Done.\", currentStepIndex: 0, status: \"idle\" } } };",
    "    }",
    "  }",
    "",
  ].join("\n");
  const insertionPoint = "  const asksToOpen = /\\b(open|launch|start|load|run)\\b/.test(request);";
  if (!text.includes(insertionPoint)) {
    throw new Error("[multi-action] Could not find type-in-app insertion point in server.ts");
  }
  text = text.replace(insertionPoint, secondBlock + insertionPoint);
}

fs.writeFileSync(serverFile, text, "utf8");
console.log("[multi-action] Open-and-type and follow-up type-in-app support installed.");
