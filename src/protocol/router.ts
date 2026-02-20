import type { InboundMessage } from './types.js';
import type { Session } from '../session/session.js';
import type { Transport } from '../transport/interface.js';
import type pino from 'pino';

import { handleHello } from './handlers/hello.js';
import { handleListen } from './handlers/listen.js';
import { handleAbort } from './handlers/abort.js';
import { handlePing } from './handlers/ping.js';
import { handleGoodbye } from './handlers/goodbye.js';
import { handleIot } from './handlers/iot.js';
import { handleMcp } from './handlers/mcp.js';

export interface RouteContext {
  session: Session;
  transport: Transport;
  logger: pino.Logger;
}

/**
 * Route a validated inbound message to the appropriate handler.
 */
export async function routeMessage(
  message: InboundMessage,
  ctx: RouteContext,
): Promise<void> {
  switch (message.type) {
    case 'hello':
      await handleHello(message, ctx);
      break;
    case 'listen':
      await handleListen(message, ctx);
      break;
    case 'abort':
      await handleAbort(message, ctx);
      break;
    case 'ping':
      await handlePing(ctx);
      break;
    case 'goodbye':
      await handleGoodbye(message, ctx);
      break;
    case 'iot':
      await handleIot(message, ctx);
      break;
    case 'mcp':
      await handleMcp(message, ctx);
      break;
  }
}
