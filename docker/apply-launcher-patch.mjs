// 对 dsh-tavern 启动器做必要补丁（幂等）：
//
// 1) 服务启动参数：支持自定义绑定地址与信任主机（LAN / 反向代理访问）。
//    核心的 /api 信任栅栏只接受回环 Host、绑定地址本身或 --trusted-host
//    声明的权威；容器里通过 DSH_TAVERN_BIND_HOST / DSH_TAVERN_TRUSTED_HOSTS 注入。
//    注意：上游启动器代码会演进（如 String(CLI_PORT) -> String(state.port)），
//    因此这里用正则匹配参数数组，而不是固定字符串锚点。
//
// 2) 就绪检查：新版 DSH 核心自带浏览器认证（BrowserAuth），未携带 cookie 的
//    根路径请求会 302 跳转到 /?token=... 且无限循环。Node 的 fetch 没有
//    cookie 存储，导致 isServiceReady 永远失败、启动超时。改为不跟随跳转，
//    并把 302/303 视为「服务已就绪」。
//
// 应用更新后补丁会被覆盖，容器每次启动都会重新应用。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const file = process.argv[2]
if (!file || !existsSync(file)) {
  console.log(`[patch] 跳过（文件不存在）：${file}`)
  process.exit(0)
}

const TRUSTED_ARGS = "...(process.env.DSH_TAVERN_TRUSTED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean).flatMap((h) => ['--trusted-host', h])"

const patches = [
  {
    name: '绑定/信任主机',
    marker: 'process.env.DSH_TAVERN_BIND_HOST || CLI_HOST',
    pattern: /(\['--profile', PROFILE, '--host', )CLI_HOST(, '--port', String\([^)]+\))(, '--no-open')\]/,
    replacement: (_match, head, port, tail) =>
      `${head}process.env.DSH_TAVERN_BIND_HOST || CLI_HOST${port}${tail}, ${TRUSTED_ARGS}]`,
  },
  {
    name: '就绪检查（BrowserAuth 302）',
    anchor: 'const response = await request(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })',
    replacement:
      "const response = await request(`http://127.0.0.1:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(1000) })",
  },
  {
    name: '就绪检查（接受 3xx）',
    anchor: "return response.ok || response.status === 401 || (host === 'android' && response.status === 403)",
    replacement:
      "return response.ok || response.status === 401 || response.status === 302 || response.status === 303 || (host === 'android' && response.status === 403)",
  },
]

let source = readFileSync(file, 'utf8')
let changed = 0
for (const patch of patches) {
  if (patch.marker && source.includes(patch.marker)) continue
  if (patch.pattern) {
    if (!patch.pattern.test(source)) {
      console.log(`[patch] 未找到锚点，跳过：${patch.name}`)
      continue
    }
    source = source.replace(patch.pattern, patch.replacement)
    changed += 1
    continue
  }
  if (source.includes(patch.replacement)) continue
  if (!source.includes(patch.anchor)) {
    console.log(`[patch] 未找到锚点，跳过：${patch.name}`)
    continue
  }
  source = source.replace(patch.anchor, patch.replacement)
  changed += 1
}

if (changed > 0) {
  writeFileSync(file, source)
  console.log(`[patch] 已应用 ${changed} 处补丁。`)
} else {
  console.log('[patch] 补丁已是最新。')
}
