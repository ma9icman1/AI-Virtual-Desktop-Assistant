const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const avatarPath = path.join(ROOT, "src", "components", "avatar", "Avatar2D.tsx");
const lipPath = path.join(ROOT, "src", "services", "lipSyncEngine.ts");

function fail(message) {
  console.error(`[nova-production] ERROR: ${message}`);
  process.exit(1);
}

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) fail(`Could not patch ${label}. The source layout has changed.`);
  return next;
}

let avatar = fs.readFileSync(avatarPath, "utf8");

avatar = replaceOnce(
  avatar,
  /type NovaSource =[\s\S]*?type RGBAImage = \{/,
  `type NovaSource = string;

type RGBAImage = {`,
  "NovaSource type",
);

avatar = replaceOnce(
  avatar,
  /const CANVAS_SIZE = 1024;/,
  "const CANVAS_SIZE = 2048;",
  "Nova canvas size",
);

avatar = replaceOnce(
  avatar,
  /const sources = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/,
  `const sources = useMemo(() => {
    const values: NovaSource[] = [
      NOVA_FILES.base,
      "eyes/center.png",
      "eyes/left.png",
      "eyes/right.png",
      "eyes/up.png",
      "eyes/down.png",
      "eyes/up_left.png",
      "eyes/up_right.png",
      "eyes/down_left.png",
      "eyes/down_right.png",
      "blinks/open.png",
      "blinks/quarter.png",
      "blinks/half.png",
      "blinks/three_quarter.png",
      "blinks/closed.png",
      "idle_listening/slight_smile.png",
      "idle_listening/annoyed.png",
      "mouth/Mouth Press_20.png",
      "mouth/Mouth Press_40.png",
      "mouth/Mouth Press_60.png",
      "mouth/Mouth Press_80.png",
      "mouth/Mouth Press_100.png",
      "mouth/Mouth Smile_100.png",
      "mouth/Mouth Smile Widen_60.png",
      "mouth/Mouth Stretch_40.png",
      "mouth/Mouth Stretch_60.png",
      "mouth/Mouth Stretch_80.png",
      "mouth/Mouth Upper Up_60.png",
      "mouth/Mouth Upper Up_80.png",
      "mouth/Mouth Upper Up_100.png",
      "mouth/Mouth Pucker_60.png",
      "mouth/Mouth Pucker_80.png",
      "mouth/Mouth Pucker_100.png",
      "speech/phoneme_TH_80.png",
      "speech/phoneme_SH_CH_J_80.png",
      "speech/vowel_U_80.png",
      "face_deform/smile_50.png",
      "face_deform/mouth wide_75.png",
      "eyebrows/Brow Up_50.png",
      "eyebrows/Brow Inner Up_50.png",
      "eyebrows/Brow Down_50.png",
      "eyebrows/Brow Squeeze_50.png",
    ];
    return [...new Set(values)];
  }, []);`,
  "production source preload",
);

avatar = replaceOnce(
  avatar,
  /const mouthSources: NovaSource\[\] = \[[\s\S]*?const browSources: NovaSource\[\] = \[[\s\S]*?\n  \];/,
  `const mouthSources: NovaSource[] = [
    "mouth/Mouth Press_100.png",
    "mouth/Mouth Smile_100.png",
    "mouth/Mouth Stretch_60.png",
    "mouth/Mouth Upper Up_100.png",
    "mouth/Mouth Pucker_80.png",
  ];
  const eyeSources: NovaSource[] = [
    "blinks/open.png",
    "blinks/half.png",
    "blinks/closed.png",
  ];
  const faceSources: NovaSource[] = [
    "face_deform/lip_25.png",
    "face_deform/smile_50.png",
    "face_deform/frown_50.png",
    "face_deform/cheek_50.png",
    "face_deform/mouth wide_75.png",
  ];
  const browSources: NovaSource[] = [
    "eyebrows/Brow Down_50.png",
    "eyebrows/Brow Up_50.png",
    "eyebrows/Brow Inner Up_50.png",
    "eyebrows/Brow Outer Up Left_50.png",
    "eyebrows/Brow Outer Up Right_50.png",
    "eyebrows/Brow Squeeze_50.png",
    "eyebrows/Brow Down_100.png",
  ];`,
  "developer source arrays",
);

const renderStart = avatar.indexOf("  const renderNova = useCallback(() => {");
const renderEnd = avatar.indexOf("\n\n  useEffect(() => {\n    let cancelled = false;", renderStart);
if (renderStart < 0 || renderEnd < 0) fail("Could not locate renderNova block.");

const newRender = `  const renderNova = useCallback(() => {
    const canvas = canvasRef.current;
    const base = getImage(NOVA_FILES.base);
    if (!canvas || !base) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Production plates are already transparent, aligned 2048x2048 renders.
    // Draw the base once, then stack only the active transparent facial plates.
    ctx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const weights = currentWeightsRef.current;
    const drawPlate = (source: NovaSource, opacity = 1) => {
      const image = getImage(source);
      if (!image) return;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      ctx.restore();
    };

    const px = enableParallax ? parallax.x : 0;
    const py = enableParallax ? parallax.y : 0;
    const eyeX = px;
    const eyeY = py;
    const eyePath =
      Math.abs(eyeX) < 0.33 && Math.abs(eyeY) < 0.33
        ? "eyes/center.png"
        : eyeY < -0.33
          ? (eyeX < -0.33 ? "eyes/up_left.png" : eyeX > 0.33 ? "eyes/up_right.png" : "eyes/up.png")
          : eyeY > 0.33
            ? (eyeX < -0.33 ? "eyes/down_left.png" : eyeX > 0.33 ? "eyes/down_right.png" : "eyes/down.png")
            : eyeX < -0.33 ? "eyes/left.png" : "eyes/right.png";

    drawPlate(eyePath);

    if (devAutoAnimate) {
      const blinkPath =
        eyeState === "half" ? "blinks/half.png" :
        eyeState === "closed" ? "blinks/closed.png" :
        null;
      if (blinkPath) drawPlate(blinkPath);
    }

    if (!isSpeaking) {
      drawPlate(isListening ? "idle_listening/slight_smile.png" : "idle_listening/annoyed.png", isListening ? 0.85 : 0.18);
    }

    if (isSpeaking) {
      const jaw = weights.jawOpen ?? 0;
      const pucker = Math.max(weights.mouthPucker ?? 0, weights.mouthFunnel ?? 0);
      const smile = Math.max(weights.mouthSmileLeft ?? 0, weights.mouthSmileRight ?? 0);
      const aa = weights.viseme_aa ?? 0;
      const e = weights.viseme_E ?? 0;
      const i = weights.viseme_I ?? 0;
      const o = weights.viseme_O ?? 0;
      const u = weights.viseme_U ?? 0;
      const pp = weights.viseme_PP ?? 0;
      const ff = weights.viseme_FF ?? 0;
      const th = weights.viseme_TH ?? 0;
      const ch = weights.viseme_CH ?? 0;
      const ss = weights.viseme_SS ?? 0;

      let mouthPath = "mouth/Mouth Press_20.png";

      if (pp > 0.3) {
        mouthPath = `mouth/Mouth Press_${Math.max(20, Math.min(100, Math.round(pp * 100 / 20) * 20))}.png`;
      } else if (ff > 0.3) {
        mouthPath = `mouth/Mouth Stretch_${Math.max(40, Math.min(80, Math.round(ff * 80 / 20) * 20))}.png`;
      } else if (th > 0.35) {
        mouthPath = "speech/phoneme_TH_80.png";
      } else if (ch > 0.35) {
        mouthPath = "speech/phoneme_SH_CH_J_80.png";
      } else if (o > 0.3 || u > 0.3 || pucker > 0.3) {
        const strength = Math.max(60, Math.min(100, Math.round(Math.max(o, u, pucker) * 100 / 20) * 20));
        mouthPath = `mouth/Mouth Pucker_${strength}.png`;
      } else if (aa > 0.35 || jaw > 0.55) {
        const strength = Math.max(60, Math.min(100, Math.round(Math.max(aa, jaw) * 100 / 20) * 20));
        mouthPath = `mouth/Mouth Upper Up_${strength}.png`;
      } else if (e > 0.25 || i > 0.25 || jaw > 0.12) {
        const strength = Math.max(40, Math.min(80, Math.round(Math.max(e, i, jaw) * 100 / 20) * 20));
        mouthPath = `mouth/Mouth Stretch_${strength}.png`;
      } else if (ss > 0.3 || smile > 0.3) {
        const strength = Math.max(20, Math.min(100, Math.round(Math.max(ss, smile) * 100 / 20) * 20));
        mouthPath = `mouth/Mouth Smile Widen_${strength}.png`;
      }

      drawPlate(mouthPath);

      if (smile > 0.25) {
        const faceStrength = Math.max(25, Math.min(100, Math.round(smile * 100 / 25) * 25));
        drawPlate(`face_deform/smile_${faceStrength}.png`, 0.65);
      }
    } else {
      drawPlate(devAutoAnimate ? "mouth/Mouth Press_20.png" : mouthSources[devMouthIndex]);
    }

    const brow = weights.browInnerUp ?? 0;
    if (brow > 0.25) {
      const strength = Math.max(25, Math.min(100, Math.round(brow * 100 / 25) * 25));
      drawPlate(`eyebrows/Brow Inner Up_${strength}.png`);
    }
  }, [
    eyeState, isSpeaking, isListening, devAutoAnimate, devMouthIndex,
    mouthSources, parallax, enableParallax, getImage,
  ]);`;

avatar = avatar.slice(0, renderStart) + newRender + avatar.slice(renderEnd);

avatar = replaceOnce(
  avatar,
  /\n  useEffect\(\(\) => \{\n    if \(!isSpeaking\) return;\n\n    let index = 0;[\s\S]*?\n  \}, \[isSpeaking\]\);\n/,
  "\n",
  "artificial mouth cycling fallback",
);

fs.writeFileSync(avatarPath, avatar, "utf8");

let lip = fs.readFileSync(lipPath, "utf8");
lip = replaceOnce(
  lip,
  /    this\.speechTimeoutId = setTimeout\(\(\) => \{\n      if \(this\.speakingActive\) \{\n        this\.resetWeights\(\);\n      \}\n    \}, delay \+ 200\);\n/,
  `    // Do not force-reset the mouth from a guessed speech duration. The voice engine\n    // owns the real speech end event; resetting here caused premature mouth snapping.\n`,
  "premature speech reset",
);
lip = replaceOnce(
  lip,
  /      \/\/ Add gentle jitter\/formant variation to make speech mouth feel organic[\s\S]*?        this\.notify\(\);\n      \}\n/,
  `      // Keep the production render library stable. The avatar selects actual\n      // intermediate-strength plates from the current viseme weights, so random\n      // jaw jitter is intentionally not injected here.\n      if (this.targetWeights.jawOpen !== undefined) {\n        this.currentWeights.jawOpen = this.targetWeights.jawOpen;\n        this.notify();\n      }\n`,
  "random jaw jitter",
);
fs.writeFileSync(lipPath, lip, "utf8");

console.log("[nova-production] patched Avatar2D.tsx to 2048x2048 production plates");
console.log("[nova-production] removed artificial mouth cycling fallback");
console.log("[nova-production] patched lip-sync timing/jitter behavior");
