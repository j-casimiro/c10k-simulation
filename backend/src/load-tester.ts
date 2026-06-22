/**
 * C10K Load Tester — Bot Army Simulator
 *
 * Standalone CLI tool that hammers the C10K server with thousands of
 * concurrent TCP connections to validate event-loop scalability. Connections
 * are established in configurable batches with adjustable delays to avoid
 * overwhelming the OS connection queue.
 *
 * Usage:
 *   npx tsx src/load-tester.ts [--target HOST] [--port PORT]
 *       [--connections N] [--batchSize N] [--batchDelay MS]
 */

import net from 'node:net';

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(): {
  target: string;
  port: number;
  connections: number;
  batchSize: number;
  batchDelay: number;
} {
  const args = process.argv.slice(2);
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--') && i + 1 < args.length) {
      const key = arg.slice(2);
      parsed[key] = args[++i];
    }
  }

  return {
    target: parsed['target'] ?? 'localhost',
    port: parseInt(parsed['port'] ?? '9000', 10),
    connections: parseInt(parsed['connections'] ?? '11000', 10),
    batchSize: parseInt(parsed['batchSize'] ?? '500', 10),
    batchDelay: parseInt(parsed['batchDelay'] ?? '50', 10),
  };
}

const config = parseArgs();

// ─── State ───────────────────────────────────────────────────────────────────

const sockets: net.Socket[] = [];
let connected = 0;
let failed = 0;
let peakConcurrent = 0;
const testStartTime = Date.now();

// ─── Utilities ───────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Batch Connection Creator ────────────────────────────────────────────────

function createBatch(batchNum: number, totalBatches: number): void {
  for (let i = 0; i < config.batchSize; i++) {
    const socket = net.createConnection({
      host: config.target,
      port: config.port,
    });

    socket.setNoDelay(true);

    socket.on('connect', () => {
      connected++;
      peakConcurrent = Math.max(peakConcurrent, connected);
      sockets.push(socket);
    });

    socket.on('error', () => {
      failed++;
      // Don't crash — connection failures are expected at scale
    });

    socket.on('close', () => {
      connected--;
      const idx = sockets.indexOf(socket);
      if (idx !== -1) {
        sockets.splice(idx, 1);
      }
    });
  }

  console.log(
    `[batch ${batchNum}/${totalBatches}] Establishing ${config.batchSize} connections... ` +
      `(${connected} active, ${failed} failed)`,
  );
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  // Full heartbeat to all sockets every 3s
  setInterval(() => {
    const now = Date.now();
    const payload = `PING ${now}\n`;
    let writeErrors = 0;

    for (const socket of sockets) {
      try {
        if (!socket.destroyed) {
          socket.write(payload);
        }
      } catch {
        writeErrors++;
      }
    }

    const elapsed = ((now - testStartTime) / 1000).toFixed(1);
    console.log(
      `[heartbeat] active=${connected} peak=${peakConcurrent} ` +
        `failed=${failed} writeErrors=${writeErrors} elapsed=${elapsed}s`,
    );
  }, 3000);

  // Random data bursts: ~10% of sockets fire aggressive dummy data every 500ms
  setInterval(() => {
    if (sockets.length === 0) return;

    const payload = `DATA ${Date.now()} ${Math.random().toString(36).substring(2)}\n`;
    let burstCount = 0;

    for (const socket of sockets) {
      if (Math.random() < 0.1) {
        try {
          if (!socket.destroyed) {
            socket.write(payload);
            burstCount++;
          }
        } catch {
          // ignore write errors on burst
        }
      }
    }

    if (burstCount > 0) {
      console.log(`[burst] fired=${burstCount} of ${sockets.length} sockets`);
    }
  }, 500);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function startLoadTest(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║      C10K LOAD TESTER — BOT ARMY SIMULATOR   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log();
  console.log(`  Target:       ${config.target}:${config.port}`);
  console.log(`  Connections:  ${config.connections.toLocaleString()}`);
  console.log(`  Batch Size:   ${config.batchSize}`);
  console.log(`  Batch Delay:  ${config.batchDelay}ms`);
  console.log();

  const totalBatches = Math.ceil(config.connections / config.batchSize);
  console.log(`  Total Batches: ${totalBatches}`);
  console.log('─'.repeat(48));
  console.log();

  for (let batch = 1; batch <= totalBatches; batch++) {
    createBatch(batch, totalBatches);
    await delay(config.batchDelay);
  }

  const elapsed = ((Date.now() - testStartTime) / 1000).toFixed(1);
  console.log();
  console.log('═'.repeat(48));
  console.log(`  All batches dispatched in ${elapsed}s`);
  console.log(
    `  Connected: ${connected} | Failed: ${failed} | Peak: ${peakConcurrent}`,
  );
  console.log('═'.repeat(48));
  console.log();
  console.log('Starting heartbeat (PING every 3s)...');
  console.log('Press Ctrl+C to stop and see summary.\n');

  startHeartbeat();
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function handleShutdown(signal: string) {
  const duration = ((Date.now() - testStartTime) / 1000).toFixed(1);

  console.log('\n');
  console.log('╔══════════════════════════════════════════════╗');
  console.log(`║          LOAD TEST SUMMARY (${signal})`.padEnd(47) + '║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Peak Concurrent: ${String(peakConcurrent).padEnd(26)}║`);
  console.log(`║  Total Connected: ${String(connected).padEnd(26)}║`);
  console.log(`║  Failed:          ${String(failed).padEnd(26)}║`);
  console.log(`║  Duration:        ${(duration + 's').padEnd(26)}║`);
  console.log('╚══════════════════════════════════════════════╝');

  // Destroy all sockets
  for (const socket of sockets) {
    try {
      socket.destroy();
    } catch {
      // Ignore cleanup errors
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// ─── Entry Point ─────────────────────────────────────────────────────────────

startLoadTest();
