import React, { useState, useEffect, useCallback, useRef } from "react";
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
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>("none");
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

  useEffect(() => {
    document.body.classList.toggle("desktop-shell", isDesktopShell);
    return () => document.body.classList.remove("desktop-shell");
  }, [isDesktopShell]);

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
    takeControlOpenRef.current = isTakeControlOpen;
  }, [isTakeControlOpen]);

  const setDesktopPermission = useCallback((level: PermissionLevel) => {
    setPermissionLevel(level);
    (window as any).magicDesktop?.setPermission(level);
  }, []);

  const executeDesktopAction = useCallback(async (actionType: string, params: Record<string, any> = {}) => {
    const coordinates = params.coordinates || {};
    const normalizedType = actionType.toUpperCase();
    const actions: Record<string, { action: string; params: Record<string, any> }> = {
      MOVE_MOUSE: { action: "MOVE_MOUSE", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },
      CLICK_BUTTON: { action: "CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },
      DOUBLE_CLICK: { action: "DOUBLE_CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },
      RIGHT_CLICK: { action: "RIGHT_CLICK", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, coordinateSpace: params.coordinateSpace } },
      DRAG: { action: "DRAG", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, endX: params.endX, endY: params.endY, coordinateSpace: params.coordinateSpace } },
      SCROLL: { action: "SCROLL", params: { x: params.x ?? coordinates.x, y: params.y ?? coordinates.y, key: params.key || "{PAGEDOWN}", coordinateSpace: params.coordinateSpace } },
      TYPE_INPUT: { action: "TYPE_TEXT", params: { text: params.text || params.parameter || "" } },
      KEY_PRESS: { action: "KEY_PRESS", params: { key: params.key || params.key_combination || params.parameter || "" } },
      LAUNCH_APP: { action: "LAUNCH_APP", params: { app: params.app || params.parameter || "notepad" } },
      FOCUS_APP: { action: "FOCUS_APP", params: { app: params.app || params.parameter || "" } },
      CLOSE_APP: { action: "CLOSE_APP", params: { app: params.app || params.parameter || "" } },
      OPEN_FOLDER: { action: "OPEN_FOLDER", params: { path: params.path || params.parameter || "" } },
      GET_ACTIVE_WINDOW: { action: "GET_ACTIVE_WINDOW", params: {} },
      INSPECT_UI_TREE: { action: "INSPECT_UI_TREE", params: { process: params.process || "", maxDepth: params.maxDepth, maxNodes: params.maxNodes, activeOnly: params.activeOnly !== false, includeUnnamed: params.includeUnnamed === true } },
      FIND_UI_ELEMENT: { action: "FIND_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process } },
      CLICK_UI_ELEMENT: { action: "CLICK_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process } },
      READ_UI_ELEMENT: { action: "READ_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process } },
      SET_UI_VALUE: { action: "SET_UI_VALUE", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process, value: params.value ?? params.text ?? "" } },
      WAIT_FOR_UI_ELEMENT: { action: "WAIT_FOR_UI_ELEMENT", params: { name: params.name, automationId: params.automationId, controlType: params.controlType, process: params.process, timeoutMs: params.timeoutMs, intervalMs: params.intervalMs } },
      NAVIGATE_URL: { action: "NAVIGATE_URL", params: { url: params.url || params.parameter || "" } },
      SEARCH_WEB: { action: "SEARCH_WEB", params: { query: params.query || params.text || params.parameter || "" } },
      DETECT_WEBPAGE: { action: "DETECT_WEBPAGE", params: { timeoutMs: params.timeoutMs, intervalMs: params.intervalMs } },
      OPEN_FILE: { action: "OPEN_FILE", params: { path: params.path || params.parameter || "" } },
      WAIT: { action: "WAIT", params: { ms: params.ms || params.estimatedDurationMs || 500 } },
    };
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
  }, []);

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
        params: { x: point.x, y: point.y, coordinateSpace: "vision" },
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
  }, [executeDesktopAction, permissionLevel]);

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

      for (let i = 0; i < plan.steps.length; i++) {
        if (stopExecutionRef.current) {
          setAssistantState("idle");
          setActivityText("");
          setShowActivityPanel(false);
          return;
        }
        setActivityText(plan.steps[i].description || `Running step ${i + 1}`);
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
          await executeDesktopAction(plan.steps[i].actionType, {
            ...plan.steps[i].params,
            parameter: plan.steps[i].parameter,
            coordinates: plan.steps[i].coordinates,
            estimatedDurationMs: plan.steps[i].estimatedDurationMs,
            coordinateSpace: plan.steps[i].params?.coordinateSpace,
          });

          // Web navigation/search is followed immediately by a visual scan so
          // ma9icAI starts with a live understanding of the page it just opened.
          if (["NAVIGATE_URL", "SEARCH_WEB"].includes(String(plan.steps[i].actionType).toUpperCase())) {
            await new Promise((resolve) => setTimeout(resolve, 700));
            await captureScreenRef.current?.();
          }
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
          setAssistantState("error");
          setShowActivityPanel(false);
          VoiceEngine.speak(`Desktop control stopped: ${reason}`, () => setAssistantState("idle"));
          return;
        }

        // Mark step completed
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
                      idx === i ? { ...s, status: "completed" } : s
                    ),
                  },
                },
              };
            }
            return msg;
          })
        );
      }

      setAssistantState("speaking");
      const completionText = plan.spokenCompletion || "I have completed all steps in the plan.";
      VoiceEngine.speak(completionText, () => {
        setAssistantState("idle");
        setActivityText("");
        setShowActivityPanel(false);
      });
    },
    [executeDesktopAction]
  );

  // Screen Capture & Multimodal Vision Analysis (Gemini Flash OCR)
  const handleCaptureScreen = useCallback(async (): Promise<VisionDetection | null> => {
    setIsAnalyzingVision(true);
    setAssistantState("processing");
    VoiceEngine.speak("Examining your screen right now.");

    try {
      const base64Image = await VisionService.captureScreen();
      setVisionThumbnail(base64Image);
      // Screen captures belong in the conversation feed, not the Vision placeholder page.
      setActiveSection("Chat");

      const response = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: base64Image,
          instruction:
            "Find the active application and visible actionable controls. Return exact screenshot-pixel boundingBox and center coordinates for each important control.",
        }),
      });

      let visionResult: VisionDetection;
      if (response.ok) {
        visionResult = await response.json();
      } else {
        visionResult = {
          summary: "I examined the screen snapshot and am ready for your next instruction.",
          openWindows: ["Current Window"],
          activeApplication: "Desktop Workspace",
          detectedElements: [],
          extractedText: "",
          suggestedActions: ["Ask question", "Run command"],
        };
      }
      setActiveVision(visionResult);
      publishVisionToUnreal(visionResult);
      setIsXRayVisible(true);

      setAssistantState("speaking");
      VoiceEngine.speak(visionResult.summary, () => {
        setAssistantState("idle");
      });

      // Add to conversation feed with thumbnail
      setMessages((prev) => [
        ...prev,
        {
          id: `vision-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          role: "assistant",
          content: visionResult.summary,
          visionThumbnail: base64Image,
          vision: visionResult,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      return visionResult;
    } catch (err) {
      console.error("Screen capture error:", err);
      VoiceEngine.speak(`Screen inspection failed: ${describeError(err, "screen capture was cancelled or unavailable.")}`);
      setAssistantState("idle");
      return null;
    } finally {
      setIsAnalyzingVision(false);
    }
  }, []);

  captureScreenRef.current = handleCaptureScreen;

  // Web Camera Snapshot & Analysis
  const handleCaptureCamera = useCallback(async () => {
    setIsAnalyzingVision(true);
    setAssistantState("processing");
    VoiceEngine.speak("Taking a camera snapshot.");

    try {
      const base64Image = await VisionService.captureWebcam();
      setVisionThumbnail(base64Image);

      const response = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: base64Image,
          instruction: "Describe what you see through the user's camera clearly and concisely.",
        }),
      });

      let visionResult: VisionDetection;
      if (response.ok) {
        visionResult = await response.json();
      } else {
        visionResult = {
          summary: "Camera snapshot captured and processed.",
          openWindows: [],
          activeApplication: "Camera Feed",
          detectedElements: [],
          extractedText: "",
          suggestedActions: ["Capture another", "Ask question"],
        };
      }
      setActiveVision(visionResult);

      setAssistantState("speaking");
      VoiceEngine.speak(visionResult.summary, () => {
        setAssistantState("idle");
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `camera-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          role: "assistant",
          content: visionResult.summary,
          visionThumbnail: base64Image,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (err) {
      console.error("Webcam error:", err);
      VoiceEngine.speak(`Camera inspection failed: ${describeError(err, "camera access was not granted.")}`);
      setAssistantState("idle");
    } finally {
      setIsAnalyzingVision(false);
    }
  }, []);

  // Trigger Magic's greeting when the user says "Magic" or clicks the orb
  const armWakeWord = useCallback(async () => {
    VoiceEngine.setWakeWordMode(true);
    try {
      await VoiceEngine.startListening();
      setIsListening(true);
      setAssistantState("listening");
      setVoiceNotice("Wake word active — say ma9icAI.");
    } catch (error) {
      VoiceEngine.setWakeWordMode(false);
      setIsListening(false);
      setAssistantState("idle");
      setVoiceNotice(describeError(error, "Microphone access is unavailable."));
    }
  }, []);

  const triggerMagicGreeting = useCallback((startListeningAfter = true) => {
    // A wake word must hand the microphone to the greeting, then restart it
    // after TTS finishes. Otherwise the old listener can hear ma9icAI speaking
    // and immediately trigger another wake word.
    VoiceEngine.setWakeWordMode(false);
    VoiceEngine.stopListening();
    VoiceEngine.stopSpeaking();

    const greetings = [
      "Hi there. What can I help you with today?",
      "Good to see you. I am ready when you are.",
      "Hello. Your desktop assistant is online.",
      "Welcome back. What would you like to do?",
      "Hi. I am here and listening when you need me.",
    ];
    let greetingIndex = Math.floor(Math.random() * greetings.length);
    if (greetings.length > 1 && greetingIndex === lastGreetingRef.current) {
      greetingIndex = (greetingIndex + 1) % greetings.length;
    }
    lastGreetingRef.current = greetingIndex;
    const greetingText = greetings[greetingIndex];

    setMessages((prev) => [
      ...prev,
      {
        id: `msg-asst-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: "assistant",
        content: greetingText,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);

    setAssistantState("speaking");
    setIsListening(false);

    VoiceEngine.speak(greetingText, () => {
      if (!startListeningAfter) {
        void armWakeWord();
        return;
      }

      VoiceEngine.startListening()
        .then(() => {
          setVoiceNotice(null);
          setIsListening(true);
          setAssistantState("listening");
        })
        .catch((error) => {
          setIsListening(false);
          setAssistantState("idle");
          setVoiceNotice(describeError(error, "Microphone access is unavailable."));
        });
    });
  }, []);

  // Send Message to Gemini Chat API
  const handleSendMessage = useCallback(
    async (text: string, visionOverride?: VisionDetection | null) => {
      if (!text.trim()) return;

      const escapedAssistantName = assistantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const isPureWakeWord = new RegExp(`^\\s*(hey\\s+|hi\\s+|ok\\s+|okay\\s+)?${escapedAssistantName}[!?.,]*\\s*$`, "i").test(text.trim());
      if (isPureWakeWord) {
        triggerMagicGreeting();
        return;
      }

      const userMsg: ChatMessage = {
        id: `msg-user-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        role: "user",
        content: text,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, userMsg]);
      setAssistantState("processing");

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history: messages.slice(-6).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            memories: MemoryService.getMemories(),
            visionContext: visionOverride ?? activeVision,
            assistantName,
          }),
        });

        let data: any = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }

        if (!response.ok && !data?.spokenResponse) {
          throw new Error(data?.error || `Chat server returned HTTP ${response.status}.`);
        }

        const spokenText = data?.spokenResponse || data?.spokenReply || "The assistant returned no response. Check the Ollama connection and selected model.";

        const assistantMsg: ChatMessage = {
          id: `msg-asst-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          role: "assistant",
          content: spokenText,
          action: data.action,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setAssistantState("speaking");

        VoiceEngine.speak(spokenText, () => {
          setAssistantState("idle");
        });

          // Handle specific actions if present
          if (data.action?.type === "LAUNCH_APP" || data.action?.type === "OPEN_FILE") {
          const appName = data.action.app || data.action.parameter || data.action.params?.app;
            const filePath = data.action.path || data.action.parameter || data.action.params?.path;
            const actionType = data.action.type;
            const plan: MultiStepPlan = {
              id: `launch-${Date.now()}`,
              planTitle: actionType === "OPEN_FILE" ? `Open ${filePath || "file"}` : `Open ${appName || "application"}`,
              spokenIntro: spokenText,
              steps: [{
                stepNumber: 1,
                description: actionType === "OPEN_FILE" ? `Open ${filePath || "file"}` : `Launch ${appName || "application"}`,
                actionType,
                params: actionType === "OPEN_FILE" ? { path: filePath } : { app: appName },
              status: "pending",
              estimatedDurationMs: 1000,
            }],
            spokenCompletion: actionType === "OPEN_FILE"
              ? `${filePath || "The file"} is open.`
              : `${appName || "The application"} is open.`,
            currentStepIndex: 0,
            status: "idle",
          };
          if (permissionLevel === "none" || permissionLevel === "deny") {
            setPendingPlan(plan);
            setIsPermissionOpen(true);
          } else {
            executePlanSequence(plan);
          }
        } else if (data.action?.type === "REMEMBER" && data.action.parameter) {
          MemoryService.addMemory("Preference", data.action.parameter, "preference", "persistent");
          setMemories(MemoryService.getMemories());
        } else if (data.action?.type === "SCREEN_ANALYSIS") {
          handleCaptureScreen();
        } else if (data.action?.type === "MULTI_STEP_PLAN" && data.action.multiStepPlan) {
          const plan = data.action.multiStepPlan as MultiStepPlan;
          if (permissionLevel === "none" || permissionLevel === "deny") {
            setPendingPlan(plan);
            setIsPermissionOpen(true);
          } else {
            executePlanSequence(plan);
          }
        }
      } catch (err) {
        console.error("Chat error:", err);
        setAssistantState("error");
        VoiceEngine.speak(`Chat failed: ${describeError(err, "the assistant could not process that request.")}`);
        setTimeout(() => setAssistantState("idle"), 3000);
      }
    },
    [messages, activeVision, assistantName, executePlanSequence, handleCaptureScreen, permissionLevel, triggerMagicGreeting]
  );

  const handlePermissionGrant = useCallback((level: PermissionLevel) => {
    setDesktopPermission(level);
    setIsPermissionOpen(false);
    if (pendingPlan) {
      const plan = pendingPlan;
      setPendingPlan(null);
      executePlanSequence(plan);
    }
  }, [executePlanSequence, pendingPlan, setDesktopPermission]);

  const handleTakeControl = useCallback(async (task: string) => {
    setIsTakeControlOpen(false);
    setIsTakeControlListening(false);
    VoiceEngine.stopListening();
    setTakeControlTask("");
    const screenContext = await handleCaptureScreen();
    await handleSendMessage(task, screenContext);
  }, [handleCaptureScreen, handleSendMessage]);

  const handlePermissionDeny = useCallback(() => {
    setDesktopPermission("deny");
    setPendingPlan(null);
    setIsPermissionOpen(false);
    VoiceEngine.speak("Desktop control was cancelled.");
  }, [setDesktopPermission]);

  // Toggle Voice Listening
  const handleToggleListening = useCallback(() => {
    if (isListening) {
      VoiceEngine.stopListening();
      setIsListening(false);
      setAssistantState("idle");
      setAudioLevel(0);
      setVoiceNotice(null);
    } else {
      setIsListening(true);
      setAssistantState("listening");
      setVoiceNotice("Starting microphone…");
      VoiceEngine.startListening().then(() => {
        setVoiceNotice("Microphone active — speak now.");
      }).catch((error) => {
        setIsListening(false);
        setAssistantState("error");
        setVoiceNotice(describeError(error, "Microphone access is unavailable."));
        setAssistantState("idle");
      });
    }
  }, [isListening]);

  const handleTakeControlVoice = useCallback(() => {
    if (isTakeControlListening) {
      VoiceEngine.stopListening();
      setIsTakeControlListening(false);
      return;
    }
    VoiceEngine.startListening()
      .then(() => {
        setIsTakeControlListening(true);
        setVoiceNotice(null);
      })
      .catch((error) => {
        setIsTakeControlListening(false);
        setVoiceNotice(describeError(error, "Microphone access is unavailable."));
      });
  }, [isTakeControlListening]);

  const handleStopDesktopControl = useCallback(() => {
    stopExecutionRef.current = true;
    (window as any).magicDesktop?.emergencyStop?.();
    setDesktopPermission("deny");
    setAssistantState("idle");
    setActivityText("");
    setShowActivityPanel(false);
    VoiceEngine.speak("Desktop control stopped.");
  }, [setDesktopPermission]);

  const handleModelQuickAction = useCallback(
    (action: "todo" | "important" | "inspect") => {
      const prompts = {
        todo: "Show me my important to-do items and help me decide what to do next.",
        important: "Review our conversation and tell me the most important items I should remember or act on.",
        inspect: "Inspect my screen and tell me what is active.",
      };
      handleSendMessage(prompts[action]);
    },
    [handleSendMessage]
  );
  // Click on the orb triggers "Hi, how can I help you?" or stops speaking
  const handleOrbClick = useCallback(() => {
    if (assistantState === "speaking") {
      VoiceEngine.stopSpeaking();
      setAssistantState("idle");
    } else {
      triggerMagicGreeting();
    }
  }, [assistantState, triggerMagicGreeting]);

  // Memory additions and removals
  const handleAddMemory = useCallback(
    (key: string, value: string, category: "preference" | "routine" | "application" | "user_info" | "website") => {
      MemoryService.addMemory(key, value, category, "persistent");
      setMemories(MemoryService.getMemories());
      VoiceEngine.speak(`I will remember that your ${key} is ${value}.`);
    },
    []
  );

  const handleRemoveMemory = useCallback((id: string) => {
    MemoryService.removeMemory(id);
    setMemories(MemoryService.getMemories());
  }, []);

  // Initial setup & event listeners
  useEffect(() => {
    // 1. Load memories
    setMemories(MemoryService.getMemories());
    let cleanupVoices = () => {};

    // 2. Load SpeechSynthesis voices
    if ("speechSynthesis" in window) {
      const updateVoices = () => {
        const engineVoices = VoiceEngine.getVoices();
        const browserVoices = window.speechSynthesis.getVoices();
        const voices = [...engineVoices, ...browserVoices].filter(
          (voice, index, all) => all.findIndex((candidate) =>
            candidate.name === voice.name &&
            candidate.lang === voice.lang &&
            candidate.voiceURI === voice.voiceURI
          ) === index
        );
        if (voices.length > 0) setAvailableVoices(voices);
      };
      updateVoices();
      window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
      const voiceLoadRetry = window.setInterval(updateVoices, 250);
      window.setTimeout(() => window.clearInterval(voiceLoadRetry), 5000);
      cleanupVoices = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
        window.clearInterval(voiceLoadRetry);
      };
    }

    // 3. Connect speech recognition callback
    const unsubSpeech = VoiceEngine.onSpeechRecognized((transcript: string) => {
      const micOffCommand = /^(?:turn|switch|shut|stop)\s+(?:the\s+)?(?:mic|microphone|listening)(?:\s+off)?[.!?]*$/i.test(transcript.trim())
        || /^(?:turn|switch|shut|stop)\s+off\s+(?:the\s+)?(?:mic|microphone|listening)[.!?]*$/i.test(transcript.trim());
      if (micOffCommand) {
        // "Turn off mic" exits active command mode and returns to local
        // wake-word standby, so the assistant can still be awakened hands-free.
        void armWakeWord();
        VoiceEngine.speak("Microphone commands are off. Say ma9icAI when you need me.");
        return;
      }

      if (takeControlOpenRef.current) {
        setTakeControlTask((current) => `${current ? `${current} ` : ""}${transcript}`.trim());
        setIsTakeControlListening(false);
        VoiceEngine.stopListening();
        return;
      }
      setAssistantState("processing");
      handleSendMessage(transcript);
    });

    // 4. Connect wake-word callback ("Magic")
    const unsubWake = VoiceEngine.onWakeWordDetected(() => {
      triggerMagicGreeting();
    });

    // 5. Connect audio level meter
    const unsubAudio = VoiceEngine.onAudioLevel((lvl: number) => {
      setAudioLevel(lvl);
    });
    const unsubVoiceError = VoiceEngine.onError((message: string) => {
      console.warn("Voice recognition stopped:", message);
      setVoiceNotice(message);
      const isPermanentVoiceError = /permission was denied|unavailable|audio-capture|could not be initialized|speech recognition stopped|speech process did not start/i.test(message);
      if (isPermanentVoiceError) {
        setIsListening(false);
        setAssistantState("error");
        setAssistantState("idle");
      } else {
        setAssistantState("listening");
      }
    });

    return () => {
      cleanupVoices();
      unsubSpeech();
      unsubWake();
      unsubAudio();
      unsubVoiceError();
      VoiceEngine.stopListening();
    };
  }, [armWakeWord, handleSendMessage, triggerMagicGreeting]);

  useEffect(() => {
    const greetingTimer = window.setTimeout(() => triggerMagicGreeting(false), 900);
    return () => window.clearTimeout(greetingTimer);
  }, [triggerMagicGreeting]);

  const dashboardPrompts = [
    { title: 'Open Chrome', sub: 'Launch applications', icon: <AppWindow />, prompt: 'Open Chrome' },
    { title: "What’s the weather today?", sub: 'Get information', icon: <Globe2 />, prompt: "What's the weather today?" },
    { title: 'Show me my desktop', sub: 'Window management', icon: <Monitor />, prompt: 'Show me my desktop' },
    { title: 'Set a timer for 10 minutes', sub: 'Productivity tools', icon: <Settings />, prompt: 'Set a timer for 10 minutes' },
    { title: 'Open my documents', sub: 'File & folder access', icon: <FolderOpen />, prompt: 'Open my documents' },
    { title: 'Help me with this task', sub: 'General assistance', icon: <Lightbulb />, prompt: 'Help me with this task' },
  ];

  const runDashboardPrompt = (prompt: string) => {
    setActiveSection('Chat');
    void handleSendMessage(prompt);
  };

  return (
    <div className={`ma9ic-shell w-screen h-screen overflow-hidden text-slate-100 flex flex-col font-sans select-none relative ${isDesktopShell ? "desktop-shell" : ""}`}>
      {experienceMode === "model" ? (
        <AvatarCanvas
          isSpeaking={assistantState === "speaking"}
          isListening={isListening}
          audioLevel={audioLevel}
          modelOnly
          onSpeakGreeting={triggerMagicGreeting}
          onToggleListening={handleToggleListening}
          onCaptureScreen={handleCaptureScreen}
          onSendMessage={handleSendMessage}
          status={assistantState}
          voiceNotice={voiceNotice}
          connectionProgress={connectionProgress}
          onQuickAction={handleModelQuickAction}
          onToggleFullView={() => setExperienceMode("full")}
          onModelConnectionChange={setModelConnected}
          loadOnMount
          className="h-screen w-screen"
        />
      ) : (
        <>
          <header className="ma9ic-header shrink-0">
            <button type="button" onClick={() => setIsSettingsOpen(true)} className="ma9ic-brand" title="Open assistant settings">
              <img src="/ui/ma9icai-logo.png" alt="ma9icAI" className="ma9ic-brand-logo" />
              <div>
                <div className="ma9ic-brand-title">ma9icAI</div>
              </div>
            </button>
            <div className="ma9ic-header-tagline">✦ Your AI. Your Desktop. Your Control.</div>
            <div className="ma9ic-header-actions">
              <span className={`ma9ic-online ${aiConnected ? "ready" : "offline"}`}><i />{aiConnected ? "Online" : "Offline"}</span>
              <button type="button" onClick={() => (window as any).magicWindow?.minimize?.()} className="ma9ic-window-btn" title="Minimize">—</button>
              <button type="button" onClick={() => (window as any).magicWindow?.toggleMaximize?.()} className="ma9ic-window-btn" title="Maximize">□</button>
              <button type="button" onClick={() => (window as any).magicWindow?.close()} className="ma9ic-window-btn close" title={`Close ${assistantName}`}><X /></button>
            </div>
          </header>

          <div className="ma9ic-body">
            <aside className="ma9ic-sidebar">
              <nav className="ma9ic-nav">
                {[
                  ['Home', <Home />], ['Chat', <MessageSquare />], ['Voice', <Mic2 />], ['Vision', <ScanEye />], ['Windows Control', <Monitor />], ['Apps & Tools', <Grid2X2 />], ['AI Models', <Cpu />], ['About', <Info />]
                ].map(([label, icon]) => (
                  <button key={String(label)} type="button" className={`ma9ic-nav-item ${activeSection === label ? "selected" : ""}`} onClick={() => {
                    setActiveSection(String(label));
                    if (label === 'AI Models') openOllamaSettings();
                    else if (label === 'Voice') setIsSettingsOpen(true);
                    else if (label === 'Vision') void handleCaptureScreen();
                    else if (label === 'Windows Control') setIsTakeControlOpen(true);
                  }}>
                    <span className="ma9ic-nav-icon">{icon}</span><span>{label}</span>
                  </button>
                ))}
              </nav>

            </aside>

            <main className="ma9ic-main">
              <div className="ma9ic-main-title">
                <span>AI Virtual Desktop Assistant</span>
              </div>
              {activeSection === 'Home' ? (
                <div className="ma9ic-home-scroll">
                  <section className="ma9ic-home-chat">
                    <div className="ma9ic-home-chat-title"><MessageSquare /> <span>Chat</span></div>
                    <div className="ma9ic-home-chat-feed">
                      <ChatFeed messages={messages} assistantName={assistantName} onSpeak={handleSpeakText} onQuickPrompt={handleSendMessage} onOpenVisionDetail={() => setIsVisionModalOpen(true)} onVisionTargetClick={handleXRayTargetClick} />
                    </div>
                  </section>
                </div>
              ) : activeSection === 'Chat' ? (
                <div className="ma9ic-chat-page"><ChatFeed messages={messages} assistantName={assistantName} onSpeak={handleSpeakText} onQuickPrompt={handleSendMessage} onOpenVisionDetail={() => setIsVisionModalOpen(true)} onVisionTargetClick={handleXRayTargetClick} /></div>
              ) : (
                <div className="ma9ic-section-placeholder">
                  <div className="ma9ic-placeholder-icon"><Sparkles /></div>
                  <h2>{activeSection}</h2>
                  <p>Use the controls below or choose an action from the sidebar.</p>
                  {activeSection === 'Apps & Tools' && <button onClick={() => runDashboardPrompt('Open an app')} className="ma9ic-placeholder-action"><AppWindow /> Open an App</button>}
                  {activeSection === 'About' && <p className="ma9ic-about-copy">ma9icAI — your AI virtual desktop assistant for voice, vision, desktop control and local models.</p>}
                </div>
              )}

              <InputBar onSendMessage={handleSendMessage} isListening={isListening} onToggleListening={handleToggleListening} onCaptureScreen={handleCaptureScreen} onCaptureCamera={handleCaptureCamera} onTakeControl={() => setIsTakeControlOpen(true)} state={assistantState} isAnalyzingVision={isAnalyzingVision} assistantName={assistantName} voiceNotice={voiceNotice} />
            </main>

            <aside className="ma9ic-right-rail">
              <section className="ma9ic-rail-card">
                <div className="ma9ic-rail-title"><Activity /><span>System Status</span></div>
                {[['Voice Recognition', true, <Mic2 />], ['ChatGPT API', aiConnected, <Settings />], ['Local Models', modelConnected, <Grid2X2 />], ['Desktop Control', permissionLevel !== 'none', <Monitor />]].map(([label, ready, icon]) => (
                  <div className="ma9ic-rail-row" key={String(label)}><span className="ma9ic-rail-icon">{icon}</span><strong>{label}</strong><em className={ready ? 'ready' : ''}><i />{ready ? (label === 'Desktop Control' ? 'Enabled' : label === 'ChatGPT API' ? 'Connected' : label === 'Local Models' ? 'Ready' : 'Active') : 'Offline'}</em><ChevronRight /></div>
                ))}
              </section>

              <section className="ma9ic-rail-card quick">
                <div className="ma9ic-rail-title"><Zap /><span>Quick Actions</span></div>
                <div className="ma9ic-quick-grid">
                  <button onClick={() => runDashboardPrompt('Open an app')}><AppWindow /><span>Open App</span></button>
                  <button onClick={() => setIsTakeControlOpen(true)}><PanelsTopLeft /><span>Control Windows</span></button>
                  <button onClick={() => handleCaptureScreen()}><Camera /><span>Take Screenshot</span></button>
                  <button onClick={() => setActiveSection('About')}><Info /><span>System Info</span></button>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}

      {assistantState === "executing" && showActivityPanel && (
        <div className="desktop-modal-backdrop pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="desktop-modal-panel pointer-events-auto w-full max-w-sm rounded-2xl border border-cyan-300/25 bg-slate-950/90 p-4 text-slate-100 shadow-2xl shadow-cyan-950/40 backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                <div>
                  <p className="text-sm font-semibold">{assistantName} is working</p>
                  <p className="mt-1 text-xs text-slate-400">{activityText || "Executing the requested desktop actions..."}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleStopDesktopControl}
                className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/25"
                title="Stop desktop control"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}

      <MagicXRayOverlay
        vision={activeVision}
        imageUrl={visionThumbnail}
        visible={isXRayVisible}
        onClose={() => setIsXRayVisible(false)}
        onTargetClick={handleXRayTargetClick}
      />

      {/* Voice & Settings Modal */}
      <VoiceSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={voiceSettings}
        onSettingsChange={(newSettings) => {
          VoiceEngine.updateSettings(newSettings);
          setVoiceSettings(VoiceEngine.getSettings());
        }}
        availableVoices={availableVoices}
        assistantName={assistantName}
        onAssistantNameChange={handleAssistantNameChange}
      />

      {isModelMenuOpen && (
        <div className="ai-model-menu-backdrop fixed inset-0 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="ai-model-menu w-full max-w-sm max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl border border-cyan-400/30 p-4 text-slate-100 shadow-2xl shadow-cyan-950/40">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-cyan-300" />
                <div>
                  <h2 className="text-sm font-semibold text-white">AI model menu</h2>
                  <p className="text-[11px] text-slate-400">{ollamaConfig?.ollamaOnline ? `Ollama online · ${ollamaConfig.ollamaHost}` : "Ollama is offline or not installed"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModelMenuOpen(false)}
                className="flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
                title="Close AI model menu"
                aria-label="Close AI model menu"
              >
                <X className="h-4 w-4" />
                <span>Close</span>
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-cyan-400/20 bg-slate-900/70 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-white">Active Ollama model</p>
                  <p className="mt-1 text-[10px] text-slate-400">Choose which installed local model ma9icAI uses for chat.</p>
                </div>
                <button type="button" onClick={() => void refreshOllamaConfig()} className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:border-cyan-300/40">Refresh</button>
              </div>
              <select
                value={ollamaConfig?.ollamaModel || ""}
                onChange={(event) => void selectOllamaModel(event.target.value)}
                disabled={ollamaLoading || !(ollamaConfig?.availableOllamaModels || []).length}
                className="mt-3 w-full rounded-xl border border-cyan-400/20 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-cyan-300"
              >
                {(ollamaConfig?.availableOllamaModels || []).map((model: any) => (
                  <option key={model.name} value={model.name}>{model.name}</option>
                ))}
                {!(ollamaConfig?.availableOllamaModels || []).length && <option value="">No installed Ollama models found</option>}
              </select>
              {ollamaNotice && <p className="mt-2 text-[10px] text-cyan-200">{ollamaNotice}</p>}
               {ollamaActionError && <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-2 py-1.5 text-[10px] text-rose-200">{ollamaActionError}</p>}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-cyan-300" />
                <div>
                  <p className="text-xs font-semibold text-white">GPU-friendly Ollama models</p>
                  <p className="mt-1 text-[10px] text-slate-400">Choose a smaller model for better video-card performance.</p>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {[
                  { name: "qwen2.5vl:3b", label: "Qwen 2.5 VL 3B", note: "Vision + text · 4-8 GB VRAM" },
                  { name: "minicpm-v", label: "MiniCPM-V", note: "Vision + text · 4-8 GB VRAM" },
                  { name: "llama3.2:3b", label: "Llama 3.2 3B", note: "Text assistant · 4-8 GB VRAM" },
                ].map((model) => (
                  <div key={model.name} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-slate-100">{model.label}</p>
                      <p className="font-mono text-[9px] text-slate-500">{model.name} · {model.note}</p>
                    </div>
                    <button
                      type="button"
                      disabled={downloadingOllamaModel !== null}
                      onClick={async () => {
                        setDownloadingOllamaModel(model.name);
                        setOllamaActionError(null);
                        try {
                          const result = await (window as any).magicWindow?.downloadOllama?.(model.name);
                          if (!result?.ok) throw new Error(result?.error || "Could not start the model download.");
                          setOllamaNotice(`Downloading ${model.name}…`);
                          void refreshOllamaConfig();
                        } catch (error) {
                          setDownloadingOllamaModel(null);
                          setOllamaActionError(error instanceof Error ? error.message : "Could not start the model download.");
                        }
                      }}
                      className="shrink-0 rounded-lg bg-cyan-400 px-2 py-1.5 text-[10px] font-semibold text-cyan-950 hover:bg-cyan-300 disabled:cursor-wait disabled:opacity-50"
                    >
                      {downloadingOllamaModel === model.name ? "Installing..." : ((ollamaConfig?.availableOllamaModels || []).some((m: any) => m.name === model.name) ? "Installed" : "Install / Download")}
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[9px] text-slate-500">Downloads run through Ollama in the background. Progress and errors appear here. VRAM needs vary by model and context size.</p>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/70 p-3">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-300" />
                <div>
                  <p className="text-xs font-semibold text-white">Start Ollama MiniCPM-V</p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">ollama serve · local API :11434</p>
                </div>
              </div>
              <button
                type="button"
                disabled={isStartingOllama}
                onClick={async () => {
                  setIsStartingOllama(true);
                  setOllamaActionError(null);
                  try {
                    const result = await (window as any).magicWindow?.startOllama?.();
                    if (!result?.ok) throw new Error(result?.error || "Could not start Ollama.");
                    setOllamaNotice(result.models?.length
                      ? `Ollama is online · ${result.models.length} installed model${result.models.length === 1 ? "" : "s"}.`
                      : "Ollama is online. No models are installed yet — choose Install / Download above.");
                    await refreshOllamaConfig();
                  } catch (error) {
                    setOllamaActionError(error instanceof Error ? error.message : "Could not start Ollama.");
                  } finally {
                    setIsStartingOllama(false);
                  }
                }}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
              >
                <Terminal className="h-4 w-4" />
                {isStartingOllama ? "Opening Ollama..." : "Start Ollama"}
              </button>
              <p className="mt-2 text-[10px] text-slate-500">Starts the Ollama local service. Models load when selected or used.</p>
            </div>
          </div>
        </div>
      )}

      {/* Memory Manager Modal */}
      <MemoryModal
        isOpen={isMemoryOpen}
        onClose={() => setIsMemoryOpen(false)}
        memories={memories}
        onAddMemory={handleAddMemory}
        onRemoveMemory={handleRemoveMemory}
      />

      {/* Multimodal Vision Analysis Details Modal */}
      <VisionModal
        isOpen={isVisionModalOpen}
        onClose={() => setIsVisionModalOpen(false)}
        vision={activeVision}
        thumbnailUrl={visionThumbnail}
        onActionClick={handleSendMessage}
      />

      <SuperAIPermissionDialog
        isOpen={isPermissionOpen}
        requestedActionDescription={pendingPlan?.planTitle || "A multi-step desktop control task"}
        onGrant={handlePermissionGrant}
        onDeny={handlePermissionDeny}
        assistantName={assistantName}
      />
      <TakeControlModal
        isOpen={isTakeControlOpen}
        onClose={() => {
          setIsTakeControlOpen(false);
          setIsTakeControlListening(false);
          VoiceEngine.stopListening();
          setTakeControlTask("");
        }}
        onSubmit={handleTakeControl}
        assistantName={assistantName}
        task={takeControlTask}
        onTaskChange={setTakeControlTask}
        isListening={isTakeControlListening}
        onToggleListening={handleTakeControlVoice}
      />
    </div>
  );
}
