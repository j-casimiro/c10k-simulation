import { useRef, useEffect, useCallback } from 'react'

interface MetricsSnapshot {
  activeConnections: number
  totalRequests: number
  memoryMB: number
  recentActiveIds: number[]
  totalEverConnected: number
  uptime: number
  peakConnections: number
  requestsPerSecond: number
}

interface SwarmVisualizerProps {
  metricsRef: React.MutableRefObject<MetricsSnapshot>
}

const TOTAL_CELLS = 11000
const MIN_CELL_SIZE = 2
const GAP = 1

export default function SwarmVisualizer({ metricsRef }: SwarmVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const cellStates = useRef(new Uint8Array(TOTAL_CELLS))
  const prevActiveConnections = useRef(0)
  const gridRef = useRef({ cellSize: 4, pitch: 5, cols: 1, rows: 1, offsetX: 0, offsetY: 0, canvasW: 0, canvasH: 0 })

  const updateDimensions = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const dpr = window.devicePixelRatio || 1
    const w = container.clientWidth
    const h = container.clientHeight

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (ctx) ctx.scale(dpr, dpr)

    // Calculate optimal cell size to fill the available space
    // We want cols * rows >= TOTAL_CELLS and the grid to fill w x h
    let cellSize = Math.max(MIN_CELL_SIZE, Math.floor(Math.sqrt((w * h) / TOTAL_CELLS)) - GAP)

    // Ensure we can fit all cells, shrink if needed
    while (cellSize >= MIN_CELL_SIZE) {
      const pitch = cellSize + GAP
      const cols = Math.floor(w / pitch)
      const rows = Math.floor(h / pitch)
      if (cols * rows >= TOTAL_CELLS) break
      cellSize--
    }
    cellSize = Math.max(cellSize, MIN_CELL_SIZE)

    const pitch = cellSize + GAP
    const cols = Math.max(1, Math.floor(w / pitch))
    const rows = Math.ceil(TOTAL_CELLS / cols)

    // Center the grid
    const gridW = cols * pitch - GAP
    const gridH = rows * pitch - GAP
    const offsetX = Math.max(0, Math.floor((w - gridW) / 2))
    const offsetY = Math.max(0, Math.floor((h - gridH) / 2))

    gridRef.current = { cellSize, pitch, cols, rows, offsetX, offsetY, canvasW: w, canvasH: h }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => updateDimensions())
    observer.observe(container)
    updateDimensions()

    return () => observer.disconnect()
  }, [updateDimensions])

  useEffect(() => {
    const cells = cellStates.current

    const tick = () => {
      const canvas = canvasRef.current
      if (!canvas) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const { cellSize, pitch, cols, offsetX, offsetY, canvasW, canvasH } = gridRef.current
      if (canvasW === 0 || canvasH === 0) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const metrics = metricsRef.current
      const currentActive = metrics.activeConnections
      const prevActive = prevActiveConnections.current

      // Phase 1: Transition disconnecting(3) → empty(0), active(2) → connected(1)
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (cells[i] === 3) cells[i] = 0
        else if (cells[i] === 2) cells[i] = 1
      }

      // Phase 2: Handle connection count changes
      if (currentActive > prevActive) {
        let toAdd = currentActive - prevActive
        for (let i = 0; i < TOTAL_CELLS && toAdd > 0; i++) {
          if (cells[i] === 0) {
            cells[i] = 1
            toAdd--
          }
        }
      } else if (currentActive < prevActive) {
        let toRemove = prevActive - currentActive
        for (let i = TOTAL_CELLS - 1; i >= 0 && toRemove > 0; i--) {
          if (cells[i] === 1) {
            cells[i] = 3
            toRemove--
          }
        }
      }

      // Phase 3: Mark recent active IDs — map socket IDs into cell index range
      const activeIds = metrics.recentActiveIds
      for (let j = 0; j < activeIds.length; j++) {
        const idx = activeIds[j] % TOTAL_CELLS
        if (idx >= 0 && idx < TOTAL_CELLS && cells[idx] === 1) {
          cells[idx] = 2
        }
      }

      prevActiveConnections.current = currentActive

      // Detect theme
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light'

      // Clear entire canvas
      const bgColor = isDark ? '#0a0a0a' : '#f0f0f0'
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, canvasW, canvasH)

      // Batch render by state
      const colors: Record<number, string> = isDark
        ? { 1: '#1e3a3a', 2: '#00ff88', 3: '#cc4400' }
        : { 1: '#b0c4c4', 2: '#0066cc', 3: '#cc4400' }

      for (const stateVal of [1, 2, 3]) {
        ctx.fillStyle = colors[stateVal]
        for (let i = 0; i < TOTAL_CELLS; i++) {
          if (cells[i] === stateVal) {
            const col = i % cols
            const row = Math.floor(i / cols)
            const x = offsetX + col * pitch
            const y = offsetY + row * pitch
            ctx.fillRect(x, y, cellSize, cellSize)
          }
        }
      }

      // Stats overlay
      const overlayBg = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)'
      const overlayText = isDark ? '#e2e8f0' : '#333333'

      let connectedCount = 0
      let activeCount = 0
      for (let i = 0; i < TOTAL_CELLS; i++) {
        if (cells[i] === 1 || cells[i] === 2) connectedCount++
        if (cells[i] === 2) activeCount++
      }

      const gridPercent = ((connectedCount / TOTAL_CELLS) * 100).toFixed(1)
      const statsText = `Connections: ${connectedCount.toLocaleString()} / 11,000  |  Grid: ${gridPercent}%  |  Active: ${activeCount.toLocaleString()}`

      ctx.font = '11px "Courier New", monospace'
      const textMetrics = ctx.measureText(statsText)
      const textW = textMetrics.width + 16
      const textH = 20

      ctx.fillStyle = overlayBg
      ctx.fillRect(4, 4, textW, textH)
      ctx.fillStyle = overlayText
      ctx.fillText(statsText, 12, 17)

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [metricsRef])

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden relative">
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  )
}
