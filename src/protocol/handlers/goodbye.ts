import type { GoodbyeMessage } from '../types.js';
import type { RouteContext } from '../router.js';

/**
 * Handle graceful disconnect.
 */
export async function handleGoodbye(
  message: GoodbyeMessage,
  ctx: RouteContext,
): Promise<void> {
  const { session, transport, logger } = ctx;

  logger.info({
    sessionId: session.id,
    reason: message.reason,
  }, 'Client goodbye');

  await transport.sendText(JSON.stringify({
    type: 'goodbye',
    reason: 'server_ack',
  }));

  transport.close();
}
