import type pino from 'pino';
import type { SessionConfig } from '../config/schema.js';
import { Session } from './session.js';

/**
 * Manages all active sessions. Enforces idle timeouts and max concurrent sessions.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private idleCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: SessionConfig,
    private readonly logger: pino.Logger,
  ) {}

  /** Start the idle session reaper */
  start(): void {
    // Check for idle sessions every 30 seconds
    this.idleCheckInterval = setInterval(() => this.reapIdleSessions(), 30_000);
  }

  /** Stop the reaper and destroy all sessions */
  stop(): void {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
    for (const session of this.sessions.values()) {
      session.destroy();
    }
    this.sessions.clear();
  }

  /** Create a new session for a device. Returns null if at max capacity. */
  create(deviceId: string): Session | null {
    // Check if device already has a session
    const existing = this.getByDeviceId(deviceId);
    if (existing) {
      this.logger.info({ deviceId, sessionId: existing.id }, 'Replacing existing session for device');
      this.destroy(existing.id);
    }

    // Check capacity
    if (this.sessions.size >= this.config.maxConcurrentSessions) {
      this.logger.warn({ maxSessions: this.config.maxConcurrentSessions }, 'Max concurrent sessions reached');
      return null;
    }

    const session = new Session(deviceId);
    this.sessions.set(session.id, session);
    this.logger.info({ sessionId: session.id, deviceId }, 'Session created');
    return session;
  }

  /** Get a session by ID */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Get a session by device ID */
  getByDeviceId(deviceId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.deviceId === deviceId) return session;
    }
    return undefined;
  }

  /** Destroy a session */
  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.destroy();
      this.sessions.delete(sessionId);
      this.logger.info({ sessionId, deviceId: session.deviceId }, 'Session destroyed');
    }
  }

  /** Current number of active sessions */
  get count(): number {
    return this.sessions.size;
  }

  /** Reap sessions that have been idle too long */
  private reapIdleSessions(): void {
    const timeoutMs = this.config.idleTimeoutSeconds * 1000;
    for (const [sessionId, session] of this.sessions) {
      if (session.isIdle(timeoutMs)) {
        this.logger.info({ sessionId, deviceId: session.deviceId }, 'Reaping idle session');
        session.destroy();
        this.sessions.delete(sessionId);
      }
    }
  }
}
