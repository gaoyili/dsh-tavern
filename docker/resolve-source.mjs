// 探测可用的 GitHub 加速源，输出所选前缀（无前缀表示直连 GitHub）。
//
// 单一加速源（如 gh-proxy.com）会限流/临时封禁，导致首次安装失败。这里按顺序
// 探测多个候选源，选第一个可用的；用户可通过 DSH_TAVERN_GIT_URL 直接覆盖。
//
// 输出：一行前缀（可能为空字符串，表示直连 https://github.com）
const REPO = process.env.DSH_TAVERN_REPOSITORY || 'flizzywine/dsh-tavern'
const ARCHIVE = `https://github.com/${REPO}/archive/refs/heads/main.tar.gz`

const candidates = [
  'https://ghfast.top/',
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
  '', // 直连 GitHub
]

async function probe(prefix) {
  const url = prefix + ARCHIVE
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    })
    // 代理可能回 200/206；302 等由 redirect:follow 消化
    return response.ok || response.status === 206
  } catch {
    return false
  }
}

let chosen = ''
let found = false
for (const prefix of candidates) {
  // eslint-disable-next-line no-await-in-loop
  if (await probe(prefix)) {
    chosen = prefix
    found = true
    break
  }
}

if (!found) {
  // 都不通也返回直连，让安装脚本自己的回退链去尝试
  chosen = ''
}

// 输出：<prefix>\t<human readable>
process.stdout.write(`${chosen}`)
