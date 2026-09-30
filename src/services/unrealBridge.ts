import { VisionDetection } from "../types";

export interface UnrealVisionTarget {
  id: string;
  type: string;
  label: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  center?: { x: number; y: number };
}

export interface UnrealVisionEvent {
  timestamp: number;
  activeApplication: string;
  summary: string;
  targets: UnrealVisionTarget[];
}

declare global {
  interface Window {
    magicUnreal?: {
      sendVisionEvent?: (event: UnrealVisionEvent) => void;
    };
  }
}

export function publishVisionToUnreal(vision: VisionDetection | null): UnrealVisionEvent | null {
  if (!vision) return null;

  const event: UnrealVisionEvent = {
    timestamp: Date.now(),
    activeApplication: vision.activeApplication || "Unknown",
    summary: vision.summary || "",
    targets: vision.detectedElements.map((element, index) => ({
      id: `vision-target-${index}`,
      type: element.type,
      label: element.label,
      boundingBox: element.boundingBox,
      center: element.center,
    })),
  };

  window.dispatchEvent(new CustomEvent<UnrealVisionEvent>("magicai:vision-update", { detail: event }));

  try {
    window.magicUnreal?.sendVisionEvent?.(event);
  } catch (error) {
    console.warn("Unreal vision bridge is unavailable:", error);
  }

  return event;
}
