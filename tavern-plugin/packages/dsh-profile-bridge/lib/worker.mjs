import { readFileSync, writeFileSync, appendFileSync, unlinkSync, rmdirSync, rmSync, lstatSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { waitForExit, switchProfile, relaunchApp } from './helper.mjs'
import { selectNextProfile } from './next.mjs'
const job = process.argv[2]
// Register before parsing the request: even a corrupt job then leaves a pid the
// next switch can use to tell this helper is gone.
try { writeFileSync(join(dirname(job), 'worker.json'), JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx', mode: 0o600 }) } catch {}
const request = JSON.parse(readFileSync(job, 'utf8'))
const log = message => appendFileSync(join(request.stateDir, 'last-run.log'), new Date().toISOString() + ' ' + message + '\n')
let exited = false
try {
  log('已排队，等待官方桌面正常退出；不会强制结束进程。')
  await waitForExit(request.pids)
  exited = true
  if (request.next) {
    // DSH NEXT refuses a linked profiles/desktop. Back to the original, undo a link the
    // official app's switch may have left (both apps can share this home), then select it.
    const desktop = join(request.profilesRoot, 'desktop')
    const linked = (() => { try { return lstatSync(desktop).isSymbolicLink() } catch { return false } })()
    if (request.mode === 'unlink' && linked) log(JSON.stringify(switchProfile({ ...request, liveDir: desktop })))
    selectNextProfile(request.home, request.mode === 'link' ? request.targetName : 'desktop')
    log(JSON.stringify({ changed: true, next: request.mode === 'link' ? request.targetName : 'desktop' }))
  } else log(JSON.stringify(switchProfile(request)))
  log('切换完成。')
} catch (error) {
  log('ERROR: ' + error.message)
  process.exitCode = 1
} finally {
  // Reopen whether or not the switch went through: a failed switch leaves the old profile intact.
  if (exited && request.relaunch) {
    try { relaunchApp(request.relaunch); log('已重新打开官方桌面。') } catch (error) { log('ERROR: 无法重新打开官方桌面：' + error.message) }
  }
  unlinkSync(job)
  rmSync(join(dirname(job), 'worker.json'), { force: true })
  rmdirSync(dirname(job))
}
