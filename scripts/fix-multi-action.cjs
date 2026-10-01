const fs = require("fs");
const path = require("path");

const serverFile = path.join(process.cwd(), "server.ts");
if (!fs.existsSync(serverFile)) process.exit(0);

let text = fs.readFileSync(serverFile, "utf8");
const marker = 'function normalizeDesktopIntent(message: string, parsed: any, visionContext: any = null) {\n';
if (!text.includes(marker)) throw new Error("[multi-action] Could not find normalizeDesktopIntent in server.ts");

const startMarker = '  // Multi-action voice commands: split the spoken request into an ordered execution plan.\n';
if (!text.includes(startMarker)) {
  // Use a normal quoted JS string rather than a template literal so the
  // generated script cannot accidentally interpret ${...} inside the code
  // block as fix-multi-action.cjs variables.
  const block = [
    '  // Multi-action voice commands: split the spoken request into an ordered execution plan.',
    '  // Keep text after a typing verb intact so phrases such as "cats and dogs" are not split.',
    '  const multiAction = message.trim().replace(/[.!?]+$/g, "").match(/^(?:please\\s+)?(?:open|launch|start|run)\\s+(notepad|calculator|paint|explorer|files|terminal|task manager|taskmgr|chrome|edge|brave|firefox|browser)(?:\\s+and\\s+then|\\s+then|\\s+and)\\s+(?:type|enter|write)\\s+(.+)$/i);',
    '  if (multiAction) {',
    '    const rawApp = multiAction[1].toLowerCase().replace(/\\s+/g, " ");',
    '    const appMap: Record<string, string> = { "notepad": "notepad", "calculator": "calculator", "paint": "paint", "explorer": "explorer", "files": "explorer", "terminal": "terminal", "task manager": "taskmgr", "taskmgr": "taskmgr", "chrome": "chrome", "edge": "edge", "brave": "brave", "firefox": "firefox", "browser": "browser" };',
    '    const app = appMap[rawApp];',
    '    const typedText = multiAction[2].replace(/\\s+(?:and\\s+)?(?:press|hit)\\s+enter\\s*$/i, "").trim();',
    '    if (app && typedText) {',
    '      const intro = "Opening " + app + " and typing " + typedText + ".";',
    '      return { ...parsed, spokenResponse: intro, spokenReply: intro, action: { type: "MULTI_STEP_PLAN", description: "Open " + app + " and type " + typedText, multiStepPlan: { planTitle: "Open " + app + " and type text", spokenIntro: "I will open " + app + ", focus it, and type your text.", steps: [ { stepNumber: 1, description: "Open " + app, actionType: "LAUNCH_APP", params: { app }, status: "pending", estimatedDurationMs: 1200 }, { stepNumber: 2, description: "Type " + typedText, actionType: "TYPE_INPUT", params: { text: typedText }, status: "pending", estimatedDurationMs: 500 } ], spokenCompletion: "Done. I opened " + app + " and typed your text.", currentStepIndex: 0, status: "idle" } } };',
    '    }',
    '  }',
    '',
    ''
  ].join("\\n");
  text = text.replace(marker, marker + block);
}

fs.writeFileSync(serverFile, text, "utf8");
console.log("[multi-action] Installed ordered voice command plans for open-and-type commands.");
