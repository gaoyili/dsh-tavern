import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import runtime from '../bin/official-desktop-runtime.cjs'

test('Windows 官方 shim 不将中文路径写进批处理，并拒绝未知宿主', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'official-desktop-中文 '))
  t.after(() => rm(root, {recursive: true, force: true}))
  const executable = path.join(root, 'DeepSeek Harness.exe')
  const {app, host, pnpm} = runtime.layout(executable, 'win32')
  // layout initially selects ASAR; use the unpacked build layout for this fixture.
  const unpacked = app.replace(/app\.asar$/, 'app')
  await mkdir(unpacked, {recursive: true})
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({name: '@deepseek-ai/dsh-desktop'}))
  const paths = runtime.layout(executable, 'win32')
  const cli = path.join(paths.host, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')
  await mkdir(path.dirname(cli), {recursive: true}); await writeFile(cli, '')
  await mkdir(path.dirname(pnpm), {recursive: true}); await writeFile(pnpm, '')
  const home = path.join(root, '旧存档')
  const env = runtime.prepare({executable, home, platform: 'win32', env: {Path: 'original'}})
  assert.ok(env.Path.endsWith(';original'))
  assert.equal(env.DSH_HOME, home)
  assert.equal(env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR, path.join(paths.host, 'package.json'))
  for (const name of ['node', 'pnpm', 'dsh']) {
    const shim = await readFile(path.join(home, 'tools/official-desktop/bin', name + '.cmd'), 'utf8')
    assert.match(shim, /^[\x00-\x7f]+$/)
    assert.match(shim, /DisableDelayedExpansion/)
  }
  await writeFile(path.join(unpacked, 'package.json'), JSON.stringify({name: 'dsh-desktop'}))
  assert.throws(() => runtime.prepare({executable, home, platform: 'win32'}), /官方 DeepSeek Harness 或社区/)
})

test('社区版 DSH NEXT / DSH Desktop：用自带的 desktop-cli 与按架构的 pnpm，官方优先被发现', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'community-desktop-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const executable = path.join(root, 'DSH NEXT', 'DSH NEXT.exe')
  const app = path.join(root, 'DSH NEXT', 'resources', 'app')
  await mkdir(path.join(app, 'lib'), {recursive: true})
  await writeFile(path.join(app, 'package.json'), JSON.stringify({name: 'dsh-plugin-desktop'}))
  await writeFile(path.join(app, 'lib', 'desktop-cli.js'), '')
  const pnpm = path.join(root, 'DSH NEXT', 'resources', 'runtime', 'x64', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
  await mkdir(path.dirname(pnpm), {recursive: true}); await writeFile(pnpm, '')
  await writeFile(executable, '')
  const paths = runtime.layout(executable, 'win32', 'arm64')
  assert.equal(paths.bootstrap, path.join(app, 'lib', 'desktop-cli.js'))
  assert.equal(paths.pnpm, pnpm, '缺当前架构时回退到已有的运行时')
  const env = runtime.prepare({executable, home: path.join(root, 'home'), platform: 'win32', env: {Path: ''}})
  assert.equal(env.DSH_DESKTOP_DSH_BOOTSTRAP, paths.bootstrap)
  assert.equal(env.DSH_TAVERN_HOST_DEPENDENCY_ANCHOR, path.join(app, 'package.json'))
  assert.equal(runtime.discover({DSH_DESKTOP_APP_EXECUTABLE: executable}, 'win32'), executable)
  assert.deepEqual(runtime.APP_NAMES, ['DeepSeek Harness', 'DSH NEXT', 'DSH Desktop'])
})

test('本机官方 Electron 可从中文目录运行 DSH 和 pnpm', async t => {
  let executable
  try { executable = runtime.discover() } catch { t.skip('未安装官方 Desktop'); return }
  const home = await mkdtemp(path.join(tmpdir(), 'official-中文 '))
  t.after(() => rm(home, {recursive: true, force: true}))
  const setup = spawnSync(executable, ['--expose-internals', path.resolve('bin/official-desktop-runtime.cjs'), home],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}, encoding: 'utf8'})
  assert.equal(setup.status, 0, setup.stderr)
  const env = {...process.env, ...JSON.parse(setup.stdout), ELECTRON_RUN_AS_NODE: '1'}
  for (const [entry, expected] of [[env.DSH_DESKTOP_DSH_BOOTSTRAP, '0.2.1-rc.2'], [env.DSH_DESKTOP_PNPM_ENTRY, '11.28.5']]) {
    const result = spawnSync(executable, ['--expose-internals', entry, '--version'], {env, encoding: 'utf8'})
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expected)
  }
})

// 社区版用自带的真 Node 跑校验，而真 Node 打不开 app.asar：包名读成空，DSH NEXT 被拒绝。
// 包名要直接从 asar 的目录里读出来；仍读不到时，报错带上读到的包名与应用目录。
test('应用打包成 app.asar 时，不用 Electron 也能读出包名；读不到时报错写明原因', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'desktop-asar-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const executable = path.join(root, 'DSH NEXT.exe')
  const archive = path.join(root, 'resources', 'app.asar')
  await mkdir(path.dirname(archive), {recursive: true})
  const body = Buffer.from(JSON.stringify({name: 'dsh-plugin-desktop'}))
  const json = Buffer.from(JSON.stringify({files: {'package.json': {size: body.length, offset: '0'}}}))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4)])
  const header = Buffer.alloc(8); header.writeUInt32LE(4 + padded.length, 0); header.writeUInt32LE(json.length, 4)
  const sizes = Buffer.alloc(8); sizes.writeUInt32LE(4, 0); sizes.writeUInt32LE(header.length + padded.length, 4)
  await writeFile(archive, Buffer.concat([sizes, header, padded, body]))
  assert.equal(runtime.layout(executable, 'win32').name, 'dsh-plugin-desktop')
  await writeFile(archive, Buffer.from('not an archive'))
  assert.throws(() => runtime.prepare({executable, home: path.join(root, 'home'), platform: 'win32'}), /读到的应用包名：无法读取，应用目录：.*app\.asar/)
})

// DSH NEXT 2.0.19 改了布局：包名 dsh-desktop-next，resources/app 只剩一个 package.json，
// 应用和 DSH 入口都在 app.asar 里，必须用应用自己的 Electron 运行；node/pnpm 仍用自带的 Node。
function asar(files) {
  const tree = {files: {}}, bodies = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text)
    let node = tree
    const parts = name.split('/')
    for (const part of parts.slice(0, -1)) node = node.files[part] ??= {files: {}}
    node.files[parts.at(-1)] = {size: body.length, offset: String(offset)}
    offset += body.length; bodies.push(body)
  }
  const json = Buffer.from(JSON.stringify(tree))
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4)])
  const header = Buffer.alloc(8); header.writeUInt32LE(4 + padded.length, 0); header.writeUInt32LE(json.length, 4)
  const sizes = Buffer.alloc(8); sizes.writeUInt32LE(4, 0); sizes.writeUInt32LE(header.length + padded.length, 4)
  return Buffer.concat([sizes, header, padded, ...bodies])
}

test('DSH NEXT 2.0.19：宿主在 app.asar 里，安装代码与 dsh 用 Electron 运行，只有 pnpm 用自带 Node', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'desktop-next-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const executable = path.join(root, 'DSH NEXT.exe')
  const resources = path.join(root, 'resources')
  await mkdir(path.join(resources, 'app'), {recursive: true})
  await writeFile(path.join(resources, 'app', 'package.json'), JSON.stringify({name: 'dsh-desktop-next'}))
  await writeFile(path.join(resources, 'app.asar'), asar({'package.json': JSON.stringify({name: 'dsh-desktop-next'}), 'lib/desktop-cli.js': ''}))
  const deps = path.join(resources, 'runtime', process.arch, 'primary-runtime', 'dependencies')
  await mkdir(path.join(deps, 'node'), {recursive: true}); await writeFile(path.join(deps, 'node', 'node.exe'), '')
  await mkdir(path.join(deps, 'pnpm', 'bin'), {recursive: true}); await writeFile(path.join(deps, 'pnpm', 'bin', 'pnpm.mjs'), '')
  const paths = runtime.layout(executable, 'win32')
  assert.equal(paths.app, path.join(resources, 'app.asar'), '占位的 resources/app 不是应用目录')
  assert.equal(paths.bootstrap, path.join(resources, 'app.asar', 'lib', 'desktop-cli.js'))
  const env = runtime.prepare({executable, home: path.join(root, 'home'), platform: 'win32', env: {Path: 'p'}})
  assert.equal(env.DSH_DESKTOP_DSH_RUNNER, executable, 'asar 里的入口只有 Electron 能加载')
  assert.equal(env.DSH_DESKTOP_NODE_EXECUTABLE, executable, '安装代码要读 asar 里的宿主依赖，也用 Electron')
  assert.equal(env.DSH_DESKTOP_PNPM_RUNNER, path.join(deps, 'node', 'node.exe'), 'pnpm 仍用自带 Node，避开 Electron 下挂住')
  assert.equal(runtime.runner(executable, 'win32'), executable)
  const dsh = await readFile(path.join(root, 'home/tools/official-desktop/bin/dsh.cmd'), 'utf8')
  assert.match(dsh, /%DSH_DESKTOP_DSH_RUNNER%/)
  const pnpm = await readFile(path.join(root, 'home/tools/official-desktop/bin/pnpm.cmd'), 'utf8')
  assert.match(pnpm, /%DSH_DESKTOP_PNPM_RUNNER%/)
})
