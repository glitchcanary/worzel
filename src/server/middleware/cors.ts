import type { CorsConfig } from '../../config/schema.js';

/**
 * Build Fastify CORS options from our config.
 * Default: no origins allowed (must be explicitly configured).
 */
export function buildCorsOptions(config: CorsConfig) {
  return {
    origin: config.allowedOrigins.length > 0
      ? config.allowedOrigins
      : false, // No CORS at all by default
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86400,
  };
}
