const fs = require("fs");
const path = require("path");

const root = process.cwd();
const avatarPath = path.join(root, "src/components/avatar/Avatar2D.tsx");
const lipPath = path.join(root, "src/services/lipSyncEngine.ts");

function patch(file, replacements) {
  let text = fs.readFileSync(file, "utf8");
  for (const [pattern, replacement, name] of replacements) {
    const next = text.replace(pattern, replacement);
    if (next === text) throw new Error("[nova-production] missing marker: " + name);
    text = next;
  }
  fs.writeFileSync(file, text, "utf8");
}

patch(avatarPath, [
  [/type NovaSource =[\s\S]*?type RGBAImage = \{/, "type NovaSource = string;\n\ntype RGBAImage = {", "NovaSource"],
  [/const CANVAS_SIZE = 1024;/, "const CANVAS_SIZE = 2048;", "canvas size"],
  [/const sources = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/,
`const sources = useMemo(() => [
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
  "eyebrows/Brow Up_50.png","eyebrows/Brow Inner Up_50.png","eyebrows/Brow Down_50.png","eyebrows/Brow Squeeze_50.png"
], []);`, "source preload"],
  [/const mouthSources: NovaSource\[\] = \[[\s\S]*?const browSources: NovaSource\[\] = \[[\s\S]*?\n  \];/,
`const mouthSources: NovaSource[] = [
  "mouth/Mouth Press_100.png","mouth/Mouth Smile_100.png","mouth/Mouth Stretch_60.png",
  "mouth/Mouth Upper Up_100.png","mouth/Mouth Pucker_80.png"
];
  const eyeSources: NovaSource[] = ["blinks/open.png","blinks/half.png","blinks/closed.png"];
  const faceSources: NovaSource[] = [
    "face_deform/lip_25.png","face_deform/smile_50.png","face_deform/frown_50.png",
    "face_deform/cheek_50.png","face_deform/mouth wide_75.png"
  ];
  const browSources: NovaSource[] = [
    "eyebrows/Brow Down_50.png","eyebrows/Brow Up_50.png","eyebrows/Brow Inner Up_50.png",
    "eyebrows/Brow Outer Up Left_50.png","eyebrows/Brow Outer Up Right_50.png",
    "eyebrows/Brow Squeeze_50.png","eyebrows/Brow Down_100.png"
  ];`, "developer arrays"],
]);

let avatar = fs.readFileSync(avatarPath, "utf8");
const start = avatar.indexOf("  const renderNova = useCallback(() => {");
const end = avatar.indexOf("\n\n  useEffect(() => {\n    let cancelled = false;", start);
if (start < 0 || end < 0) throw new Error("[nova-production] renderNova marker not found");

const render = [
"  const renderNova = useCallback(() => {",
"    const canvas = canvasRef.current;",
"    const base = getImage(NOVA_FILES.base);",
"    if (!canvas || !base) return;",
"    const ctx = canvas.getContext('2d');",
"    if (!ctx) return;",
"    canvas.width = CANVAS_SIZE; canvas.height = CANVAS_SIZE;",
"    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);",
"    ctx.drawImage(base, 0, 0, CANVAS_SIZE, CANVAS_SIZE);",
"    const w = currentWeightsRef.current;",
"    const draw = (source, opacity = 1) => { const image = getImage(source); if (!image) return; ctx.save(); ctx.globalAlpha = opacity; ctx.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE); ctx.restore(); };",
"    const px = enableParallax ? parallax.x : 0;",
"    const py = enableParallax ? parallax.y : 0;",
"    const eye = Math.abs(px) < .33 && Math.abs(py) < .33 ? 'eyes/center.png' : py < -.33 ? (px < -.33 ? 'eyes/up_left.png' : px > .33 ? 'eyes/up_right.png' : 'eyes/up.png') : py > .33 ? (px < -.33 ? 'eyes/down_left.png' : px > .33 ? 'eyes/down_right.png' : 'eyes/down.png') : (px < -.33 ? 'eyes/left.png' : 'eyes/right.png');",
"    draw(eye);",
"    if (devAutoAnimate && eyeState !== 'open') draw(eyeState === 'half' ? 'blinks/half.png' : 'blinks/closed.png');",
"    if (!isSpeaking) draw(isListening ? 'idle_listening/slight_smile.png' : 'idle_listening/annoyed.png', isListening ? .85 : .18);",
"    if (isSpeaking) {",
"      const jaw=w.jawOpen||0, pucker=Math.max(w.mouthPucker||0,w.mouthFunnel||0), smile=Math.max(w.mouthSmileLeft||0,w.mouthSmileRight||0);",
"      const aa=w.viseme_aa||0,e=w.viseme_E||0,i=w.viseme_I||0,o=w.viseme_O||0,u=w.viseme_U||0,pp=w.viseme_PP||0,ff=w.viseme_FF||0,th=w.viseme_TH||0,ch=w.viseme_CH||0,ss=w.viseme_SS||0;",
"      let mouth = 'mouth/Mouth Press_20.png';",
"      if (pp>.3) mouth='mouth/Mouth Press_'+Math.max(20,Math.min(100,Math.round(pp*100/20)*20))+'.png';",
"      else if (ff>.3) mouth='mouth/Mouth Stretch_'+Math.max(40,Math.min(80,Math.round(ff*80/20)*20))+'.png';",
"      else if (th>.35) mouth='speech/phoneme_TH_80.png';",
"      else if (ch>.35) mouth='speech/phoneme_SH_CH_J_80.png";",
"      else if (o>.3||u>.3||pucker>.3) mouth='mouth/Mouth Pucker_'+Math.max(60,Math.min(100,Math.round(Math.max(o,u,pucker)*100/20)*20))+'.png';",
"      else if (aa>.35||jaw>.55) mouth='mouth/Mouth Upper Up_'+Math.max(60,Math.min(100,Math.round(Math.max(aa,jaw)*100/20)*20))+'.png';",
"      else if (e>.25||i>.25||jaw>.12) mouth='mouth/Mouth Stretch_'+Math.max(40,Math.min(80,Math.round(Math.max(e,i,jaw)*100/20)*20))+'.png';",
"      else if (ss>.3||smile>.3) mouth='mouth/Mouth Smile Widen_'+Math.max(20,Math.min(100,Math.round(Math.max(ss,smile)*100/20)*20))+'.png';",
"      draw(mouth);",
"      if (smile>.25) draw('face_deform/smile_'+Math.max(25,Math.min(100,Math.round(smile*100/25)*25))+'.png', .65);",
"    } else draw(devAutoAnimate ? 'mouth/Mouth Press_20.png' : mouthSources[devMouthIndex]);",
"    const brow=w.browInnerUp||0;",
"    if (brow>.25) draw('eyebrows/Brow Inner Up_'+Math.max(25,Math.min(100,Math.round(brow*100/25)*25))+'.png');",
"  }, [eyeState,isSpeaking,isListening,devAutoAnimate,devMouthIndex,mouthSources,parallax,enableParallax,getImage]);"
].join("\n");

avatar = avatar.slice(0, start) + render + avatar.slice(end);

avatar = avatar.replace(/\n  useEffect\(\(\) => \{\n    if \(!isSpeaking\) return;[\s\S]*?\n  \}, \[isSpeaking\]\);\n/, "\n");
fs.writeFileSync(avatarPath, avatar, "utf8");

patch(lipPath, [
  [/    this\.speechTimeoutId = setTimeout\(\(\) => \{\n      if \(this\.speakingActive\) \{\n        this\.resetWeights\(\);\n      \}\n    \}, delay \+ 200\);\n/, "    // The real speech-end event owns reset timing; do not snap the mouth early.\n", "speech reset"],
  [/      \/\/ Add gentle jitter\/formant variation to make speech mouth feel organic[\s\S]*?        this\.notify\(\);\n      \}\n/, "      if (this.targetWeights.jawOpen !== undefined) {\n        this.currentWeights.jawOpen = this.targetWeights.jawOpen;\n        this.notify();\n      }\n", "jaw jitter"],
]);

console.log("[nova-production] Avatar2D switched to 2048x2048 production plates");
console.log("[nova-production] artificial mouth cycling removed");
console.log("[nova-production] lip-sync premature reset/jitter removed");
