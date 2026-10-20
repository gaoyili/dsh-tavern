// 探测本机网络地址，供容器入口脚本决定反向代理绑定与信任主机列表。
// 输出：
//   primary=<默认路由出口的本机 IPv4>
//   all=<所有非回环 IPv4，逗号分隔>
import os from 'node:os'
import dgram from 'node:dgram'

const all = []
for (const list of Object.values(os.networkInterfaces())) {
  for (const info of list || []) {
    if (info.family === 'IPv4' && !info.internal) all.push(info.address)
  }
}

function primaryAddress() {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const socket = dgram.createSocket('udp4')
      socket.once('error', () => { try { socket.close() } catch {} ; done('') })
      socket.connect(53, '8.8.8.8', () => {
        const address = socket.address().address
        try { socket.close() } catch {}
        done(address)
      })
      setTimeout(() => { try { socket.close() } catch {} ; done('') }, 1500).unref()
    } catch {
      done('')
    }
  })
}

const primary = await primaryAddress()
console.log(`primary=${primary || all[0] || ''}`)
console.log(`all=${all.join(',')}`)
