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

const DIFF_THRESHOLD = 1;
const CANVAS_SIZE = 2048;

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
      ctx.globalAlpha = opacity;
      ctx.drawImage(mask, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.restore();
    };

    const px = enableParallax ? parallax.x : 0;
    const py = enableParallax ? parallax.y : 0;
    const eye =
      Math.abs(px) < .33 && Math.abs(py) < .33 ? "eyes/center.png" :
      py < -.33 ? (px < -.33 ? "eyes/up_left.png" : px > .33 ? "eyes/up_right.png" : "eyes/up.png") :
      py > .33 ? (px < -.33 ? "eyes/down_left.png" : px > .33 ? "eyes/down_right.png" : "eyes/down.png") :
      px < -.33 ? "eyes/left.png" : "eyes/right.png";
    draw(eye);

    if (!isSpeaking) {
      draw(isListening ? "idle_listening/slight_smile.png" : "idle_listening/annoyed.png", isListening ? .85 : .18);
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
      } else if (o > .3 || u > .3 || pucker > .3) {
        mouth = `mouth/Mouth Pucker_${Math.max(60, Math.min(100, Math.round(Math.max(o, u, pucker) * 100 / 20) * 20))}.png`;
      } else if (aa > .35 || jaw > .55) {
        mouth = `mouth/Mouth Upper Up_${Math.max(60, Math.min(100, Math.round(Math.max(aa, jaw) * 100 / 20) * 20))}.png`;
      } else if (e > .25 || i > .25 || jaw > .12) {
        mouth = `mouth/Mouth Stretch_${Math.max(40, Math.min(80, Math.round(Math.max(e, i, jaw) * 100 / 20) * 20))}.png`;
      } else if (ss > .3 || smile > .3) {
        mouth = "mouth/Mouth Smile Widen_60.png";
      }

      draw(mouth);
      if (smile > .25) draw("face_deform/smile_50.png", .65);
    } else {
      draw("mouth/Mouth Press_20.png");
    }

    const brow = currentWeightsRef.current.browInnerUp ?? 0;
    if (brow > .25) draw("eyebrows/Brow Inner Up_50.png");

    // BLINK MUST BE THE FINAL COMPOSITOR LAYER. Mouth and expression plates
    // are full renders turned into difference masks; their masks can still
    // touch pixels around the eyes. Drawing blink earlier lets those later
    // layers repaint the eyes open again even while eyeState says "closed".
    if (eyeState !== "open") draw(eyeState === "half" ? "blinks/half.png" : "blinks/closed.png");
  }, [eyeState, isSpeaking, isListening, parallax, enableParallax, getImage, getMask]);

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
    let blinkTimeout = 0;
    let blinkHalfTimeout = 0;
    let blinkClosedTimeout = 0;
    let blinkReturnTimeout = 0;
    let cancelled = false;

    const executeBlink = (onComplete: () => void) => {
      if (cancelled) {
        onComplete();
        return;
      }

      setEyeState("half");
      blinkHalfTimeout = window.setTimeout(() => {
        if (cancelled) return onComplete();

        setEyeState("closed");
        blinkClosedTimeout = window.setTimeout(() => {
          if (cancelled) return onComplete();

          setEyeState("half");
          blinkReturnTimeout = window.setTimeout(() => {
            if (cancelled) return onComplete();

            setEyeState("open");
            onComplete();
          }, 70);
        }, 90);
      }, 65);
    };

    const scheduleNextBlink = () => {
      // Natural, slightly quicker blinks: about 2–4.2 seconds apart.
      const delay = Math.random() * 2200 + 2000;
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

    return () => {
      cancelled = true;
      window.clearTimeout(blinkTimeout);
      window.clearTimeout(blinkHalfTimeout);
      window.clearTimeout(blinkClosedTimeout);
      window.clearTimeout(blinkReturnTimeout);
      setEyeState("open");
    };
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
      </div>
      </div>
    </div>
  );
};
