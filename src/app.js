const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config/env');
const { pool } = require('./config/db');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { publicDemoInfo } = require('./middleware/demo');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's HTTPS proxy: trust X-Forwarded-* from one hop

// Security headers. The frontend uses only same-origin scripts and styles, so a strict CSP works.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);

// Request logging: concise coloured lines in development, Apache "combined" format in production.
if (!config.isTest) app.use(morgan(config.isProduction ? 'combined' : 'dev'));

// Optional CORS for a frontend hosted on a different domain (not needed when Express serves /public).
if (config.corsOrigins.length) {
  app.use('/api', (req, res, next) => {
    const origin = req.get('Origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
}

app.use(express.json({ limit: '100kb' }));

/** GET /api/health: used by Render's health check and uptime monitors. Checks the database too. */
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/machines', require('./routes/machines'));
app.use('/api/work-orders', require('./routes/workOrders'));
app.use('/api/downtime', require('./routes/downtime'));
app.use('/api/energy', require('./routes/energy'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/production-lines', require('./routes/productionLines'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/users', require('./routes/users'));

/** Public list of lines for the self-registration form (codes and names only). */
app.get('/api/public/production-lines', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT id, code, name FROM production_lines ORDER BY code');
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

/** Public demo details for the login page: { enabled: false } unless DEMO_MODE=true. */
app.get('/api/public/demo', (req, res) => {
  res.json({ data: publicDemoInfo() });
});

app.use('/api', notFoundHandler);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use(errorHandler);

module.exports = app;
