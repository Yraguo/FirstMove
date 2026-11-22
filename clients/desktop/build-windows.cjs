const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { getMakeNsisPath, getNsisPluginsPath } = require("app-builder-lib/out/toolsets/windows");
const { version, build } = require("./package.json");

async function buildWindows() {
  const dist = path.resolve(__dirname, "../../dist");
  const unpacked = path.join(dist, "win-release");
  const output = path.join(dist, `FirstMove-${version}-windows-x64-Setup.exe`);
  const options = { cwd: __dirname, stdio: "inherit" };
  execFileSync(process.execPath, [
    require.resolve("electron-builder/cli.js"),
    "--win", "--dir", "--x64", "--publish", "never",
    `-c.directories.output=${unpacked}`
  ], options);

  const plugins = await getNsisPluginsPath();
  const compiler = process.platform === "win32" ? await getMakeNsisPath() : { path: "makensis" };
  execFileSync(compiler.path, [
    "-INPUTCHARSET", "UTF8",
    `-DAPPDIR=${path.join(unpacked, "win-unpacked")}`,
    `-DICON=${path.join(unpacked, ".icon-ico", "icon.ico")}`,
    `-DOUTPUT=${output}`,
    `-DVERSION=${version}`,
    `-DAPP_ID=${build.appId}`,
    `-DNSIS_PLUGINS=${path.join(plugins, "x86-unicode")}`,
    "windows.nsi"
  ], { ...options, env: { ...process.env, ...compiler.env } });
}

buildWindows().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
