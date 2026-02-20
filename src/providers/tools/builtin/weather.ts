import { createGuardedFetch } from '../../endpoint-guard.js';
import type { ToolDefinition } from '../tool-registry.js';

/**
 * OpenWeatherMap weather tool.
 * Uses OpenWeatherMap (not QWeather) — no Chinese cloud dependency.
 */
export function createWeatherTool(apiKey: string): ToolDefinition {
  const guardedFetch = createGuardedFetch();

  return {
    name: 'weather',
    description: 'Get current weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name or coordinates' },
        units: { type: 'string', enum: ['metric', 'imperial'], description: 'Temperature units' },
      },
      required: ['location'],
    },
    handler: async (args) => {
      const location = args['location'] as string;
      const units = (args['units'] as string) ?? 'metric';

      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&units=${units}&appid=${apiKey}`;

      const response = await guardedFetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.status}`);
      }

      const data = await response.json() as {
        main: { temp: number; humidity: number };
        weather: { description: string }[];
        name: string;
      };

      return {
        location: data.name,
        temperature: data.main.temp,
        humidity: data.main.humidity,
        description: data.weather[0]?.description ?? 'unknown',
        units,
      };
    },
  };
}
