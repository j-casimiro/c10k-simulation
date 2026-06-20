/**
 * HTTP Protocol Parser & Response Builder
 *
 * Lightweight, zero-dependency HTTP/1.1 parser that operates directly on raw
 * TCP buffers. Used by the multiplexer in server.ts to distinguish HTTP
 * traffic from raw TCP connections and to construct well-formed responses
 * without pulling in the full Node.js `http` module.
 */

const HTTP_METHODS = [
  'GET',
  'POST',
  'HEAD',
  'PUT',
  'DELETE',
  'OPTIONS',
  'PATCH',
] as const;

/**
 * Checks whether the leading bytes of a buffer look like a valid HTTP request.
 * We look for one of the standard method tokens followed by a space — this is
 * enough to reliably distinguish HTTP from arbitrary TCP payloads.
 */
export function isHttpRequest(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 10).toString('ascii');
  return HTTP_METHODS.some((method) => head.startsWith(method + ' '));
}

/**
 * Parses a raw HTTP request buffer into its constituent parts.
 *
 * Only the *first* request in the buffer is parsed (no HTTP pipelining).
 * Header names are normalised to lower-case for easy lookup.
 */
export function parseHttpRequest(buffer: Buffer): {
  method: string;
  path: string;
  headers: Record<string, string>;
} {
  const raw = buffer.toString('utf-8');
  const lines = raw.split('\r\n');
  const [method = '', fullPath = ''] = (lines[0] ?? '').split(' ');
  const [path = ''] = fullPath.split('?');

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) break; // empty line = end of headers
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();
    headers[key] = value;
  }

  return { method, path, headers };
}

/**
 * Constructs a complete HTTP/1.1 response as a single Buffer ready for
 * writing to a TCP socket.
 */
export function buildHttpResponse(
  statusCode: number,
  headers: Record<string, string>,
  body: string,
): Buffer {
  const statusText = getStatusText(statusCode);
  let response = `HTTP/1.1 ${statusCode} ${statusText}\r\n`;

  for (const [key, value] of Object.entries(headers)) {
    response += `${key}: ${value}\r\n`;
  }

  response += `\r\n${body}`;
  return Buffer.from(response, 'utf-8');
}

/**
 * Returns the pre-built SSE response header string.
 *
 * This is written *once* per SSE client — subsequent writes are bare
 * `data: …\n\n` frames.
 */
export function buildSseHeaders(): string {
  return (
    'HTTP/1.1 200 OK\r\n' +
    'Content-Type: text/event-stream\r\n' +
    'Cache-Control: no-cache\r\n' +
    'Connection: keep-alive\r\n' +
    'Access-Control-Allow-Origin: *\r\n' +
    'Access-Control-Allow-Headers: Cache-Control\r\n' +
    '\r\n'
  );
}

/**
 * Maps common HTTP status codes to their reason phrases.
 */
export function getStatusText(code: number): string {
  const STATUS_TEXTS: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    204: 'No Content',
    301: 'Moved Permanently',
    304: 'Not Modified',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return STATUS_TEXTS[code] ?? 'Unknown';
}
