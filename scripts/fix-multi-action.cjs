const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
if (!fs.existsSync(serverFile)) process.exit(0);

let text = fs.readFileSync(serverFile, "utf8");

const insertMarker = '  if (fileMatch && parsed?.action?.type !== "OPEN_FILE") {';
const alreadyInstalled = text.includes("// Multi-action voice commands: split open-and-type requests into an ordered plan.");

if (alreadyInstalled) {
  console.log("[multi-action] Ordered voice command plans already present; skipped.");
  process.exit(0);
}

if (!text.includes(insertMarker)) {
  throw new Error("[multi-action] Could not find desktop intent insertion point in server.ts");
}

const block = [
  "  // Multi-action voice commands: split open-and-type requests into an ordered plan.",
  "  // Keep everything after the typing verb intact, including phrases containing 'and'.",
  "  const multiAction = message.trim().replace(/[.!?]+$/g, \"\").match(/^(?:please\\s+)?(?:open|launch|start|run)\\s+(notepad|calculator|paint|explorer|files|terminal|task manager|taskmgr|chrome|edge|brave|firefox|browser)(?:\\s+and\\s+then|\\s+then|\\s+and)\\s+(?:type|enter|write)\\s+(.+)$/i);",
  "  if (multiAction) {",
  "    const rawApp = multiAction[1].toLowerCase().replace(/\\s+/g, \" \");",
  "    const appMap: Record<string, string> = { notepad: \"notepad\", calculator: \"calculator\", paint: \"paint\", explorer: \"explorer\", files: \"explorer\", terminal: \"terminal\", \"task manager\": \"taskmgr\", taskmgr: \"taskmgr\", chrome: \"chrome\", edge: \"edge\", brave: \"brave\", firefox: \"firefox\", browser: \"browser\" };",
  "    const app = appMap[rawApp];",
  "    const typedText = multiAction[2].replace(/\\s+(?:and\\s+)?(?:press|hit)\\s+enter\\s*$/i, \"\").trim();",
  "    if (app && typedText) {",
  "      return {",
  "        ...parsed,",
  "        spokenResponse: \"Opening \" + app + \" and typing \" + typedText + \".\",",
  "        spokenReply: \"Opening \" + app + \" and typing \" + typedText + \".\",",
  "        action: {",
  "          type: \"MULTI_STEP_PLAN\",",
  "          description: \"Open \" + app + \" and type \" + typedText,",
  "          multiStepPlan: {",
  "            planTitle: \"Open \" + app + \" and type text\",",
  "            spokenIntro: \"I will open \" + app + \", focus it, and type your text.\",",
  "            steps: [",
  "              { stepNumber: 1, description: \"Open \" + app, actionType: \"LAUNCH_APP\", params: { app }, status: \"pending\", estimatedDurationMs: 1200 },",
  "              { stepNumber: 2, description: \"Type \" + typedText, actionType: \"TYPE_INPUT\", params: { text: typedText }, status: \"pending\", estimatedDurationMs: 500 },",
  "            ],",
  "            spokenCompletion: \"Done. I opened \" + app + \" and typed your text.\",",
  "            currentStepIndex: 0,",
  "            status: \"idle\",",
  "          },",
  "        },",
  "      };",
  "    }",
  "  }",
  "",
].join("\n");

text = text.replace(insertMarker, block + insertMarker);
fs.writeFileSync(serverFile, text, "utf8");
console.log("[multi-action] Installed ordered voice command plans for open-and-type commands.");
