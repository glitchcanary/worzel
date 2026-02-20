import type { IotMessage } from '../types.js';
import type { RouteContext } from '../router.js';

/**
 * Handle IoT device descriptor updates.
 *
 * Devices send IoT descriptors to advertise their capabilities
 * (lights, sensors, switches, etc.) and methods that can be called.
 * These get registered as LLM function calling tools.
 */
export async function handleIot(
  message: IotMessage,
  ctx: RouteContext,
): Promise<void> {
  const { session, logger } = ctx;

  if (message.descriptors) {
    logger.info({
      sessionId: session.id,
      descriptorCount: message.descriptors.length,
      names: message.descriptors.map(d => d.name),
    }, 'IoT descriptors received');

    // Store descriptors on the session for tool registration
    // The McpBridge will register these as callable tools
    (session as any).iotDescriptors = message.descriptors;
  }

  if (message.update) {
    logger.info({
      sessionId: session.id,
      update: message.update,
    }, 'IoT state update received');
  }
}
