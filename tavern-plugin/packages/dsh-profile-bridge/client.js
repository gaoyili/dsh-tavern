/**
 * dsh-profile-bridge — browser half.
 *
 * Adds one settings page that shows which profile this Harness is running, which
 * other profiles exist, and switches the app's profile directory to the one you
 * pick (or reverts that switch). All file work happens in the Host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-profile-bridge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Shared RPC channel owned by this plugin's Host half. */
    const CHANNEL = '/profile-bridge'
    /** Locale namespace of this page. */
    const NS = 'profileBridge'

    const zh = {
      sectionTavern: '原版DSH',
      sectionOriginal: 'DSH酒馆',
      explain: 'DSH 酒馆和原版 DSH 是同一个应用里的两套环境，切换时应用会重启一次，对话和设置都会保留。',
      toOriginal: '切到原版 DSH 并重启',
      toTavern: '切到 DSH 酒馆并重启',
      noTavern: '还没有装好 DSH 酒馆，装好后这里就能切过去。',
      noOriginal: '找不到原版 DSH 的备份，暂时切不回去。请看下面的「说明与日志」。',
      standalone: '这是 DSH 酒馆的独立窗口，原版 DSH 就是 DeepSeek Harness 本身，不用切换、不用重启。',
      openOriginal: '打开原版 DSH',
      restarting: '正在重启…',
      quitHint: '请从托盘退出桌面版，切换完成后会自动重新打开（两分钟内有效）。',
      loading: '读取中…',
      cliHint: '当前不是桌面版。命令行用户直接用 dsh --profile <名称> 选择即可。',
      failure: '操作失败',
      more: '说明与日志',
      shortcut: '添加桌面快捷方式',
      shortcutHint: '桌面上会多一个「DSH 酒馆」，点开它就在独立窗口里打开酒馆，不用切换、不用重启；原版 DSH 照常用 DeepSeek Harness 打开。',
      shortcutDone: '已添加到桌面：',
      shortcutExists: '桌面上已经有了：',
      logEmpty: '（还没有日志）',
      why: '桌面版固定读取 profiles/desktop。进入 DSH 酒馆时，会把它链接到 profiles/tavern（Windows 用 junction，macOS/Linux 用符号链接）；原版配置先备份为 desktop.fresh-*，切回原版时恢复。切换需要桌面版先退出：重启走正常退出流程，有任务时会先请你确认，不会强制结束进程。',
    }
    const en = {
      sectionTavern: 'Original DSH',
      sectionOriginal: 'DSH Tavern',
      explain: 'DSH Tavern and the original DSH are two setups of the same app. Switching restarts the app once; conversations and settings are kept.',
      toOriginal: 'Switch to original DSH and restart',
      toTavern: 'Switch to DSH Tavern and restart',
      noTavern: 'DSH Tavern is not installed yet; once it is, you can switch from here.',
      noOriginal: 'The original DSH backup is missing, so switching back is not possible right now. See "Details and log" below.',
      standalone: 'This is the standalone DSH Tavern window. The original DSH is DeepSeek Harness itself; no switch or restart needed.',
      openOriginal: 'Open original DSH',
      restarting: 'Restarting…',
      quitHint: 'Quit Desktop from the tray; it reopens by itself after the switch (valid for two minutes).',
      loading: 'Loading…',
      cliHint: 'This is not the Desktop app. Command-line users can pick one with dsh --profile <name>.',
      failure: 'Failed',
      more: 'Details and log',
      shortcut: 'Add desktop shortcut',
      shortcutHint: 'Adds "DSH 酒馆" to your desktop. It opens the Tavern in its own window, no switch or restart; the original DSH keeps opening from DeepSeek Harness.',
      shortcutDone: 'Added to the desktop: ',
      shortcutExists: 'Already on the desktop: ',
      logEmpty: '(no log yet)',
      why: 'Desktop always reads profiles/desktop. Opening DSH Tavern links it to profiles/tavern (a junction on Windows, a symlink elsewhere); the original is first backed up as desktop.fresh-* and restored when you switch back. Desktop has to exit first: restarting is a normal quit that asks for confirmation when tasks are running, never a forced kill.',
    }

    /** Scoped stylesheet; class names are prefixed so they never leak into the host. */
    const CSS = `
.pb { display: grid; gap: 16px; font-size: 13px; line-height: 1.6; color: inherit; width: 100%; max-width: 640px; min-width: 0;
  --pb-accent: #4d6bfe; --pb-accent-soft: rgba(77,107,254,0.07); --pb-line: rgba(127,127,127,0.25); --pb-fill: rgba(127,127,127,0.06); }
.pb * { box-sizing: border-box; }
.pb-head { display: grid; gap: 2px; }
.pb-title { margin: 0; font-size: 16px; font-weight: 600; }
.pb-sub { margin: 0; opacity: 0.6; }
.pb-bar { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 10px; background: var(--pb-accent-soft); }
.pb-bar-text { flex: 1; min-width: 0; }
.pb-btn { appearance: none; font: inherit; font-size: 13px; flex: none; color: #fff; background: var(--pb-accent); border: 0; border-radius: 8px; padding: 6px 16px; cursor: pointer; }
.pb-btn:hover:not(:disabled) { background: #3d5bf0; }
.pb-btn:disabled { opacity: 0.5; cursor: default; }
.pb-shortcut { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 10px; border: 1px solid var(--pb-line); }
.pb-shortcut .pb-sub { margin: 0; }
.pb-done { margin: 4px 0 0; font-size: 12px; word-break: break-all; }
.pb-btn-quiet { color: inherit; background: var(--pb-fill); border: 1px solid var(--pb-line); }
.pb-btn-quiet:hover:not(:disabled) { background: var(--pb-accent-soft); }
.pb-error { margin: 0; padding: 10px 12px; border-radius: 10px; color: #e5484d; background: rgba(229,72,77,0.08); }
.pb-fold summary { list-style: none; cursor: pointer; opacity: 0.55; font-size: 12px; user-select: none; }
.pb-fold summary::-webkit-details-marker { display: none; }
.pb-fold summary::before { content: '›'; display: inline-block; width: 12px; transition: transform .15s; }
.pb-fold[open] summary::before { transform: rotate(90deg); }
.pb-fold summary:hover { opacity: 1; }
.pb-fold p { margin: 6px 0; opacity: 0.6; font-size: 12px; }
.pb-pre { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--pb-fill); max-height: 200px; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
`

    /** Describe one RPC failure for display. */
    function describeFailure(error) {
      if (error === undefined || error === null) return 'unknown error'
      return typeof error.message === 'string' ? error.message : String(error)
    }

    /** The menu names this page by side at once: the Tavern client marks a page that loaded it. */
    const inTavern = () => window.__dshTavernLoaded === true

    /**
     * One settings page with one action: from the tavern setup, back to the original DSH;
     * from the original, into DSH Tavern. Either way the app quits and reopens once.
     * @param {{ t: Function, rpcCall: Function }} props - injected faces from the registration.
     */
    function ProfileBridgeSettings(props) {
      const t = props.t
      const call = props.rpcCall
      const [status, setStatus] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [applied, setApplied] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        call('status', {}).then((result) => {
          if (!alive) return
          if (result?.ok === true) setStatus(result.value)
          else setFailure(describeFailure(result?.error))
        }, (error) => { if (alive) setFailure(describeFailure({ message: error?.message ?? String(error) })) })
        return () => { alive = false }
      }, [call])

      // Which side this page is on comes from the page itself, the same as the menu name.
      const side = inTavern() ? 'tavern' : 'original'
      const standalone = status?.desktopApp === false
      const tavernReady = (status?.profiles ?? []).some((profile) => profile.name === 'tavern' && (profile.bundles ?? []).includes('dsh-profile-bridge') && profile.hasNodeModules)
      // Back to the original needs its backup; into the tavern needs a tavern setup that can come back.
      const blocked = side === 'original' ? (tavernReady ? null : t('noTavern'))
        : (status?.backups ?? []).length > 0 || status?.nextProfiles ? null : t('noOriginal')
      const target = side === 'original' ? 'tavern' : null

      const [shortcut, setShortcut] = React.useState(null)
      async function addShortcut() {
        setBusy(true)
        setFailure(null)
        try {
          const result = await call('shortcut', {})
          if (result?.ok === true) setShortcut(result.value)
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ message: error?.message ?? String(error) }))
        } finally {
          setBusy(false)
        }
      }

      async function openOriginal() {
        setFailure(null)
        try {
          const result = await call('openOriginal', {})
          if (result?.ok !== true) setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ message: error?.message ?? String(error) }))
        }
      }

      async function apply() {
        setBusy(true)
        setFailure(null)
        try {
          const result = target ? await call('link', { target }) : await call('unlink', {})
          if (result?.ok === true) setApplied(result.value ?? {})
          else setFailure(describeFailure(result?.error))
        } catch (error) {
          setFailure(describeFailure({ message: error?.message ?? String(error) }))
        } finally {
          setBusy(false)
        }
      }

      const title = t(inTavern() ? 'sectionTavern' : 'sectionOriginal')
      const isDesktop = status?.appKind === 'desktop'
      return h('section', { className: 'pb' },
        h('style', null, CSS),
        h('header', { className: 'pb-head' },
          h('h2', { className: 'pb-title' }, title),
          h('p', { className: 'pb-sub' }, status === null ? t('loading') : !isDesktop ? t('cliHint') : standalone ? t('standalone') : t('explain')),
        ),
        !isDesktop ? null : standalone ? h('div', { className: 'pb-bar' },
          h('span', { className: 'pb-bar-text' }),
          h('button', { type: 'button', className: 'pb-btn', disabled: busy, onClick: () => void openOriginal() }, t('openOriginal')),
        ) : blocked ? h('p', { className: 'pb-error' }, blocked) : h('div', { className: 'pb-bar' },
          h('span', { className: 'pb-bar-text' },
            applied === null ? '' : applied.closesApp ? t('restarting') : t('quitHint'),
            ...(applied?.warnings ?? []).map((warning) => h('span', { key: warning, style: { display: 'block', opacity: 0.75 } }, `• ${warning}`)),
          ),
          applied !== null ? null : h('button', { type: 'button', className: 'pb-btn', disabled: busy, onClick: () => void apply() },
            busy ? t('restarting') : target ? t('toTavern') : t('toOriginal')),
        ),
        failure !== null ? h('p', { className: 'pb-error' }, `${t('failure')}: ${failure}`) : null,
        !isDesktop || standalone ? null : h('div', { className: 'pb-shortcut' },
          h('div', { className: 'pb-bar-text' },
            h('p', { className: 'pb-sub' }, t('shortcutHint')),
            shortcut ? h('p', { className: 'pb-done' }, (shortcut.existed ? t('shortcutExists') : t('shortcutDone')) + shortcut.path) : null),
          h('button', { type: 'button', className: 'pb-btn pb-btn-quiet', disabled: busy, onClick: () => void addShortcut() }, t('shortcut')),
        ),
        h('details', { className: 'pb-fold' },
          h('summary', null, t('more')),
          h('p', null, t('why')),
          // The structured log is empty when the helper never reached its first
          // line (for example a PowerShell startup failure); the launcher
          // transcript is where that shows up.
          h('pre', { className: 'pb-pre' },
            status?.logTail?.trim()
              ? status.logTail
              : status?.transcriptTail?.trim() ? status.transcriptTail : t('logEmpty')),
        ),
      )
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        const rpcCall = (endpoint, payload) => ctx.connection.rpc.call(CHANNEL, endpoint, payload)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'profile-bridge: locale dictionaries')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'profile-bridge',
          order: 60,
          label: () => t(inTavern() ? 'sectionTavern' : 'sectionOriginal'),
          inject: () => ({ rpcCall, t }),
        }, ProfileBridgeSettings))
      },
    }
  },
})
