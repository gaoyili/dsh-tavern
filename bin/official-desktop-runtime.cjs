// Shared bootstrap for the desktop hosts, shell installers and the Windows bundle:
// the official DeepSeek Harness, or the community DSH Desktop / DSH NEXT (same DSH, other layout).
// Runs under Electron Node mode so packaged app.asar files remain readable.
const fs = require('node:fs');
const path = require('node:path');
// COMMUNITY is DSH Desktop / NEXT up to 2.0.18 (unpacked app, DSH run by its bundled Node);
// NEXT from 2.0.19 packs the app into app.asar and, like the official app, runs DSH under its Electron.
const OFFICIAL = '@deepseek-ai/dsh-desktop', COMMUNITY = 'dsh-plugin-desktop', NEXT = 'dsh-desktop-next';
// Discovery order: official first, then the community app (NEXT replaced Desktop after 2.0.18).
const APP_NAMES = ['DeepSeek Harness', 'DSH NEXT', 'DSH Desktop'];
// The app's package name decides the layout. Plain Node cannot open app.asar (only
// Electron's fs can), and the community app runs this check with its bundled Node,
// so read package.json out of the archive directly: an 8-byte size pickle, then a
// header pickle whose JSON lists each file's offset from the end of the header.
function asarRead(archive, relative, contents) {
  const fd = fs.openSync(archive, 'r');
  try {
    const sizes = Buffer.alloc(16);
    fs.readSync(fd, sizes, 0, 16, 0);
    const headerSize = sizes.readUInt32LE(4), jsonSize = sizes.readUInt32LE(12);
    const json = Buffer.alloc(jsonSize);
    fs.readSync(fd, json, 0, jsonSize, 16);
    let entry = JSON.parse(json.toString('utf8'));
    for (const part of relative.split(/[\\/]/).filter(Boolean)) entry = entry?.files?.[part];
    if (!entry || entry.files) return null;
    if (!contents) return '';
    if (entry.unpacked || !Number.isSafeInteger(Number(entry.offset))) return null;
    const data = Buffer.alloc(entry.size);
    fs.readSync(fd, data, 0, entry.size, 8 + headerSize + Number(entry.offset));
    return data.toString('utf8');
  } catch { return null; } finally { fs.closeSync(fd); }
}
// Split a path at the archive that contains it; null when it is not inside one.
function inAsar(file) {
  const match = /^(.*?\.asar)[\\/](.+)$/.exec(file);
  return match && !fs.existsSync(match[1] + path.sep) ? { archive: match[1], relative: match[2] } : null;
}
// A file the runner can load: on disk, or inside app.asar (readable under Electron only).
function exists(file) {
  if (fs.existsSync(file)) return true;
  const packed = inAsar(file);
  return packed !== null && fs.existsSync(packed.archive) && asarRead(packed.archive, packed.relative, false) !== null;
}
function packageName(app) {
  try { return JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).name || ''; } catch {}
  try { return app.endsWith('.asar') ? String(JSON.parse(asarRead(app, 'package.json', true) || '{}').name || '') : ''; } catch { return ''; }
}
function layout(executable, platform = process.platform, arch = process.arch) {
  const resources = platform === 'darwin' ? path.resolve(path.dirname(executable), '../Resources') : path.join(path.dirname(executable), 'resources');
  const unpacked = path.join(resources, 'app'), packed = path.join(resources, 'app.asar');
  let app = fs.existsSync(path.join(unpacked, 'package.json')) ? unpacked : packed;
  const name = packageName(app);
  // NEXT keeps a bare package.json in resources/app; the app itself is the archive.
  if (name === NEXT && fs.existsSync(packed)) app = packed;
  if (name === COMMUNITY || name === NEXT) {
    // The community app ships its own unpacked DSH and one runtime per architecture, including a real
    // Node. Run tools with that Node: under the app's Electron, pnpm lingers for minutes after "Done".
    const runtime = [arch, 'x64', 'arm64'].map(each => path.join(resources, 'runtime', each, 'primary-runtime')).find(dir => fs.existsSync(dir))
      || path.join(resources, 'runtime', arch, 'primary-runtime');
    const nodeDir = path.join(runtime, 'dependencies', 'node');
    const node = (platform === 'win32' ? [path.join(nodeDir, 'node.exe'), path.join(nodeDir, 'bin', 'node.exe')] : [path.join(nodeDir, 'bin', 'node')]).find(file => fs.existsSync(file));
    // 2.0.18 runs everything with that Node. From 2.0.19 the host lives in app.asar, which only the
    // app's Electron can read: run installer code and DSH there, and keep the bundled Node for pnpm.
    const runner = name === NEXT ? executable : node;
    return { resources, app, name, host: app, node: runner, pnpmRunner: node, dshRunner: runner,
      bootstrap: path.join(app, 'lib', 'desktop-cli.js'), pnpm: path.join(runtime, 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
  }
  const host = path.join(app, 'dsh');
  return { resources, app, name, host, bootstrap: path.join(host, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'), pnpm: path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs') };
}
function prepare({ executable, home, env = process.env, platform = process.platform }) {
  if (!executable || !home) throw Error('请先安装 DeepSeek Harness 或 DSH NEXT，并指定安装目录');
  const paths = layout(executable, platform);
  if (![OFFICIAL, COMMUNITY, NEXT].includes(paths.name)) throw Error('Desktop 宿主必须是官方 DeepSeek Harness 或社区 DSH NEXT / DSH Desktop：' + executable
    + '（读到的应用包名：' + (paths.name || '无法读取') + '，应用目录：' + paths.app + '）');
  const bootstrap = paths.bootstrap;
  for (const file of [bootstrap, paths.pnpm]) if (!exists(file)) throw Error('桌面运行时不完整：' + file);
  const runner = paths.node || executable;
  const dshRunner = paths.dshRunner || runner, pnpmRunner = paths.pnpmRunner || runner;
  const runnerOf = name => name === 'dsh' ? dshRunner : name === 'pnpm' ? pnpmRunner : runner;
  const variableOf = name => name === 'dsh' ? 'DSH_DESKTOP_DSH_RUNNER' : name === 'pnpm' ? 'DSH_DESKTOP_PNPM_RUNNER' : 'DSH_DESKTOP_NODE_EXECUTABLE';
  const bin = path.join(home, 'tools', 'official-desktop', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  for (const [name, entry] of [['node', null], ['pnpm', paths.pnpm], ['dsh', bootstrap]]) {
    const file = path.join(bin, name + (platform === 'win32' ? '.cmd' : ''));
    const text = platform === 'win32'
      ? '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%' + variableOf(name) + '%" --expose-internals ' + (entry ? '"%' + (name === 'dsh' ? 'DSH_DESKTOP_DSH_BOOTSTRAP' : 'DSH_DESKTOP_PNPM_ENTRY') + '%" ' : '') + '%*\r\nexit /b %errorlevel%\r\n'
      : '#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec ' + quote(runnerOf(name)) + ' --expose-internals ' + (entry ? quote(entry) + ' ' : '') + '"$@"\n';
    fs.writeFileSync(file, text, { mode: 0o755 });
  }
  const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  // NODE_EXECUTABLE runs installer code and `node`; PNPM_RUNNER runs pnpm; DSH_RUNNER runs the DSH entry.
  return { DSH_HOME: path.resolve(home), DSH_DESKTOP_NODE_EXECUTABLE: runner, DSH_DESKTOP_APP_EXECUTABLE: executable,
    DSH_DESKTOP_PNPM_RUNNER: pnpmRunner, DSH_DESKTOP_DSH_RUNNER: dshRunner, DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap, DSH_DESKTOP_PNPM_ENTRY: paths.pnpm,
    DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: path.join(paths.host, 'package.json'),
    [key]: bin + (platform === 'win32' ? ';' : ':') + (env[key] || '') };
}
function discover(env = process.env, platform = process.platform) {
  // DSH_DESKTOP_NODE_EXECUTABLE is the community app's bundled Node, not an app; skip it then.
  const node = env.DSH_DESKTOP_NODE_EXECUTABLE && !/^node(\.exe)?$/i.test(path.basename(env.DSH_DESKTOP_NODE_EXECUTABLE)) ? env.DSH_DESKTOP_NODE_EXECUTABLE : undefined;
  const candidates = [env.DSH_DESKTOP_APP_EXECUTABLE, node, process.versions.electron ? process.execPath : undefined];
  for (const app of APP_NAMES) {
    if (platform === 'darwin') candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`, path.join(require('node:os').homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    if (platform === 'win32') for (const root of [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.ProgramFiles]) if (root) candidates.push(path.join(root, app, app + '.exe'));
  }
  const executable = candidates.find(file => file && fs.existsSync(file));
  if (!executable) throw Error('找不到 DeepSeek Harness 或 DSH NEXT；请先安装，或用 DSH_DESKTOP_APP_EXECUTABLE 指定程序路径');
  return executable;
}
// The program that runs installer code: the bundled Node for the community app, else the app's Electron.
function runner(executable, platform = process.platform) { return layout(executable, platform).node || executable; }
module.exports = { layout, prepare, discover, runner, APP_NAMES };
if (require.main === module) {
  try {
    const result = prepare({ executable: process.versions.electron ? process.execPath : discover(), home: process.argv[2] });
    if (process.argv.includes('--shell')) for (const [key, value] of Object.entries(result)) console.log('export ' + key + "='" + value.replaceAll("'", "'\\''") + "'");
    else console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
