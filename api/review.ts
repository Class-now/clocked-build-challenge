import type { ServerResponse } from 'node:http';
import { handleReview, liveDeps } from '../src/server/handlers.js';
import { send, toDemoRequest } from '../src/server/vercel.js';
import type { NodeRequest } from '../src/server/vercel.js';

export default async function handler(req: NodeRequest, res: ServerResponse): Promise<void> {
  send(res, await handleReview(toDemoRequest(req), liveDeps()));
}
