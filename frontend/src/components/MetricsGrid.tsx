import { useRef, useEffect } from 'react'
import { Cpu, Activity, MemoryStick, TrendingUp } from 'lucide-react'
import type { MetricsSnapshot, MetricsHistory } from '../App'

interface MetricsGridProps {
  metrics: MetricsSnapshot
  history: MetricsHistory
}

// Lightweight canvas sparkline — no external deps
function Sparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const step = w / (data.length - 1)

    ctx.clearRect(0, 0, w, h)

    // Fill area
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < data.length; i++) {
      const x = i * step
      const y = h - ((data[i] - min) / range) * (h - 2)
      ctx.lineTo(x, y)
    }
    ctx.lineTo((data.length - 1) * step, h)
    ctx.closePath()

    // Parse hex color to rgba for fill
    ctx.fillStyle = color + '18' // ~10% opacity hex alpha
    ctx.fill()

    // Line
    ctx.beginPath()
    for (let i = 0; i < data.length; i++) {
      const x = i * step
      const y = h - ((data[i] - min) / range) * (h - 2)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [data, color, height])

  return (
    <div className="mt-2 mb-2 w-full">
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height }}
      />
    </div>
  )
}

export default function MetricsGrid({ metrics, history }: MetricsGridProps) {
  const memPercent = Math.min((metrics.memoryMB / 100) * 100, 100)
  const capacityPercent = metrics.peakConnections > 0
    ? ((metrics.peakConnections / 11000) * 100).toFixed(1)
    : '0.0'

  // Use backend-provided RPS directly
  const reqPerSec = metrics.requestsPerSecond ?? 0

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-3">
      {/* Card 1 — Active Connections */}
      <div className="metric-card">
        <div className="flex items-center gap-2 mb-1">
          <Cpu size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 13, fontWeight: 'bold' }}>Active Connections</span>
        </div>
        <div style={{ fontFamily: '"Courier New", monospace', fontSize: 24, fontWeight: 600 }}>
          {metrics.activeConnections.toLocaleString()}
        </div>
        <Sparkline data={history.connections} color="#38bdf8" />
        <div className="mt-1">
          <span className="badge">Total: {metrics.totalEverConnected.toLocaleString()}</span>
        </div>
      </div>

      {/* Card 2 — Throughput */}
      <div className="metric-card">
        <div className="flex items-center gap-2 mb-1">
          <Activity size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 13, fontWeight: 'bold' }}>Throughput</span>
        </div>
        <div style={{ fontFamily: '"Courier New", monospace', fontSize: 24, fontWeight: 600 }}>
          {reqPerSec.toLocaleString()}
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>req/s</span>
        </div>
        <Sparkline data={history.rps} color="#22c55e" />
        <div className="mt-1">
          <span className="badge">Total: {metrics.totalRequests.toLocaleString()}</span>
        </div>
      </div>

      {/* Card 3 — Memory RSS */}
      <div className="metric-card">
        <div className="flex items-center gap-2 mb-1">
          <MemoryStick size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 13, fontWeight: 'bold' }}>Memory RSS</span>
        </div>
        <div style={{ fontFamily: '"Courier New", monospace', fontSize: 24, fontWeight: 600 }}>
          {metrics.memoryMB.toFixed(1)}
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>MB</span>
        </div>
        <Sparkline data={history.memory} color="#f59e0b" height={24} />
        <div className="memory-bar-track mt-1 mb-1">
          <div
            className="memory-bar-fill"
            style={{ width: `${memPercent}%` }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {memPercent.toFixed(1)}% of 100 MB budget
        </div>
      </div>

      {/* Card 4 — Peak Connections */}
      <div className="metric-card">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp size={16} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontSize: 13, fontWeight: 'bold' }}>Peak Connections</span>
        </div>
        <div style={{ fontFamily: '"Courier New", monospace', fontSize: 24, fontWeight: 600 }}>
          {metrics.peakConnections.toLocaleString()}
        </div>
        <div className="mt-2" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Capacity: {capacityPercent}%
        </div>
      </div>
    </div>
  )
}
