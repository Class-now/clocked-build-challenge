import type { ServerResponse } from 'node:http';
import { handleScenarios, liveDeps } from '../src/server/handlers.js';
import { send, toDemoRequest } from '../src/server/vercel.js';
import type { NodeRequest } from '../src/server/vercel.js';

export default function handler(req: NodeRequest, res: ServerResponse): void {
  send(res, handleScenarios(toDemoRequest(req), liveDeps()));
}
