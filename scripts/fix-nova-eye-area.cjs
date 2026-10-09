const fs = require("fs");

const file = "src/components/avatar/Avatar2D.tsx";
let s = fs.readFileSync(file, "utf8");

const anchor = '    const px = enableParallax ? parallax.x : 0;';

if (!s.includes(anchor)) {
  throw new Error("Could not find renderNova insertion point. Original file left unchanged.");
}

if (s.includes("const drawEyeArea =")) {
  throw new Error("Eye-area patch already exists; refusing to apply twice.");
}

const helper = `
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
`;

s = s.replace(anchor, helper + "\n" + anchor);

const eyeLine = '    draw(eye);';
if (!s.includes(eyeLine)) {
  throw new Error("Could not find draw(eye); original file left unchanged.");
}
s = s.replace(eyeLine, '    drawEyeArea(eye);');

const blinkLine = '      draw(blinkSource);';
if (!s.includes(blinkLine)) {
  throw new Error("Could not find blink overlay draw call. Restore backup before retrying.");
}
s = s.replace(blinkLine, '      drawEyeArea(blinkSource);');

fs.writeFileSync(file, s, "utf8");
console.log("Applied eye-area clipping to eye and blink overlays.");
