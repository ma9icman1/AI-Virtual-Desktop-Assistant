"use strict";

/**
 * Canonical desktop coordinate mapping for vision-driven input.
 *
 * Inspired by the coord-map pattern used by desktop computer-use agents:
 * the screenshot carries the exact capture rectangle and image dimensions,
 * and every pointer action maps from screenshot pixels to physical screen
 * pixels through one shared function.
 */

const DEFAULT_MAX_VISION_EDGE = 1280;

function positiveInt(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getVisionCanvasSize(display, maxEdge = DEFAULT_MAX_VISION_EDGE) {
  const width = positiveInt(display?.size?.width, 1920);
  const height = positiveInt(display?.size?.height, 1080);
  const limit = positiveInt(maxEdge, DEFAULT_MAX_VISION_EDGE);
  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function getDisplayPhysicalRect(display, screenApi) {
  const bounds = display?.bounds || display?.workArea || display?.size || { x: 0, y: 0, width: 1920, height: 1080 };
  const dipOrigin = { x: Number(bounds.x) || 0, y: Number(bounds.y) || 0 };
  const dipBottomRight = {
    x: dipOrigin.x + positiveInt(bounds.width, 1920),
    y: dipOrigin.y + positiveInt(bounds.height, 1080),
  };

  if (screenApi && typeof screenApi.dipToScreenPoint === "function") {
    const physicalOrigin = screenApi.dipToScreenPoint(dipOrigin);
    const physicalBottomRight = screenApi.dipToScreenPoint(dipBottomRight);
    return {
      x: Math.round(physicalOrigin.x),
      y: Math.round(physicalOrigin.y),
      width: Math.max(1, Math.round(physicalBottomRight.x - physicalOrigin.x)),
      height: Math.max(1, Math.round(physicalBottomRight.y - physicalOrigin.y)),
    };
  }

  const scale = Number(display?.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
  return {
    x: Math.round(dipOrigin.x * scale),
    y: Math.round(dipOrigin.y * scale),
    width: Math.max(1, Math.round(positiveInt(bounds.width, 1920) * scale)),
    height: Math.max(1, Math.round(positiveInt(bounds.height, 1080) * scale)),
  };
}

function createCoordinateMap(display, screenApi, visionWidth, visionHeight) {
  const vision = {
    width: positiveInt(visionWidth, DEFAULT_MAX_VISION_EDGE),
    height: positiveInt(visionHeight, 720),
  };
  const capture = getDisplayPhysicalRect(display, screenApi);
  return {
    version: 1,
    coordinateSpace: "vision",
    captureX: capture.x,
    captureY: capture.y,
    captureWidth: capture.width,
    captureHeight: capture.height,
    imageWidth: vision.width,
    imageHeight: vision.height,
  };
}

function parseCoordinateMap(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const map = value;
    const fields = ["captureX", "captureY", "captureWidth", "captureHeight", "imageWidth", "imageHeight"];
    if (fields.every((field) => Number.isFinite(Number(map[field])) && Number(map[field]) > 0 || ["captureX", "captureY"].includes(field) && Number.isFinite(Number(map[field])))) {
      return {
        version: Number(map.version) || 1,
        coordinateSpace: "vision",
        captureX: Number(map.captureX),
        captureY: Number(map.captureY),
        captureWidth: Number(map.captureWidth),
        captureHeight: Number(map.captureHeight),
        imageWidth: Number(map.imageWidth),
        imageHeight: Number(map.imageHeight),
      };
    }
    return null;
  }

  const parts = String(value).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 6 || parts.some((part) => !Number.isFinite(part))) return null;
  const [captureX, captureY, captureWidth, captureHeight, imageWidth, imageHeight] = parts;
  if (captureWidth <= 0 || captureHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
  return {
    version: 1,
    coordinateSpace: "vision",
    captureX,
    captureY,
    captureWidth,
    captureHeight,
    imageWidth,
    imageHeight,
  };
}

function formatCoordinateMap(map) {
  const normalized = parseCoordinateMap(map);
  if (!normalized) throw new Error("Invalid desktop coordinate map.");
  return [
    normalized.captureX,
    normalized.captureY,
    normalized.captureWidth,
    normalized.captureHeight,
    normalized.imageWidth,
    normalized.imageHeight,
  ].map((value) => Math.round(value)).join(",");
}

function mapPointFromCoordinateMap(x, y, map) {
  const normalized = parseCoordinateMap(map);
  if (!normalized) throw new Error("A valid vision coordinate map is required for this action.");

  const sourceX = Math.max(0, Math.min(normalized.imageWidth - 1, Number(x)));
  const sourceY = Math.max(0, Math.min(normalized.imageHeight - 1, Number(y)));

  return {
    x: Math.round(normalized.captureX + (sourceX / normalized.imageWidth) * normalized.captureWidth),
    y: Math.round(normalized.captureY + (sourceY / normalized.imageHeight) * normalized.captureHeight),
  };
}

module.exports = {
  DEFAULT_MAX_VISION_EDGE,
  getVisionCanvasSize,
  getDisplayPhysicalRect,
  createCoordinateMap,
  parseCoordinateMap,
  formatCoordinateMap,
  mapPointFromCoordinateMap,
};
