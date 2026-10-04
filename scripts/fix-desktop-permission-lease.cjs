const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "electron", "main.cjs");
const source = fs.readFileSync(mainPath, "utf8");

const marker = 'let desktopPermission = "none";';
if (!source.includes(marker)) {
  throw new Error("[desktop-permission-lease] desktop permission state marker not found; refusing to modify files.");
}

const helper = `
let desktopPermissionLeaseTimer = null;

function promoteOneActionPermissionForTask() {
  if (desktopPermission !== "one_action") return;
  desktopPermission = "one_session";
  if (desktopPermissionLeaseTimer) clearTimeout(desktopPermissionLeaseTimer);
  desktopPermissionLeaseTimer = setTimeout(() => {
    if (desktopPermission === "one_session") desktopPermission = "none";
    desktopPermissionLeaseTimer = null;
  }, 30000);
}
`;

if (!source.includes("function promoteOneActionPermissionForTask()")) {
  const updated = source.replace(marker, marker + helper);
  fs.writeFileSync(mainPath, updated, "utf8");
  console.log("[desktop-permission-lease] installed 30-second one-action automation lease.");
} else {
  console.log("[desktop-permission-lease] already installed; skipped.");
}

const current = fs.readFileSync(mainPath, "utf8");
const consumePattern = /if \(desktopPermission === "one_action"\) desktopPermission = "none";/g;
const count = (current.match(consumePattern) || []).length;
if (count > 0) {
  const updated = current.replace(consumePattern, "promoteOneActionPermissionForTask();");
  fs.writeFileSync(mainPath, updated, "utf8");
  console.log(`[desktop-permission-lease] replaced ${count} one-action consumers with task lease.`);
} else {
  console.log("[desktop-permission-lease] no one-action consumers found; nothing to replace.");
}
