import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LipSyncEngine, VisemeWeights } from "../../services/lipSyncEngine";
import { Mic, Volume2, Maximize2, Layers, SlidersHorizontal } from "lucide-react";

export type EyeState = "open" | "half" | "closed";
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

const NOVA_ROOT = "/Nova_2_5D_PRODUCTION_LAYERS_FINAL";

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
    neutral: "eyebrows/Brow Down.png",
    up: "eyebrows/Brow Up.png",
    innerUp: "eyebrows/Brow Inner Up.png",
    outerUpLeft: "eyebrows/Brow Outer Up Left.png",
    outerUpRight: "eyebrows/Brow Outer Up Right.png",
    squeeze: "eyebrows/Brow Squeeze.png",
    down: "eyebrows/Brow Down.png",
  },
  mouth: {
    closed: "mouth/Mouth Press.png",
    smile: "mouth/Mouth Smile.png",
    openSmall: "mouth/Mouth Stretch.png",
    openWide: "mouth/Mouth Upper Up.png",
    o: "mouth/Mouth Pucker.png",
  },
  faceDeform: {
    neutral: "face_deform/lip.png",
    smile: "face_deform/smile.png",
    frown: "face_deform/frown.png",
    cheek: "face_deform/cheek.png",
    wide: "face_deform/mouth wide.png",
  },
} as const;

type NovaSource =
  | typeof NOVA_FILES.base
  | (typeof NOVA_FILES.eyes)[keyof typeof NOVA_FILES.eyes]
  | (typeof NOVA_FILES.blinks)[keyof typeof NOVA_FILES.blinks]
  | (typeof NOVA_FILES.eyebrows)[keyof typeof NOVA_FILES.eyebrows]
  | (typeof NOVA_FILES.mouth)[keyof typeof NOVA_FILES.mouth]
  | (typeof NOVA_FILES.faceDeform)[keyof typeof NOVA_FILES.faceDeform];

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
const CANVAS_SIZE = 1024;

function sourceUrl(source: NovaSource): string {
  return `${NOVA_ROOT}/${source}`;
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
): HTMLCanvasElement {
  const baseCanvas = document.createElement("canvas");
  const overlayCanvas = document.createElement("canvas");
  const maskCanvas = document.createElement("canvas");

  baseCanvas.width = overlayCanvas.width = maskCanvas.width = CANVAS_SIZE;
  baseCanvas.height = overlayCanvas.height = maskCanvas.height = CANVAS_SIZE;

  const baseCtx = baseCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext("2d", { willReadFrequently: true });
  const maskCtx = maskCanvas.getContext("2d");

  if (!baseCtx || !overlayCtx || !maskCtx) {
    throw new Error("Nova compositor could not create canvas contexts.");
  }

  baseCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  overlayCtx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  baseCtx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  overlayCtx.drawImage(overlay, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const a = baseCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const b = overlayCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const out = new ImageData(CANVAS_SIZE, CANVAS_SIZE);

  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    const da = Math.abs(a.data[i + 3] - b.data[i + 3]);

    const changed = Math.max(dr, dg, db, da) >= threshold;

    if (changed) {
      out.data[i] = b.data[i];
      out.data[i + 1] = b.data[i + 1];
      out.data[i + 2] = b.data[i + 2];
      out.data[i + 3] = b.data[i + 3];
    }
  }

  maskCtx.putImageData(out, 0, 0);
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
  const [mouthState, setMouthState] = useState<MouthState>("closed");
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [showDevControls, setShowDevControls] = useState(false);
  const [devAutoAnimate, setDevAutoAnimate] = useState(true);
  const [devMouthIndex, setDevMouthIndex] = useState(2);
  const [devEyeIndex, setDevEyeIndex] = useState(0);
  const [devFaceIndex, setDevFaceIndex] = useState(0);
  const [devBrowIndex, setDevBrowIndex] = useState(0);
  const [devControls, setDevControls] = useState<DevControls>(DEFAULT_DEV_CONTROLS);

  const sources = useMemo(() => {
    const values: NovaSource[] = [
      NOVA_FILES.base,
      NOVA_FILES.eyes.center,
      ...Object.values(NOVA_FILES.blinks),
      ...Object.values(NOVA_FILES.eyebrows),
      ...Object.values(NOVA_FILES.mouth),
      ...Object.values(NOVA_FILES.faceDeform),
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
    NOVA_FILES.mouth.closed, NOVA_FILES.mouth.smile, NOVA_FILES.mouth.openSmall,
    NOVA_FILES.mouth.openWide, NOVA_FILES.mouth.o,
  ];
  const eyeSources: NovaSource[] = [
    NOVA_FILES.blinks.open, NOVA_FILES.blinks.half, NOVA_FILES.blinks.closed,
  ];
  const faceSources: NovaSource[] = [
    NOVA_FILES.faceDeform.neutral, NOVA_FILES.faceDeform.smile, NOVA_FILES.faceDeform.frown,
    NOVA_FILES.faceDeform.cheek, NOVA_FILES.faceDeform.wide,
  ];
  const browSources: NovaSource[] = [
    NOVA_FILES.eyebrows.neutral, NOVA_FILES.eyebrows.up, NOVA_FILES.eyebrows.innerUp,
    NOVA_FILES.eyebrows.outerUpLeft, NOVA_FILES.eyebrows.outerUpRight, NOVA_FILES.eyebrows.squeeze,
    NOVA_FILES.eyebrows.down,
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

    // The DAZ plates share the exact same 1024x1024 camera/canvas.
    // Render the base first, then difference masks for the active states.
    ctx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const mouthSource = devAutoAnimate
      ? (mouthState === "o"
        ? NOVA_FILES.mouth.o
        : mouthState === "open_wide"
          ? NOVA_FILES.mouth.openWide
          : mouthState === "open_small"
            ? NOVA_FILES.mouth.openSmall
            : mouthState === "smile"
              ? NOVA_FILES.mouth.smile
              : NOVA_FILES.mouth.closed)
      : mouthSources[devMouthIndex];

    const eyeSource = devAutoAnimate
      ? NOVA_FILES.blinks[eyeState]
      : eyeSources[devEyeIndex];

    const drawLayer = (source: NovaSource, settings: DevLayerSettings) => {
      if (!settings.visible) return;
      const mask = getMask(source);
      if (!mask) return;
      ctx.save();
      ctx.globalAlpha = settings.opacity;
      const size = CANVAS_SIZE * settings.scale;
      const offset = (CANVAS_SIZE - size) / 2;
      ctx.drawImage(mask, offset + settings.x, offset + settings.y, size, size);
      ctx.restore();
    };

    if (devControls.eyes.visible) {
      drawLayer(NOVA_FILES.eyes.center, devControls.eyes);
      if (eyeState === "half" || eyeState === "closed" || !devAutoAnimate) {
        drawLayer(eyeSource, devControls.eyes);
      }
    }

    const browSource = devAutoAnimate ? NOVA_FILES.eyebrows.neutral : browSources[devBrowIndex];
    drawLayer(browSource, devControls.eyebrows);

    // Face deformation goes underneath the mouth plate. This is critical for
    // the 2.5D open-mouth artwork: the deformation must never cover the lips.
    if (devControls.face.visible) {
      const faceSource = devAutoAnimate
        ? (mouthState === "open_wide" ? NOVA_FILES.faceDeform.wide
          : mouthState === "smile" ? NOVA_FILES.faceDeform.smile : null)
        : faceSources[devFaceIndex];
      if (faceSource) drawLayer(faceSource, devControls.face);
    }

    // Mouth is the final facial plate so the open/rounded artwork is always
    // visible during speech.
    drawLayer(mouthSource, devControls.mouth);
  }, [eyeState, mouthState, devAutoAnimate, devMouthIndex, devEyeIndex, devFaceIndex, devBrowIndex, devControls, getImage, getMask]);

  useEffect(() => {
    let cancelled = false;

    Promise.all(sources.map(loadImage))
      .then((loaded) => {
        if (cancelled) return;
        for (const item of loaded) {
          imagesRef.current.set(imageKey(item.source), item.image);
        }
        setReady(true);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[Nova 2.5D] image load failed", error);
        setLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [sources]);

  useEffect(() => {
    if (!ready) return;

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
  }, [isSpeaking, isListening, devAutoAnimate]);

  useEffect(() => {
    if (!isSpeaking) return;

    let index = 0;
    const cycle: MouthState[] = [
      "open_small",
      "open_wide",
      "open_small",
      "o",
      "smile",
    ];

    const interval = window.setInterval(() => {
      const jaw = currentWeightsRef.current.jawOpen ?? 0;
      if (jaw === 0) {
        index = (index + 1) % cycle.length;
        setMouthState(cycle[index]);
      }
    }, 140);

    return () => window.clearInterval(interval);
  }, [isSpeaking]);

  useEffect(() => {
    let blinkTimeout = 0;

    const executeBlink = (onComplete: () => void) => {
      setEyeState("half");
      window.setTimeout(() => {
        setEyeState("closed");
        window.setTimeout(() => {
          setEyeState("half");
          window.setTimeout(() => {
            setEyeState("open");
            onComplete();
          }, 45);
        }, 50);
      }, 40);
    };

    const scheduleNextBlink = () => {
      // Frequent, visible blinks: 2.5–5.5 seconds between blinks.
      const delay = Math.random() * 3000 + 2500;
      blinkTimeout = window.setTimeout(() => {
        executeBlink(() => {
          if (Math.random() < 0.25) {
            window.setTimeout(() => executeBlink(scheduleNextBlink), 120);
          } else {
            scheduleNextBlink();
          }
        });
      }, delay);
    };

    scheduleNextBlink();

    return () => window.clearTimeout(blinkTimeout);
  }, []);

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
          transform: `rotateY(${rotY}deg) rotateX(${rotX}deg)`,
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
        <div className="absolute right-3 bottom-20 z-[99] w-[360px] max-w-[calc(100vw-24px)] max-h-[78vh] overflow-y-auto rounded-xl border border-cyan-500/30 bg-slate-950/95 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <div><div className="text-xs font-bold text-cyan-300">Nova 2.5D PRODUCTION DEV</div><div className="text-[9px] text-slate-500">Live controls linked directly to production animation images</div></div>
            <button type="button" onClick={resetDevControls} className="rounded border border-slate-700 px-2 py-1 text-[9px]">RESET</button>
          </div>
          <label className="mb-3 flex items-center justify-between rounded bg-slate-900 p-2 text-[10px]">
            Auto animation <input type="checkbox" checked={devAutoAnimate} onChange={(e) => setDevAutoAnimate(e.target.checked)} />
          </label>
          <div className="mb-3 rounded bg-slate-900 p-2">
            <div className="mb-1 text-[10px] font-bold text-pink-300">MOUTH IMAGE</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? "Lip-sync" : ["Closed","Smile","Open Small","Open Wide","O"][devMouthIndex]}</span><span className="truncate text-cyan-400/70">{mouthSources[devMouthIndex]}</span></div>
            <input className="w-full" type="range" min="0" max="4" step="1" value={devMouthIndex} disabled={devAutoAnimate} onChange={(e) => setDevMouthIndex(Number(e.target.value))} />
            <label className="mt-2 block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.mouth.x} onChange={(e)=>updateDevLayer("mouth",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.mouth.y} onChange={(e)=>updateDevLayer("mouth",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.mouth.scale} onChange={(e)=>updateDevLayer("mouth",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.mouth.opacity} onChange={(e)=>updateDevLayer("mouth",{opacity:Number(e.target.value)})}/></label>
          </div>
          <div className="mb-3 rounded bg-slate-900 p-2">
            <div className="mb-1 text-[10px] font-bold text-cyan-300">EYES / BLINK</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? eyeState : ["Open","Half","Closed"][devEyeIndex]}</span><span className="truncate text-cyan-400/70">{eyeSources[devEyeIndex]}</span></div>
            <input className="w-full" type="range" min="0" max="2" step="1" value={devEyeIndex} disabled={devAutoAnimate} onChange={(e)=>setDevEyeIndex(Number(e.target.value))}/>
            <label className="mt-2 block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.eyes.x} onChange={(e)=>updateDevLayer("eyes",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.eyes.y} onChange={(e)=>updateDevLayer("eyes",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.eyes.scale} onChange={(e)=>updateDevLayer("eyes",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.eyes.opacity} onChange={(e)=>updateDevLayer("eyes",{opacity:Number(e.target.value)})}/></label>
          </div>
          <div className="rounded bg-slate-900 p-2">
            <div className="mb-1 text-[10px] font-bold text-violet-300">FACE DEFORM</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? "Auto state" : ["Neutral","Smile","Frown","Cheek","Wide"][devFaceIndex]}</span><span className="truncate text-cyan-400/70">{faceSources[devFaceIndex]}</span></div>
            <input className="w-full" type="range" min="0" max="4" step="1" value={devFaceIndex} disabled={devAutoAnimate} onChange={(e)=>setDevFaceIndex(Number(e.target.value))}/>
            <label className="block text-[9px]">X <input className="w-full" type="range" min="-120" max="120" value={devControls.face.x} onChange={(e)=>updateDevLayer("face",{x:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Y <input className="w-full" type="range" min="-120" max="120" value={devControls.face.y} onChange={(e)=>updateDevLayer("face",{y:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Scale <input className="w-full" type="range" min=".75" max="1.25" step=".01" value={devControls.face.scale} onChange={(e)=>updateDevLayer("face",{scale:Number(e.target.value)})}/></label>
            <label className="block text-[9px]">Opacity <input className="w-full" type="range" min="0" max="1" step=".01" value={devControls.face.opacity} onChange={(e)=>updateDevLayer("face",{opacity:Number(e.target.value)})}/></label>
          </div>
          <div className="mt-3 rounded bg-slate-900 p-2">
            <div className="mb-1 text-[10px] font-bold text-amber-300">EYEBROWS</div>
            <div className="flex items-center gap-2 text-[9px] text-slate-500"><span>{devAutoAnimate ? "Neutral" : ["Neutral","Up","Inner Up","Outer Left","Outer Right","Squeeze","Down"][devBrowIndex]}</span><span className="truncate text-cyan-400/70">{browSources[devBrowIndex]}</span></div>
            <input className="w-full" type="range" min="0" max="6" step="1" value={devBrowIndex} disabled={devAutoAnimate} onChange={(e)=>setDevBrowIndex(Number(e.target.value))}/>
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
          <span className="w-full px-8 text-center break-words">
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
