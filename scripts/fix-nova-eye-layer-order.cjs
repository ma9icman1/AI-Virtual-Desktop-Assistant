const fs = require("fs");
const file = "src/components/avatar/Avatar2D.tsx";
let s = fs.readFileSync(file, "utf8");
const eye = "    const eye =";
const mouth = "    if (isSpeaking) {";
const brow = '    if (brow > .25) draw("eyebrows/Brow Inner Up_50.png");';

function allIndexes(text, marker) {
  const found = [];
  let at = 0;
  while ((at = text.indexOf(marker, at)) !== -1) {
    found.push(at);
    at += marker.length;
  }
  return found;
}

let eyes = allIndexes(s, eye);
if (eyes.length > 1) {
  // Remove the earlier duplicate eye layer, including its blink block.
  const start = eyes[0];
  const end = s.indexOf(mouth, start);
  if (end < 0) throw new Error("Mouth boundary not found; file not changed.");
  s = s.slice(0, start) + s.slice(end);
}

eyes = allIndexes(s, eye);
if (eyes.length !== 1) {
  throw new Error(`Expected one eye declaration; found ${eyes.length}.`);
}
const browAt = s.indexOf(brow);
if (browAt < 0 || eyes[0] < browAt) {
  throw new Error("Eye layer must follow eyebrow layer; file not changed.");
}
if (!s.includes("draw(blinkSource);")) {
  throw new Error("Masked blink drawing is missing; file not changed.");
}
fs.writeFileSync(file, s.replace(/\s*$/, "\n"), "utf8");
console.log("[nova-eye-layer-order] Validated one eye declaration after brows.");
