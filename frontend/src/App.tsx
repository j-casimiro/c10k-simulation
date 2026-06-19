import { useState, useEffect, useRef, useCallback } from 'react'
import { Menu, X, Sun, Moon } from 'lucide-react'
import MetricsGrid from './components/MetricsGrid'
import SwarmVisualizer from './components/SwarmVisualizer'

export interface MetricsSnapshot {
  activeConnections: number
  totalRequests: number
  memoryMB: number
  recentActiveIds: number[]
  totalEverConnected: number
  uptime: number
  peakConnections: number
  requestsPerSecond: number
}

export interface MetricsHistory {
  connections: number[]
  memory: number[]
  rps: number[]
}

const HISTORY_LENGTH = 120 // ~60 seconds at 500ms sampling

const defaultMetrics: MetricsSnapshot = {
  activeConnections: 0,
  totalRequests: 0,
  memoryMB: 0,
  recentActiveIds: [],
  totalEverConnected: 0,
  uptime: 0,
  peakConnections: 0,
  requestsPerSecond: 0,
}

const defaultHistory: MetricsHistory = {
  connections: [],
  memory: [],
  rps: [],
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function App() {
  const metricsRef = useRef<MetricsSnapshot>(defaultMetrics)
  const [displayMetrics, setDisplayMetrics] = useState<MetricsSnapshot>(defaultMetrics)
  const [history, setHistory] = useState<MetricsHistory>(defaultHistory)
  const [connected, setConnected] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('c10k-theme')
      if (stored === 'light' || stored === 'dark') return stored
    }
    return 'dark'
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Apply theme on mount and change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('c10k-theme', theme)
  }, [theme])

  // SSE connection
  useEffect(() => {
    const es = new EventSource('/metrics')

    es.onmessage = (e) => {
      try {
        metricsRef.current = JSON.parse(e.data)
      } catch {
        // ignore malformed data
      }
    }

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    return () => es.close()
  }, [])

  // RAF display update loop
  useEffect(() => {
    let frameId: number

    const update = () => {
      setDisplayMetrics(metricsRef.current)
      frameId = requestAnimationFrame(update)
    }

    frameId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frameId)
  }, [])

  // History sampling at 500ms intervals
  useEffect(() => {
    const interval = setInterval(() => {
      const m = metricsRef.current
      setHistory((prev) => ({
        connections: [...prev.connections.slice(-(HISTORY_LENGTH - 1)), m.activeConnections],
        memory: [...prev.memory.slice(-(HISTORY_LENGTH - 1)), m.memoryMB],
        rps: [...prev.rps.slice(-(HISTORY_LENGTH - 1)), m.requestsPerSecond ?? 0],
      }))
    }, 500)

    return () => clearInterval(interval)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <div
      className="h-screen w-screen overflow-hidden flex"
      style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-primary)' }}
    >
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 lg:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static z-40 top-0 left-0 h-full
          flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
        `}
        style={{
          width: 280,
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-color)',
        }}
      >
        {/* Header */}
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18, fontWeight: 600 }}>C10K Monitor</span>
            <span className="badge">v1.0</span>
          </div>
          <button
            className="btn lg:hidden p-1"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Connection status */}
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          <span style={{ fontFamily: '"Courier New", monospace', fontSize: 12, color: 'var(--text-secondary)' }}>
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>

        {/* Server info */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: 15, fontWeight: 'bold', marginBottom: 8 }}>Server</div>
          <div className="flex flex-col gap-1" style={{ fontSize: 13 }}>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Port</span>
              <span style={{ fontFamily: '"Courier New", monospace' }}>9000</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Uptime</span>
              <span style={{ fontFamily: '"Courier New", monospace' }}>{formatUptime(displayMetrics.uptime)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>Protocol</span>
              <span style={{ fontFamily: '"Courier New", monospace' }}>TCP/SSE</span>
            </div>
          </div>
        </div>

        {/* Theme toggle */}
        <div className="px-4 py-3">
          <button className="btn w-full flex items-center justify-center gap-2" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Footer */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-color)', fontSize: 11, color: 'var(--text-muted)' }}>
          Single-threaded event loop demo
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <div
          className="lg:hidden flex items-center p-3 gap-3"
          style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-sidebar)' }}
        >
          <button className="btn p-1" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
            <Menu size={18} />
          </button>
          <span style={{ fontSize: 16, fontWeight: 600 }}>C10K Monitor</span>
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
        </div>

        {/* Metrics row */}
        <MetricsGrid metrics={displayMetrics} history={history} />

        {/* Canvas area */}
        <SwarmVisualizer metricsRef={metricsRef} />
      </div>
    </div>
  )
}
