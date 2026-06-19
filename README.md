# C10K Event Loop Simulation

A simulation of a single-threaded server handling ~10,000 concurrent connections.

## Purpose

This project demonstrates how Node.js utilizes a single-threaded event loop (via libuv) to manage ~10,000 concurrent network connections. It serves as a visual contrast to traditional multi-threaded servers (thread-per-connection), which incur significant memory and context-switching overhead at scale.

## Real-World Applications

This event-driven, single-threaded architecture is highly suited for systems that handle large numbers of open connections with low computational overhead per request. Key applications include:

- **API Gateways and Reverse Proxies:** Systems like Nginx, Envoy, or Node-based gateways route massive traffic volumes. They multiplex client requests to backend services with minimal CPU and memory consumption.
- **Real-Time Communication Servers:** Chat applications, multiplayer game lobbies, and collaborative document editors (e.g., WebSockets servers) hold thousands of idle or low-traffic connections open simultaneously.
- **IoT Data Ingestion:** IoT hubs receive telemetry data from hundreds of thousands of remote sensors. The server keeps sockets open to receive periodic, small data payloads without spawning separate threads.
- **Push Notification Services:** Notification platforms maintain persistent connections to web and mobile clients to deliver real-time updates instantly.
- **Streaming and SSE endpoints:** Live video/audio metadata pipelines and SSE subscription feeds stream continuous updates to many clients concurrently.

## Benefits

- **Low Memory Footprint:** The entire simulation handles 10,000 connections using under 100 MB of Resident Set Size (RSS) memory, whereas a thread-per-connection model typically requires gigabytes of RAM.
- **No Thread Overhead:** Eliminates CPU overhead caused by thread context switching and thread stack allocations.
- **Centralized State:** Simplifies socket management since all active connections are tracked inside a single-process memory space, removing the need for lock-based synchronization.

## Project Structure

- `/backend` - Node.js TCP/HTTP server using only standard libraries (`net`, `os`, `fs`). Exposes a Server-Sent Events (SSE) endpoint on port 9000.
- `/frontend` - React/Vite dashboard using Canvas to render connection states and traffic.
- `/backend/src/load-tester.ts` - CLI load tester tool simulating socket activity.

## Setup

Install dependencies in both directories:

```bash
cd backend && npm install
cd ../frontend && npm install
```

## Running the Project

### 1. Server

```bash
cd backend
npm run build
npm start
```

### 2. Frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:5173 to view the dashboard.

### 3. Load Tester

Ensure you raise your shell file limit first:

```bash
ulimit -n 15000
cd backend
npm run loadtest -- --connections 10500
```

## Video Demonstration

<!-- Video Placeholder -->

Place your demo video link below:

```markdown
![C10K Simulation Video](/path/to/video.mp4)
```

## Test Stats

- **Connections:** 10,000+
- **Throughput:** ~2,000 req/s
- **Server Memory (RSS):** ~93 MB
