// 轻量反向代理：把 0.0.0.0:<public> 的请求转发到 127.0.0.1:<core>。
//
// 为什么需要它：DSH 核心出于安全考虑硬拒绝通配绑定地址（0.0.0.0），只接受
// 具体接口地址；而 dsh-tavern 的就绪检查固定探测 127.0.0.1。因此让核心保持
// 回环监听，由本代理对外提供访问。
//
// 关键点：**保留原始 Host 头**。核心的 /api 信任栅栏按 Host 判定，
// dsh-webui-auth 的登录跳转也按请求 Host 生成地址；改写 Host 会同时破坏两者。
// 外部访问的权威需通过 DSH_TAVERN_TRUSTED_HOSTS（--trusted-host）加入白名单。
//
// 关于 X-Forwarded-Proto：若前面还有一层 HTTPS 反代（如 FnOS 反代 / Caddy），
// 它会下发 X-Forwarded-Proto: https。本代理**必须原样透传**，否则 dsh-webui-auth
// 会把登录跳转生成成 http:// 地址，在 HTTPS 页面上形成混合内容/死链。
import http from 'node:http'
import net from 'node:net'

const listenHost = process.env.DSH_TAVERN_PROXY_BIND || '0.0.0.0'
const listenPort = Number(process.env.DSH_TAVERN_PUBLIC_PORT || 3080)
const targetHost = '127.0.0.1'
const targetPort = Number(process.env.DSH_TAVERN_PORT || 3081)

function forwardHeaders(req) {
  const headers = { ...req.headers }
  const remote = req.socket.remoteAddress || ''
  headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${remote}` : remote
  // 仅在本机直连（无上游反代）时补 http；有上游时原样保留其协议声明
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'http'
  if (!headers['x-forwarded-host']) headers['x-forwarded-host'] = headers['host'] || ''
  return headers
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: targetHost, port: targetPort, method: req.method, path: req.url, headers: forwardHeaders(req) },
    (response) => {
      res.writeHead(response.statusCode || 502, response.headers)
      response.pipe(res)
    },
  )
  upstream.on('error', () => {
    try { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('DSH Tavern 后端尚未就绪，请稍后刷新。') } catch {}
  })
  req.on('error', () => upstream.destroy())
  req.pipe(upstream)
})

// WebSocket / HTTP Upgrade 透传（/api/remote.mux）
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = forwardHeaders(req)
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (const [key, value] of Object.entries(headers)) raw += `${key}: ${value}\r\n`
    raw += '\r\n'
    upstream.write(raw)
    if (head && head.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  const close = () => { socket.destroy(); upstream.destroy() }
  upstream.on('error', close)
  socket.on('error', close)
})

server.on('error', (error) => {
  console.error(`[proxy] 监听失败：${error.message}`)
  process.exit(1)
})

server.listen(listenPort, listenHost, () => {
  console.log(`[proxy] 正在监听 ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`)
})
