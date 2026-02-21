import type { FastifyRequest, FastifyReply } from 'fastify';
import { generateToken, verifyToken } from '../../utils/crypto.js';
import type { AuthConfig, ServerConfig } from '../../config/schema.js';
import { sanitizeDeviceId } from '../../utils/sanitize.js';

/**
 * OTA (Over-The-Air) authentication endpoint handler.
 *
 * The xiaozhi protocol uses an OTA HTTP endpoint to authenticate devices
 * and get WebSocket connection parameters. This is the first step in the
 * device connection flow.
 *
 * POST /api/ota with device MAC/ID → get auth token + WebSocket URL
 */
export function createOtaHandler(authConfig: AuthConfig, serverConfig: ServerConfig) {
  return async function otaHandler(
    request: FastifyRequest<{
      Body: { mac_address?: string; device_id?: string; board?: string; app_version?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const body = request.body ?? {};
    const rawDeviceId = body.mac_address ?? body.device_id;

    if (!rawDeviceId) {
      reply.status(400).send({
        error: 'missing_device_id',
        message: 'mac_address or device_id is required',
      });
      return;
    }

    const deviceId = sanitizeDeviceId(rawDeviceId);
    if (!deviceId) {
      reply.status(400).send({
        error: 'invalid_device_id',
        message: 'Device ID contains invalid characters',
      });
      return;
    }

    // Derive WebSocket URL from the request's Host header so it works
    // regardless of bind address (0.0.0.0, 127.0.0.1, LAN IP, etc.)
    // Respect X-Forwarded-Proto from reverse proxies (e.g. Tailscale Serve)
    const host = request.headers.host ?? `localhost:${serverConfig.port}`;
    const forwardedProto = request.headers['x-forwarded-proto'];
    const isTls = serverConfig.tlsCert || forwardedProto === 'https';
    const wsProtocol = isTls ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${host}/ws`;

    const token = generateToken(authConfig.secret, deviceId, authConfig.tokenTtlSeconds);

    reply.send({
      server_url: wsUrl,
      token,
      device_id: deviceId,
    });
  };
}

/**
 * Verify a token from a WebSocket connection URL query string.
 * Returns the device ID or null.
 */
export function verifyWsToken(authSecret: string, url: string): string | null {
  try {
    const parsed = new URL(url, 'http://localhost');
    const token = parsed.searchParams.get('token');
    if (!token) return null;
    return verifyToken(authSecret, token);
  } catch {
    return null;
  }
}
