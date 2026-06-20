/**
 * C10K Event Loop Engine
 *
 * A single-threaded TCP server that multiplexes HTTP and raw TCP connections
 * on the same port. Serves static files, exposes a JSON status API, and
 * streams real-time metrics to SSE clients — all using only native Node.js
 * modules (`net`, `os`, `fs`, `path`).
 *
 * The architecture intentionally avoids the built-in `http` module to
 * demonstrate how the event loop can efficiently manage thousands of
 * concurrent sockets with minimal overhead.
 */

import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import {
  isHttpRequest,
  parseHttpRequest,
  buildHttpResponse,
  buildSseHeaders,
} from './http-parser';

// ─── Constants ───────────────────────────────────────────────────────────────

const PORT = 9000;
const SSE_INTERVAL = 100; // ms
const FRONTEND_DIST_PATH = path.resolve(__dirname, '../../frontend/dist');

// ─── State ───────────────────────────────────────────────────────────────────

let nextSocketId = 1;

interface SocketEntry {
  socket: net.Socket;
  connectedAt: number;
}

const activeSockets: Map<number, SocketEntry> = new Map();
let totalRequests = 0;
let totalEverConnected = 0;
let peakConnections = 0;

const recentActivity: Set<number> = new Set();
const sseClients: Set<net.Socket> = new Set();

const startTime = Date.now();

// ─── Rolling RPS Tracker ─────────────────────────────────────────────────────

let prevRequestCount = 0;
let requestsPerSecond = 0;

setInterval(() => {
  requestsPerSecond = totalRequests - prevRequestCount;
  prevRequestCount = totalRequests;
}, 1000);

// ─── MIME Helper ─────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

// ─── HTTP Request Handler ────────────────────────────────────────────────────

function handleHttpRequest(socket: net.Socket, data: Buffer): void {
  const { method, path: reqPath } = parseHttpRequest(data);

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    const response = buildHttpResponse(
      204,
      {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
        'Content-Length': '0',
      },
      '',
    );
    socket.write(response);
    socket.end();
    return;
  }

  // ── SSE metrics stream ──
  if (reqPath === '/metrics') {
    socket.write(buildSseHeaders());
    sseClients.add(socket);
    return; // keep alive
  }

  // ── JSON status endpoint ──
  if (reqPath === '/api/status') {
    const snapshot = buildSnapshot();
    const body = JSON.stringify(snapshot);
    const response = buildHttpResponse(
      200,
      {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': Buffer.byteLength(body).toString(),
        Connection: 'close',
      },
      body,
    );
    socket.write(response);
    socket.end();
    return;
  }

  // ── Static file serving ──
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.join(FRONTEND_DIST_PATH, safePath);

  // Prevent directory traversal
  if (!filePath.startsWith(FRONTEND_DIST_PATH)) {
    send404(socket);
    return;
  }

  fs.readFile(filePath, (err, fileData) => {
    if (err) {
      // If the exact path fails, try serving index.html for SPA routing
      if (safePath !== '/index.html' && !path.extname(safePath)) {
        const indexPath = path.join(FRONTEND_DIST_PATH, 'index.html');
        fs.readFile(indexPath, (indexErr, indexData) => {
          if (indexErr) {
            send404(socket);
            return;
          }
          const response = buildHttpResponse(
            200,
            {
              'Content-Type': 'text/html',
              'Access-Control-Allow-Origin': '*',
              'Content-Length': indexData.length.toString(),
              Connection: 'close',
            },
            indexData.toString('utf-8'),
          );
          socket.write(response);
          socket.end();
        });
      } else {
        send404(socket);
      }
      return;
    }

    const mime = getMimeType(filePath);
    const response = buildHttpResponse(
      200,
      {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*',
        'Content-Length': fileData.length.toString(),
        Connection: 'close',
      },
      fileData.toString('utf-8'),
    );
    socket.write(response);
    socket.end();
  });
}

function send404(socket: net.Socket): void {
  const body =
    '<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>';
  const response = buildHttpResponse(
    404,
    {
      'Content-Type': 'text/html',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(body).toString(),
      Connection: 'close',
    },
    body,
  );
  socket.write(response);
  socket.end();
}

// ─── Snapshot Builder ────────────────────────────────────────────────────────

function buildSnapshot(): {
  activeConnections: number;
  totalRequests: number;
  memoryMB: number;
  recentActiveIds: number[];
  totalEverConnected: number;
  uptime: number;
  peakConnections: number;
  requestsPerSecond: number;
} {
  const memUsage = process.memoryUsage();
  return {
    activeConnections: activeSockets.size,
    totalRequests,
    memoryMB: Math.round((memUsage.rss / 1024 / 1024) * 10) / 10,
    recentActiveIds: Array.from(recentActivity),
    totalEverConnected,
    uptime: Math.round(((Date.now() - startTime) / 1000) * 10) / 10,
    peakConnections,
    requestsPerSecond,
  };
}

// ─── TCP Server ──────────────────────────────────────────────────────────────

const server = net.createServer((socket: net.Socket) => {
  const socketId = nextSocketId++;

  socket.setNoDelay(true);
  socket.setKeepAlive(true, 30000);

  activeSockets.set(socketId, { socket, connectedAt: Date.now() });
  totalEverConnected++;
  peakConnections = Math.max(peakConnections, activeSockets.size);

  let isIdentified = false;
  let isHttp = false;
  let clientBuffer = Buffer.alloc(0);

  socket.on('data', (data: Buffer) => {
    totalRequests++;

    if (!isIdentified) {
      clientBuffer = Buffer.concat([clientBuffer, data]);
      if (isHttpRequest(clientBuffer)) {
        isHttp = true;
        isIdentified = true;
      } else if (clientBuffer.length >= 5) {
        isIdentified = true;
      }
    }

    if (isIdentified) {
      if (isHttp) {
        const reqData = clientBuffer.length > 0 ? clientBuffer : data;
        handleHttpRequest(socket, reqData);
        clientBuffer = Buffer.alloc(0);
      } else {
        // Raw TCP connection — register as recent activity
        recentActivity.add(socketId);
      }
    }
  });

  socket.on('close', () => {
    activeSockets.delete(socketId);
    sseClients.delete(socket);
  });

  socket.on('end', () => {
    socket.end();
  });

  socket.on('error', (err: NodeJS.ErrnoException) => {
    socket.destroy();
    // Suppress expected connection-level errors
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
    // Log unexpected errors for debugging
    console.error(`[socket ${socketId}] Unexpected error: ${err.message}`);
  });
});

// ─── SSE Aggregation Loop ────────────────────────────────────────────────────

setInterval(() => {
  if (sseClients.size === 0) return;

  const snapshot = buildSnapshot();
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;

  for (const client of sseClients) {
    try {
      if (!client.destroyed) {
        client.write(payload);
      } else {
        sseClients.delete(client);
      }
    } catch {
      try {
        client.destroy();
      } catch {}
      sseClients.delete(client);
    }
  }

  recentActivity.clear();
}, SSE_INTERVAL);

// ─── Periodic Stats Logging ──────────────────────────────────────────────────

setInterval(() => {
  const mem = process.memoryUsage();
  console.log(
    `[stats] connections=${activeSockets.size} peak=${peakConnections} ` +
      `requests=${totalRequests} sseClients=${sseClients.size} ` +
      `heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB ` +
      `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB ` +
      `platform=${os.platform()} cpus=${os.cpus().length}`,
  );
}, 5000);

// ─── Start Listening ─────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`C10K Server listening on port ${PORT}`);
  console.log(`Frontend path: ${FRONTEND_DIST_PATH}`);
  console.log(`SSE interval: ${SSE_INTERVAL}ms`);
  console.log(
    `Platform: ${os.platform()} | CPUs: ${os.cpus().length} | Memory: ${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)}GB`,
  );
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[shutdown] Closing server...');
  server.close();
  for (const [, entry] of activeSockets) {
    entry.socket.destroy();
  }
  process.exit(0);
});
