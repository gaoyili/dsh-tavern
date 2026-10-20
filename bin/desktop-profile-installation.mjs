// Offline profile publication. Every rename is journaled; old directories are retained.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { copyTreeSync, removeTreeSync } from './portable-fs.mjs'
import { switchProfile } from '../tavern-plugin/packages/dsh-profile-bridge/lib/helper.mjs'
import { assertDesktopStopped } from './import-user-home.mjs'
import { isDesktopNext, readNextProfile, selectNextProfile } from '../tavern-plugin/packages/dsh-profile-bridge/lib/next.mjs'

const present = file => { try { lstatSync(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const read = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
const isTavern = doc => doc?.dsh?.profile?.bundles?.includes('dsh-tavern-plugin') || doc?.name === 'dsh-profile-tavern'
const hasBridge = dir => { try { return read(dir)?.dsh?.profile?.bundles?.includes('dsh-profile-bridge') === true } catch { return false } }
const save = (file, value) => { writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); renameSync(file + '.tmp', file) }
function originalProfile(home, live, linked) {
  if (!linked && !isTavern(read(live))) return { directory: live }
  const profiles = path.join(home, 'profiles')
  const candidates = readdirSync(profiles).filter(n => n.startsWith('desktop.fresh-')).sort().reverse().map(n => path.join(profiles, n))
  const backups = path.join(home, 'backups')
  if (existsSync(backups)) for (const n of readdirSync(backups).sort().reverse()) candidates.push(path.join(backups, n, 'profiles', 'desktop'))
  for (const directory of candidates) {
    try { if (!isTavern(read(directory)) && Array.isArray(read(directory).dsh?.profile?.bundles)) return { directory } } catch {}
  }
  // Older installers preserved individual configuration files next to desktop.
  if (!linked) for (const name of readdirSync(live).filter(n => n.startsWith('package.json.backup.')).sort()) {
    const doc = JSON.parse(readFileSync(path.join(live, name), 'utf8'))
    const suffix = name.slice('package.json'.length)
    if (!isTavern(doc) && Array.isArray(doc.dsh?.profile?.bundles) && existsSync(path.join(live, 'cordis.patch.yml' + suffix))) return { directory: live, suffix }
  }
  throw Error('找不到可恢复的原版 desktop 配置，未修改 profile。请先恢复原版 desktop 备份后重试；现有酒馆和存档保持不变。')
}
function installBridge(dir, sourceRoot) {
  const source = path.join(sourceRoot, 'tavern-plugin/packages/dsh-profile-bridge')
  for (const target of ['vendor/dsh-profile-bridge', 'node_modules/dsh-profile-bridge']) {
    const destination = path.join(dir, target)
    if (present(destination)) renameSync(destination, destination + '.previous-' + randomUUID())
    mkdirSync(path.dirname(destination), { recursive: true })
    copyTreeSync(source, destination)
  }
  const doc = read(dir)
  doc.dependencies = { ...doc.dependencies, 'dsh-profile-bridge': 'file:./vendor/dsh-profile-bridge' }
  doc.dsh.profile.bundles = [...new Set([...doc.dsh.profile.bundles, 'dsh-profile-bridge'])]
  save(path.join(dir, 'package.json'), doc)
}
const sameTree = (a, b) => {
  try {
    const names = dir => readdirSync(dir).filter(n => !n.includes('.previous-')).sort()
    const left = names(a), right = names(b)
    return left.length === right.length && left.every((n, i) => n === right[i] && (lstatSync(path.join(a, n)).isDirectory()
      ? sameTree(path.join(a, n), path.join(b, n)) : readFileSync(path.join(a, n)).equals(readFileSync(path.join(b, n)))))
  } catch { return false }
}
// The original profile's switcher must know NEXT, or switching from it would link profiles/desktop again.
// The original is idle while the tavern runs or installs, so it is refreshed in place.
function refreshBridge(dir, sourceRoot) {
  const source = path.join(sourceRoot, 'tavern-plugin/packages/dsh-profile-bridge')
  if (['vendor', 'node_modules'].every(parent => sameTree(source, path.join(dir, parent, 'dsh-profile-bridge')))) return
  const previous = ['vendor', 'node_modules'].map(parent => path.join(dir, parent, 'dsh-profile-bridge'))
  const before = new Set(previous.flatMap(file => present(path.dirname(file)) ? readdirSync(path.dirname(file)).map(n => path.join(path.dirname(file), n)) : []))
  installBridge(dir, sourceRoot)
  for (const file of previous) for (const n of readdirSync(path.dirname(file))) {
    const old = path.join(path.dirname(file), n)
    if (n.startsWith('dsh-profile-bridge.previous-') && !before.has(old)) removeTreeSync(old)
  }
}
function recover(journalFile, journal) {
  for (const action of [...journal.actions].reverse()) {
    if (action.reverted) continue
    if (present(action.to)) {
      if (present(action.from)) throw Error(`恢复路径冲突，请保留备份并人工检查：${journalFile}`)
      renameSync(action.to, action.from)
    }
    action.reverted = true; save(journalFile, journal)
  }
  journal.phase = 'rolled-back'; save(journalFile, journal)
}
// Returns null when desktop already links to tavern: an update then rewrites the tavern profile in place,
// as in-app updates do while the desktop is running. Only the first bridging needs the desktop closed.
// DSH NEXT (2.0.19+) selects its own Profile and refuses a linked profiles/desktop: there the original
// stays a real directory (with the bridge, so it can switch into the tavern) and the tavern is selected.
export function beginDesktopProfileInstallation({ home, sourceRoot, checkStopped = () => assertDesktopStopped([home], { requireGuiClosed: true }), next = isDesktopNext(process.env.DSH_DESKTOP_APP_EXECUTABLE) }) {
  const profiles = path.join(home, 'profiles'), live = path.join(profiles, 'desktop'), tavern = path.join(profiles, 'tavern')
  const interrupted = (() => { try { return JSON.parse(readFileSync(path.join(home, 'profile-bridge', 'install.json'), 'utf8')).phase === 'preparing' } catch { return false } })()
  const linkedToTavern = present(live) && lstatSync(live).isSymbolicLink() && present(tavern) && realpathSync(live) === realpathSync(tavern)
  if (!interrupted && next && present(tavern) && (linkedToTavern || (present(live) && hasBridge(live)))) {
    // Already bridged (by NEXT, or by the official app or NEXT 2.0.18 linking desktop): undo the link NEXT
    // refuses, bring the original's switcher up to date, and select the tavern.
    let restored = !linkedToTavern
    if (!restored) try { switchProfile({ mode: 'unlink', profilesRoot: profiles, liveDir: live, stamp: 'next-' + Date.now() }); restored = true } catch {}
    if (restored) {
      refreshBridge(live, sourceRoot)
      if (readNextProfile(home) !== 'tavern') selectNextProfile(home, 'tavern')
      return null
    }
  }
  if (!interrupted && !next && linkedToTavern) return null
  checkStopped()
  const state = path.join(home, 'profile-bridge')
  mkdirSync(state, { recursive: true })
  if (existsSync(path.join(state, 'pending'))) throw Error('有未完成的 profile 切换，请先检查 profile-bridge/pending。')
  const journalFile = path.join(state, 'install.json')
  if (existsSync(journalFile)) {
    const old = JSON.parse(readFileSync(journalFile, 'utf8'))
    if (old.phase === 'preparing') recover(journalFile, old)
  }
  if (!present(live)) throw Error('请先启动一次官方桌面，再完整退出后安装。')
  const linked = lstatSync(live).isSymbolicLink()
  if (linked && realpathSync(live) !== realpathSync(tavern)) throw Error('desktop 当前链接到其他 profile，请先还原原版 desktop 再安装。')
  if (present(tavern) && lstatSync(tavern).isSymbolicLink()) throw Error('tavern 必须是独立目录，不能是符号链接。')
  const original = originalProfile(home, live, linked)
  const stamp = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID()
  const backup = path.join(home, 'backups', 'profile-bridge-install-' + stamp)
  mkdirSync(backup, { recursive: true })
  const journal = { phase: 'preparing', backup, actions: [] }
  save(journalFile, journal)
  const move = (from, to) => {
    journal.actions.push({ from, to }); save(journalFile, journal)
    renameSync(from, to)
  }
  let done = false
  try {
    const desktopStage = path.join(backup, 'prepared-desktop')
    copyTreeSync(original.directory, desktopStage)
    if (original.suffix) for (const file of ['package.json', 'cordis.patch.yml']) writeFileSync(path.join(desktopStage, file), readFileSync(path.join(original.directory, file + original.suffix)))
    installBridge(desktopStage, sourceRoot)
    const legacyDesktop = !linked && isTavern(read(live))
    if (present(tavern)) move(tavern, path.join(backup, 'previous-tavern'))
    const tavernStage = path.join(backup, 'prepared-tavern')
    const seed = legacyDesktop ? live : path.join(backup, 'previous-tavern')
    if (present(seed)) copyTreeSync(seed, tavernStage)
    else mkdirSync(tavernStage)
    move(tavernStage, tavern)
    return {
      backup,
      desktopStage,
      finish() {
        checkStopped()
        if (next) {
          // The bridged original replaces profiles/desktop in place; NEXT then starts the tavern by selection.
          move(live, path.join(backup, 'previous-desktop'))
          move(desktopStage, live)
          selectNextProfile(home, 'tavern')
          return
        }
        // Keep the original profile available for the settings page's restore action.
        const originalDir = path.join(profiles, 'desktop.fresh-' + stamp)
        move(desktopStage, originalDir)
        const link = path.join(profiles, 'desktop.switch-stage-' + stamp)
        symlinkSync(tavern, link, process.platform === 'win32' ? 'junction' : 'dir')
        move(live, path.join(backup, 'previous-desktop'))
        move(link, live)
      },
      commit() { journal.phase = 'completed'; save(journalFile, journal); done = true },
      rollback() { if (!done) { recover(journalFile, journal); done = true } },
    }
  } catch (error) { recover(journalFile, journal); throw error }
}
