const { rateLimit } = require('express-rate-limit');
const config = require('../config/env');

/*
 * Per-IP limits for the public authentication endpoints.
 * The client IP comes from req.ip, which is correct behind Render's proxy because app.js sets
 * `trust proxy` to exactly one hop. Counters are kept in memory, which suits a single instance.
 */

const tooMany = (message) => (req, res, next, options) =>
  res.status(options.statusCode).json({ error: { code: 'RATE_LIMITED', message } });

/** Failed logins only: successful sign-ins never count, so reviewers sharing one office IP are not locked out. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.rateLimit.loginMax,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany('Too many failed sign-in attempts. Please wait 15 minutes and try again.'),
});

/** Every registration attempt counts, to stop automated account creation. */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimit.registerMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany('Too many accounts created from this network. Please try again in an hour.'),
});

module.exports = { loginLimiter, registerLimiter };
