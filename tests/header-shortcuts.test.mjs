import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { DEFAULT_HEADER_ITEMS, applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

test('顶栏默认值与改动前一致：酒馆状态、导出，图标加文字', () => {
  assert.deepEqual({ display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] }, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
  assert.deepEqual(presentTavernSettings({}, {}).headerItems, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
})

test('顶栏设置去重并按上限截断', () => {
  const saved = applyTavernSettingsPatch({}, { headerItems: { display: 'icon', items: ['dsh-tavern:cards', 'dsh-tavern:cards', 'header:export'] } })
  assert.deepEqual(saved.headerItems, { display: 'icon', items: ['dsh-tavern:cards', 'header:export'] })
  assert.deepEqual(presentTavernSettings(saved, {}).headerItems, { display: 'icon', items: ['dsh-tavern:cards', 'header:export'] })

  const many = Array.from({ length: 30 }, (_, index) => 'dsh-tavern:page-' + index)
  const capped = applyTavernSettingsPatch({}, { headerItems: { display: 'icon-text', items: many } })
  assert.equal(capped.headerItems.items.length, 24)
  assert.deepEqual(capped.headerItems.items.slice(0, 2), ['dsh-tavern:page-0', 'dsh-tavern:page-1'])
})

test('非法顶栏设置被拒绝', () => {
  for (const bad of [
    { display: 'large', items: [] },
    { display: 'icon', items: 'dsh-tavern:status' },
    { display: 'icon', items: ['dsh-tavern:status', 'bad id'] },
    { display: 'icon', items: [1] },
    { display: 'icon', items: [null] },
    []
  ]) assert.throws(() => applyTavernSettingsPatch({}, { headerItems: bad }), /无效的顶栏设置/)
  assert.throws(() => applyTavernSettingsPatch({}, { headerItems: { items: [{ id: 'dsh-tavern:status' }] } }), /无效的顶栏设置/)
})

test('传 null 恢复默认顶栏', () => {
  let document = applyTavernSettingsPatch({}, { headerItems: { display: 'icon', items: ['dsh-tavern:cards'] } })
  assert.deepEqual(document.headerItems, { display: 'icon', items: ['dsh-tavern:cards'] })
  document = applyTavernSettingsPatch(document, { headerItems: null })
  assert.equal(Object.hasOwn(document, 'headerItems'), false)
  assert.deepEqual(presentTavernSettings(document, {}).headerItems, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
  // 存档里损坏的值不会让读取失败。
  assert.deepEqual(presentTavernSettings({ headerItems: { display: 'nope', items: ['bad id'] } }, {}).headerItems, { display: 'icon-text', items: ['dsh-tavern:status', 'header:export'] })
})

test('getDisplayPreferences 一并返回顶栏设置', async () => {
  const line = server.split('\n').find(source => source.includes("case 'getDisplayPreferences':"))
  const body = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'))
  const run = new Function('readTavernSettings', 'return async () => {' + body + '}')
  const preferences = await run(async () => ({ hideContextAndReasoning: false, renderDepth: 5, headerItems: { display: 'icon', items: ['header:export'] } }))()
  assert.deepEqual(preferences, { hideContextAndReasoning: false, renderDepth: 5, headerItems: { display: 'icon', items: ['header:export'] } })
})

test('客户端顶栏默认值与服务端一致，设置在首次读取前就用默认值', async () => {
  const declaration = client.match(/const TAVERN_HEADER_DEFAULT = (.*?);\n/)[1]
  const value = vm.runInNewContext('(' + declaration + ')', { Object })
  assert.deepEqual({ display: value.display, items: [...value.items] }, { display: DEFAULT_HEADER_ITEMS.display, items: [...DEFAULT_HEADER_ITEMS.items] })
  assert.match(client, /function useTavernHeaderItems\(\)[\s\S]*?TAVERN_HEADER_DEFAULT/)

  const dom = new JSDOM('<html><body></body></html>')
  const source = client.match(/const displayPreferences = \(\(\) => \{[\s\S]*?\}\)\(\);/)[0].replace('const displayPreferences = ', '')
  const store = vm.runInNewContext(source, {
    document: dom.window.document,
    window: dom.window,
    rpc: async () => ({ hideContextAndReasoning: true, headerItems: { display: 'icon', items: ['dsh-tavern:cards'] } })
  })
  assert.equal(store.snapshot(), null, '第一次读取前没有快照，顶栏回落到默认值')
  const stop = store.start()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot().headerItems)), { display: 'icon', items: ['dsh-tavern:cards'] })
  stop()
  dom.window.close()
})

test('顶栏落成一个插槽，旧的两个插槽已移除', () => {
  assert.match(client, /id: "dsh-tavern-header-items", order: 80/)
  assert.doesNotMatch(client, /id: "dsh-tavern-conversation-settings", order: 80/)
  assert.doesNotMatch(client, /id: "dsh-tavern-conversation-export", order: 90/)
  assert.match(client, /tavernHeaderCatalog/)
  assert.match(client, /function tavernStartIcon\(/)
  assert.match(client, /function tavernStartGroups\(/)
})

test('默认对小白无感：开始页没有图钉，「⋯」只在有按钮收起时出现，配置放在高级里', () => {
  assert.doesNotMatch(client, /dsh-tavern-start-pin/)
  assert.doesNotMatch(client, /dsh-tavern-header-divider/)
  assert.match(client, /foldedEntries\.length \? h\("div", \{ className: "dsh-tavern-more-actions dsh-tavern-header-more" \}/)
  const advanced = client.slice(client.indexOf('group("高级"'))
  assert.match(advanced.slice(0, advanced.indexOf('state.error ?')), /h\(HeaderItemsSettings\)/)
  assert.doesNotMatch(client.slice(client.indexOf('group("显示与交互"'), client.indexOf('group("高级"')), /HeaderItemsSettings/)
})

test('手机上两个例外规则都放行新的顶栏容器', () => {
  assert.equal((css.match(/:not\(\.dsh-tavern-header-items\)/g) || []).length, 2)
  assert.match(css, /\[class\*="_headerUtilities"\] > :not\(\.dsh-tavern-header-settings\):not\(\.dsh-tavern-export-menu\):not\(\.dsh-tavern-header-items\)/)
  assert.match(css, /\[data-slot="conversation\.session\.header\.utilities"\] > :not\(\.dsh-tavern-header-settings\):not\(\.dsh-tavern-export-menu\):not\(\.dsh-tavern-header-items\)/)
})

test('空间不足时从尾部收起页面，酒馆状态和导出永不收起', () => {
  const source = client.match(/function tavernHeaderFold\(ids[\s\S]*?\n\t\t\}/)[0]
  const fold = vm.runInNewContext('(' + source + ')')
  const width = value => value
  // 都放得下时不收起任何按钮。
  assert.deepEqual(Array.from(fold(['a', 'b'], width, 400, { gap: 2 })), [])
  // 从尾部连续收起。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c', 'd', 'e'], () => 100, 300, { gap: 2, moreWidth: 34 })), ['c', 'd', 'e'])
  // 固定按钮不参与收起，也不会挡住它前面的页面。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c'], id => (id === 'c' ? 100 : 100), 250, { gap: 2, moreWidth: 34, fixed: ['c'] })), ['b'])
  assert.deepEqual(Array.from(fold(['dsh-tavern:status', 'dsh-tavern:cards', 'dsh-tavern:worldbooks', 'header:export'], () => 100, 260, { gap: 2, moreWidth: 34, fixed: ['dsh-tavern:status', 'header:export'] })), ['dsh-tavern:cards', 'dsh-tavern:worldbooks'])
})

test('会话模式不依赖左侧栏：顶栏自己拉一次会话列表，未知会话仍不显示酒馆按钮', () => {
  assert.match(client, /function useTavernSessionMode\(sessionId\)[\s\S]*?ensureTavernSessionModes\(\)/)
  const ensure = client.match(/function ensureTavernSessionModes\(\) \{[\s\S]*?\n\t\t\}/)[0]
  assert.match(ensure, /tavernSessionModeRequest \|\| tavernSessionModes\.loaded/)
  assert.match(ensure, /rpc\("listSessions"\)/)
  // 显示条件保持严格：没确认是酒馆会话就不画。
  assert.match(client, /if \(!mode\) return null;/)
  assert.match(client, /if \(!isPlayMode\(mode\)\) return null;/)
})

// 手机上固定上限：与标题长短无关，不会随当前渲染数量来回变。
function sliceFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.notEqual(start, -1, '未找到 ' + name)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error('未闭合：' + name)
}

test('手机上最多保留三个快捷入口，导出优先，其余进 ⋮', () => {
  const fold = vm.runInNewContext('(' + sliceFunction(client, 'tavernHeaderMobileFold') + ')', { TAVERN_HEADER_MOBILE_LIMIT: 3 })
  // 三个以内不动，也不出现 ⋮。
  assert.deepEqual(Array.from(fold(['dsh-tavern:status', 'header:export', 'dsh-tavern:cards'], 3)), [])
  // 超过三个：导出 + 清单里前两个留下，其余全折。
  assert.deepEqual(
    Array.from(fold(['dsh-tavern:status', 'header:export', 'dsh-tavern:cards', 'dsh-tavern:worldbooks'], 3)),
    ['dsh-tavern:worldbooks']
  )
  // 没有导出时按顺序保留前三个。
  assert.deepEqual(Array.from(fold(['a', 'b', 'c', 'd'], 3)), ['d'])
  // 上限传 0 视为「用默认上限」，不会让整排图标消失。
  assert.deepEqual(Array.from(fold(['a', 'b'], 0)), [])
  // 显式传 1 时只留一个，其余进 ⋮。
  assert.deepEqual(Array.from(fold(['a', 'b'], 1)), ['b'])
})

test('手机按标题行宽折算槽位：放不下就留一格给 ⋮', () => {
  const capacity = vm.runInNewContext('(' + sliceFunction(client, 'tavernHeaderMobileCapacity') + ')', { TAVERN_HEADER_MOBILE_SLOT: 42, TAVERN_HEADER_MOBILE_LIMIT: 3 })
  // 行宽够 4 格、条目只有 3 个：全显示，上限读数就是容量 3。
  assert.equal(capacity(3, 180, { limit: 3 }), 3)
  // 条目比容量少时，上限不缩水（读数表示「放得下几个」）。
  assert.equal(capacity(2, 180, { limit: 3 }), 3)
  // 行宽只有 3 格、条目 5 个：2 个图标 + ⋮。
  assert.equal(capacity(5, 126, { limit: 3 }), 2)
  // 行宽 4 格但条目 8 个：受上限限制，3 个图标 + ⋮。
  assert.equal(capacity(8, 180, { limit: 3 }), 3)
  // 行宽只有 2 格：1 个图标 + ⋮。
  assert.equal(capacity(5, 90, { limit: 3 }), 1)
  // 一格都放不下也留 1 个（导出优先，折进 ⋮ 里点不到）。
  assert.equal(capacity(5, 10, { limit: 3 }), 1)
  // 只有 1 个条目：上限读数仍是容量，不额外收。
  assert.equal(capacity(1, 300, { limit: 3 }), 3)
})

test('手机顶栏的布局约束：角落按钮留座、宿主动作组保持自然宽度', () => {
  // 预算变量写在标题行上，JS 读它折算槽位。
  assert.match(css, /\[class\*="_titleRow"\] \{\s*--dsh-tavern-header-fixed: 196px;/)
  // 0.2.x 的 headerActions 是 display:contents 插槽，侧栏开关/文件/全屏都在里面；
  // 容器压窄会让固定尺寸按钮互相覆盖，因此保持自然宽度，让标题区收缩。
  assert.match(css, /\[class\*="_headerActions"\] \{\s*flex: none; min-width: 0; gap: 0;/)
  assert.doesNotMatch(css, /--dsh-tavern-header-fixed: 156px;/)
  // dsh-web-mobile 隐藏 titleRow 的 corner 时，酒馆要放回宿主右侧栏按钮，并隐藏重复的文件按钮。
  assert.match(css, /\[data-mobile-nav="frame"\][\s\S]{0,240}\[data-conversation-header-corner\][\s\S]{0,80}display: flex !important;/)
  assert.match(css, /\[data-mobile-nav="frame"\][\s\S]{0,300}\[data-mobile-nav="files"\]\s*\{\s*display: none !important;/)
  // 手机判定与上限要暴露给夹具。
  assert.match(client, /function useTavernMobileHeader\(\)/)
  assert.match(client, /"data-tavern-header-limit": mobile \? mobileLimit : ""/)
  // ⋮ 在手机上竖排三点。
  assert.match(client, /mobile \? "M12 5h\.01M12 12h\.01M12 19h\.01"/)
})

test('宿主隐藏 utilities 时入口仍然在：加载即标记 shell，兜底规则不依赖 body 类', () => {
  // dsh-web-mobile 在 `@media (max-width:767px) and (pointer:coarse)` 里把
  // `header:has(_headerLeading) [class*=_headerUtilities]` 设成 display:none !important
  // （特异性 (0,4,1)）。酒馆的快捷入口全在这个单元格里，竖屏就整排消失、横屏又回来。
  // 两条都要：body 类一经缺席，所有 `body.dsh-tavern-shell-active …` 覆盖全部失效。
  assert.match(client, /function markTavernShellActive\(\)/)
  assert.match(client, /markTavernShellActive\(\);/)
  assert.match(css, /header:has\(\[class\*="_headerLeading"\]\) \[class\*="_headerUtilities"\]:has\(\.dsh-tavern-header-items\)/)
  assert.match(css, /display: flex !important; flex: 0 1 auto !important; min-width: 0 !important;/)
})
