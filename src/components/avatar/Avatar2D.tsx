import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LipSyncEngine, VisemeWeights } from "../../services/lipSyncEngine";
import { Mic, Volume2, Maximize2, Layers } from "lucide-react";

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

const DIFF_THRESHOLD = 8;
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

    const activeSources: NovaSource[] = [
      NOVA_FILES.eyes.center,
      NOVA_FILES.blinks[eyeState],
      NOVA_FILES.eyebrows.neutral,
      NOVA_FILES.mouth[
        mouthState === "o"
          ? "o"
          : mouthState === "open_wide"
            ? "openWide"
            : mouthState === "open_small"
              ? "openSmall"
              : mouthState === "smile"
                ? "smile"
                : "closed"
      ],
      NOVA_FILES.faceDeform[
        mouthState === "open_wide"
          ? "wide"
          : mouthState === "smile"
            ? "smile"
            : "neutral"
      ],
    ];

    for (const source of activeSources) {
      const mask = getMask(source);
      if (mask) {
        ctx.drawImage(mask, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }
    }
  }, [eyeState, mouthState, getImage, getMask]);

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
  }, [isSpeaking, isListening]);

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
      const delay = Math.random() * 3000 + 3500;
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
        </div>
      </div>
    </div>
  );
};
