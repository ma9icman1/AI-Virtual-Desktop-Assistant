import express from "express";
import path from "path";
import { Readable } from "stream";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

import fs from "fs";

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  next();
});const APP_ROOT = process.env.MAGIC_APP_ROOT || process.cwd();
const PORT = Number(process.env.PORT || 3000);
const DRIVE_MODEL_URL =
  "https://drive.usercontent.google.com/download?id=1vcrb7KBpUkOlfpXYcE30FzVxpTaNvEp2&export=download&confirm=t";

// AI Engine Configuration State
let OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
let activeProvider: "ollama" | "gemini" = (process.env.AI_PROVIDER as any) || "ollama";
const DEFAULT_OLLAMA_MODEL = "minicpm-magic-assistant:latest";
const DEFAULT_OLLAMA_VISION_MODEL = "minicpm-v:latest";
let activeOllamaModel = process.env.OLLAMA_CHAT_MODEL || DEFAULT_OLLAMA_MODEL;
let activeOllamaVisionModel = process.env.OLLAMA_VISION_MODEL || DEFAULT_OLLAMA_VISION_MODEL;
let activeGeminiModel = process.env.GEMINI_MODEL || "gemini-flash-latest";

function describeOllamaError(error: any): string {
  const message = String(error?.message || error || "Unknown Ollama error");
  if (/ECONNREFUSED|fetch failed|127\.0\.0\.1:11434/i.test(message)) {
    return "Ollama is not reachable at http://127.0.0.1:11434. Start Ollama, then try again.";
  }
  if (/404|not found|model .* not found/i.test(message)) {
    return `The Ollama model is not installed. Run: ollama pull ${activeOllamaModel}`;
  }
  if (/timeout|timed out|abort/i.test(message)) {
    return `The Ollama model took too long to respond (${activeOllamaModel}). Try again after the model is loaded.`;
  }
  return `Ollama failed with ${activeOllamaModel}: ${message}`;
}

function normalizeDesktopIntent(message: string, parsed: any, visionContext: any = null) {
  const request = message.toLowerCase();
  const appAliases: Array<[RegExp, string]> = [
    [/\b(browser|web browser|internet browser)\b/, "browser"],
    [/\b(brave|brave browser)\b/, "brave"],
    [/\b(edge|microsoft edge)\b/, "edge"],
    [/\b(chrome|google chrome)\b/, "chrome"],
    [/\b(notepad)\b/, "notepad"],
    [/\b(calculator|calc)\b/, "calculator"],
    [/\b(paint|mspaint)\b/, "paint"],
    [/\b(file explorer|explorer|files)\b/, "explorer"],
    [/\b(task manager|taskmgr)\b/, "taskmgr"],
    [/\b(power ?shell|terminal)\b/, "terminal"],
    [/\b(firefox|mozilla firefox)\b/, "firefox"],
    [/\b(opera|vivaldi)\b/, "browser"],
  ];
  const requestedApp = appAliases.find(([pattern]) => pattern.test(request))?.[1];
  const asksToOpen = /\b(open|launch|start|load|run)\b/.test(request);
  const websiteUrlMatch = message.match(
    /\b(?:open|go\s+to|navigate\s+to|visit|load|browse\s+to|goto)\s*(https?:\/\/)?((?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s]*)?)(?:\s+in|\s+using|\s+with)?\s*$/i
  );
  const browserUrlMatch = message.match(
    /\b(?:open|go\s+to|navigate\s+to)\s+(?:https?:\/\/)?(www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s]*)?\s+(?:in|using|with)\s+(edge|chrome|brave|firefox|opera|vivaldi)\b/i
  );
  const fileMatch = message.match(/\b(?:open|load)\s+(?:the\s+)?file\s+["']?(.+?)["']?\s*$/i);
  const webSearchMatch = message.match(
    /\b(?:search(?:\s+the\s+web)?|look\s+up)\s+(?:for\s+)?["']?(.+?)["']?\s*$/i
  );
  const browserSearchMatch = message.match(
    /\b(?:in|using|with)\s+(edge|chrome|brave|firefox|opera|vivaldi)\b[\s\S]*?\b(?:search|look\s+up)\s+(?:for\s+)?["']?(.+?)["']?\s*$/i
  );
  const browserTypeMatch = message.match(
    /\b(?:in|using|with)\s+(edge|chrome|brave|firefox|opera|vivaldi)\b[\s\S]*?\b(?:type|enter|search)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+and\s+(?:press|hit)\s+enter)?\s*$/i
  );
  const coordinateClickMatch = message.match(/\bclick\s+(?:at\s+)?(?:x\s*)?(\d{2,5})\s*(?:,|and)\s*(?:y\s*)?(\d{2,5})\b/i);
  const visibleElements = Array.isArray(visionContext?.detectedElements) ? visionContext.detectedElements : [];
  const targetElement = visibleElements.find((element: any) => {
    const label = String(element.label || "").toLowerCase();
    return element.center || element.boundingBox && (
      /\b(search|address|query|input|text field)\b/.test(request) && /\b(search|address|query|input|text field)\b/.test(label)
      || /\b(button|link|tab|menu)\b/.test(request) && label.includes(request.match(/\b(?:button|link|tab|menu)\s+["']?([^"']+)["']?/i)?.[1]?.toLowerCase() || "")
    );
  });
  const targetPoint = targetElement?.center || (targetElement?.boundingBox
    ? {
        x: targetElement.boundingBox.x + targetElement.boundingBox.width / 2,
        y: targetElement.boundingBox.y + targetElement.boundingBox.height / 2,
      }
    : null);
  const visibleInputMatch = message.match(/\b(?:click|go to|focus|use)\s+(?:the\s+)?(?:search|address|query|text)\s+(?:box|bar|field)\b[\s\S]*?\b(?:type|enter|search)\s+(?:for\s+)?["']?(.+?)["']?(?:\s+(?:and\s+)?(?:press|hit)\s+enter)?\s*$/i);

  if (websiteUrlMatch) {
    const protocol = websiteUrlMatch[1] || "https://";
    const url = `${protocol}${websiteUrlMatch[2]}`;
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Open ${url} in the Windows default browser`,
        multiStepPlan: {
          planTitle: `Open ${websiteUrlMatch[2]}`,
          spokenIntro: `I will open ${websiteUrlMatch[2]} in your default browser.`,
          steps: [
            { stepNumber: 1, description: `Open ${url}`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
          ],
          spokenCompletion: `${websiteUrlMatch[2]} is open.`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (webSearchMatch) {
    const query = webSearchMatch[1].replace(/\s+(?:in|using|with)\s+(?:edge|chrome|brave|firefox|opera|vivaldi)\s*$/i, "").trim();
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Search the web for ${query}`,
        multiStepPlan: {
          planTitle: `Search for ${query}`,
          spokenIntro: `I will search the web for ${query} in your default browser.`,
          steps: [
            { stepNumber: 1, description: `Search for ${query}`, actionType: "SEARCH_WEB", params: { query }, status: "pending", estimatedDurationMs: 1200 },
          ],
          spokenCompletion: `I searched the web for ${query}.`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (browserUrlMatch) {
    const host = `${browserUrlMatch[1] || ""}${browserUrlMatch[2]}`;
    const url = `https://${host}`;
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Open ${url} in the Windows default browser`,
        multiStepPlan: {
          planTitle: `Open ${host}`,
          spokenIntro: `I will open ${host} in your default browser.`,
          steps: [
            { stepNumber: 1, description: `Open ${url}`, actionType: "NAVIGATE_URL", params: { url }, status: "pending", estimatedDurationMs: 1200 },
          ],
          spokenCompletion: `${host} is open.`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (visibleInputMatch && targetPoint) {
    const query = visibleInputMatch[1].replace(/\s+(?:and\s+)?(?:press|hit)\s+enter\s*$/i, "").trim();
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Use the visible search field to enter ${query}`,
        multiStepPlan: {
          planTitle: "Use visible search field",
          spokenIntro: `I found the visible search field. I will click it, enter ${query}, and submit it.`,
          steps: [
            { stepNumber: 1, description: `Move to ${targetElement.label || "search field"}`, actionType: "MOVE_MOUSE", params: { ...targetPoint, coordinateSpace: "vision" }, status: "pending", estimatedDurationMs: 600 },
            { stepNumber: 2, description: "Click the visible search field", actionType: "CLICK_BUTTON", params: { ...targetPoint, coordinateSpace: "vision" }, status: "pending", estimatedDurationMs: 200 },
            { stepNumber: 3, description: `Type ${query}`, actionType: "TYPE_INPUT", params: { text: query }, status: "pending", estimatedDurationMs: 500 },
            { stepNumber: 4, description: "Submit the search", actionType: "KEY_PRESS", params: { key: "~" }, status: "pending", estimatedDurationMs: 300 },
          ],
          spokenCompletion: "The search was submitted.",
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (targetPoint && /\b(click|press|select|open)\b/.test(request)) {
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Click ${targetElement.label || "the selected screen control"}`,
        multiStepPlan: {
          planTitle: `Click ${targetElement.label || "screen control"}`,
          spokenIntro: `I found ${targetElement.label || "the requested control"} on the screen. I will move there and click it.`,
          steps: [
            { stepNumber: 1, description: `Move to ${targetElement.label || "target"}`, actionType: "MOVE_MOUSE", params: { ...targetPoint, coordinateSpace: "vision" }, status: "pending", estimatedDurationMs: 600 },
            { stepNumber: 2, description: `Click ${targetElement.label || "target"}`, actionType: "CLICK_BUTTON", params: { ...targetPoint, coordinateSpace: "vision" }, status: "pending", estimatedDurationMs: 200 },
          ],
          spokenCompletion: `${targetElement.label || "The selected control"} was clicked.`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (browserTypeMatch) {
    const query = browserTypeMatch[2].replace(/\s+(?:and\s+)?(?:press|hit)\s+enter\s*$/i, "").trim();
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Search the web for ${query}`,
        multiStepPlan: {
          planTitle: `Search for ${query}`,
          spokenIntro: `I will search the web for ${query} in your default browser.`,
          steps: [
            { stepNumber: 1, description: `Search for ${query}`, actionType: "SEARCH_WEB", params: { query }, status: "pending", estimatedDurationMs: 1200 },
          ],
          spokenCompletion: `I searched the web for ${query}.`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (coordinateClickMatch) {
    const x = Number(coordinateClickMatch[1]);
    const y = Number(coordinateClickMatch[2]);
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Move to ${x}, ${y} and click`,
        multiStepPlan: {
          planTitle: "Click screen location",
          spokenIntro: `I will move the mouse to ${x}, ${y} and click.`,
          steps: [
            { stepNumber: 1, description: `Move to ${x}, ${y}`, actionType: "MOVE_MOUSE", params: { x, y }, status: "pending", estimatedDurationMs: 600 },
            { stepNumber: 2, description: "Click the selected location", actionType: "CLICK_BUTTON", params: { x, y }, status: "pending", estimatedDurationMs: 200 },
          ],
          spokenCompletion: "The selected location was clicked.",
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (browserSearchMatch) {
    const query = browserSearchMatch[2].trim();
    return {
      ...parsed,
      action: {
        type: "MULTI_STEP_PLAN",
        description: `Search the web for ${query}`,
        multiStepPlan: {
          planTitle: `Search for ${query}`,
          spokenIntro: `I will search the web for ${query} in your default browser.`,
          steps: [
            { stepNumber: 1, description: `Search for ${query}`, actionType: "SEARCH_WEB", params: { query }, status: "pending", estimatedDurationMs: 1200 },
          ],
          spokenCompletion: `I searched the web for ${query}.`,
          currentStepIndex: 0,
          status: "idle",
        },
      },
    };
  }

  if (fileMatch && parsed?.action?.type !== "OPEN_FILE") {
    return {
      ...parsed,
      action: {
        type: "OPEN_FILE",
        description: `Open ${fileMatch[1]}`,
        path: fileMatch[1].trim(),
        parameter: fileMatch[1].trim(),
      },
    };
  }
  if (requestedApp && asksToOpen && parsed?.action?.type !== "LAUNCH_APP" && parsed?.action?.type !== "MULTI_STEP_PLAN") {
    return {
      ...parsed,
      action: {
        type: "LAUNCH_APP",
        description: `Open ${requestedApp}`,
        app: requestedApp,
        parameter: requestedApp,
      },
    };
  }
  if (parsed?.action?.type === "MULTI_STEP_PLAN" && parsed.action.multiStepPlan) {
    parsed.action.multiStepPlan.steps = parsed.action.multiStepPlan.steps.map((step: any) => ({
      ...step,
      params: step.params || {},
      status: step.status || "pending",
    }));
  }
  return parsed;
}

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use("/models", express.static(path.join(APP_ROOT, "public", "models")));
app.use(express.static(path.join(APP_ROOT, "public")));

app.get("/api/models/nova.compressed.glb", async (_req, res) => {
  try {
    const localPath = path.join(APP_ROOT, "public", "models", "nova.compressed.glb");
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    const modelResponse = await fetch(DRIVE_MODEL_URL);
    if (!modelResponse.ok || !modelResponse.body) {
      return res.status(modelResponse.status || 502).send("Unable to download avatar model");
    }

    res.setHeader("Content-Type", modelResponse.headers.get("content-type") || "model/gltf-binary");
    const contentLength = modelResponse.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    Readable.fromWeb(modelResponse.body as any).pipe(res);
  } catch (error) {
    console.error("Error proxying avatar model:", error);
    if (!res.headersSent) res.status(502).send("Unable to download avatar model");
  }
});

// Helper: Query Ollama instance tags and status
async function getOllamaStatus(): Promise<{ online: boolean; models: any[] }> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return { online: false, models: [] };
    const data = (await res.json()) as any;
    return { online: true, models: data.models || [] };
  } catch {
    return { online: false, models: [] };
  }
}

// Helper: Invoke local Ollama chat endpoint
async function callOllamaChat(params: {
  model?: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content: string; images?: string[] }>;
  formatJson?: boolean;
  timeoutMs?: number;
  options?: Record<string, any>;
}): Promise<string> {
  const { model = activeOllamaModel, systemPrompt, messages, formatJson = true, timeoutMs = 60000, options = { temperature: 0.3 } } = params;

  const chatMessages: any[] = [];
  if (systemPrompt) {
    chatMessages.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    const entry: any = { role: m.role, content: m.content };
    if (m.images && m.images.length > 0) {
      entry.images = m.images;
    }
    chatMessages.push(entry);
  }

  const payload: any = {
    model,
    messages: chatMessages,
    stream: false,
    options,
  };

  if (formatJson) {
    payload.format = "json";
  }

  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Ollama API returned HTTP ${res.status}: ${errorText}`);
  }

  const data = (await res.json()) as any;
  return data?.message?.content || "";
}

function parseLooseJson(raw: string): any | null {
  let text = String(raw || "").trim();
  if (!text) return null;
  text = text.replace(/^\\s*```(?:json)?/i, "").replace(/```\\s*$/i, "").trim();
  const candidates = [text];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try { const value = JSON.parse(candidate); if (value && typeof value === "object") return value; } catch {}
  }
  const candidate = candidates[candidates.length - 1];
  let repaired = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escaped) { repaired += ch; escaped = false; continue; }
    if (ch === "\\") { repaired += ch; escaped = true; continue; }
    if (ch === '"' ) {
      let next = i + 1; while (next < candidate.length && /\\s/.test(candidate[next])) next++;
      if (!inString) inString = true;
      else if (next >= candidate.length || /[,}\\]:]/.test(candidate[next])) inString = false;
      else { repaired += '\\\"'; continue; }
    }
    if (inString && ch === "\n") repaired += "\\n";
    else if (inString && ch === "\r") repaired += "\\r";
    else if (inString && ch === "\t") repaired += "\\t";
    else repaired += ch;
  }
  repaired = repaired.replace(/,\\s*([}\\]])/g, "$1");
  try { const value = JSON.parse(repaired); return value && typeof value === "object" ? value : null; } catch {}
  return null;
}

// Gemini initialization
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Helper: Gemini fallback generator
async function generateContentWithFallback(ai: GoogleGenAI, baseConfig: any, timeoutMs = 8000) {
  const fallbackModels = [activeGeminiModel, "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
  let lastErr: any = null;

  for (let i = 0; i < fallbackModels.length; i++) {
    const model = fallbackModels[i];
    try {
      const callPromise = ai.models.generateContent({
        ...baseConfig,
        model,
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout generating with ${model}`)), timeoutMs)
      );
      const response = (await Promise.race([callPromise, timeoutPromise])) as any;
      return response;
    } catch (err: any) {
      lastErr = err;
      const code = err?.status || err?.code || err?.error?.code;
      console.warn(`[Gemini] ${model} unavailable (${err?.message || code}). Attempting next fallback...`);
      if (i < fallbackModels.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }

  throw lastErr;
}

// Low-confidence voice correction. The local Windows recognizer remains the
// first pass; this endpoint is only used when the renderer asks for a retry.
app.post("/api/transcribe", async (req, res) => {
  try {
    const { audioBase64, mimeType = "audio/webm" } = req.body || {};
    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res.status(400).json({ error: "audioBase64 is required" });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ available: false, error: "Cloud transcription is not configured." });
    }

    const ai = getAI();
    const response = await generateContentWithFallback(ai, {
      contents: [{
        role: "user",
        parts: [
          {
            inlineData: {
              data: audioBase64.replace(/^data:[^;]+;base64,/, ""),
              mimeType,
            },
          },
          {
            text: "Transcribe the spoken English in this recording exactly. Return only the words spoken, with no explanation. If there is no clear speech, return an empty string.",
          },
        ],
      }],
    }, 15000);

    const text = String(response.text || "")
      .replace(/^```(?:text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return res.json({ available: true, text, confidence: text ? 0.9 : 0 });
  } catch (error: any) {
    console.warn("[Voice] Cloud transcription failed:", error?.message || error);
    return res.status(502).json({ available: false, error: "Cloud transcription failed." });
  }
});

// GET AI Configuration & Status
app.get("/api/ai/config", async (_req, res) => {
  const ollama = await getOllamaStatus();
  res.json({
    provider: activeProvider,
    ollamaHost: OLLAMA_HOST,
    ollamaModel: activeOllamaModel,
    ollamaVisionModel: activeOllamaVisionModel,
    geminiModel: activeGeminiModel,
    ollamaOnline: ollama.online,
    availableOllamaModels: ollama.models,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  });
});

// POST update AI configuration
app.post("/api/ai/config", async (req, res) => {
  const { provider, ollamaHost, ollamaModel, ollamaVisionModel, geminiModel } = req.body;
  if (provider === "ollama" || provider === "gemini") {
    activeProvider = provider;
  }
  if (ollamaHost && typeof ollamaHost === "string") {
    OLLAMA_HOST = ollamaHost.trim();
  }
  if (ollamaModel && typeof ollamaModel === "string") {
    activeOllamaModel = ollamaModel.trim();
  }
  if (ollamaVisionModel && typeof ollamaVisionModel === "string") {
    activeOllamaVisionModel = ollamaVisionModel.trim();
  }
  if (geminiModel && typeof geminiModel === "string") {
    activeGeminiModel = geminiModel.trim();
  }

  const ollama = await getOllamaStatus();
  res.json({
    success: true,
    provider: activeProvider,
    ollamaHost: OLLAMA_HOST,
    ollamaModel: activeOllamaModel,
    ollamaVisionModel: activeOllamaVisionModel,
    geminiModel: activeGeminiModel,
    ollamaOnline: ollama.online,
    availableOllamaModels: ollama.models,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  });
});

// List Ollama models
app.get("/api/ollama/models", async (_req, res) => {
  const status = await getOllamaStatus();
  res.json(status);
});

// Health check endpoint
app.get("/api/health", async (_req, res) => {
  const ollama = await getOllamaStatus();
  res.json({
    status: "ok",
    assistant: "Magic AI Desktop Assistant",
    version: "1.0.0-win11",
    activeProvider,
    ollamaOnline: ollama.online,
    hasApiKey: !!process.env.GEMINI_API_KEY,
  });
});

// Main Chat & Command Interpretation Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], memories = [], visionContext = null, assistantName = "Nova" } = req.body;
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }
    if (message.length > 8000) {
      return res.status(413).json({ error: "Message is too long." });
    }
    if (!Array.isArray(history) || history.length > 20) {
      return res.status(400).json({ error: "Invalid conversation history." });
    }
    if (!Array.isArray(memories) || memories.length > 100) {
      return res.status(400).json({ error: "Invalid memories payload." });
    }

    const configuredAssistantName = typeof assistantName === "string" && assistantName.trim() ? assistantName.trim().slice(0, 32) : "Nova";
    const systemPrompt = `You are "${configuredAssistantName}", a sophisticated, friendly, articulate, highly capable AI desktop assistant inside the ma9ic AI app.
Persona: Composed, attentive, clear, proactive, and elegant.
Voice response style: Concise, spoken-friendly, conversational, direct (under 40 words).
Always refer to yourself as ${configuredAssistantName}. Never call yourself Magic or Nova unless that is the configured name.

User Stored Memories: ${JSON.stringify(memories)}
Latest Screen Analysis: ${JSON.stringify(visionContext)}

When the user asks you to click, move, type, or interact with something visible, use the latest screen analysis coordinates when available. Return a MULTI_STEP_PLAN with MOVE_MOUSE followed by CLICK_BUTTON, TYPE_INPUT, or KEY_PRESS. Never claim to have performed a desktop action unless you return an executable plan.

When responding, you must provide:
1. "spokenResponse": A concise, spoken companion reply to be spoken aloud.
2. "action": An optional structured action if the user asks for a task, search, reminder, memory, plan, or information:
Possible action types:
- "WEB_SEARCH": { "query": string }
- "SCREEN_ANALYSIS": {}
- "LAUNCH_APP": { "app": "brave" | "edge" | "chrome" | "firefox" | "notepad" | "calculator" | "paint" | "explorer" | "terminal" | "taskmgr" }
- "OPEN_FILE": { "path": string }
- "REMEMBER": { "key": string, "value": string, "category": string }
- "FORGET": { "key": string }
- "MULTI_STEP_PLAN": { "planTitle": string, "spokenIntro": string, "steps": Array<{ "stepNumber": number, "description": string, "actionType": "LAUNCH_APP" | "MOVE_MOUSE" | "CLICK_BUTTON" | "DOUBLE_CLICK" | "RIGHT_CLICK" | "DRAG" | "SCROLL" | "TYPE_INPUT" | "KEY_PRESS" | "WAIT", "params": { "app"?: string, "x"?: number, "y"?: number, "endX"?: number, "endY"?: number, "coordinateSpace"?: "vision", "text"?: string, "key"?: string, "ms"?: number } }>, "spokenCompletion": string }
- "NONE": null

Return ONLY valid JSON matching this structure:
{
  "spokenResponse": "string",
  "action": {
    "type": "WEB_SEARCH" | "SCREEN_ANALYSIS" | "REMEMBER" | "FORGET" | "MULTI_STEP_PLAN" | "NONE",
    "description": "string",
    "parameter": "string",
    "multiStepPlan": object
  },
  "status": "idle" | "listening" | "executing" | "complete"
}`;

    // Check if Ollama should be used (default or if selected or if no Gemini key)
    const useOllama = activeProvider === "ollama" || !process.env.GEMINI_API_KEY;

    if (useOllama) {
      try {
        const chatMessages = [
          ...history.slice(-8).map((h: any) => ({
            role: h.role === "assistant" ? "assistant" : "user",
            content: h.content,
          })),
          {
            role: "user",
            content: message,
          },
        ];

        let rawContent: string;
        let lastChatError: any;
        for (const model of [activeOllamaModel, DEFAULT_OLLAMA_MODEL, "minicpm-v:latest"].filter(
          (model, index, models) => model && models.indexOf(model) === index
        )) {
          try {
            rawContent = await callOllamaChat({ model, systemPrompt, messages: chatMessages, formatJson: true });
            lastChatError = null;
            break;
          } catch (error) {
            lastChatError = error;
          }
        }
        if (lastChatError || !rawContent!) throw lastChatError || new Error("No Ollama chat response");

        let parsed: any;
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          const match = rawContent.match(/\{[\s\S]*\}/);
          parsed = match ? JSON.parse(match[0]) : null;
        }

        if (!parsed) {
          parsed = {
            spokenResponse: rawContent.replace(/```json|```/g, "").trim() || "How can I assist you?",
            action: { type: "NONE" },
            status: "complete",
          };
        }

        parsed = normalizeDesktopIntent(message, parsed, visionContext);
        const spoken = parsed.spokenResponse || parsed.spokenReply || "How can I assist you?";
        return res.json({
          ...parsed,
          spokenResponse: spoken,
          spokenReply: spoken,
          provider: "ollama",
          model: activeOllamaModel,
        });
      } catch (ollamaErr: any) {
        console.warn("[Ollama] Local chat error:", ollamaErr.message);
        if (!process.env.GEMINI_API_KEY) {
          return res.json({
            spokenResponse: describeOllamaError(ollamaErr),
            spokenReply: describeOllamaError(ollamaErr),
            action: { type: "NONE" },
            status: "idle",
            warning: describeOllamaError(ollamaErr),
          });
        }
        // Fall back to Gemini if available
      }
    }

    // Gemini Execution Path
    const ai = getAI();
    const contents = [
      ...history.slice(-8).map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      })),
      {
        role: "user",
        parts: [{ text: message }],
      },
    ];

    const response = await generateContentWithFallback(ai, {
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const replyText = response.text || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(replyText);
    } catch {
      parsed = {
        spokenResponse: replyText.replace(/```json|```/g, "").trim(),
        action: { type: "NONE" },
        status: "complete",
      };
    }

    const spoken = parsed.spokenResponse || parsed.spokenReply || "How can I assist you?";
    res.json({
      ...parsed,
      spokenResponse: spoken,
      spokenReply: spoken,
      provider: "gemini",
      model: activeGeminiModel,
    });
  } catch (error: any) {
    console.error("Error in /api/chat:", error);
    res.json({
      spokenResponse: "I am experiencing a momentary delay, but I'm ready for your next request.",
      spokenReply: "I am experiencing a momentary delay, but I'm ready for your next request.",
      action: { type: "NONE" },
      status: "idle",
      warning: error.message,
    });
  }
});

// Computer Vision: Screen & Desktop Reading Endpoint
app.post("/api/vision/analyze", async (req, res) => {
  try {
    const rawImage = req.body.imageBase64 || req.body.imageData;
    const prompt =
      req.body.prompt ||
      req.body.instruction ||
      "Analyze the screen in detail. Identify the active application, every visible window, browser address/search bars, buttons, tabs, menus, readable text, and likely clickable controls. Include screen coordinates for each actionable control.";
    if (!rawImage) {
      return res.status(400).json({ error: "imageBase64 or imageData is required" });
    }

    const cleanBase64 = rawImage.replace(/^data:image\/\w+;base64,/, "");
    const visionSystemPrompt = `You are a fast desktop UI detector.
Return ONLY valid JSON, with no markdown.
Use exactly this compact shape:
{"summary":"short sentence","activeApplication":"focused app","detectedElements":[{"type":"button|input|menu|tab|text|window","label":"short label","boundingBox":{"x":0,"y":0,"width":0,"height":0},"center":{"x":0,"y":0}}]}
Rules: return at most 8 detectedElements; prioritize clickable/input controls; omit uncertain elements; labels under 6 words; coordinates are pixels in the 1280x800 screenshot; keep the JSON short.`;

    const useOllama = activeProvider === "ollama" || !process.env.GEMINI_API_KEY;

    if (useOllama) {
      try {
        const rawContent = await callOllamaChat({
          model: activeOllamaVisionModel,
          systemPrompt: visionSystemPrompt,
          messages: [
            {
              role: "user",
              content: `Find the active application and visible actionable controls. Return only the compact JSON schema above.`,
              images: [cleanBase64],
            },
          ],
          formatJson: true,
          timeoutMs: 12000,
          options: {
            temperature: 0,
            num_ctx: 2048,
            num_predict: 300,
          },
        });

        const parsed = parseLooseJson(rawContent);

        if (parsed && typeof parsed === "object") {
          const detectedElements = Array.isArray(parsed.detectedElements)
            ? parsed.detectedElements.slice(0, 8).filter((item: any) => item && typeof item === "object")
            : [];
          return res.json({
            summary: String(parsed.summary || "Screen examined successfully."),
            openWindows: Array.isArray(parsed.openWindows) ? parsed.openWindows.slice(0, 6) : [],
            activeApplication: String(parsed.activeApplication || "Desktop Workspace"),
            detectedElements,
            extractedText: String(parsed.extractedText || ""),
            suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.slice(0, 3) : [],
            provider: "ollama",
            model: activeOllamaVisionModel,
          });
        }

        console.warn("[Ollama] Vision response could not be parsed; returning a safe fallback instead of blocking X-Ray.");
        return res.json({
          summary: "I examined your screen. The screenshot was captured, but the local vision model returned malformed structured data.",
          openWindows: ["Active Desktop Workspace"],
          activeApplication: "Main Workspace",
          detectedElements: [],
          extractedText: "",
          suggestedActions: ["Try examining the screen again", "Ask me what is visible"],
          details: "Screen capture succeeded. Vision JSON parsing failed safely; no desktop action was taken.",
          warning: "Local vision model returned malformed JSON.",
          provider: "ollama",
          model: activeOllamaVisionModel,
        });
      } catch (ollamaVisionErr: any) {
        console.warn("[Ollama] Vision analysis error:", ollamaVisionErr.message);
        if (!process.env.GEMINI_API_KEY) {
          return res.json({
            summary: "I examined your screen. You have active application content open with readable text and controls.",
            openWindows: ["Active Desktop Workspace"],
            activeApplication: "Main Workspace",
            detectedElements: [{ type: "text", label: "Content Area", location: "center" }],
            extractedText: "Analyzed screen content",
            suggestedActions: ["Read aloud", "Summarize text"],
            warning: ollamaVisionErr.message,
          });
        }
      }
    }

    // Gemini Vision Fallback
    const ai = getAI();
    const response = await generateContentWithFallback(ai, {
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: "image/png",
              },
            },
            {
              text: `${prompt}\n${visionSystemPrompt}`,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text || "{}";
    const cleanedText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    }

    if (!parsed) {
      throw new Error("Could not parse vision analysis response");
    }

    res.json(parsed);
  } catch (error: any) {
    console.error("Error in /api/vision/analyze:", error);
    res.json({
      summary: "I examined your screen. You have active application content open with readable text and controls.",
      openWindows: ["Active Browser", "Editor Workspace"],
      activeApplication: "Main Workspace",
      detectedElements: [
        { type: "text", label: "Content Area", location: "center" },
        { type: "button", label: "Action Control", location: "bottom-bar" },
      ],
      extractedText: "Analyzed screen content",
      suggestedActions: ["Read aloud", "Summarize text", "Extract action items"],
      warning: error.message,
    });
  }
});

// Multi-Step Task Planner Endpoint
const PLANNER_ACTION_TYPES = new Set([
  "LAUNCH_APP",
  "SEARCH_WEB",
  "DETECT_WEBPAGE",
  "FOCUS_APP",
  "CLOSE_APP",
  "OPEN_FOLDER",
  "GET_ACTIVE_WINDOW",
  "INSPECT_UI_TREE",
  "FIND_UI_ELEMENT",
  "CLICK_UI_ELEMENT",
  "READ_UI_ELEMENT",
  "SET_UI_VALUE",
  "WAIT_FOR_UI_ELEMENT",
  "NAVIGATE_URL",
  "MOVE_MOUSE",
  "CLICK_BUTTON",
  "DOUBLE_CLICK",
  "RIGHT_CLICK",
  "DRAG",
  "SCROLL",
  "TYPE_INPUT",
  "KEY_PRESS",
  "WAIT",
]);
const PLANNER_APPS = new Set([
  "browser", "brave", "edge", "chrome", "firefox", "opera", "vivaldi", "notepad", "calculator",
  "paint", "explorer", "files", "terminal", "taskmgr",
]);

function validateAgentPlan(plan: any) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) {
    throw new Error("Planner returned an invalid plan.");
  }
  if (plan.steps.length === 0 || plan.steps.length > 12) {
    throw new Error("Planner returned an invalid number of steps.");
  }

  const steps = plan.steps.map((step: any, index: number) => {
    if (!step || typeof step !== "object") {
      throw new Error(`Planner step ${index + 1} is invalid.`);
    }
    const actionType = String(step.actionType || "");
    if (!PLANNER_ACTION_TYPES.has(actionType)) {
      throw new Error(`Planner action is not allowed: ${actionType || "unknown"}.`);
    }
    const rawParams = step.params && typeof step.params === "object" && !Array.isArray(step.params)
      ? step.params
      : {};
    const normalized = {
      stepNumber: index + 1,
      description: String(step.description || `${actionType} step`).slice(0, 240),
      actionType,
      params: { ...rawParams },
      estimatedDurationMs: Math.min(15000, Math.max(0, Number(step.estimatedDurationMs) || 0)),
    };

    if (actionType === "LAUNCH_APP") {
      const app = String(normalized.params.app || "").trim().toLowerCase();
      if (!PLANNER_APPS.has(app)) throw new Error(`Planner app is not allowed: ${app || "unknown"}.`);
      normalized.params = { app };
    }
    if (["FOCUS_APP", "CLOSE_APP"].includes(actionType)) {
      const app = String(normalized.params.app || "").trim().toLowerCase();
      if (!PLANNER_APPS.has(app)) throw new Error(`Planner app is not allowed: ${app || "unknown"}.`);
      normalized.params = { app };
    }
    if (actionType === "OPEN_FOLDER") {
      const folderPath = String(normalized.params.path || "").trim();
      if (!folderPath || !/^[A-Za-z]:\\/.test(folderPath) || folderPath.length > 500) throw new Error("Planner folder path is invalid.");
      normalized.params = { path: folderPath };
    }
    if (actionType === "GET_ACTIVE_WINDOW") {
      normalized.params = {};
    }
    if (actionType === "INSPECT_UI_TREE") {
      const process = String(normalized.params.process || "").trim().toLowerCase().replace(/\.exe$/i, "");
      const maxDepth = Number(normalized.params.maxDepth ?? 4);
      const maxNodes = Number(normalized.params.maxNodes ?? 150);
      if (process.length > 80) throw new Error("Planner UI process filter is invalid.");
      if (!Number.isFinite(maxDepth) || maxDepth < 1 || maxDepth > 6) throw new Error("Planner UI tree depth is invalid.");
      if (!Number.isFinite(maxNodes) || maxNodes < 20 || maxNodes > 300) throw new Error("Planner UI tree size is invalid.");
      normalized.params = { process, maxDepth: Math.round(maxDepth), maxNodes: Math.round(maxNodes), activeOnly: normalized.params.activeOnly !== false, includeUnnamed: normalized.params.includeUnnamed === true };
    }
    if (["FIND_UI_ELEMENT", "CLICK_UI_ELEMENT", "READ_UI_ELEMENT", "SET_UI_VALUE", "WAIT_FOR_UI_ELEMENT"].includes(actionType)) {
      const name = String(normalized.params.name || "").slice(0, 200);
      const automationId = String(normalized.params.automationId || "").slice(0, 200);
      const controlType = String(normalized.params.controlType || "").slice(0, 80).toLowerCase();
      const process = String(normalized.params.process || "").trim().toLowerCase().replace(/\.exe$/i, "");
      if (!name && !automationId && !controlType) throw new Error("UI element action needs a name, automationId, or controlType.");
      normalized.params = { name, automationId, controlType, process };
      if (actionType === "SET_UI_VALUE") {
        const value = String(rawParams.value ?? rawParams.text ?? "");
        if (value.length > 4000) throw new Error("Planner UI value is too long.");
        normalized.params.value = value;
      }
      if (actionType === "WAIT_FOR_UI_ELEMENT") {
        const timeoutMs = Number(rawParams.timeoutMs ?? 5000);
        const intervalMs = Number(rawParams.intervalMs ?? 250);
        if (!Number.isFinite(timeoutMs) || timeoutMs < 250 || timeoutMs > 15000) throw new Error("Planner UI wait timeout is invalid.");
        if (!Number.isFinite(intervalMs) || intervalMs < 100 || intervalMs > 1000) throw new Error("Planner UI wait interval is invalid.");
        normalized.params.timeoutMs = Math.round(timeoutMs);
        normalized.params.intervalMs = Math.round(intervalMs);
      }
    }
    if (actionType === "SEARCH_WEB") {
      const query = String(normalized.params.query || normalized.params.text || "").trim();
      if (!query || query.length > 1000) throw new Error("Planner web search query is invalid.");
      normalized.params = { query };
    }
    if (actionType === "DETECT_WEBPAGE") {
      const timeoutMs = Number(normalized.params.timeoutMs ?? 5000);
      const intervalMs = Number(normalized.params.intervalMs ?? 300);
      if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 10000) throw new Error("Planner webpage detection timeout is invalid.");
      if (!Number.isFinite(intervalMs) || intervalMs < 150 || intervalMs > 1000) throw new Error("Planner webpage detection interval is invalid.");
      normalized.params = { timeoutMs: Math.round(timeoutMs), intervalMs: Math.round(intervalMs) };
    }
    if (actionType === "NAVIGATE_URL") {
      const url = String(normalized.params.url || "").trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Planner URL is invalid.");
      }
      if (!/^https?:$/.test(parsedUrl.protocol) || url.length > 2048) {
        throw new Error("Planner URL is not allowed.");
      }
      normalized.params = { url };
    }
    if (["MOVE_MOUSE", "CLICK_BUTTON", "DOUBLE_CLICK", "RIGHT_CLICK"].includes(actionType)) {
      for (const [key, max] of [["x", 1280], ["y", 800]] as const) {
        const value = Number(normalized.params[key]);
        if (!Number.isFinite(value) || value < 0 || value > max) {
          throw new Error(`Planner coordinate ${key} is invalid.`);
        }
        normalized.params[key] = Math.round(value);
      }
    }
    if (actionType === "DRAG") {
      for (const [key, max] of [["x", 1280], ["endX", 1280], ["y", 800], ["endY", 800]] as const) {
        const value = Number(normalized.params[key]);
        if (!Number.isFinite(value) || value < 0 || value > max) {
          throw new Error(`Planner coordinate ${key} is invalid.`);
        }
        normalized.params[key] = Math.round(value);
      }
    }
    if (actionType === "SCROLL") {
      const amount = Number(normalized.params.amount);
      if (!Number.isFinite(amount) || amount < -10000 || amount > 10000) {
        throw new Error("Planner scroll amount is invalid.");
      }
      normalized.params = { amount: Math.round(amount) };
    }
    if (actionType === "TYPE_INPUT") {
      const text = String(normalized.params.text ?? "");
      if (text.length > 4000) throw new Error("Planner input is too long.");
      normalized.params = { text };
    }
    if (actionType === "KEY_PRESS") {
      const key = String(normalized.params.key || "");
      if (!key || key.length > 64) throw new Error("Planner key input is invalid.");
      normalized.params = { key };
    }
    if (actionType === "WAIT") {
      const ms = Number(normalized.params.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 10000) throw new Error("Planner wait duration is invalid.");
      normalized.params = { ms: Math.round(ms) };
    }

    return normalized;
  });

  return {
    planTitle: String(plan.planTitle || "Desktop task").slice(0, 120),
    spokenIntro: String(plan.spokenIntro || "").slice(0, 500),
    steps,
    spokenCompletion: String(plan.spokenCompletion || "").slice(0, 500),
  };
}

app.post("/api/agent/plan", async (req, res) => {
  try {
    const { goal, context = {} } = req.body;
    if (!goal || typeof goal !== "string") {
      return res.status(400).json({ error: "Goal is required" });
    }
    if (goal.length > 4000) {
      return res.status(413).json({ error: "Goal is too long" });
    }

    const plannerPrompt = `You are the Task Planning Engine for Magic inside the Magic Windows Assistant.
Deconstruct the user's high-level command into an ordered sequence of executable automation steps.
User Goal: "${goal}"
Desktop Context: ${JSON.stringify(context)}

Only use these executable step action types:
- "LAUNCH_APP": { "app": "browser" | "brave" | "edge" | "chrome" | "firefox" | "notepad" | "calculator" | "paint" | "explorer" | "files" | "terminal" | "taskmgr" } (any browser name delegates to the Windows default browser)
- "FOCUS_APP": { "app": same app list }
- "CLOSE_APP": { "app": same app list }
- "OPEN_FOLDER": { "path": "absolute Windows folder path" }
- "GET_ACTIVE_WINDOW": {}
- "INSPECT_UI_TREE": { "process": "optional process name", "maxDepth": 1-6, "maxNodes": 20-300, "activeOnly": true | false }
- "FIND_UI_ELEMENT": { "name": "optional", "automationId": "optional", "controlType": "optional", "process": "optional" }
- "CLICK_UI_ELEMENT": { "name": "optional", "automationId": "optional", "controlType": "optional", "process": "optional" }
- "READ_UI_ELEMENT": { "name": "optional", "automationId": "optional", "controlType": "optional", "process": "optional" }
- "SET_UI_VALUE": { "name": "optional", "automationId": "optional", "controlType": "optional", "process": "optional", "value": string }
- "WAIT_FOR_UI_ELEMENT": { "name": "optional", "automationId": "optional", "controlType": "optional", "process": "optional", "timeoutMs": number }
- "NAVIGATE_URL": { "url": string } (open a website in the Windows default browser)
- "SEARCH_WEB": { "query": string } (search the web in the Windows default browser)
- "DETECT_WEBPAGE": { "timeoutMs": number, "intervalMs": number } (detect the active browser page title/process/URL when needed)
- "MOVE_MOUSE": { "x": number, "y": number }
- "CLICK_BUTTON": { "x": number, "y": number }
- "DOUBLE_CLICK": { "x": number, "y": number }
- "RIGHT_CLICK": { "x": number, "y": number }
- "DRAG": { "x": number, "y": number, "endX": number, "endY": number }
- "SCROLL": { "amount": number }
- "TYPE_INPUT": { "text": string }
- "KEY_PRESS": { "key": string }
- "WAIT": { "ms": number }

Never output shell commands, PowerShell, command prompt instructions, executable paths, file deletion/install commands, or any action type outside this list.
Return no more than 12 steps.

Respond ONLY with valid JSON:
{
  "planTitle": "string",
  "spokenIntro": "Brief spoken acknowledgment of the plan",
  "steps": [
    {
      "stepNumber": 1,
      "description": "Readable description of this step",
      "actionType": "LAUNCH_APP",
      "params": {},
      "estimatedDurationMs": 1000
    }
  ],
  "spokenCompletion": "Spoken sentence once all steps are completed"
}`;

    const useOllama = activeProvider === "ollama" || !process.env.GEMINI_API_KEY;

    if (useOllama) {
      try {
        const rawPlan = await callOllamaChat({
          model: activeOllamaModel,
          systemPrompt: plannerPrompt,
          messages: [{ role: "user", content: `Goal: ${goal}` }],
          formatJson: true,
        });

        let parsed: any;
        try {
          parsed = JSON.parse(rawPlan);
        } catch {
          const match = rawPlan.match(/\{[\s\S]*\}/);
          parsed = match ? JSON.parse(match[0]) : null;
        }

        if (parsed && parsed.steps) {
          return res.json(validateAgentPlan(parsed));
        }
      } catch (ollamaPlanErr: any) {
        console.warn("[Ollama] Planner error:", ollamaPlanErr.message);
      }
    }

    // Gemini Fallback
    const ai = getAI();
    const response = await generateContentWithFallback(ai, {
      contents: [{ role: "user", parts: [{ text: plannerPrompt }] }],
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text || "{}";
    const cleanedText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleanedText);
    } catch {
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    }

    res.json(validateAgentPlan(parsed));
  } catch (error: any) {
    console.error("Error in /api/agent/plan:", error);
    res.status(502).json({
      error: "The task planner could not produce a safe executable plan.",
    });
  }
});

// Setup Vite middleware in dev or static files in prod
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(APP_ROOT, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Magic Windows Assistant running on http://0.0.0.0:${PORT}`);
    console.log(`[AI Engine] Provider: ${activeProvider} | Ollama Host: ${OLLAMA_HOST} | Default Chat Model: ${activeOllamaModel}`);
  });
}

start();
