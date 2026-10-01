const { app, ipcMain } = require("electron");
const { NativeComputerControl } = require("./native-computer.cjs");

const nativeComputer = new NativeComputerControl();
const nativeActions = new Set([
  "MOVE_MOUSE",
  "CLICK",
  "RIGHT_CLICK",
  "DOUBLE_CLICK",
  "DRAG",
  "SCROLL",
  "TYPE_TEXT",
  "TYPE_INPUT",
  "KEY_PRESS",
  "WAIT",
]);

let nativePermission = "none";
let nativeKilled = false;

const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  if (channel === "desktop-control-action") {
    return originalHandle(channel, async (event, action, params = {}) => {
      if (!nativeActions.has(action)) return listener(event, action, params);
      if (nativeKilled || !["one_action", "one_session", "always"].includes(nativePermission)) {
        throw new Error("Desktop control is not permitted.");
      }
      const result = await nativeComputer.execute(action, params);
      if (nativePermission === "one_action") nativePermission = "none";
      return result;
    });
  }

  if (channel === "desktop-capture-screen") {
    return originalHandle(channel, async (event, ...args) => {
      try {
        return await nativeComputer.screenshot({ width: 1280, height: 800 });
      } catch (error) {
        console.warn("[native-computer] screenshot fallback:", error.message);
        return listener(event, ...args);
      }
    });
  }

  return originalHandle(channel, listener);
};

const originalOn = ipcMain.on.bind(ipcMain);
ipcMain.on = (channel, listener) => {
  if (channel === "desktop-control-permission") {
    return originalOn(channel, (event, level) => {
      if (["none", "one_action", "one_session", "always", "deny"].includes(level)) {
        nativePermission = level;
        nativeKilled = level === "deny";
      }
      return listener(event, level);
    });
  }

  if (channel === "desktop-control-kill") {
    return originalOn(channel, (event, ...args) => {
      nativeKilled = true;
      nativePermission = "none";
      nativeComputer.shutdown();
      return listener(event, ...args);
    });
  }

  return originalOn(channel, listener);
};

app.on("will-quit", () => nativeComputer.shutdown());

require("./main.cjs");
