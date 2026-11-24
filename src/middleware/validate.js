const { badRequest } = require('../utils/httpError');

/*
 * A small, dependency-free validator.
 *
 * A schema maps each field to a rule:
 *   { type: 'string' | 'int' | 'number' | 'boolean' | 'email' | 'date' | 'datetime' | 'enum',
 *     required, min, max, values, nullable }
 * For strings, min/max are lengths; for numbers they are values.
 *
 * Unknown fields are dropped, so a client can never set columns like `role_id` or `closed_at`
 * by adding them to the request body. The cleaned values replace req.body.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRealDate(str) {
  // Parse as UTC so the calendar date cannot shift with the server's time zone.
  // Rejects impossible dates such as 2026-02-30, which Date would silently roll over.
  if (/Z$/.test(str)) return !Number.isNaN(new Date(str).getTime());
  const iso = str.length === 10 ? `${str}T00:00:00Z` : `${str.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str.slice(0, 10);
}

function checkField(name, value, rule) {
  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') return `${name} must be text`;
      const v = value.trim();
      if (rule.min !== undefined && v.length < rule.min) return `${name} must be at least ${rule.min} characters`;
      if (rule.max !== undefined && v.length > rule.max) return `${name} must be at most ${rule.max} characters`;
      return { value: v };
    }
    case 'email': {
      if (typeof value !== 'string' || !EMAIL_RE.test(value.trim()) || value.length > 255) return `${name} must be a valid email address`;
      return { value: value.trim().toLowerCase() };
    }
    case 'int':
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return `${name} must be a number`;
      if (rule.type === 'int' && !Number.isInteger(n)) return `${name} must be a whole number`;
      if (rule.min !== undefined && n < rule.min) return `${name} must be at least ${rule.min}`;
      if (rule.max !== undefined && n > rule.max) return `${name} must be at most ${rule.max}`;
      return { value: n };
    }
    case 'boolean':
      if (typeof value !== 'boolean') return `${name} must be true or false`;
      return { value };
    case 'enum':
      if (!rule.values.includes(value)) return `${name} must be one of: ${rule.values.join(', ')}`;
      return { value };
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value) || !isRealDate(value)) return `${name} must be a date (YYYY-MM-DD)`;
      return { value };
    case 'datetime': {
      if (typeof value !== 'string' || !DATETIME_RE.test(value) || !isRealDate(value)) return `${name} must be a date and time (YYYY-MM-DDTHH:mm)`;
      // Store as MySQL DATETIME text: 'YYYY-MM-DD HH:mm:ss'
      const d = new Date(/Z$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
      return { value: d.toISOString().slice(0, 19).replace('T', ' ') };
    }
    default:
      throw new Error(`Unknown rule type ${rule.type}`);
  }
}

/**
 * @param schema field rules
 * @param options.partial true for PATCH: every field becomes optional, but at least one is needed
 * @param options.source 'body' (default) or 'query'
 */
function validate(schema, { partial = false, source = 'body' } = {}) {
  return (req, res, next) => {
    const input = req[source] || {};
    if (source === 'body' && (typeof input !== 'object' || Array.isArray(input))) {
      return next(badRequest('Request body must be a JSON object'));
    }

    const errors = [];
    const clean = {};

    for (const [name, rule] of Object.entries(schema)) {
      const value = input[name];
      const missing = value === undefined || value === '' || (value === null && !rule.nullable);

      if (value === null && rule.nullable) {
        clean[name] = null;
        continue;
      }
      if (missing) {
        if (rule.required && !partial) errors.push({ field: name, message: `${name} is required` });
        continue;
      }
      const result = checkField(name, value, rule);
      if (typeof result === 'string') errors.push({ field: name, message: result });
      else clean[name] = result.value;
    }

    if (partial && errors.length === 0 && Object.keys(clean).length === 0) {
      errors.push({ field: null, message: `Provide at least one of: ${Object.keys(schema).join(', ')}` });
    }
    if (errors.length) return next(badRequest('Validation failed', errors));

    if (source === 'body') req.body = clean;
    else req.validQuery = clean;
    next();
  };
}

/** Reject non-numeric or non-positive :id style params with 400 instead of letting them reach SQL. */
function validateIdParam(...names) {
  return (req, res, next) => {
    for (const name of names) {
      const raw = req.params[name];
      if (!/^[1-9]\d{0,9}$/.test(raw)) {
        return next(badRequest('Validation failed', [{ field: name, message: `${name} must be a positive whole number` }]));
      }
      req.params[name] = Number(raw);
    }
    next();
  };
}

module.exports = { validate, validateIdParam };
