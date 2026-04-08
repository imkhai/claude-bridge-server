import crypto from 'crypto';
import { config } from '../config.mjs';
import { logger } from '../utils/logger.mjs';

export function authMiddleware(req, res, next) {
  // Skip auth for health checks and dashboard
  if (req.path === '/health') return next();
  if (req.path === '/api/telegram/webhook') return next();
  if (req.path.startsWith('/dashboard') || req.path.startsWith('/api/dashboard')) return next();

  // If no API_KEY configured, allow all (local dev mode)
  if (!config.API_KEY) return next();

  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  if (!timingSafeEqual(token, config.API_KEY)) {
    logger.warn(`Unauthorized request to ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against itself to maintain constant time regardless of length mismatch
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
