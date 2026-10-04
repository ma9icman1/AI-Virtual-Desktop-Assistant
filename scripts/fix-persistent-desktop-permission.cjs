const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "src", "App.tsx");
const source = fs.readFileSync(appPath, "utf8");

const marker = "// [persistent-desktop-permission-v1]";
if (source.includes(marker)) {
  console.log("[persistent-desktop-permission] already installed; skipped.");
  process.exit(0);
}

const stateMarker = '  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>("none");';
const stateReplacement = `  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>(() => {
    try {
      return localStorage.getItem("ma9icai_desktop_permission") === "always" ? "always" : "none";
    } catch {
      return "none";
    }
  });`;

if (!source.includes(stateMarker)) {
  throw new Error("[persistent-desktop-permission] permission state marker not found; refusing to modify App.tsx.");
}

const setterMarker = `  const setDesktopPermission = useCallback((level: PermissionLevel) => {
    setPermissionLevel(level);
    (window as any).magicDesktop?.setPermission(level);
  }, []);`;

const setterReplacement = `  // [persistent-desktop-permission-v1]
  const setDesktopPermission = useCallback((level: PermissionLevel) => {
    setPermissionLevel(level);
    if (level === "always") {
      try {
        localStorage.setItem("ma9icai_desktop_permission", "always");
      } catch {
        // Persistent storage can be unavailable; the current session still works.
      }
    } else if (level === "deny") {
      try {
        localStorage.removeItem("ma9icai_desktop_permission");
      } catch {
        // Ignore storage cleanup failures.
      }
    }
    (window as any).magicDesktop?.setPermission(level);
  }, []);`;

if (!source.includes(setterMarker)) {
  throw new Error("[persistent-desktop-permission] desktop permission setter marker not found; refusing to modify App.tsx.");
}

const updated = source
  .replace(stateMarker, stateReplacement)
  .replace(setterMarker, setterReplacement);

const finalSource = updated.replace(
  '  const setDesktopPermission = useCallback((level: PermissionLevel) => {',
  `  useEffect(() => {
    if (permissionLevel === "always") {
      (window as any).magicDesktop?.setPermission("always");
    }
  }, [permissionLevel]);

  const setDesktopPermission = useCallback((level: PermissionLevel) => {`
);

fs.writeFileSync(appPath, finalSource, "utf8");

const verify = fs.readFileSync(appPath, "utf8");
for (const required of [
  marker,
  'localStorage.getItem("ma9icai_desktop_permission")',
  'localStorage.setItem("ma9icai_desktop_permission", "always")',
  'localStorage.removeItem("ma9icai_desktop_permission")',
  'magicDesktop?.setPermission("always")',
]) {
  if (!verify.includes(required)) {
    throw new Error(`[persistent-desktop-permission] verification failed: missing ${required}`);
  }
}

console.log("[persistent-desktop-permission] installed and verified.");
