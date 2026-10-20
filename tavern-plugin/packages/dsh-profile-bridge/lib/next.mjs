// DSH NEXT (from 2.0.19) selects its Profile in <DSH_HOME>/desktop-next.json and refuses to start
// when the selected profiles/<name> is a link ("Next profile path must be a real directory"). So on
// NEXT a switch writes that selection instead of replacing profiles/desktop with a link. The official
// app keeps the link: both apps may share one DSH_HOME, and each then follows its own mechanism.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const NEXT_PACKAGE = 'dsh-desktop-next'
const DEFAULT_PROFILE = 'desktop'

/**
 * Whether an app executable (or macOS .app bundle) is DSH NEXT with native Profile selection.
 * @param {string | undefined} exe - the desktop app binary, or its .app bundle on macOS.
 * @returns {boolean} true for DSH NEXT 2.0.19+.
 */
export function isDesktopNext(exe) {
  if (typeof exe !== 'string' || exe === '') return false
  const bundle = /^(.*?\.app)(?:\/|$)/u.exec(exe)?.[1]
  const resources = bundle !== undefined ? join(bundle, 'Contents', 'Resources') : join(dirname(exe), 'resources')
  // NEXT keeps its package.json unpacked beside app.asar, so no archive reader is needed here.
  try { return JSON.parse(readFileSync(join(resources, 'app', 'package.json'), 'utf8')).name === NEXT_PACKAGE } catch { return false }
}

function selectionFile(home) { return join(resolve(home), 'desktop-next.json') }

/**
 * The Profile DSH NEXT starts with.
 * @param {string} home - DSH_HOME.
 * @returns {string} the selected profile name ("desktop" when nothing was chosen yet).
 */
export function readNextProfile(home) {
  try {
    const active = JSON.parse(readFileSync(selectionFile(home), 'utf8')).active
    return typeof active === 'string' && active !== '' ? active : DEFAULT_PROFILE
  } catch { return DEFAULT_PROFILE }
}

/**
 * Select the Profile DSH NEXT starts with, in the format NEXT itself writes.
 * @param {string} home - DSH_HOME.
 * @param {string} name - a plain directory name under profiles/.
 */
export function selectNextProfile(home, name) {
  if (typeof name !== 'string' || name === '' || basename(name) !== name) throw new Error('Profile 名称无效：' + name)
  const file = selectionFile(home)
  const staged = file + '.' + process.pid + '.tmp'
  writeFileSync(staged, JSON.stringify({ version: 1, active: name }, null, 2) + '\n', { mode: 0o600 })
  renameSync(staged, file)
}
