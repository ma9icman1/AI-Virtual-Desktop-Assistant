import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AssistantState,
  ChatMessage,
  MemoryItem,
  MultiStepPlan,
  VisionDetection,
  VoiceSettings,
  PermissionLevel,
} from "./types";
import { VoiceEngine } from "./services/voiceEngine";
import { VisionService } from "./services/visionService";
import { publishVisionToUnreal } from "./services/unrealBridge";
import { MemoryService } from "./services/memoryService";

import { VoiceOrb } from "./components/assistant/VoiceOrb";
import { AvatarCanvas } from "./components/avatar/AvatarCanvas";
import { Avatar2D } from "./components/avatar/Avatar2D";
import { ChatFeed } from "./components/assistant/ChatFeed";
import { InputBar } from "./components/assistant/InputBar";
import { VoiceSettingsModal } from "./components/assistant/VoiceSettingsModal";
import { MemoryModal } from "./components/assistant/MemoryModal";
import { VisionModal } from "./components/assistant/VisionModal";
import { SuperAIPermissionDialog } from "./components/desktop/SuperAIPermissionDialog";
import { TakeControlModal } from "./components/desktop/TakeControlModal";
import { MagicXRayOverlay } from "./components/desktop/MagicXRayOverlay";

import {
  Sparkles,
  Trash2,
  Mic,
  Volume2,
  User,
  X,
  Eye,
  EyeOff,
  Loader2,
  Cpu,
  Terminal,
  Download,
  Home,
  MessageSquare,
  Mic2,
  ScanEye,
  Monitor,
  Grid2X2,
  Settings,
  Info,
  Activity,
  Zap,
  Camera,
  AppWindow,
  PanelsTopLeft,
  Clock3,
  Globe2,
  Lightbulb,
  ChevronRight,
  FolderOpen,
  Minus,
  Square,
} from "lucide-react";

function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || "");
  return message && message !== "[object Object]" ? message : fallback;
}

export default function App() {
  const isDesktopShell = new URLSearchParams(window.location.search).has("desktop");

  // Assistant core state
  const [assistantState, setAssistantState] = useState<AssistantState>("idle");
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [visualMode, setVisualMode] = useState<"avatar" | "orb">("avatar");
  const [avatarMode, setAvatarMode] = useState<"2d" | "3d">("2d");
  const [experienceMode, setExperienceMode] = useState<"full" | "model">("full");
  const [showVisualStage, setShowVisualStage] = useState(false);
  const [modelConnected, setModelConnected] = useState(false);
  const [aiConnected, setAiConnected] = useState(false);
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [ollamaConfig, setOllamaConfig] = useState<any>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaNotice, setOllamaNotice] = useState<string | null>(null);
  const [isStartingOllama, setIsStartingOllama] = useState(false);
  const [downloadingOllamaModel, setDownloadingOllamaModel] = useState<string | null>(null);
  const [ollamaActionError, setOllamaActionError] = useState<string | null>(null);
  const [showActivityPanel, setShowActivityPanel] = useState(true);
  const [activityText, setActivityText] = useState("");
  const [guiBlurred, setGuiBlurred] = useState(true);
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>(() => {
    try {
      return localStorage.getItem("ma9icai_desktop_permission") === "always" ? "always" : "none";
    } catch {
      return "none";
    }
  });
  const [pendingPlan, setPendingPlan] = useState<MultiStepPlan | null>(null);
  const [isPermissionOpen, setIsPermissionOpen] = useState(false);
  const [isTakeControlOpen, setIsTakeControlOpen] = useState(false);
  const [takeControlTask, setTakeControlTask] = useState("");
  const [isTakeControlListening, setIsTakeControlListening] = useState(false);
  const takeControlOpenRef = useRef(false);
  const stopExecutionRef = useRef(false);

  // Chat conversation
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Memories
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);

  // Vision State & Modal
  const [activeVision, setActiveVision] = useState<VisionDetection | null>(null);
  const [visionThumbnail, setVisionThumbnail] = useState<string | undefined>(undefined);
  const [isAnalyzingVision, setIsAnalyzingVision] = useState(false);
  const [isVisionModalOpen, setIsVisionModalOpen] = useState(false);
  const [isXRayVisible, setIsXRayVisible] = useState(false);
  const captureScreenRef = useRef<(() => Promise<VisionDetection | null>) | null>(null);
  const [connectionProgress, setConnectionProgress] = useState<number | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const lastGreetingRef = useRef(-1);
  // Keep the voice subscription bound to the latest send-message handler without
  // restarting the subscription every time listening state changes.
  const handleSendMessageRef = useRef<(text: string, visionOverride?: VisionDetection | null) => Promise<void>>(async () => {});

  useEffect(() => {
    document.body.classList.toggle("desktop-shell", isDesktopShell);
    document.body.classList.toggle("avatar-overlay", experienceMode === "model");
    return () => {
      document.body.classList.remove("desktop-shell");
      document.body.classList.remove("avatar-overlay");
    };
  }, [isDesktopShell, experienceMode]);

  useEffect(() => {
    (window as any).magicWindow?.setOverlayMode(experienceMode === "model");
  }, [experienceMode]);

  useEffect(() => {
    let cancelled = false;

    const checkAiConnection = async () => {
      try {
        const response = await fetch("/api/ai/config", { cache: "no-store" });
        if (!response.ok) throw new Error(`AI status returned HTTP ${response.status}`);
        const config = await response.json();
        const providerReady = config.provider === "gemini"
          ? Boolean(config.hasGeminiKey)
          : Boolean(config.ollamaOnline || config.hasGeminiKey);
        if (!cancelled) {
          setAiConnected(providerReady);
          const installedModels = Array.isArray(config.availableOllamaModels) ? config.availableOllamaModels : [];
          setModelConnected(Boolean(config.ollamaOnline && installedModels.length > 0));
        }
      } catch {
        if (!cancelled) setAiConnected(false);
      }
    };

    void checkAiConnection();
    const timer = window.setInterval(checkAiConnection, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (assistantState !== "processing" && assistantState !== "executing") {
      setConnectionProgress(null);
      return;
    }

    setConnectionProgress(12);
    const timer = window.setInterval(() => {
      setConnectionProgress((current) => current === null ? 12 : Math.min(88, current + 7));
    }, 450);
    return () => window.clearInterval(timer);
  }, [assistantState]);

  // Voice Settings & Modal
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(VoiceEngine.getSettings());
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [assistantName, setAssistantName] = useState(() => {
    const stored = localStorage.getItem("assistant_name");
    return stored && stored !== "Nova" ? stored : "ma9icAI";
  });
  const [activeSection, setActiveSection] = useState("Home");

  const handleAssistantNameChange = useCallback((value: string) => {
    const nextName = value.replace(/\s+/g, " ").trimStart().slice(0, 32);
    setAssistantName(nextName);
    localStorage.setItem("assistant_name", nextName);
    VoiceEngine.setAssistantName(nextName);
  }, []);

  const refreshOllamaConfig = useCallback(async () => {
    setOllamaLoading(true);
    try {
      const response = await fetch("/api/ai/config", { cache: "no-store" });
      if (!response.ok) throw new Error(`Ollama settings returned HTTP ${response.status}`);
      const config = await response.json();
      setOllamaConfig(config);
      const installedModels = Array.isArray(config.availableOllamaModels) ? config.availableOllamaModels : [];
      setModelConnected(Boolean(config.ollamaOnline && installedModels.length > 0));
      setOllamaNotice(null);
    } catch (error) {
      setOllamaNotice(error instanceof Error ? error.message : "Could not load Ollama settings.");
    } finally {
      setOllamaLoading(false);
    }
  }, []);

  const openOllamaSettings = useCallback(() => {
    setIsModelMenuOpen(true);
    void refreshOllamaConfig();
  }, [refreshOllamaConfig]);

  const selectOllamaModel = useCallback(async (model: string) => {
    try {
      const response = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "ollama", ollamaModel: model }),
      });
      if (!response.ok) throw new Error(`Could not select ${model}`);
      const config = await response.json();
      setOllamaConfig(config);
      setModelConnected(Boolean(config.ollamaOnline && (config.availableOllamaModels || []).length > 0));
      setOllamaNotice(`Active model: ${model}`);
    } catch (error) {
      setOllamaNotice(error instanceof Error ? error.message : "Could not select model.");
    }
  }, []);

  useEffect(() => {
    if (isModelMenuOpen) void refreshOllamaConfig();
  }, [isModelMenuOpen, refreshOllamaConfig]);

  useEffect(() => {
    const unsubscribe = (window as any).magicWindow?.onOllamaProgress?.((payload: any) => {
      const model = String(payload?.model || "Ollama");
      const text = String(payload?.text || "");
      if (payload?.state === "complete") {
        setDownloadingOllamaModel(null);
        setOllamaNotice(text || `${model} is installed.`);
        void refreshOllamaConfig();
      } else if (payload?.state === "error") {
        setDownloadingOllamaModel(null);
        setOllamaActionError(text || `Ollama could not install ${model}.`);
      } else if (payload?.state === "creating") {
        setDownloadingOllamaModel(model);
        setOllamaNotice(text || `Creating ${model}...`);
      } else if (payload?.state === "downloading") {
        setDownloadingOllamaModel(model);
        setOllamaNotice(text || `Downloading ${model}...`);
      } else if (text) {
        setOllamaNotice(text);
      }
    });
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [refreshOllamaConfig]);


  useEffect(() => {
    VoiceEngine.setAssistantName(assistantName);
  }, [assistantName]);

  useEffect(() => {
    const cleanup = (window as any).magicDesktop?.onEmergencyStop?.((payload: any) => {
      console.warn("[EMERGENCY STOP TRIGGERED]", payload);
      stopExecutionRef.current = true;
      setAssistantState("idle");
      setShowActivityPanel(false);
      VoiceEngine.stopListening();
      setVoiceNotice("Emergency stop activated. All actions halted.");
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-kill-${Date.now()}`,
          role: "system",
          content: `âš ï¸ **Emergency Stop Triggered**: ${payload?.reason || "Desktop automation was halted."}`,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      VoiceEngine.speak("Emergency stop activated. All actions halted.");
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    takeControlOpenRef.current = isTakeControlOpen;
  }, [isTakeControlOpen]);
  useEffect(() => {
    if (permissionLevel === "always") {
      (window as any).magicDesktop?.setPermission("always");
    }
  }, [permissionLevel]);

  const setDesktopPermission = useCallback((level: PermissionLevel) => {
    setPermissionLevel(level);
    if (level === "always") {
      try {
        localStorage.setItem("ma9icai_desktop_permission", "always");
      } catch {
        // Persistent browser storage may be unavailable; session permission still works.
      }
    } else if (level === "deny") {
      try {
        localStorage.removeItem("ma9icai_desktop_permission");
      } catch {
        // Ignore storage cleanup failures.
      }
    }
    (window as any).magicDesktop?.setPermission(level);
  }, []);

  const executeDesktopAction = useCallback(async (actionType: string, params: Record<string, any> = {}) => {
    const coordinates = params.coordinates || {};
    const normalizedType = actionType.toUpperCase();
    const coordinateMetadata = {
      coordinateSpace: params.coordinateSpace,
      visionWidth: params.visionWidth ?? activeVision?.visionWidth,
      visionHeight: params.visionHeight ?? activeVision?.visionHeight,
      coordMap: params.coordMap ?? activeVision?.coordMap,
      coordMapString: params.coordMapString ?? activeVision?.coordMapString,
    };
    const actions: Record<string, { action: string; params: Record<string, any> }> = {
      MOVE_MOUSE: { action: "MOVE_MOUSE", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, ...coordinateMetadata } },
      CLICK_BUTTON: { action: "CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, ...coordinateMetadata } },
      DOUBLE_CLICK: { action: "DOUBLE_CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, ...coordinateMetadata } },
      RIGHT_CLICK: { action: "RIGHT_CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, ...coordinateMetadata } },
      DRAG: { action: "DRAG", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, endX: params.endX, endY: params.endY, ...coordinateMetadata } },
      SCROLL: { action: "SCROLL", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, key: params.key || "{PAGEDOWN}", ...coordinateMetadata } },
      TYPE_INPUT: { action: "TYPE_TEXT", params: { text: params.text || params.parameter || "" } },
      KEY_PRESS: { action: "KEY_PRESS", params: { key: params.key || params.key_combination || params.parameter || "" } },
      LAUNCH_APP: { action: "LAUNCH_APP", params: { app: params.app || params.parameter || "notepad" } },
      FOCUS_APP: { action: "FOCUS_APP", params: { app: params.app || params.parameter || "" } },
      CLOSE_APP: { action: "CLOSE_APP", params: { app: params.app || params.parameter || "" } },
      OPEN_FOLDER: { action: "OPEN_FOLDER", params: { path: params.path || params.parameter || "" } },
      MINIMIZE_APP: { action: "MINIMIZE_APP", params: { app: params.app || params.parameter || "" } },
      MAXIMIZE_APP: { action: "MAXIMIZE_APP", params: { app: params.app || params.parameter || "" } },
      RESTORE_APP: { action: "RESTORE_APP", params: { app: params.app || params.parameter || "" } },
      GET_ACTIVE_WINDOW: { action: "GET_ACTIVE_WINDOW", params: {} },
      INSPECT_UI_TREE: { action: "INSPECT_UI_TREE", params: { process: params.process || "", maxDepth: params.maxDepth, maxNodes: params.maxNodes, activeOnly: params.activeOnly !== false, includeUnnamed: params.includeUnnamed === true } },
      FIND_UI_ELEMENT: { action: "FIND_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process } },
      CLICK_UI_ELEMENT: { action: "CLICK_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process } },
      READ_UI_ELEMENT: { action: "READ_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process } },
      SET_UI_VALUE: { action: "SET_UI_VALUE", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process, value: params.value ?? params.text ?? "" } },
      WAIT_FOR_UI_ELEMENT: { action: "WAIT_FOR_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process, timeoutMs: params.timeoutMs, intervalMs: params.intervalMs } },
      CLICK_WEB_FIELD: { action: "CLICK_WEB_FIELD", params: { process: params.process, index: params.index } },
      NAVIGATE_URL: { action: "NAVIGATE_URL", params: { url: params.url || params.parameter || "", browser: params.browser || params.browserName || "" } },
      SEARCH_WEB: { action: "SEARCH_WEB", params: { query: params.query || params.text || params.parameter || "" } },
      DETECT_WEBPAGE: { action: "DETECT_WEBPAGE", params: { timeoutMs: params.timeoutMs, intervalMs: params.intervalMs } },
      OPEN_FILE: { action: "OPEN_FILE", params: { path: params.path || params.parameter || "" } },
      EXECUTE_SHELL: { action: "EXECUTE_SHELL", params: { command: params.command || params.cmd || params.parameter || "" } },
      FETCH_WEB_CONTENT: { action: "FETCH_WEB_CONTENT", params: { url: params.url || "", query: params.query || params.parameter || "" } },
      VERIFY_STATE: { action: "VERIFY_STATE", params: { app: params.app || params.process || params.parameter || "" } },
      WAIT: { action: "WAIT", params: { ms: params.ms || params.estimatedDurationMs || 500 } },
      SCREENSHOT_REGION: { action: "CAPTURE_REGION", params: { region: params.region || { x: params.x, y: params.y, width: params.width, height: params.height } } },
      ZOOM_SCREEN: { action: "CAPTURE_REGION", params: { region: params.region || { x: params.x, y: params.y, width: params.width, height: params.height } } },
    };
    if (normalizedType === "SCREENSHOT_REGION" || normalizedType === "ZOOM_SCREEN") {
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

    if (normalizedType === "VISION_CLICK_TARGET") {
      // [browser-2d-vision-mode-v4]
      console.log("[VISION CLICK TARGET] enabling 2.5D browser interaction mode");
      setAvatarMode("2d");
      setExperienceMode("model");
      await new Promise((resolve) => setTimeout(resolve, 650));
      const frame = await VisionService.captureScreenFrame();
      const imageData = frame.image;
      console.log("[VISION CLICK TARGET] screenshot captured", {
        bytes: imageData?.length || 0,
        targetLabel: params.targetLabel,
        visionSize: `${frame.visionWidth}x${frame.visionHeight}`,
        sourceSize: `${frame.sourceWidth}x${frame.sourceHeight}`,
      });
      const response = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageData,
          sourceWidth: frame.sourceWidth,
          sourceHeight: frame.sourceHeight,
          visionWidth: frame.visionWidth,
          visionHeight: frame.visionHeight,
          coordinateSpace: "vision",
          coordMap: frame.coordMap,
          coordMapString: frame.coordMapString,
          prompt: "Identify the exact visible clickable control matching the target in the CURRENT SCREENSHOT. Return detectedElements with label, type, boundingBox, and center coordinates in the ACTUAL SCREENSHOT PIXEL COORDINATE SYSTEM. If the target is a search bar, return only the site/page search input, not the browser toolbar, address bar, logo, menu, or arbitrary text. Do not return normalized 0-1 or 0-1000 coordinates. Do not guess coordinates. Never use a point near the top-left corner such as (0,0) unless the target is visibly there."
        }),
      });
      if (!response.ok) throw new Error("Vision analysis failed while locating the target control.");
      const vision = await response.json();
      const elements = Array.isArray(vision?.detectedElements)
        ? vision.detectedElements
        : (Array.isArray(vision?.elements) ? vision.elements : []);
      const targetLabel = String(params.targetLabel || "search").toLowerCase().trim();
      const targetIntent = String(params.targetIntent || targetLabel).toLowerCase().trim();
      const normalizeControlText = (value: unknown) =>
        String(value || "")
          .toLowerCase()
          .replace(/[\\/_-]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const controlMatches = (element: any) => {
        const label = normalizeControlText(element?.label);
        const type = normalizeControlText(element?.type);
        const text = normalizeControlText(element?.text || element?.name);
        const haystack = [label, type, text].filter(Boolean).join(" ");
        if (!haystack) return false;

        if (/sign\s*in|log\s*in|login/.test(targetIntent)) {
          return /sign\s*in|log\s*in|login/.test(haystack) &&
            /button|link|submit|sign|login/.test(haystack);
        }
        if (/username|user\s+name|email/.test(targetIntent)) {
          return /username|user\s+name|email|phone/.test(haystack) &&
            /input|text|field|textbox|email|username|phone/.test(haystack);
        }
        if (targetIntent === "password") {
          return /password|passcode/.test(haystack) &&
            /input|text|field|textbox|password/.test(haystack);
        }
        if (/search/.test(targetIntent)) {
          return /search|query|find/.test(haystack) &&
            /input|text|field|textbox|search|button/.test(haystack);
        }

        const targetWords = targetLabel.split(/[^a-z0-9]+/).filter(Boolean);
        return targetWords.length > 0 && targetWords.some((word) => haystack.includes(word));
      };

      // Prefer an exact semantic match over a loose word match. This prevents
      // "sign in" from accidentally selecting an unrelated element that merely
      // contains one common word.
      let target = [...elements]
        .filter(controlMatches)
        .sort((a: any, b: any) => {
          const aText = normalizeControlText(a?.label || a?.text || a?.name);
          const bText = normalizeControlText(b?.label || b?.text || b?.name);
          const aExact = aText.includes(normalizeControlText(targetLabel)) ? 1 : 0;
          const bExact = bText.includes(normalizeControlText(targetLabel)) ? 1 : 0;
          return bExact - aExact;
        })[0];
      // [vision-bbox-center-v1]
      // The model can return a stale/wrong "center" even when its boundingBox
      // correctly surrounds the control. Always derive the click point from
      // the bounding box when available.
      let point = target?.boundingBox
        ? {
            x: Number(target.boundingBox.x) + Number(target.boundingBox.width) / 2,
            y: Number(target.boundingBox.y) + Number(target.boundingBox.height) / 2,
          }
        : target?.center || null;

      console.log("[VISION CLICK TARGET] calculated click point", {
        label: target?.label,
        boundingBox: target?.boundingBox,
        modelCenter: target?.center,
        calculatedPoint: point,
      });

      // Roblox Sign In has a reliable native/browser fallback below. Do not
      // require the vision model to recognize the button before allowing that
      // semantic path to run; Brave can expose the page controls through
      // Windows UI Automation even when vision returns no matching element.
      if ((!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y)))
        && /sign\s*in|log\s*in|login/i.test(targetIntent)) {
        console.warn("[VISION CLICK TARGET] vision did not identify Sign In; using semantic browser fallback", {
          targetLabel: params.targetLabel,
          detectedElements: elements.length,
        });
        target = { label: "Sign in", type: "link" };
        point = { x: 0, y: 0 };
      }

      if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
        throw new Error(`Vision could not find the visible ${params.targetLabel || "target control"}.`);
      }
      console.log("[VISION CLICK TARGET] identified control", {
        requestedTarget: params.targetLabel,
        identifiedLabel: target?.label,
        identifiedType: target?.type,
        point,
        visionSize: [vision?.visionWidth || frame.visionWidth, vision?.visionHeight || frame.visionHeight],
        coordMap: vision?.coordMapString || frame.coordMapString,
      });

      // Tell the user exactly what vision identified before the physical click.
      // Listening is already stopped for the active command, so this announcement
      // cannot become another voice command.
      const identifiedLabel = String(target?.label || params.targetLabel || "the requested control").trim();
      await VoiceEngine.speak("I found " + identifiedLabel + ".");
      if (!(window as any).magicDesktop?.execute) throw new Error("Desktop control is unavailable in this app window.");

      const clickParams = {
        x: point.x,
        y: point.y,
        coordinateSpace: "vision",
        visionWidth: Number(vision?.visionWidth) || frame.visionWidth,
        visionHeight: Number(vision?.visionHeight) || frame.visionHeight,
        coordMap: vision?.coordMap || frame.coordMap,
        coordMapString: vision?.coordMapString || frame.coordMapString,
      };

      // For named browser controls such as "Sign in", prefer Windows UI
      // Automation when the browser exposes the webpage element. MiniCPM can
      // correctly identify the control but occasionally return a bad Y
      // coordinate. UI Automation invokes the actual accessible webpage
      // control without depending on the model's pixel estimate.
      if (/sign\s*in|log\s*in|login/i.test(targetIntent)) {
        // Login controls must be inspected with Magic AI already out of the
        // browser's way. Do this before DETECT_WEBPAGE / semantic clicking,
        // because those operations can happen before React's experience-mode
        // effect has a chance to resize the Electron window.
        console.log("[VISION CLICK TARGET] switching Magic AI to 2.5D before login detection");
        setAvatarMode("2d");
        // experienceMode is the single source of truth for the overlay resize.
        // Do not also call setOverlayMode here: doing both paths causes two
        // BrowserWindow bounds/repaint cycles while Brave is opening login UI.
        setExperienceMode("model");
        await new Promise((resolve) => setTimeout(resolve, 800));

        let activePage: any = null;
        let browserProcess = "";

        try {
          activePage = await (window as any).magicDesktop.execute("DETECT_WEBPAGE", {
            timeoutMs: 2500,
            intervalMs: 250,
          });
          browserProcess = String(activePage?.browser || activePage?.process || "")
            .trim()
            .toLowerCase()
            .replace(/\.exe$/i, "");

          if (browserProcess) {
            console.log("[VISION CLICK TARGET] attempting semantic browser click", {
              identifiedLabel,
              browserProcess,
              observedUrl: activePage?.url || "",
            });

            const semanticClick = await (window as any).magicDesktop.execute("CLICK_UI_ELEMENT", {
              name: "Sign in",
              process: browserProcess,
            });

            console.log("[VISION CLICK TARGET] semantic browser click completed", semanticClick);

            // The URL captured before the click can still be the old Roblox
            // page. Re-detect after the click so we do not mistake a successful
            // same-window transition to /login for a reason to open a second
            // browser window.
            await new Promise((resolve) => setTimeout(resolve, 900));
            try {
              activePage = await (window as any).magicDesktop.execute("DETECT_WEBPAGE", {
                timeoutMs: 5000,
                intervalMs: 250,
              });
              browserProcess = String(activePage?.browser || activePage?.process || browserProcess)
                .trim()
                .toLowerCase()
                .replace(/\.exe$/i, "");
              console.log("[ROBLOX LOGIN] page after Sign In click", {
                browserProcess,
                observedUrl: activePage?.url || "",
              });
            } catch (navigationCheckError) {
              console.warn("[ROBLOX LOGIN] could not re-detect page after Sign In click", navigationCheckError);
            }

            const observedUrl = String(activePage?.url || "").toLowerCase();
            if (!/roblox\.com/.test(observedUrl)) {
              return semanticClick;
            }

            // Roblox sign-in succeeded semantically. Continue directly into
            // the saved-credential flow below rather than falling back to
            // vision coordinates. The refreshed activePage prevents a second
            // browser window when Roblox already transitioned to /login.
          }
        } catch (semanticError) {
          console.warn("[VISION CLICK TARGET] semantic browser click unavailable", semanticError);
        }

        // Roblox Sign In is never allowed to fall back to MiniCPM's pixel
        // coordinate because the vision model has previously produced an
        // incorrect Y coordinate for this control.
        const activeHost = (() => {
          try {
            return new URL(String(activePage?.url || "")).hostname.toLowerCase().replace(/^www\./, "");
          } catch {
            return "";
          }
        })();

        if (activeHost === "roblox.com" || browserProcess === "brave") {
          try {
            if (activeHost !== "roblox.com" || !/\/login(?:\/|$)/i.test(String(activePage?.url || ""))) {
              console.log("[ROBLOX LOGIN] opening canonical login page");
              await (window as any).magicDesktop.execute("NAVIGATE_URL", {
                url: "https://www.roblox.com/login",
              });
              activePage = await (window as any).magicDesktop.execute("DETECT_WEBPAGE", {
                timeoutMs: 6000,
                intervalMs: 250,
              });
              browserProcess = String(activePage?.browser || activePage?.process || browserProcess || "brave")
                .trim()
                .toLowerCase()
                .replace(/\.exe$/i, "");
            }

            const clickSemantic = async (names: string[], label: string) => {
              let lastError: unknown = null;
              for (const name of names) {
                try {
                  const result = await (window as any).magicDesktop.execute("CLICK_UI_ELEMENT", {
                    name,
                    process: browserProcess,
                  });
                  console.log("[ROBLOX LOGIN] clicked semantic control", { label, name });
                  return result;
                } catch (error) {
                  lastError = error;
                }
              }
              throw lastError || new Error(`Could not find Roblox ${label} control.`);
            };

            // Put Magic AI into its small 2.5D desktop/overlay view before
            // interacting with browser credentials. This keeps the assistant
            // out of the browser's fields and saved-account popup so vision and
            // native browser UI automation can see the real controls.
            console.log("[ROBLOX LOGIN] switching Magic AI to 2.5D desktop view");
            setAvatarMode("2d");
            setExperienceMode("model");
            await new Promise((resolve) => setTimeout(resolve, 600));

            // Chromium/Brave often exposes Roblox's HTML inputs as unnamed
            // UIA Edit controls rather than their visible labels. Target the
            // first page-level Edit control instead of relying on a label that
            // UI Automation may not expose.
            const usernameField = await (window as any).magicDesktop.execute("CLICK_WEB_FIELD", {
              process: browserProcess,
              index: 0,
            });
            console.log("[ROBLOX LOGIN] focused username/email web field", usernameField);

            // Let Brave display its saved-account suggestion, then select
            // the saved account. The password itself is never read or logged.
            let accountSelected = false;
            const verifyUsernameSelected = async () => {
              try {
                const field = await (window as any).magicDesktop.execute("READ_UI_ELEMENT", {
                  automationId: "login-username",
                  process: browserProcess,
                });
                const value = String(field?.element?.value || "").trim().toLowerCase();
                return value === "ma9icman1";
              } catch {
                return false;
              }
            };

            try {
              const suggestion = await (window as any).magicDesktop.execute("WAIT_FOR_UI_ELEMENT", {
                name: "ma9icman1",
                process: browserProcess,
                timeoutMs: 4000,
                intervalMs: 200,
              });
              if (suggestion?.found) {
                await (window as any).magicDesktop.execute("CLICK_UI_ELEMENT", {
                  name: "*ma9icman1*",
                  process: browserProcess,
                });
                await new Promise((resolve) => setTimeout(resolve, 300));
                accountSelected = await verifyUsernameSelected();
                console.log("[ROBLOX LOGIN] saved-account selection", { found: true, selected: accountSelected });
              }
            } catch (accountError) {
              console.warn("[ROBLOX LOGIN] saved-account suggestion unavailable", accountError);
            }

            if (!accountSelected) {
              // Credential-manager popups are sometimes only partially exposed
              // through UI Automation. Use the browser's native selection, then
              // verify that the username field actually received ma9icman1.
              console.warn("[ROBLOX LOGIN] trying native saved-account keyboard selection");
              try {
                await new Promise((resolve) => setTimeout(resolve, 500));
                await (window as any).magicDesktop.execute("KEY_PRESS", { key: "DOWN" });
                await new Promise((resolve) => setTimeout(resolve, 150));
                await (window as any).magicDesktop.execute("KEY_PRESS", { key: "ENTER" });
                await new Promise((resolve) => setTimeout(resolve, 500));
                accountSelected = await verifyUsernameSelected();
                console.log("[ROBLOX LOGIN] keyboard saved-account selection", { selected: accountSelected });
              } catch (keyboardError) {
                console.warn("[ROBLOX LOGIN] native saved-account keyboard selection failed", keyboardError);
              }
            }

            if (!accountSelected) {
              // Last safe fallback: put the known saved username into the
              // username field. The password is never read or logged; focusing
              // the password field below gives the browser a chance to autofill
              // the stored password for this exact username.
              try {
                await (window as any).magicDesktop.execute("SET_UI_VALUE", {
                  automationId: "login-username",
                  process: browserProcess,
                  value: "ma9icman1",
                });
                await new Promise((resolve) => setTimeout(resolve, 300));
                accountSelected = await verifyUsernameSelected();
                console.log("[ROBLOX LOGIN] username fallback", { selected: accountSelected });
              } catch (usernameFallbackError) {
                console.warn("[ROBLOX LOGIN] username fallback failed", usernameFallbackError);
              }
            }

            const passwordField = await (window as any).magicDesktop.execute("CLICK_WEB_FIELD", {
              process: browserProcess,
              index: 1,
            });
            console.log("[ROBLOX LOGIN] focused password web field", passwordField);

            // Brave's credential popup can expose the saved account as a UIA element
            // for a short window after the password field receives a real click. Prefer
            // that exact semantic target when available, then fall back to the physical
            // coordinate path below. Never read or type the stored password.
            let passwordAccountSelected = false;

            try {
              const savedAccount = await (window as any).magicDesktop.execute("WAIT_FOR_UI_ELEMENT", {
                name: "*ma9icman1*",
                process: browserProcess,
                timeoutMs: 2500,
                intervalMs: 150,
              });
              if (savedAccount?.found) {
                const savedClick = await (window as any).magicDesktop.execute("CLICK_UI_ELEMENT", {
                  name: "ma9icman1",
                  process: browserProcess,
                });
                passwordAccountSelected = savedClick?.ok === true;
                console.log("[ROBLOX LOGIN] password saved-account UIA selection", {
                  found: true,
                  selected: passwordAccountSelected,
                });
                if (passwordAccountSelected) {
                  await new Promise((resolve) => setTimeout(resolve, 300));
                }
              }
            } catch (passwordSemanticError) {
              console.warn("[ROBLOX LOGIN] password saved-account UIA selection unavailable", passwordSemanticError);
            }
            const fieldElement = passwordField?.element || {};
            const fieldX = Number(fieldElement.x);
            const fieldY = Number(fieldElement.y);
            const fieldWidth = Number(fieldElement.width);
            const fieldHeight = Number(fieldElement.height);

            if ([fieldX, fieldY, fieldWidth, fieldHeight].every(Number.isFinite)) {
              const accountRowX = Math.round(fieldX + fieldWidth / 2);
              // Chromium's saved-account row is immediately below the password field.
              const accountRowY = Math.round(fieldY + fieldHeight + 34);

              try {
                await new Promise((resolve) => setTimeout(resolve, 700));

                console.log("[ROBLOX LOGIN] moving mouse to saved-account row", {
                  field: { x: fieldX, y: fieldY, width: fieldWidth, height: fieldHeight },
                  target: { x: accountRowX, y: accountRowY },
                });

                const moveResult = await (window as any).magicDesktop.execute("MOVE_MOUSE", {
                  x: accountRowX,
                  y: accountRowY,
                });
                console.log("[ROBLOX LOGIN] mouse moved to saved-account row", moveResult);

                await new Promise((resolve) => setTimeout(resolve, 150));

                const clickResult = await (window as any).magicDesktop.execute("DOUBLE_CLICK", {
                  x: accountRowX,
                  y: accountRowY,
                });
                console.log("[ROBLOX LOGIN] physically double-clicked saved-account row", clickResult);

                passwordAccountSelected = clickResult?.ok === true;
              } catch (passwordPhysicalError) {
                console.warn("[ROBLOX LOGIN] physical saved-account selection failed", passwordPhysicalError);
              }
            } else {
              console.warn("[ROBLOX LOGIN] password field returned no usable screen bounds", passwordField);
            }

            if (!passwordAccountSelected) {
              // Only use keyboard selection after the physical attempt has failed.
              try {
                await new Promise((resolve) => setTimeout(resolve, 300));
                await (window as any).magicDesktop.execute("KEY_PRESS", { key: "DOWN" });
                await new Promise((resolve) => setTimeout(resolve, 150));
                await (window as any).magicDesktop.execute("KEY_PRESS", { key: "ENTER" });
                console.log("[ROBLOX LOGIN] physical saved-account selection failed; keyboard fallback attempted");
              } catch (passwordKeyboardError) {
                console.warn("[ROBLOX LOGIN] password-field keyboard saved-account selection failed", passwordKeyboardError);
              }
            }

            // Give Brave a moment to apply the stored password before clicking
            // Log In. We never read, log, or type the password itself.
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // The saved-account popup should now be closed. Click the actual
            // Roblox Log In control underneath it using semantic UI Automation.
            await clickSemantic(
              ["Log In", "Login", "LOG IN", "LOGIN"],
              "login"
            );

            console.log("[ROBLOX LOGIN] credential flow completed", { accountSelected });

            // Restore the normal Magic AI window after the browser task has
            // handed off to Roblox. The small 2.5D view is only an automation
            // workspace, not a permanent UI change.
            await new Promise((resolve) => setTimeout(resolve, 1200));
            setExperienceMode("full");

            return { ok: true, verified: true, loginPage: true, accountSelected };
          } catch (loginError) {
            console.warn("[ROBLOX LOGIN] semantic credential flow failed", loginError);
            if (activeHost === "roblox.com") {
              throw loginError;
            }
          }
        }
      }

      // Make the physical pointer movement an explicit step before the click.
      // This makes the automation observable and gives us a clean log point
      // when diagnosing DPI/fullscreen coordinate errors.
      const moveResult = await (window as any).magicDesktop.execute("MOVE_MOUSE", clickParams);
      console.log("[VISION CLICK TARGET] mouse moved to identified control", {
        identifiedLabel,
        visionPoint: { x: point.x, y: point.y },
        moveResult,
      });

      const clickResult = await (window as any).magicDesktop.execute("CLICK", clickParams);
      console.log("[VISION CLICK TARGET] click completed", {
        identifiedLabel,
        visionPoint: { x: point.x, y: point.y },
        clickResult,
      });

      // A successful Windows mouse event is not the same thing as a successful
      // web interaction. Verify the browser actually left the current page.
      // Roblox can occasionally ignore the synthetic click while its page is
      // still settling, so keep a deterministic fallback for its Sign In control.
      if (/sign\s*in|log\s*in|login/i.test(targetIntent)) {
        await new Promise((resolve) => setTimeout(resolve, 1200));

        let webpage: any = null;
        try {
          webpage = await (window as any).magicDesktop.execute("DETECT_WEBPAGE", {
            timeoutMs: 2500,
            intervalMs: 250,
          });
        } catch (verificationError) {
          console.warn("[VISION CLICK TARGET] post-click webpage verification unavailable", verificationError);
        }

        const observedUrl = String(webpage?.url || "").trim();
        const observedHost = (() => {
          try {
            return new URL(observedUrl).hostname.toLowerCase().replace(/^www\./, "");
          } catch {
            return "";
          }
        })();
        const observedPath = (() => {
          try {
            return new URL(observedUrl).pathname.toLowerCase();
          } catch {
            return "";
          }
        })();

        console.log("[VISION CLICK TARGET] post-click verification", {
          identifiedLabel,
          observedUrl,
          observedHost,
          observedPath,
          detected: Boolean(webpage?.detected),
        });

        // Roblox's current web login route is /login. Only use this fallback
        // when we know the visible target was a sign-in control on roblox.com.
        // The real physical click above is still attempted first.
        if (
          observedHost === "roblox.com" &&
          !/^\/(?:login|newlogin)(?:\/|$)/i.test(observedPath)
        ) {
          console.warn("[VISION CLICK TARGET] Roblox Sign In did not transition; opening the canonical login route.");
          return await (window as any).magicDesktop.execute("NAVIGATE_URL", {
            url: "https://www.roblox.com/login",
          });
        }
      }

      return clickResult;
    }
    const mapped = actions[normalizedType];
    if (!mapped) throw new Error(`Unsupported desktop action: ${actionType}`);
    if (!(window as any).magicDesktop?.execute) throw new Error("Desktop control is unavailable in this app window.");
    if (normalizedType === "SEARCH_WEB" && !String(mapped.params.query).trim()) {
      throw new Error("No web search query was provided.");
    }
    if (["MOVE_MOUSE", "CLICK_BUTTON", "DOUBLE_CLICK", "RIGHT_CLICK", "DRAG", "SCROLL"].includes(normalizedType)) {
      const x = mapped.params.x;
      const y = mapped.params.y;
      if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
        throw new Error(`This action needs screen coordinates. Ask ${assistantName} to inspect the screen first, then try again.`);
      }
      if (normalizedType === "DRAG" && (!Number.isFinite(Number(mapped.params.endX)) || !Number.isFinite(Number(mapped.params.endY)))) {
        throw new Error("Drag actions need a destination point.");
      }
      if (normalizedType === "NAVIGATE_URL" && !String(mapped.params.url).trim()) {
        throw new Error("No URL was provided for navigation.");
      }
    }
    return await (window as any).magicDesktop.execute(mapped.action, mapped.params);
  }, [activeVision]);

  const handleXRayTargetClick = useCallback(async (element: VisionDetection["detectedElements"][number]) => {
    const point = element.center || (element.boundingBox
      ? {
          x: element.boundingBox.x + element.boundingBox.width / 2,
          y: element.boundingBox.y + element.boundingBox.height / 2,
        }
      : undefined);

    if (!point) return;

    const clickPlan: MultiStepPlan = {
      id: "xray-click-" + Date.now(),
      planTitle: "Click " + (element.label || "selected target"),
      spokenIntro: "I found " + (element.label || "the selected target") + " on your screen.",
      steps: [{
        stepNumber: 1,
        description: "Click " + (element.label || "selected target"),
        actionType: "CLICK_BUTTON",
        params: {
        x: point.x,
        y: point.y,
        coordinateSpace: "vision",
        visionWidth: activeVision?.visionWidth,
        visionHeight: activeVision?.visionHeight,
        coordMap: activeVision?.coordMap,
        coordMapString: activeVision?.coordMapString,
      },
        status: "pending",
        estimatedDurationMs: 500,
      }],
      spokenCompletion: "Clicked " + (element.label || "the selected target") + ".",
      currentStepIndex: 0,
      status: "idle",
    };

    if (permissionLevel === "none" || permissionLevel === "deny") {
      setPendingPlan(clickPlan);
      setIsPermissionOpen(true);
      return;
    }

    try {
      await executeDesktopAction("CLICK_BUTTON", clickPlan.steps[0].params);
      VoiceEngine.speak(clickPlan.spokenCompletion);
      setIsXRayVisible(false);
    } catch (error) {
      console.warn("Magic X-Ray target click failed:", error);
      VoiceEngine.speak(describeError(error, "Desktop control is not enabled for that target."));
    }
  }, [executeDesktopAction, permissionLevel, activeVision]);

  // Handle Assistant Speech Output
  const handleSpeakText = useCallback((text: string) => {
    setAssistantState("speaking");
    VoiceEngine.speak(text, () => {
      setAssistantState("idle");
    });
  }, []);

  // Stop current speaking
  const handleStopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setAssistantState("idle");
  }, []);

  // Execute multi-step task sequence locally if suggested
  const executePlanSequence = useCallback(
    async (plan: MultiStepPlan) => {
      stopExecutionRef.current = false;
      setAssistantState("executing");
      setShowActivityPanel(true);

      // A multi-step voice command is one approved desktop operation. If the
      // user chose "one action", temporarily scope that approval to the whole
      // plan so step 1 cannot consume it before step 2 (vision/UI automation).
      const planUsesOneActionPermission = permissionLevel === "one_action";
      if (planUsesOneActionPermission) {
        setDesktopPermission("one_session");
      }

      const rawSteps = Array.isArray(plan?.steps) ? plan.steps : [];

      // [youtube-executor-direct-v1]
      // Never let a YouTube search plan fall through to vision clicking.
      // Convert any YouTube search plan into one deterministic results URL.
      let normalizedSteps = rawSteps;

      const youtubeStep = rawSteps.find((step: any) =>
        step &&
        String(step.actionType || "").toUpperCase() === "NAVIGATE_URL" &&
        /youtube\.com/i.test(String(step.params?.url || ""))
      );

      const youtubeSearchText = rawSteps
        .map((step: any) => String(step?.description || ""))
        .join(" ");

      if (youtubeStep && /search/i.test(youtubeSearchText)) {
        const originalUrl = String(youtubeStep.params?.url || "");
        const searchMatch = originalUrl.match(/[?&]search_query=([^&]+)/i);

        if (searchMatch) {
          const query = decodeURIComponent(searchMatch[1]);
          normalizedSteps = [{
            ...youtubeStep,
            description: "Open YouTube search results for " + query,
            params: {
              url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(query)
            }
          }];

          console.log("[PLAN EXECUTOR] YouTube direct-search override", {
            query,
            url: normalizedSteps[0].params.url
          });
        }
      }

      const steps = normalizedSteps.filter((step: any) =>
        step &&
        typeof step === "object" &&
        String(step.actionType || "").trim()
      );
      console.log("[PLAN EXECUTOR] received plan", {
        title: plan?.planTitle || "",
        stepCount: rawSteps.length,
        executableStepCount: steps.length,
        steps: steps.map((step: any) => ({
          actionType: step.actionType,
          description: step.description,
          params: step.params || {},
        })),
      });
      if (!steps.length) {
        if (planUsesOneActionPermission) setDesktopPermission("none");
        setAssistantState("error");
        setShowActivityPanel(false);
        VoiceEngine.speak("The assistant created an empty desktop action plan.", () => setAssistantState("idle"));
        return;
      }

      for (let i = 0; i < steps.length; i++) {
        if (stopExecutionRef.current) {
          setAssistantState("idle");
          setActivityText("");
          setShowActivityPanel(false);
          return;
        }
        setActivityText(steps[i].description || `Running step ${i + 1}`);
        // Update plan progress
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.action?.multiStepPlan) {
              return {
                ...msg,
                action: {
                  ...msg.action,
                  multiStepPlan: {
                    ...msg.action.multiStepPlan,
                    steps: msg.action.multiStepPlan.steps.map((s, idx) =>
                      idx === i ? { ...s, status: "running" } : s
                    ),
                  },
                },
              };
            }
            return msg;
          })
        );

        try {
          console.log("[PLAN EXECUTOR] invoking desktop action", {
            step: i + 1,
            actionType: steps[i].actionType,
            params: steps[i].params || {},
          });
          const actionResult = await executeDesktopAction(steps[i].actionType, {
            ...steps[i].params,
            parameter: steps[i].parameter,
            coordinates: steps[i].coordinates,
            estimatedDurationMs: steps[i].estimatedDurationMs,
            coordinateSpace: steps[i].params?.coordinateSpace,
            visionWidth: steps[i].params?.visionWidth,
            visionHeight: steps[i].params?.visionHeight,
            coordMap: steps[i].params?.coordMap,
            coordMapString: steps[i].params?.coordMapString,
          });

          // Web navigation/search is followed immediately by a visual scan so
          // ma9icAI starts with a live understanding of the page it just opened.
          const completedActionType = String(steps[i].actionType).toUpperCase();
          if (["NAVIGATE_URL", "SEARCH_WEB"].includes(completedActionType)) {
            // Navigation/search actions are already verified by the desktop runtime.
            // Do not automatically invoke vision here; deterministic destinations
            // should not trigger an unnecessary Ollama screen-analysis pass.
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else if (completedActionType === "VISION_CLICK_TARGET") {
            // Observe again after a vision-driven click. This gives the assistant
            // a fresh page state for the next command instead of carrying stale
            // coordinates from the previous screenshot.
            await new Promise((resolve) => setTimeout(resolve, 500));
            await captureScreenRef.current?.();
          }

          const stepStdout = typeof actionResult?.stdout === "string" ? actionResult.stdout : undefined;
          const stepWebContent = typeof actionResult?.content === "string" ? actionResult.content : undefined;

          // Mark step completed with output
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.action?.multiStepPlan) {
                return {
                  ...msg,
                  action: {
                    ...msg.action,
                    multiStepPlan: {
                      ...msg.action.multiStepPlan,
                      steps: msg.action.multiStepPlan.steps.map((s, idx) =>
                        idx === i ? { ...s, status: "completed", stdout: stepStdout, webContent: stepWebContent, result: actionResult } : s
                      ),
                    },
                  },
                };
              }
              return msg;
            })
          );
        } catch (error) {
          const rawReason = describeError(error, "The desktop action did not complete.");
          const reason = rawReason.length > 180 ? "Windows rejected the desktop action. Check the target app and permissions." : rawReason;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.action?.multiStepPlan
                ? { ...msg, action: { ...msg.action, multiStepPlan: { ...msg.action.multiStepPlan, status: "aborted", steps: msg.action.multiStepPlan.steps.map((step, index) => index === i ? { ...step, status: "failed" } : step) } } }
                : msg
            )
          );
          if (planUsesOneActionPermission) setDesktopPermission("none");
          setAssistantState("error");
          setShowActivityPanel(false);
          VoiceEngine.speak(`Desktop control stopped: ${reason}`, () => setAssistantState("idle"));
          return;
        }

// Step completed
      }

      if (planUsesOneActionPermission) setDesktopPermission("none");