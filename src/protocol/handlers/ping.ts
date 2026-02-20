import type { RouteContext } from '../router.js';

/**
 * Handle ping keepalive — respond with pong.
 */
export async function handlePing(ctx: RouteContext): Promise<void> {
  ctx.session.touchActivity();
  await ctx.transport.sendText(JSON.stringify({ type: 'pong' }));
}
