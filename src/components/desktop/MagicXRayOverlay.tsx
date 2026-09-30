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

      {/* Target boxes are rendered over the captured image inside ChatFeed so they stay
          aligned with the actual screenshot instead of being pinned to the app viewport. */}

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
