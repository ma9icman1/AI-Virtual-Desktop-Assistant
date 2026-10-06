const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const avatarPath = path.join(ROOT, "src", "components", "avatar", "Avatar2D.tsx");
const cssPath = path.join(ROOT, "src", "index.css");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, value) {
  fs.writeFileSync(file, value, "utf8");
}

let avatar = read(avatarPath);
let css = read(cssPath);

const oldStageTransform = "transform: \`rotateY(\${rotY}deg) rotateX(\${rotX}deg)\`,";
const newStageTransform = "transform: \`translateX(-8%) rotateY(\${rotY}deg) rotateX(\${rotX}deg)\`,";
if (avatar.includes(oldStageTransform)) {
  avatar = avatar.replace(oldStageTransform, newStageTransform);
} else if (!avatar.includes("translateX(-8%) rotateY")) {
  throw new Error("[avatar-2d-final] Could not find avatar stage transform marker.");
}

const oldStatusSpan = '<span className="w-full px-8 text-center break-words">';
const newStatusSpan = '<span className="w-full px-8 text-center break-words text-slate-100" style={{ color: "#e9f7ff", textShadow: "0 0 10px rgba(0, 170, 255, 0.28)" }}>';
if (avatar.includes(oldStatusSpan)) {
  avatar = avatar.replace(oldStatusSpan, newStatusSpan);
}

avatar = avatar.replace(
  'transform: "translateZ(0px)",',
  'transform: "translateZ(0px)",\n              zIndex: 10,'
);
avatar = avatar.replace(
  "transform: \`translateZ(20px) translate3d(\${parallax.x * 3}px, \${parallax.y * 3}px, 0)\`,",
  "transform: \`translateZ(20px) translate3d(\${parallax.x * 3}px, \${parallax.y * 3}px, 0)\`,\n              zIndex: 30,"
);
avatar = avatar.replace(
  "transform: \`translateZ(18px) translate3d(\${parallax.x * 2.5}px, \${parallax.y * 2.5}px, 0)\`,",
  "transform: \`translateZ(18px) translate3d(\${parallax.x * 2.5}px, \${parallax.y * 2.5}px, 0)\`,\n              zIndex: 40,"
);

write(avatarPath, avatar);

const marker = "/* [avatar-2d-final-v1] */";
if (!css.includes(marker)) {
  css += "\n\n" + marker + "\n" +
    "body.avatar-overlay .avatar2d-stage {\n" +
    "  width: min(100%, 620px);\n" +
    "  margin-left: 0;\n" +
    "  margin-right: 0;\n" +
    "}\n\n" +
    "body.avatar-overlay .avatar2d-stage > .relative {\n" +
    "  transform-origin: 50% 100%;\n" +
    "}\n\n" +
    "body.avatar-overlay .avatar2d-controls {\n" +
    "  left: 50% !important;\n" +
    "  right: auto !important;\n" +
    "  transform: translateX(-50%) !important;\n" +
    "}\n\n" +
    "body.avatar-overlay .avatar2d-controls > div:first-child {\n" +
    "  color: #e9f7ff !important;\n" +
    "  text-shadow: 0 0 10px rgba(0, 170, 255, .28);\n" +
    "}\n";
}

write(cssPath, css);
console.log("[avatar-2d-final] centered Nova, fixed layer order, and forced readable overlay text.");
