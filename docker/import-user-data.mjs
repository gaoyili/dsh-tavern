#!/usr/bin/env node
// 从旧 DSH 主目录导入用户数据（CLI 容器版，配合 DSH_TAVERN_IMPORT_HOME）。
//
// 上游 bin/import-user-home.mjs 只服务桌面版，并且拒绝「源目录位于目标目录内部」
// 的布局；Docker 用户经常把旧目录备份直接放在数据卷里
// （例如 /home/tavern/.dsh-tavern/dshtavern.backup.1019），因此这里做一份
// 只复制用户数据的实现：
//
//   * 复制：profile-data/tavern、attachments、.agent-presets、
//           settings.yaml、.credentials.yaml、.openai-codex-auth.json
//   * 不复制：profiles/tavern/package.json、profiles/tavern/cordis.patch.yml
//     （这两个文件必须保持新镜像安装出来的版本，旧版本覆盖会导致依赖/配置错位）
//   * 导入前把目标中同名条目移到 backups/docker-import-<时间戳>/ 下，
//     失败时自动回滚；成功后写入 .dsh-tavern-import.json 防止重复导入。
//
// 用法：node import-user-data.mjs <旧 DSH 主目录> <目标 .dsh-tavern>
// 环境变量：
//   DSH_TAVERN_IMPORT_FORCE=1        目标已有卡片/聊天时仍强制覆盖（默认保护）
//   DSH_TAVERN_IMPORT_NO_BACKUP=1    不备份目标现有条目（不推荐）
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, copyFileSync,
  chmodSync, symlinkSync, readlinkSync, writeFileSync, renameSync, realpathSync,
  statSync, rmSync,
} from 'node:fs'
import path from 'node:path'

const log = (...args) => console.log('[import]', ...args)
const warn = (...args) => console.warn('[import] 警告：', ...args)
const fail = (message) => {
  console.error(`[import] 错误：${message}`)
  process.exit(1)
}

const [sourceArg, targetArg] = process.argv.slice(2)
if (!sourceArg || !targetArg) fail('用法：import-user-data.mjs <旧 DSH 主目录> <目标 .dsh-tavern>')
if (!path.isAbsolute(sourceArg) || !path.isAbsolute(targetArg)) fail('源目录和目标目录都必须是绝对路径')
if (!existsSync(sourceArg)) fail(`源目录不存在：${sourceArg}`)
if (!existsSync(targetArg)) fail(`目标目录不存在：${targetArg}`)

const target = realpathSync(targetArg)
const candidates = [path.resolve(sourceArg), path.join(path.resolve(sourceArg), '.dsh-tavern')]
const found = candidates.find((candidate) => (
  existsSync(path.join(candidate, 'profile-data/tavern'))
  || existsSync(path.join(candidate, 'profiles/tavern/package.json'))
))
if (!found) fail(`没有找到旧酒馆数据：${sourceArg}（应包含 profile-data/tavern 或 profiles/tavern/package.json）`)
const source = realpathSync(found)
if (source === target) fail('源目录与目标目录相同，无法导入')

const entries = [
  'profile-data/tavern',
  'attachments',
  '.agent-presets',
  'settings.yaml',
  '.credentials.yaml',
  '.openai-codex-auth.json',
]
const present = entries.filter((entry) => existsSync(path.join(source, entry)))
if (!present.length) fail(`源目录中没有可导入的用户数据：${source}`)

const markerFile = path.join(target, '.dsh-tavern-import.json')
const force = process.env.DSH_TAVERN_IMPORT_FORCE === '1'
const noBackup = process.env.DSH_TAVERN_IMPORT_NO_BACKUP === '1'

function marker() {
  try { return JSON.parse(readFileSync(markerFile, 'utf8')) } catch { return null }
}
function targetHasUserData() {
  const data = path.join(target, 'profile-data/tavern/data')
  for (const directory of ['cards', 'chats']) {
    try {
      if (readdirSync(path.join(data, directory)).some((name) => !name.startsWith('.'))) return true
    } catch { /* 目录不存在或不可读 */ }
  }
  try {
    const index = JSON.parse(readFileSync(path.join(data, 'index.json'), 'utf8'))
    if (Array.isArray(index.cards) && index.cards.length) return true
    if (Array.isArray(index.chats) && index.chats.length) return true
  } catch { /* 没有 index.json */ }
  return false
}

const previous = marker()
if (previous && previous.source === source && !force) {
  log(`该备份已导入过（${previous.importedAt}），跳过。需要重新导入请设置 DSH_TAVERN_IMPORT_FORCE=1。`)
  process.exit(0)
}
if (!force && targetHasUserData()) {
  log('目标卷中已经有卡片/聊天数据，为避免覆盖现有进度，本次不导入。')
  log('如确认要用备份覆盖，请设置 DSH_TAVERN_IMPORT_FORCE=1 后重启容器。')
  process.exit(0)
}

// 备份目录放在目标卷内，保证与目标同一文件系统；失败时可直接回滚。
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
const backup = path.join(target, 'backups', `docker-import-${stamp}`)
const journal = { source, target, backup, entries: present, phase: 'preparing', moved: [], copied: [] }
function saveJournal() {
  if (noBackup) return
  const file = path.join(backup, 'journal.json')
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
}
if (!noBackup) mkdirSync(backup, { recursive: true, mode: 0o700 })

function copyEntry(from, to) {
  const stat = lstatSync(from)
  if (stat.isSymbolicLink()) {
    // 相对链接在复制后的相同目录结构中仍然有效；绝对链接若指向旧位置可能失效。
    const link = readlinkSync(from)
    mkdirSync(path.dirname(to), { recursive: true })
    try { rmSync(to, { force: true }) } catch { /* 忽略 */ }
    symlinkSync(link, to)
    if (path.isAbsolute(link)) warn(`保留绝对符号链接（可能指向旧路径）：${to} -> ${link}`)
    return
  }
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true })
    for (const name of readdirSync(from)) copyEntry(path.join(from, name), path.join(to, name))
    return
  }
  if (!stat.isFile()) {
    warn(`跳过特殊文件：${from}`)
    return
  }
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(from, to)
  try { chmodSync(to, stat.mode & 0o777) } catch { /* 忽略 */ }
}

function moveAside(entry) {
  const from = path.join(target, entry)
  if (!existsSync(from)) return
  const to = path.join(backup, 'target', entry)
  mkdirSync(path.dirname(to), { recursive: true })
  renameSync(from, to)
  journal.moved.push(entry)
  saveJournal()
}

function rollback() {
  for (const entry of journal.copied) {
    try { rmSync(path.join(target, entry), { recursive: true, force: true }) } catch { /* 忽略 */ }
  }
  for (const entry of journal.moved) {
    const from = path.join(backup, 'target', entry)
    const to = path.join(target, entry)
    if (!existsSync(from)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    try { renameSync(from, to) } catch { /* 忽略 */ }
  }
}

let size = 0
for (const entry of present) {
  const from = path.join(source, entry)
  try {
    const stat = statSync(from)
    if (stat.isFile()) size += stat.size
  } catch { /* 忽略 */ }
}
log(`源目录：${source}`)
log(`目标目录：${target}`)
log(`准备导入：${present.join(', ')}（约 ${(size / 1024 / 1024).toFixed(1)} MB 的单文件，目录另计）`)
if (!noBackup) log(`目标现有条目备份到：${backup}`)

try {
  if (!noBackup) {
    // 只移动目标中确实存在、且源中要覆盖的条目；不动其它数据。
    for (const entry of present) moveAside(entry)
  }
  journal.phase = 'copying'
  saveJournal()
  for (const entry of present) {
    log(`复制 ${entry} ……`)
    copyEntry(path.join(source, entry), path.join(target, entry))
    journal.copied.push(entry)
    saveJournal()
  }
  journal.phase = 'completed'
  journal.importedAt = new Date().toISOString()
  saveJournal()
  writeFileSync(markerFile, `${JSON.stringify({
    source, importedAt: journal.importedAt, backup: noBackup ? null : backup, entries: present,
  }, null, 2)}\n`, 'utf8')
  log('导入完成。')
} catch (error) {
  warn(`导入失败，正在回滚：${error.message}`)
  rollback()
  process.exit(1)
}
