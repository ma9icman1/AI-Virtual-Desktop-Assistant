import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LipSyncEngine, VisemeWeights } from "../../services/lipSyncEngine";
import { Mic, Volume2, Maximize2, Layers, SlidersHorizontal } from "lucide-react";

export type EyeState = "open" | "quarter" | "half" | "three_quarter" | "closed";
export type MouthState =
  | "closed"
  | "smile"
  | "open_small"
  | "open_wide"
  | "o";

interface Avatar2DProps {
  isSpeaking: boolean;
  isListening?: boolean;
  audioLevel?: number;
  onSpeakGreeting?: () => void;
  onToggleListening?: () => void;
  onToggleFullView?: () => void;
  onSwitchMode?: (mode: "avatar" | "avatar2d" | "orb") => void;
  status?: string;
  voiceNotice?: string | null;
  speechText?: string;
  className?: string;
  enableParallax?: boolean;
}

const NOVA_ROOT = "/Nova_2_5D_FINAL_PRODUCTION_v21_all_renders";

const NOVA_FILES = {
  base: "base/nova_base.png",
  eyes: {
    center: "eyes/center.png",
  },
  blinks: {
    open: "blinks/open.png",
    half: "blinks/half.png",
    closed: "blinks/closed.png",
  },
  eyebrows: {
    neutral: "eyebrows/Brow Down_100.png",
    up: "eyebrows/Brow Up_100.png",
    innerUp: "eyebrows/Brow Inner Up_100.png",
    outerUpLeft: "eyebrows/Brow Outer Up Left_100.png",
    outerUpRight: "eyebrows/Brow Outer Up Right_100.png",
    squeeze: "eyebrows/Brow Squeeze_100.png",
    down: "eyebrows/Brow Down_100.png",
  },
  mouth: {
    closed: "mouth/Mouth Press_100.png",
    smile: "mouth/Mouth Smile_100.png",
    openSmall: "mouth/Mouth Stretch_100.png",
    openWide: "mouth/Mouth Upper Up_100.png",
    o: "mouth/Mouth Pucker_100.png",
  },
  faceDeform: {
    neutral: "face_deform/lip_100.png",
    smile: "face_deform/smile_100.png",
    frown: "face_deform/frown_100.png",
    cheek: "face_deform/cheek_100.png",
    wide: "face_deform/mouth wide_100.png",
  },
} as const;

type NovaSource = string;

type RGBAImage = {
  source: NovaSource;
  image: HTMLImageElement;
};

type DevLayerSettings = {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  visible: boolean;
};

type DevControls = {
  mouth: DevLayerSettings;
  face: DevLayerSettings;
  eyes: DevLayerSettings;
  eyebrows: DevLayerSettings;
};

const DEV_STORAGE_KEY = "nova_avatar_dev_controls_v2";

const DEFAULT_DEV_CONTROLS: DevControls = {
  mouth: { x: 0, y: 0, scale: 1, opacity: 1, visible: true },
  face: { x: 0, y: 0, scale: 1, opacity: 1, visible: true },
  eyes: { x: 0, y: 0, scale: 1, opacity: 1, visible: true },
  eyebrows: { x: 0, y: 0, scale: 1, opacity: 1, visible: true },
};

const DIFF_THRESHOLD = 1;
const CANVAS_SIZE = 2048;

type DifferenceMask = HTMLCanvasElement;

function sourceUrl(source: NovaSource): string {
  return `${NOVA_ROOT}/${source}?v=v21-production-20261008`;
}

function loadImage(source: NovaSource): Promise<RGBAImage> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve({ source, image });
    image.onerror = () => reject(new Error(`Nova image failed to load: ${source}`));
    image.src = sourceUrl(source);
  });
}

function imageKey(source: NovaSource): string {
  return source;
}

function buildDifferenceMask(
  base: HTMLImageElement,
  overlay: HTMLImageElement,
  threshold: number,
): DifferenceMask {
  const baseCanvas = document.createElement("canvas");
  const overlayCanvas = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas") as DifferenceMask;

  for (const canvas of [baseCanvas, overlayCanvas, maskCanvas]) {
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
  }

  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });
  const maskCtx = maskCanvas.getContext("2d");

  if (!baseCtx || !overlayCtx || !maskCtx) {
    throw new Error("Nova compositor could not create canvas contexts.");
  }

  baseCtx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  overlayCtx.drawImage(overlay, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const baseData = baseCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
  const overlayData = overlayCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
  const output = new ImageData(CANVAS_SIZE, CANVAS_SIZE);

  for (let i = 0; i < baseData.length; i += 4) {
    const changed =
      Math.max(
        Math.abs(baseData[i] - overlayData[i]),
        Math.abs(baseData[i + 1] - overlayData[i + 1]),
        Math.abs(baseData[i + 2] - overlayData[i + 2]),
        Math.abs(baseData[i + 3] - overlayData[i + 3]),
      ) >= threshold;

    // Only paint pixels that are actually visible in the overlay.
    // Transparent pixels in exported PNGs can contain arbitrary RGB values;
    // treating those as erasers can wipe out the whole avatar.
    if (!changed || overlayData[i + 3] === 0) continue;

    output.data[i] = overlayData[i];
    output.data[i + 1] = overlayData[i + 1];
    output.data[i + 2] = overlayData[i + 2];
    output.data[i + 3] = overlayData[i + 3];
  }

  maskCtx.putImageData(output, 0, 0);
  return maskCanvas;
}

export const Avatar2D: React.FC<Avatar2DProps> = ({
  isSpeaking,
  isListening = false,
  audioLevel = 0,
  onSpeakGreeting,
  onToggleListening,
  onToggleFullView,
  onSwitchMode,
  status = "idle",
  voiceNotice = null,
  speechText = "",
  className = "",
  enableParallax = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speechTextRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const maskCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const renderFrameRef = useRef<number | null>(null);
  const currentWeightsRef = useRef<Partial<VisemeWeights>>({});
  const targetParallax = useRef({ x: 0, y: 0 });

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eyeState, setEyeState] = useState<EyeState>("open");
  const lastRenderedBlinkRef = useRef<string>("");
  const [idleExpression, setIdleExpression] = useState<"slight_smile" | "annoyed">("slight_smile");
  const [mouthState, setMouthState] = useState<MouthState>("closed");
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [showDevControls, setShowDevControls] = useState(false);
  const [devAutoAnimate, setDevAutoAnimate] = useState(true);
  const [devMouthIndex, setDevMouthIndex] = useState(2);
  const [devEyeIndex, setDevEyeIndex] = useState(0);
  const [devFaceIndex, setDevFaceIndex] = useState(0);
  const [devBrowIndex, setDevBrowIndex] = useState(0);
  const [devControls, setDevControls] = useState<DevControls>(DEFAULT_DEV_CONTROLS);
  const [devPanelPosition, setDevPanelPosition] = useState({ x: 16, y: 16 });
  const devPanelDragRef = useRef({ dragging: false, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    const toggleProductionDevGui = () => setShowDevControls((current) => !current);
    window.addEventListener("nova-production-dev-gui-toggle", toggleProductionDevGui);
    return () => window.removeEventListener("nova-production-dev-gui-toggle", toggleProductionDevGui);
  }, []);

  const handleDevPanelPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.parentElement;
    const shell = event.currentTarget.closest(".avatar2d-shell");
    if (!panel || !shell) return;

    const shellRect = shell.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    devPanelDragRef.current = {
      dragging: true,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();

    const handleMove = (moveEvent: PointerEvent) => {
      if (!devPanelDragRef.current.dragging) return;
      const nextX = moveEvent.clientX - shellRect.left - devPanelDragRef.current.offsetX;
      const nextY = moveEvent.clientY - shellRect.top - devPanelDragRef.current.offsetY;
      const maxX = Math.max(8, shellRect.width - panelRect.width - 8);
      const maxY = Math.max(8, shellRect.height - panelRect.height - 8);
      setDevPanelPosition({
        x: Math.max(8, Math.min(maxX, nextX)),
        y: Math.max(8, Math.min(maxY, nextY)),
      });
    };

    const handleUp = () => {
      devPanelDragRef.current.dragging = false;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }, []);

  const sources = useMemo(() => {
    const values: NovaSource[] = [
      NOVA_FILES.base,
      "eyes/center.png","eyes/left.png","eyes/right.png","eyes/up.png","eyes/down.png",
      "eyes/up_left.png","eyes/up_right.png","eyes/down_left.png","eyes/down_right.png",
      "blinks/open.png","blinks/quarter.png","blinks/half.png","blinks/three_quarter.png","blinks/closed.png",
      "idle_listening/slight_smile.png","idle_listening/annoyed.png",
      "mouth/Mouth Press_20.png","mouth/Mouth Press_40.png","mouth/Mouth Press_60.png","mouth/Mouth Press_80.png","mouth/Mouth Press_100.png",
      "mouth/Mouth Smile_100.png","mouth/Mouth Smile Widen_60.png",
      "mouth/Mouth Stretch_40.png","mouth/Mouth Stretch_60.png","mouth/Mouth Stretch_80.png",
      "mouth/Mouth Upper Up_60.png","mouth/Mouth Upper Up_80.png","mouth/Mouth Upper Up_100.png",
      "mouth/Mouth Pucker_60.png","mouth/Mouth Pucker_80.png","mouth/Mouth Pucker_100.png",
      "speech/phoneme_TH_80.png","speech/phoneme_SH_CH_J_80.png","speech/vowel_U_80.png",
      "face_deform/smile_50.png","face_deform/mouth wide_75.png",
      "eyebrows/Brow Up_50.png","eyebrows/Brow Inner Up_50.png","eyebrows/Brow Down_50.png","eyebrows/Brow Squeeze_50.png",
      ...Object.values(NOVA_FILES.eyes),
      ...Object.values(NOVA_FILES.blinks),
      ...Object.values(NOVA_FILES.eyebrows),
      ...Object.values(NOVA_FILES.mouth),
      ...Object.values(NOVA_FILES.faceDeform),
      "expressions/lip_100.png","expressions/smile_100.png","expressions/frown_100.png",
      "expressions/cheek_100.png","expressions/mouth wide_100.png"
    ];
    return [...new Set(values)];
  }, []);

  const getImage = useCallback((source: NovaSource) => {
    return imagesRef.current.get(imageKey(source)) ?? null;
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DEV_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<DevControls>;
        setDevControls((current) => ({
          ...current,
          ...parsed,
          mouth: { ...current.mouth, ...(parsed.mouth ?? {}) },
          face: { ...current.face, ...(parsed.face ?? {}) },
          eyes: { ...current.eyes, ...(parsed.eyes ?? {}) },
          eyebrows: { ...current.eyebrows, ...(parsed.eyebrows ?? {}) },
        }));
      }
    } catch (error) {
      console.warn("[Nova 2.5D] dev control restore failed", error);
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(devControls)); } catch {}
  }, [devControls]);

  const updateDevLayer = useCallback((layer: keyof DevControls, patch: Partial<DevLayerSettings>) => {
    setDevControls((current) => ({ ...current, [layer]: { ...current[layer], ...patch } }));
  }, []);

  const resetDevControls = useCallback(() => {
    setDevControls(DEFAULT_DEV_CONTROLS);
    setDevMouthIndex(2);
    setDevEyeIndex(0);
    setDevFaceIndex(0);
    setDevBrowIndex(0);
    setDevAutoAnimate(true);
  }, []);

  const mouthSources: NovaSource[] = [
  "mouth/Mouth Press_100.png","mouth/Mouth Smile_100.png","mouth/Mouth Stretch_60.png",
  "mouth/Mouth Upper Up_100.png","mouth/Mouth Pucker_80.png"
];
  const eyeSources: NovaSource[] = ["blinks/open.png","blinks/half.png","blinks/closed.png"];
  const faceSources: NovaSource[] = [
    "face_deform/lip_25.png","face_deform/smile_50.png","face_deform/frown_50.png",
    "face_deform/cheek_50.png","face_deform/mouth wide_75.png"
  ];
  const browSources: NovaSource[] = [
    "eyebrows/Brow Down_50.png","eyebrows/Brow Up_50.png","eyebrows/Brow Inner Up_50.png",
    "eyebrows/Brow Outer Up Left_50.png","eyebrows/Brow Outer Up Right_50.png",
    "eyebrows/Brow Squeeze_50.png","eyebrows/Brow Down_100.png"
  ];

  const getMask = useCallback(
    (source: NovaSource): HTMLCanvasElement | null => {
      const cached = maskCacheRef.current.get(imageKey(source));
      if (cached) return cached;

      const base = getImage(NOVA_FILES.base);
      const overlay = getImage(source);

      if (!base || !overlay) return null;
      if (source === NOVA_FILES.base) return null;

      const mask = buildDifferenceMask(base, overlay, DIFF_THRESHOLD);
      maskCacheRef.current.set(imageKey(source), mask);
      return mask;
    },
    [getImage],
  );

  const renderNova = useCallback(() => {
    const canvas = canvasRef.current;
    const base = getImage(NOVA_FILES.base);
    if (!canvas || !base) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Animation PNGs are complete render plates, not isolated transparent
    // overlays. Drawing a plate directly paints its hair/head over the base.
    // Composite only pixels that differ from the neutral base render.
    const draw = (source: NovaSource, opacity = 1) => {
      if (source === NOVA_FILES.base) return;
      const mask = getMask(source);
      if (!mask) return;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = opacity;
      ctx.drawImage(mask, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.restore();
    };


    // Restrict eye/blink overlays to the eye band.
    // Coordinates are relative to the square avatar canvas.
    const drawEyeArea = (source: NovaSource) => {
      const mask = getMask(source);
      if (!mask) return;

      const size = CANVAS_SIZE;
      const eyeX = size * 0.15;
      const eyeY = size * 0.29;
      const eyeW = size * 0.70;
      const eyeH = size * 0.30;

      ctx.save();
      ctx.beginPath();
      ctx.rect(eyeX, eyeY, eyeW, eyeH);
      ctx.clip();
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(mask, 0, 0, size, size);
      ctx.restore();
    };

    // Mouth plates are also full-face renders. Apply the complementary
    // lower-face clip so changes around the eyes in a mouth render can never
    // overwrite the eye/blink layers. Keep the mouth band separate from the
    // eye band; both use the same base-difference pixels, but opposite regions.
    const drawMouthArea = (source: NovaSource, opacity = 1) => {
      const mask = getMask(source);
      if (!mask) return;

      const size = CANVAS_SIZE;
      const mouthX = size * 0.24;
      const mouthY = size * 0.56;
      const mouthW = size * 0.52;
      const mouthH = size * 0.28;

      ctx.save();
      ctx.beginPath();
      ctx.rect(mouthX, mouthY, mouthW, mouthH);
      ctx.clip();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = opacity;
      ctx.drawImage(mask, 0, 0, size, size);
      ctx.restore();
    };

    const px = enableParallax ? parallax.x : 0;
    const py = enableParallax ? parallax.y : 0;
    // Idle expression plates are full render plates. Composite them first so
    // they cannot paint open eyes over the blink layer later in this frame.
    if (!isSpeaking) {
      const idlePlate = isListening ? "idle_listening/slight_smile.png" : `idle_listening/${idleExpression}.png`;
      draw(idlePlate, isListening ? .82 : .42);
    }

    if (isSpeaking) {
      const w = currentWeightsRef.current;
      const jaw = w.jawOpen ?? 0;
      const pucker = Math.max(w.mouthPucker ?? 0, w.mouthFunnel ?? 0);
      const smile = Math.max(w.mouthSmileLeft ?? 0, w.mouthSmileRight ?? 0);
      const aa = w.viseme_aa ?? 0;
      const e = w.viseme_E ?? 0;
      const i = w.viseme_I ?? 0;
      const o = w.viseme_O ?? 0;
      const u = w.viseme_U ?? 0;
      const pp = w.viseme_PP ?? 0;
      const ff = w.viseme_FF ?? 0;
      const th = w.viseme_TH ?? 0;
      const ch = w.viseme_CH ?? 0;
      const ss = w.viseme_SS ?? 0;

      let mouth: NovaSource = "mouth/Mouth Press_20.png";
      if (pp > .3) {
        mouth = `mouth/Mouth Press_${Math.max(20, Math.min(100, Math.round(pp * 100 / 20) * 20))}.png`;
      } else if (ff > .3) {
        mouth = `mouth/Mouth Stretch_${Math.max(40, Math.min(80, Math.round(ff * 80 / 20) * 20))}.png`;
      } else if (th > .35) {
        mouth = "speech/phoneme_TH_80.png";
      } else if (ch > .35) {
        mouth = "speech/phoneme_SH_CH_J_80.png";
      } else if (u > .3 && u >= o) {
        // V21 includes a dedicated U vowel render; use it instead of reusing
        // the generic pucker plate for both O and U.
        mouth = "speech/vowel_U_80.png";
      } else if (o > .3 || pucker > .3) {
        mouth = `mouth/Mouth Pucker_${Math.max(60, Math.min(100, Math.round(Math.max(o, pucker) * 100 / 20) * 20))}.png`;
      } else if (aa > .35 || jaw > .55) {
        mouth = `mouth/Mouth Upper Up_${Math.max(60, Math.min(100, Math.round(Math.max(aa, jaw) * 100 / 20) * 20))}.png`;
      } else if (e > .25 || i > .25 || jaw > .12) {
        mouth = `mouth/Mouth Stretch_${Math.max(40, Math.min(80, Math.round(Math.max(e, i, jaw) * 100 / 20) * 20))}.png`;
      } else if (ss > .3 || smile > .3) {
        mouth = "mouth/Mouth Smile Widen_60.png";
      }

      drawMouthArea(mouth);
      if (smile > .25) drawMouthArea("face_deform/smile_50.png", .65);
    } else {
      drawMouthArea(devAutoAnimate ? "mouth/Mouth Press_20.png" : mouthSources[devMouthIndex]);
    }

    const brow = currentWeightsRef.current.browInnerUp ?? 0;
    if (brow > .25) draw("eyebrows/Brow Inner Up_50.png");
    const eye =
      Math.abs(px) < .33 && Math.abs(py) < .33 ? "eyes/center.png" :
      py < -.33 ? (px < -.33 ? "eyes/up_left.png" : px > .33 ? "eyes/up_right.png" : "eyes/up.png") :
      py > .33 ? (px < -.33 ? "eyes/down_left.png" : px > .33 ? "eyes/down_right.png" : "eyes/down.png") :
      px < -.33 ? "eyes/left.png" : "eyes/right.png";
    drawEyeArea(eye);

    // Eyes render after the mouth and brows. Blink PNGs use the existing
    // base-difference mask so they don't cover the rest of Nova's face.
    if (devAutoAnimate && eyeState !== "open") {
      const blinkSource: NovaSource =
        eyeState === "quarter" ? "blinks/quarter.png" :
        eyeState === "half" ? "blinks/half.png" :
        eyeState === "three_quarter" ? "blinks/three_quarter.png" :
        "blinks/closed.png";
      drawEyeArea(blinkSource);
    }

  }, [eyeState, idleExpression, isSpeaking, isListening, devAutoAnimate, devMouthIndex, mouthSources, parallax, enableParallax, getImage, getMask]);

  // Keep the latest renderer available to the lip-sync subscription without
  // forcing that subscription to reconnect whenever parallax or eye state changes.
  const renderNovaRef = useRef<() => void>(() => {});
  renderNovaRef.current = renderNova;

  useEffect(() => {
    let cancelled = false;

    // V21 has optional animation plates that can vary between render batches.
    // Load plates independently so one missing expression cannot hide Nova.
    Promise.all(
      sources.map((source) =>
        loadImage(source).catch((error) => {
          console.debug("[Nova v21] optional plate unavailable:", source, error);
          return null;
        }),
      ),
    )
      .then((loaded) => {
        if (cancelled) return;
        for (const item of loaded) {
          if (item) imagesRef.current.set(imageKey(item.source), item.image);
        }
        console.info("[NOVA-BLINK-DEBUG] asset load complete " + JSON.stringify({
          root: NOVA_ROOT,
          autoAnimate: devAutoAnimate,
          open: imagesRef.current.get("blinks/open.png")?.src ?? "MISSING",
          half: imagesRef.current.get("blinks/half.png")?.src ?? "MISSING",
          closed: imagesRef.current.get("blinks/closed.png")?.src ?? "MISSING",
          canvasPresent: Boolean(canvasRef.current),
        }));
        if (!imagesRef.current.has(NOVA_FILES.base)) {
          throw new Error(`Required Nova v21 base image is missing: ${sourceUrl(NOVA_FILES.base)}`);
        }
        setReady(true);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[Nova v21] base image load failed", error);
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [sources]);

  useEffect(() => {
    if (!ready) return;

    // Log only eye-state changes, not every parallax-driven canvas redraw.
    const debugState = JSON.stringify({
      eyeState,
      devAutoAnimate,
      canvasPresent: Boolean(canvasRef.current),
      closedImageLoaded: imagesRef.current.has("blinks/closed.png"),
      ready,
    });
    if ((window as Window & { __novaBlinkLastDebugState?: string }).__novaBlinkLastDebugState !== debugState) {
      (window as Window & { __novaBlinkLastDebugState?: string }).__novaBlinkLastDebugState = debugState;
      console.info("[NOVA-BLINK-DEBUG] render scheduled " + debugState);
    }

    if (renderFrameRef.current !== null) {
      cancelAnimationFrame(renderFrameRef.current);
    }

    renderFrameRef.current = requestAnimationFrame(() => {
      renderNova();
      renderFrameRef.current = null;
    });

    return () => {
      if (renderFrameRef.current !== null) {
        cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }
    };
  }, [ready, renderNova]);

  useEffect(() => {
    const el = speechTextRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [speechText]);

  useEffect(() => {
    const unsub = LipSyncEngine.getInstance().subscribe((weights) => {
      currentWeightsRef.current = weights;

      // Ref updates do not trigger React renders. While speaking, coalesce each
      // lip-sync update into the next animation frame so mouth plates animate smoothly.
      if (isSpeaking && ready && renderFrameRef.current === null) {
        renderFrameRef.current = requestAnimationFrame(() => {
          renderNovaRef.current();
          renderFrameRef.current = null;
        });
      }

      if (!devAutoAnimate) return;

      if (!isSpeaking) {
        setMouthState(
          (weights.mouthSmileLeft ?? 0) > 0.2 || isListening
            ? "smile"
            : "closed",
        );
        return;
      }

      const jaw = weights.jawOpen ?? 0;
      const visO = weights.viseme_O ?? 0;
      const visU = weights.viseme_U ?? 0;
      const funnel = weights.mouthFunnel ?? 0;
      const visAA = weights.viseme_aa ?? 0;
      const visE = weights.viseme_E ?? 0;
      const visI = weights.viseme_I ?? 0;

      if (visO > 0.35 || visU > 0.35 || funnel > 0.25) {
        setMouthState("o");
      } else if (jaw > 0.4 || visAA > 0.45) {
        setMouthState("open_wide");
      } else if (jaw > 0.08 || visE > 0.25 || visI > 0.25) {
        setMouthState("open_small");
      } else {
        setMouthState("smile");
      }
    });

    return () => unsub();
  }, [isSpeaking, isListening, devAutoAnimate, ready]);


  useEffect(() => {
    if (isSpeaking) return;
    if (isListening || !devAutoAnimate) {
      setIdleExpression(isListening ? "slight_smile" : "annoyed");
      return;
    }

    let timeout = 0;
    let cancelled = false;
    const scheduleNextExpression = () => {
      timeout = window.setTimeout(() => {
        if (cancelled) return;
        setIdleExpression((current) => current === "slight_smile" ? "annoyed" : "slight_smile");
        scheduleNextExpression();
      }, 3200 + Math.random() * 1800);
    };

    setIdleExpression("slight_smile");
    scheduleNextExpression();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isSpeaking, isListening, devAutoAnimate]);

  useEffect(() => {
    // Play all supplied blink renders instead of flipping between open and
    // closed: quarter -> half -> three-quarter -> closed, then reverse.
    let blinkTimeout = 0;
    let frameTimeout = 0;
    let cancelled = false;

    const scheduleBlink = (delay: number) => {
      console.info("[NOVA-BLINK-DEBUG] scheduling blink " + JSON.stringify({
        delayMs: delay, devAutoAnimate, ready, speaking: isSpeaking, listening: isListening,
      }));
      blinkTimeout = window.setTimeout(() => {
        if (cancelled || !devAutoAnimate) return;
        console.info("[NOVA-BLINK-DEBUG] BLINK sequence start " + new Date().toISOString());
        setEyeState("quarter");
        frameTimeout = window.setTimeout(() => {
          if (cancelled || !devAutoAnimate) return;
          setEyeState("half");
          frameTimeout = window.setTimeout(() => {
            if (cancelled || !devAutoAnimate) return;
            setEyeState("three_quarter");
            frameTimeout = window.setTimeout(() => {
              if (cancelled || !devAutoAnimate) return;
              setEyeState("closed");
              frameTimeout = window.setTimeout(() => {
                if (cancelled || !devAutoAnimate) return;
                setEyeState("three_quarter");
                frameTimeout = window.setTimeout(() => {
                  if (cancelled || !devAutoAnimate) return;
                  setEyeState("half");
                  frameTimeout = window.setTimeout(() => {
                    if (cancelled || !devAutoAnimate) return;
                    setEyeState("quarter");
                    frameTimeout = window.setTimeout(() => {
                      if (cancelled || !devAutoAnimate) return;
                      setEyeState("open");
                      console.info("[NOVA-BLINK-DEBUG] BLINK sequence complete " + new Date().toISOString());
                      scheduleBlink(2600 + Math.random() * 1800);
                    }, 35);
                  }, 35);
                }, 35);
              }, 75);
            }, 35);
          }, 35);
        }, 35);
      }, delay);
    };

    setEyeState("open");
    if (devAutoAnimate) {
      // Blink shortly after mount so the animation is immediately testable.
      scheduleBlink(1200);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(blinkTimeout);
      window.clearTimeout(frameTimeout);
    };
  }, [devAutoAnimate]);

  useEffect(() => {
    if (!enableParallax) return;

    const handleMouseMove = (event: MouseEvent) => {
      const nx = (event.clientX / window.innerWidth) * 2 - 1;
      const ny = (event.clientY / window.innerHeight) * 2 - 1;
      targetParallax.current = {
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      };
    };

    let frame = 0;
    const update = () => {
      setParallax((previous) => ({
        x: previous.x + (targetParallax.current.x - previous.x) * 0.08,
        y: previous.y + (targetParallax.current.y - previous.y) * 0.08,
      }));
      frame = requestAnimationFrame(update);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    frame = requestAnimationFrame(update);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(frame);
    };
  }, [enableParallax]);

  const rotY = parallax.x * 12;
  const rotX = -parallax.y * 10;

  return (
    <div
      className={`avatar2d-shell relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-transparent select-none ${className}`}
      style={{ perspective: "1000px" }}
    >
      <div
        className="avatar2d-stage relative w-full h-full flex items-center justify-center"
        style={{
          transformStyle: "preserve-3d",
          transform: `translateX(-8%) rotateY(${rotY}deg) rotateX(${rotX}deg)`,
        }}
      >
        <div
          className="relative w-full h-full flex items-center justify-center animate-[avatarBreathing_4s_ease-in-out_infinite]"
          style={{ transformStyle: "preserve-3d" }}
        >
          <canvas
            ref={canvasRef}
            aria-label="Nova 2.5D avatar"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            style={{
              transform: `translateZ(0px)`,
              filter: "drop-shadow(0 20px 30px rgba(0,0,0,0.5))",
            }}
          />

          {!ready && !loadError && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 pointer-events-none">
              Loading Nova…
            </div>
          )}

          {loadError && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-md rounded-lg border border-red-500/30 bg-slate-950/90 px-4 py-3 text-xs text-red-300 pointer-events-none">
              Nova 2.5D load error: {loadError}
            </div>
          )}
        </div>
      </div>

      {showDevControls && (
        <div
          className="absolute z-[9999] pointer-events-auto w-[300px] max-w-[calc(100vw-24px)] max-h-[46vh] min-h-0 overflow-y-auto rounded-xl border border-cyan-500/30 bg-slate-950/90 p-2 shadow-2xl backdrop-blur-md"
          style={{ left: devPanelPosition.x, top: devPanelPosition.y }}
        >
          <div
            className="mb-1 flex items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-cyan-950/30 px-2 py-1.5 cursor-grab active:cursor-grabbing touch-none pointer-events-auto"
            onPointerDown={handleDevPanelPointerDown}
            title="Drag to move the Nova 2.5D developer GUI"
          >
            <div className="min-w-0">
              <div className="text-xs font-bold text-cyan-300">Nova 2.5D PRODUCTION DEV</div>
              <div className="text-[9px] text-slate-500">Drag this header to move • Live controls linked directly to production animation images</div>
            </div>
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); resetDevControls(); }}
              className="shrink-0 rounded border border-slate-700 px-2 py-1 text-[9px]"
            >
              RESET
            </button>
          </div>
          <label className="mb-2 flex items-center justify-between rounded bg-slate-900 p-1.5 text-[10px] pointer-events-auto">
            <span>Auto animation</span>
            <input
              onPointerDown={(e)=>e.stopPropagation()}
              type="checkbox"
              checked={devAutoAnimate}
              onChange={(e) => {
                const enabled = e.currentTarget.checked;
                setDevAutoAnimate(enabled);
                if (!enabled) {
                  setEyeState("open");
                  setMouthState("closed");
                }
              }}
            />
          </label>
          <div className="mb-2 rounded bg-slate-900 p-1.5">
            <div className="mb-1 text-[10px] font-bold text-pink-300">MOUTH IMAGE</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? "Lip-sync" : ["Closed","Smile","Open Small","Open Wide","O"][devMouthIndex]}</span><span className="truncate text-cyan-400/70">{mouthSources[devMouthIndex]}</span></div>
            <input onPointerDown={(e)=>e.stopPropagation()} className="w-full pointer-events-auto cursor-pointer" type="range" min="0" max="4" step="1" value={devMouthIndex} disabled={devAutoAnimate} onChange={(e) => setDevMouthIndex(Number(e.target.value))} />
            <label className="mt-2 block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.mouth.x} onChange={(e)=>updateDevLayer("mouth",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.mouth.y} onChange={(e)=>updateDevLayer("mouth",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.mouth.scale} onChange={(e)=>updateDevLayer("mouth",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.mouth.opacity} onChange={(e)=>updateDevLayer("mouth",{opacity:Number(e.target.value)})}/></label>
          </div>
          <div className="mb-3 rounded bg-slate-900 p-2">
            <div className="mb-1 text-[10px] font-bold text-cyan-300">EYES / BLINK</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? eyeState : ["Open","Half","Closed"][devEyeIndex]}</span><span className="truncate text-cyan-400/70">{eyeSources[devEyeIndex]}</span></div>
            <input onPointerDown={(e)=>e.stopPropagation()} className="w-full pointer-events-auto cursor-pointer" type="range" min="0" max="2" step="1" value={devEyeIndex} disabled={devAutoAnimate} onChange={(e)=>setDevEyeIndex(Number(e.target.value))}/>
            <label className="mt-2 block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.eyes.x} onChange={(e)=>updateDevLayer("eyes",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.eyes.y} onChange={(e)=>updateDevLayer("eyes",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.eyes.scale} onChange={(e)=>updateDevLayer("eyes",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.eyes.opacity} onChange={(e)=>updateDevLayer("eyes",{opacity:Number(e.target.value)})}/></label>
          </div>
          <div className="rounded bg-slate-900 p-2">
            <div className="mb-1 text-[10px] font-bold text-violet-300">FACE DEFORM</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? "Auto state" : ["Neutral","Smile","Frown","Cheek","Wide"][devFaceIndex]}</span><span className="truncate text-cyan-400/70">{faceSources[devFaceIndex]}</span></div>
            <input onPointerDown={(e)=>e.stopPropagation()} className="w-full pointer-events-auto cursor-pointer" type="range" min="0" max="4" step="1" value={devFaceIndex} disabled={devAutoAnimate} onChange={(e)=>setDevFaceIndex(Number(e.target.value))}/>
            <label className="block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.face.x} onChange={(e)=>updateDevLayer("face",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.face.y} onChange={(e)=>updateDevLayer("face",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.face.scale} onChange={(e)=>updateDevLayer("face",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.face.opacity} onChange={(e)=>updateDevLayer("face",{opacity:Number(e.target.value)})}/></label>
          </div>
          <div className="mt-2 rounded bg-slate-900 p-1.5">
            <div className="mb-1 text-[10px] font-bold text-amber-300">EYEBROWS</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? "Neutral" : ["Neutral","Up","Inner Up","Outer Left","Outer Right","Squeeze","Down"][devBrowIndex]}</span><span className="truncate text-cyan-400/70">{browSources[devBrowIndex]}</span></div>
            <input onPointerDown={(e)=>e.stopPropagation()} className="w-full pointer-events-auto cursor-pointer" type="range" min="0" max="6" step="1" value={devBrowIndex} disabled={devAutoAnimate} onChange={(e)=>setDevBrowIndex(Number(e.target.value))}/>
            <label className="mt-2 block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.eyebrows.x} onChange={(e)=>updateDevLayer("eyebrows",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.eyebrows.y} onChange={(e)=>updateDevLayer("eyebrows",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.eyebrows.scale} onChange={(e)=>updateDevLayer("eyebrows",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.eyebrows.opacity} onChange={(e)=>updateDevLayer("eyebrows",{opacity:Number(e.target.value)})}/></label>
          </div>
        </div>
      )}

      <div className="avatar2d-controls absolute flex flex-col items-center z-20">
        <div
          className="relative flex items-center justify-center rounded-full border border-slate-700/80 bg-slate-950/90 shadow-lg shadow-black/30"
          style={{
            width: "360px",
            height: "68px",
            maxWidth: "calc(100vw - 40px)",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <span
            className={`avatar2d-status-dot absolute left-4 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
              isSpeaking
                ? "bg-cyan-400 animate-ping"
                : isListening
                  ? "bg-purple-400 animate-pulse"
                  : "bg-emerald-400"
            }`}
          />
          <span className="w-full px-8 text-center break-words text-slate-100" style={{ color: "#e9f7ff", textShadow: "0 0 10px rgba(0, 170, 255, 0.28)" }}>
            {speechText.trim() || voiceNotice || ""}
          </span>
        </div>

        <div className="avatar2d-toolbar flex items-center">
          {onToggleListening && (
            <button
              type="button"
              onClick={onToggleListening}
              className={`avatar2d-tool avatar2d-tool-mic rounded-full transition-all cursor-pointer ${
                isListening
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-600/30"
                  : "text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              }`}
              title={isListening ? "Mute Microphone" : "Enable Microphone"}
            >
              <Mic className="w-4 h-4" />
            </button>
          )}

          {onSpeakGreeting && (
            <button
              type="button"
              onClick={onSpeakGreeting}
              className="avatar2d-tool rounded-full transition-all cursor-pointer"
              title="Test Voice Greeting"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}

          {onSwitchMode && (
            <button
              type="button"
              onClick={() => onSwitchMode("avatar")}
              className="avatar2d-tool rounded-full transition-all cursor-pointer"
              title="Switch to 3D Model View"
            >
              <Layers className="w-4 h-4" />
            </button>
          )}

          {onToggleFullView && (
            <button
              type="button"
              onClick={onToggleFullView}
              className="avatar2d-tool rounded-full transition-all cursor-pointer"
              title="Toggle Full Desktop View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDevControls((v) => !v)}
            className={`avatar2d-tool !flex !flex-row !gap-1.5 !px-3 !text-[11px] !font-black !tracking-wide ${
              showDevControls
                ? "!bg-cyan-600 !text-white shadow-lg shadow-cyan-600/30"
                : "!text-cyan-300 hover:!text-cyan-100 hover:!bg-cyan-950"
            }`}
            title={showDevControls ? "Hide Nova 2.5D Production Developer GUI" : "Open Nova 2.5D Production Developer GUI"}
            aria-label="Open Nova 2.5D Production Developer GUI"
          >
            <SlidersHorizontal className="!h-4 !w-4" />
            <span>DEV GUI</span>
          </button>
        </div>
      </div>
    </div>
  );
};

