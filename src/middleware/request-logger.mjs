import { logger } from '../utils/logger.mjs';

export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const line = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
    if (res.statusCode >= 400) {
      logger.warn(line, { ip: req.ip });
    } else {
      logger.debug(line, { ip: req.ip });
    }
  });

  next();
}
