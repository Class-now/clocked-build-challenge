// Adapts a Node request and response to the plain handlers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DemoRequest, DemoResponse } from './handlers.js';

export type NodeRequest = IncomingMessage & { body?: unknown };

/** The platform sets these two headers itself, so a visitor cannot choose their own bucket. */
export function clientIp(req: Pick<IncomingMessage, 'headers'> & { socket?: { remoteAddress?: string | undefined } }): string {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real !== '') return real;
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || 'unknown';
}

export function toDemoRequest(req: NodeRequest): DemoRequest {
  let body: unknown;
  try {
    // Reading a malformed JSON body throws on this getter.
    body = req.body;
  } catch {
    body = undefined;
  }
  return { method: req.method ?? 'GET', ip: clientIp(req), body };
}

export function send(res: ServerResponse, response: DemoResponse): void {
  res.statusCode = response.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(response.headers ?? {})) res.setHeader(name, value);
  res.end(JSON.stringify(response.body));
}
