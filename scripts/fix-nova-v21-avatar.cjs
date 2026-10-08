const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "src", "components", "avatar", "Avatar2D.tsx");
let source = fs.readFileSync(file, "utf8");
const original = source;

function replaceOnce(oldText, newText, label) {
  if (source.includes(oldText)) {
    source = source.replace(oldText, newText);
    console.log("[nova-v21-fix] patched " + label);
  }
}

source = source.replaceAll(
  '"/Nova_2_5D_PRODUCTION_LAYERS_FINAL"',
  '"/Nova_2_5D_FINAL_PRODUCTION_v21_all_renders"',
);

replaceOnce(
  'neutral: "idle_listening/neutral_rest_100.png"',
  'neutral: "base/nova_base.png"',
  "neutral base plate",
);
replaceOnce(
  'attentive: "idle_listening/attentive_100.png"',
  'attentive: "base/nova_base.png"',
  "attentive base plate",
);

if (source.includes("Promise.all(sources.map(loadImage))")) {
  source = source.replace(
    "Promise.all(sources.map(loadImage))",
    "Promise.all(sources.map((asset) => loadImage(asset).catch((error) => {\n      console.debug(\"[Nova v21] optional plate unavailable:\", asset, error);\n      return null;\n    })))",
  );
  console.log("[nova-v21-fix] made optional plate loading tolerant");
}

source = source.replace(
  /for \(const item of loaded\) \{\s*imagesRef\.current\.set\(\s*(imageKey\(item\.source\)|item\.source),\s*item\.image,\s*\);\s*\}/g,
  (match, keyExpression) =>
    "for (const item of loaded) {\n          if (!item) continue;\n          imagesRef.current.set(" + keyExpression + ", item.image);\n        }",
);

if (!/imagesRef\.current\.has\((?:NOVA_FILES\.base|"base\/nova_base\.png")\)/.test(source)) {
  const readyMarker = "        setReady(true);";
  const idx = source.indexOf(readyMarker);
  if (idx !== -1) {
    source = source.slice(0, idx) +
      "        if (!imagesRef.current.has(\"base/nova_base.png\")) {\n" +
      "          throw new Error(\"Required Nova v21 base image is missing: \" + sourceUrl(\"base/nova_base.png\"));\n" +
      "        }\n" +
      source.slice(idx);
    console.log("[nova-v21-fix] added required-base validation");
  }
}

if (!source.includes('"/Nova_2_5D_FINAL_PRODUCTION_v21_all_renders"')) {
  throw new Error("Could not set the Nova v21 asset root; no files were written.");
}
if (source.includes("Promise.all(sources.map(loadImage))")) {
  throw new Error("Optional-image loader patch did not apply; no files were written.");
}
if (!source.includes("base/nova_base.png")) {
  throw new Error("Base PNG is not referenced; no files were written.");
}

if (source !== original) {
  fs.writeFileSync(file, source, "utf8");
  console.log("[nova-v21-fix] updated " + path.relative(process.cwd(), file));
} else {
  console.log("[nova-v21-fix] already applied; no changes needed");
}
