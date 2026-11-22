const { app, BrowserWindow, Menu, dialog, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const setupFile = path.join(__dirname, "connect.html");
const setupURL = pathToFileURL(setupFile).href;
const isWindows = process.platform === "win32";
let window;
let origin = "";

function workspaceOrigin(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && local)) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("请输入工作台首页地址，例如 https://work.example.com");
  }
  return url.origin;
}

function settingsFile() {
  return path.join(app.getPath("userData"), "workspace.json");
}

function connectScreen(message = "") {
  return window.loadFile(setupFile, {query: {server: origin, message}});
}

async function openWorkspace() {
  try {
    await window.loadURL(origin + "/");
  } catch (error) {
    if (!window.isDestroyed() && error.code !== "ERR_ABORTED") {
      await connectScreen("暂时无法连接工作台。请检查服务器地址和网络后重试。");
    }
  }
}

function createWindow() {
  window = new BrowserWindow({
    title: "先行", width: 1160, height: 800, minWidth: 360, minHeight: 480,
    icon: path.join(__dirname, isWindows ? "icon-win.png" : "icon.png"),
    backgroundColor: "#fcf9f7",
    webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false}
  });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({action: "deny"}));
  contents.on("will-navigate", (event, target) => {
    const url = new URL(target);
    if (contents.getURL().split("?")[0] === setupURL && url.origin === "https://firstmove.invalid" && url.pathname === "/connect") {
      event.preventDefault();
      try {
        const selected = workspaceOrigin(url.searchParams.get("server"));
        fs.writeFileSync(settingsFile(), JSON.stringify({origin: selected}), {mode: 0o600});
        origin = selected;
        void openWorkspace();
      } catch (error) {
        void connectScreen(error.message);
      }
    } else if (url.origin !== origin) {
      event.preventDefault();
    }
  });
  contents.on("will-redirect", (event, target) => {
    if (new URL(target).origin !== origin) event.preventDefault();
  });
  if (origin) void openWorkspace();
  else void connectScreen();
}

if (isWindows) app.setAppUserModelId("io.github.yraguo.firstmove");

app.whenReady().then(() => {
  try { origin = workspaceOrigin(JSON.parse(fs.readFileSync(settingsFile(), "utf8")).origin); }
  catch { origin = ""; }
  session.defaultSession.setPermissionRequestHandler((contents, permission, done, details) => {
    if (!window || contents !== window.webContents || permission !== "notifications" ||
        !origin || new URL(details.requestingUrl).origin !== origin) return done(false);
    dialog.showMessageBox(window, {message: "允许这个工作台发送提醒？", detail: origin,
      buttons: ["允许", "取消"], cancelId: 1}).then(result => done(result.response === 0), () => done(false));
  });
  const actions = [{label: "连接服务器…", click: () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
    void connectScreen();
  }}, {role: "reload"}, {type: "separator"}, {role: "quit"}];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: "先行", submenu: actions}, {role: "editMenu"}, {role: "windowMenu"}
  ]));
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
