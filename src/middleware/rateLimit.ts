import rateLimit from 'express-rate-limit';

/** General REST traffic (per IP). */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

/** Order submission and cancels (per IP). */
export const ordersWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many order requests. Please slow down.' },
});
