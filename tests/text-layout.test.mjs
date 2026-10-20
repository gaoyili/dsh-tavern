// 外观 → 正文排版：行距、字距只在调过时接管正文；字号就是 DSH 通用设置里的字号。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = client.indexOf('const TAVERN_TEXT_LAYOUT_KEY')
const marker = 'const tavernTextLayoutFeature = createTavernTextLayoutFeature();'
const source = client.slice(start, client.indexOf(marker) + marker.length)

async function setup() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = (await import('react')).default
  const feature = new Function('React', 'window', 'document', source + '\nreturn tavernTextLayoutFeature;')(React, dom.window, dom.window.document)
  return { dom, React, feature }
}

test('取值规整：没调过是 null，超范围夹住；默认行距按酒馆原来的 24px + 字号增量换算', async () => {
  assert.ok(start >= 0, '客户端 bundle 应包含正文排版')
  const { feature } = await setup()
  assert.deepEqual(feature.normalize(null), { lineHeight: null, letterSpacing: null })
  assert.deepEqual(feature.normalize({ lineHeight: 9, letterSpacing: -1 }), { lineHeight: 3, letterSpacing: -0.1 })
  assert.deepEqual(feature.normalize({ lineHeight: '', letterSpacing: 'x' }), { lineHeight: null, letterSpacing: null })
  assert.equal(feature.defaultLineHeight(14), 1.71)
  assert.equal(feature.defaultLineHeight(17), 1.59)
})

test('调过才写变量和开关属性；恢复默认后撤掉，并保存在本机', async () => {
  const { dom, feature } = await setup()
  const root = dom.window.document.documentElement
  feature.apply(feature.normalize(null))
  assert.equal(root.hasAttribute('data-dsh-text-layout'), false)
  feature.update({ lineHeight: 2.2, letterSpacing: 0.05 })
  assert.equal(root.hasAttribute('data-dsh-text-layout'), true)
  assert.equal(root.style.getPropertyValue('--dsh-tavern-line-height'), '2.2')
  assert.equal(root.style.getPropertyValue('--dsh-tavern-letter-spacing'), '0.05em')
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('dsh-tavern-text-layout')), { lineHeight: 2.2, letterSpacing: 0.05 })
  feature.update({ lineHeight: null, letterSpacing: null })
  assert.equal(root.hasAttribute('data-dsh-text-layout'), false)
  assert.equal(root.style.getPropertyValue('--dsh-tavern-line-height'), '')
})

test('外观行：字号读写 DSH 的字号设置，并跟随通用设置的改动', async () => {
  const { dom, React, feature } = await setup()
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  let snapshot = { fontSizes: { text: 17 } }
  const changes = new Set()
  const writes = []
  const theme = { getTheme: () => snapshot, setFontSize: (role, px) => { writes.push([role, px]); snapshot = { fontSizes: { text: px } }; changes.forEach(fn => fn(snapshot)) } }
  let registered, Row
  const ctx = {
    theme, on: (_event, fn) => { changes.add(fn); return () => changes.delete(fn) },
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; Row = component; return () => {} } }
  }
  feature.register(ctx)
  assert.equal(registered.name, 'settings.dreamSkin.item')
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Row, registered.inject())) })
  const values = () => [...dom.window.document.querySelectorAll('.dsh-tavern-text-layout-value')].map(node => node.textContent)
  assert.deepEqual(values(), ['17px', '1.59×', '0em'])
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  const size = dom.window.document.querySelector('.dsh-tavern-text-layout input[type=range]')
  await act(async () => { setter.call(size, '20'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(writes.at(-1), ['text', 20])
  await act(async () => { theme.setFontSize('text', 12) })
  assert.equal(values()[0], '12px', '通用设置里改字号，这里跟着变')
  await act(async () => { root.unmount() })
})

test('DSH 0.2.0 宿主：字号是单个数值，setFontSize(px) 也能调节；超过宿主上限时夹到上限而不是报错', async () => {
  const { dom, React, feature } = await setup()
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  let snapshot = { fontSize: 17 }
  const changes = new Set()
  const writes = []
  const theme = {
    getTheme: () => snapshot,
    setFontSize: (px) => {
      if (!Number.isInteger(px) || px < 10 || px > 22) throw new Error(`font size ${px} is outside 10..22`)
      writes.push(px)
      snapshot = { fontSize: px }
      changes.forEach(fn => fn(snapshot))
    }
  }
  let registered, Row
  const ctx = {
    theme, on: (_event, fn) => { changes.add(fn); return () => changes.delete(fn) },
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; Row = component; return () => {} } }
  }
  feature.register(ctx)
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Row, registered.inject())) })
  const values = () => [...dom.window.document.querySelectorAll('.dsh-tavern-text-layout-value')].map(node => node.textContent)
  assert.equal(values()[0], '17px', '0.2.0 的 snapshot 只有 fontSize，也要读到')
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  const size = dom.window.document.querySelector('.dsh-tavern-text-layout input[type=range]')
  await act(async () => { setter.call(size, '20'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(writes, [20], '按 0.2.0 的 setFontSize(px) 写入')
  await act(async () => { setter.call(size, '30'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(writes, [20, 22], '超过 0.2.0 的 22px 上限时改用上限值')
  assert.equal(size.max, '22', '滑杆跟着宿主上限收窄')
  assert.equal(values()[0], '22px')
  assert.equal(dom.window.document.querySelector('.dsh-tavern-settings-error'), null, '不把宿主上限报错摆在设置页上')
  await act(async () => { setter.call(size, '12'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.equal(writes.at(-1), 12, '收窄后仍能正常调节')
  await act(async () => { root.unmount() })
})

test('DSH 0.2.1 未打字号补丁的宿主（上限 22）同样收窄滑杆，不显示报错', async () => {
  const { dom, React, feature } = await setup()
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  let snapshot = { fontSizes: { text: 14 } }
  const changes = new Set()
  const writes = []
  const theme = {
    getTheme: () => snapshot,
    setFontSize: (role, px) => {
      if (!Number.isInteger(px) || px < 10 || px > 22) throw new Error(`${role} font size ${px} is outside 10..22`)
      writes.push([role, px])
      snapshot = { fontSizes: { text: px } }
      changes.forEach(fn => fn(snapshot))
    }
  }
  let registered, Row
  const ctx = {
    theme, on: (_event, fn) => { changes.add(fn); return () => changes.delete(fn) },
    slots: { inject: (_name, run) => run(), register: (meta, component) => { registered = meta; Row = component; return () => {} } }
  }
  feature.register(ctx)
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Row, registered.inject())) })
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  const size = dom.window.document.querySelector('.dsh-tavern-text-layout input[type=range]')
  await act(async () => { setter.call(size, '26'); size.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  assert.deepEqual(writes, [['text', 22]])
  assert.equal(size.max, '22')
  assert.equal(dom.window.document.querySelector('.dsh-tavern-settings-error'), null)
  await act(async () => { root.unmount() })
})
