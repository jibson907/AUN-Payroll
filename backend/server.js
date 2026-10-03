/**
 * AUN Payroll server (Node/Express + MongoDB Atlas).
 *
 * Development: API only (the React app runs on the Vite dev server).
 * Production:  API + the built React app from the SAME origin
 *              (frontend/dist), behind an HTTPS reverse proxy.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const logger = require('./utils/logger');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const db = require('./models/db');
const { redact } = require('./config/mongo');
const pdf = require('./services/pdfService');
const payroll = require('./services/payrollService');

async function bootstrap() {
  env.assertSecrets();

  // ensure the log folder exists (uploads and PDFs are never written to disk)
  fs.mkdirSync(env.LOG_DIR, { recursive: true });

  // Connect to MongoDB Atlas, build collections + indexes. If the database is
  // unreachable (network, firewall, Atlas IP allow-list) keep retrying instead
  // of crashing — the server comes up by itself as soon as it can connect.
  // Configuration errors (bad URI / wrong password) are fatal: retrying won't help.
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.bootstrap();
      logger.info('db_ready', { db: 'mongodb' });
      break;
    } catch (e) {
      const msg = redact(e.message);
      const fatal = /MONGODB_URI|bad auth|Authentication failed|not a valid mongodb/i.test(msg);
      logger.error('db_bootstrap_failed', { attempt, error: msg });
      // eslint-disable-next-line no-console
      console.error(`\n  ✗ Database error (attempt ${attempt}): ${msg}`);
      if (fatal) {
        console.error('    Fix MONGODB_URI (username/password) in backend/.env, then restart.\n');
        process.exit(1);
      }
      console.error('    Check your internet connection and Atlas → Network Access (current IP allowed).');
      console.error('    Some networks block port 27017. Retrying in 10 seconds…\n');
      // eslint-disable-next-line no-await-in-loop
      await db.disconnect().catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  // jobs run in-process: settle anything a previous crash/restart interrupted
  await payroll.recoverInterruptedJobs();

  const app = express();
  app.disable('x-powered-by');
  // Only trust X-Forwarded-For from a real reverse proxy (TRUST_PROXY hops);
  // otherwise clients could spoof their IP and dodge the rate limits.
  app.set('trust proxy', env.TRUST_PROXY);

  // Some hosts (cPanel/Passenger, proxies) forward /payrol/api/… unchanged,
  // others strip the sub-path and forward /api/…. Accept both.
  if (env.BASE_PATH) {
    app.use((req, res, next) => {
      if (req.url !== env.BASE_PATH && !req.url.startsWith(`${env.BASE_PATH}/`) && !req.url.startsWith(`${env.BASE_PATH}?`)) {
        req.url = env.BASE_PATH + req.url;
      }
      next();
    });
  }

  // Security headers. The CSP allows only this origin: no inline scripts, no
  // third-party content. `blob:` frames are needed for the in-app PDF preview.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // React inline style attributes
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(env.COOKIE_SECURE ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Under a sub-path of a shared domain, don't impose HSTS on its subdomains —
    // that is the main site's decision, not this app's.
    strictTransportSecurity: env.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: !env.BASE_PATH } : false,
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
  }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });

  // Cookie-based sessions: explicit origins only (validated at boot), with
  // credentials. X-CSRF-Token is the only custom request header allowed.
  app.use(cors({
    origin: env.FRONTEND_URL.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Background'],
  }));
  // JSON only (no urlencoded form bodies — the classic cross-site form vector);
  // file uploads are handled separately by multer.
  app.use(express.json({ limit: '100kb' }));

  // Everything (API + web app) lives under BASE_PATH, e.g. /payrol/api/…
  const site = express.Router();

  // Payroll data must never be stored by browsers or proxies.
  site.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // general API rate limit (login/upload/send have their own stricter limits)
  site.use('/api', rateLimit({
    windowMs: 60 * 1000, limit: 400, standardHeaders: true, legacyHeaders: false,
  }));

  site.use('/api', routes);
  site.use('/api', notFound);

  // Production: serve the built React app from the same origin.
  const dist = env.FRONTEND_DIST;
  const indexFile = path.join(dist, 'index.html');
  if (env.SERVE_FRONTEND && fs.existsSync(indexFile)) {
    // The build bakes in its base path; a mismatch would load a blank page.
    if (!fs.readFileSync(indexFile, 'utf8').includes(`src="${env.BASE_PATH}/assets/`)) {
      logger.warn('frontend_base_path_mismatch', {
        basePath: env.BASE_PATH || '/',
        advice: `Rebuild the frontend with BASE_PATH=${env.BASE_PATH} (see README).`,
      });
    }
    site.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    site.use(express.static(dist, { index: false, maxAge: '1h' }));
    // client-side routes (/, /history/…) → index.html, never cached
    site.get(/^\/(?!api\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
    logger.info('serving_frontend', { dist, basePath: env.BASE_PATH || '/' });
  } else if (env.SERVE_FRONTEND) {
    logger.warn('frontend_not_built', { dist, advice: 'Run "npm run build" in the project root.' });
  }

  app.use(env.BASE_PATH || '/', site);
  app.use(errorHandler);

  const server = app.listen(env.PORT, () => {
    logger.info('server_started', { port: env.PORT, env: env.NODE_ENV });
    // eslint-disable-next-line no-console
    console.log(`\n  AUN Payroll  →  http://localhost:${env.PORT}${env.BASE_PATH}${env.SERVE_FRONTEND ? '/' : '/api/health'}`);
    console.log('  Database: MongoDB Atlas (connected)');
    console.log(`  Email: ${env.SMTP_HOST && env.SMTP_PASSWORD ? `${env.SMTP_USER} via ${env.SMTP_HOST}` : 'NOT CONFIGURED (sending disabled)'}`);
    console.log(`  Mode: ${env.NODE_ENV}${env.SERVE_FRONTEND ? ' (serving the web app)' : ''}\n`);
  });
  // Long uploads/PDF renders are fine; idle/slow-loris connections are not.
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;

  // graceful shutdown: stop accepting requests, close DB + PDF browser
  const shutdown = (signal) => {
    logger.info('shutdown', { signal });
    server.close(async () => {
      await Promise.allSettled([db.disconnect(), pdf.closeBrowser()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  ['SIGINT', 'SIGTERM'].forEach((s) => process.once(s, () => shutdown(s)));
  process.on('unhandledRejection', (e) => logger.error('unhandled_rejection', { error: redact(String(e && e.message)) }));
}

bootstrap().catch((e) => {
  logger.error('fatal', { error: redact(e.message) });
  process.exit(1);
});
