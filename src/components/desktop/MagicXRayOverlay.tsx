import React, { useEffect, useMemo, useState } from "react";
import { Eye, Crosshair, ScanLine, Target, X } from "lucide-react";
import { VisionDetection } from "../../types";

interface MagicXRayOverlayProps {
  vision: VisionDetection | null;
  imageUrl?: string;
  visible: boolean;
  onClose: () => void;
  onTargetClick?: (element: VisionDetection["detectedElements"][number]) => void;
}

export const MagicXRayOverlay: React.FC<MagicXRayOverlayProps> = ({
  vision,
  imageUrl,
  visible,
  onClose,
  onTargetClick,
}) => {
  const [imageSize, setImageSize] = useState({ width: 1600, height: 900 });

  useEffect(() => {
    if (!imageUrl) return;
    const image = new Image();
    image.onload = () => {
      setImageSize({
        width: image.naturalWidth || 1600,
        height: image.naturalHeight || 900,
      });
    };
    image.src = imageUrl;
  }, [imageUrl]);

  const elements = useMemo(
    () => (vision?.detectedElements || []).filter((element) => element.boundingBox),
    [vision]
  );

  if (!visible || !vision) return null;

  const scaleX = window.innerWidth / imageSize.width;
  const scaleY = window.innerHeight / imageSize.height;

  return (
    <div className="fixed inset-0 z-[65] pointer-events-none" aria-label="Magic X-Ray vision overlay">
      <div className="absolute inset-0 bg-cyan-400/[0.025]" />

      <div className="ma9ic-xray-hud absolute top-4 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="flex items-center gap-2 rounded-full border border-cyan-300/40 bg-slate-950/90 px-3 py-1.5 shadow-2xl shadow-cyan-950/50 backdrop-blur-xl">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-300" />
          </span>
          <ScanLine className="h-3.5 w-3.5 text-cyan-300" />
          <span className="text-[11px] font-bold tracking-wider text-cyan-100">MAGIC X-RAY</span>
          <span className="text-[10px] text-slate-400">{elements.length} targets</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 rounded-full p-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Close Magic X-Ray"
            title="Close Magic X-Ray"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {elements.map((element, index) => {
        const box = element.boundingBox!;
        const left = box.x * scaleX;
        const top = box.y * scaleY;
        const width = Math.max(24, box.width * scaleX);
        const height = Math.max(18, box.height * scaleY);

        return (
          <div
            key={`xray-${index}-${element.type}-${element.label}`}
            className="absolute pointer-events-auto cursor-crosshair"
            style={{ left, top, width, height }}
            onClick={() => onTargetClick?.(element)}
            title={onTargetClick ? `Target: ${element.label || element.type}` : undefined}
          >
            <div className="absolute inset-0 rounded-md border border-cyan-300/80 bg-cyan-300/[0.07] shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_0_18px_rgba(34,211,238,0.18)] animate-pulse" />

            <div className="absolute -top-5 left-0 flex max-w-[260px] items-center gap-1 rounded-t-md border border-cyan-300/50 bg-slate-950/95 px-1.5 py-0.5 whitespace-nowrap shadow-lg">
              <Crosshair className="h-2.5 w-2.5 shrink-0 text-cyan-300" />
              <span className="truncate text-[9px] font-semibold text-cyan-100">
                {element.label || "Detected target"}
              </span>
              <span className="text-[8px] uppercase text-slate-500">{element.type}</span>
            </div>

            <span className="absolute -left-px -top-px h-2 w-2 border-l-2 border-t-2 border-cyan-200" />
            <span className="absolute -right-px -top-px h-2 w-2 border-r-2 border-t-2 border-cyan-200" />
            <span className="absolute -bottom-px -left-px h-2 w-2 border-b-2 border-l-2 border-cyan-200" />
            <span className="absolute -bottom-px -right-px h-2 w-2 border-b-2 border-r-2 border-cyan-200" />

            {element.center && (
              <div
                className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: element.center.x * scaleX - box.x * scaleX,
                  top: element.center.y * scaleY - box.y * scaleY,
                }}
              >
                <Target className="h-3 w-3 text-cyan-200" />
              </div>
            )}
          </div>
        );
      })}

      <div className="absolute bottom-4 left-4 max-w-sm rounded-xl border border-cyan-400/20 bg-slate-950/85 px-3 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-cyan-300" />
          <span className="text-[10px] font-semibold text-cyan-100">ACTIVE APPLICATION</span>
        </div>
        <p className="mt-0.5 text-xs text-white">{vision.activeApplication || "Unknown"}</p>
        <p className="mt-1 text-[9px] leading-relaxed text-slate-500">{vision.summary}</p>
      </div>
    </div>
  );
};
