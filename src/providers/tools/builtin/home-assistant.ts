import { createGuardedFetch } from '../../endpoint-guard.js';
import type { ToolDefinition } from '../tool-registry.js';

/**
 * Home Assistant integration tool.
 * Calls the Home Assistant REST API with validated URL.
 *
 * Note: Home Assistant URLs must be on localhost or explicitly allowlisted.
 */
export function createHomeAssistantTool(haUrl: string, haToken: string): ToolDefinition {
  const guardedFetch = createGuardedFetch();

  return {
    name: 'home_assistant',
    description: 'Control Home Assistant entities (lights, switches, etc.)',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Entity domain (light, switch, climate, etc.)' },
        service: { type: 'string', description: 'Service to call (turn_on, turn_off, toggle, etc.)' },
        entity_id: { type: 'string', description: 'Entity ID (e.g., light.living_room)' },
        data: { type: 'object', description: 'Additional service data (brightness, temperature, etc.)' },
      },
      required: ['domain', 'service', 'entity_id'],
    },
    handler: async (args) => {
      const domain = args['domain'] as string;
      const service = args['service'] as string;
      const entityId = args['entity_id'] as string;
      const data = args['data'] as Record<string, unknown> | undefined;

      const url = `${haUrl}/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`;

      const response = await guardedFetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${haToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entity_id: entityId,
          ...data,
        }),
      });

      if (!response.ok) {
        throw new Error(`Home Assistant API error: ${response.status}`);
      }

      return { success: true, entity_id: entityId, service: `${domain}.${service}` };
    },
  };
}
