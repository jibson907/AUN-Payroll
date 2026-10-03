/**
 * pdfService.js — render pay-advice HTML to a PDF using headless Chromium.
 * A single browser instance is reused across a payroll run for speed.
 * PDFs are rendered in memory only — never written to disk — and are only
 * reachable through authenticated routes or as the employee's email attachment.
 */
const fs = require('fs');
const path = require('path');
const { renderPayAdviceHtml } = require('../templates/payAdviceTemplate');
const logger = require('../utils/logger');

let puppeteer;
try {
  // eslint-disable-next-line global-require
  puppeteer = require('puppeteer');
} catch (_) {
  puppeteer = null;
}

let logoDataUri = null;
function getLogo() {
  if (logoDataUri !== null) return logoDataUri;
  try {
    const p = path.join(__dirname, '..', 'assets', 'aun-logo.png');
    const b = fs.readFileSync(p);
    logoDataUri = `data:image/png;base64,${b.toString('base64')}`;
  } catch (e) {
    logoDataUri = '';
  }
  return logoDataUri;
}

// One shared headless browser. If it dies (crash, OS sleep, killed process)
// it is detected and relaunched — a dead browser must never be reused, or
// every PDF would fail until the server restarts.
let browserPromise = null;
async function getBrowser() {
  if (!puppeteer) throw new Error('PDF engine (puppeteer) is not installed. Run `npm install` in backend/.');
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing && existing.connected) return existing;
    browserPromise = null;
  }
  const opts = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  };
  // Allow pointing at a system Chromium (e.g. in slim Docker images).
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const launching = puppeteer.launch(opts).then((b) => {
    b.on('disconnected', () => {
      if (browserPromise === launching) browserPromise = null;
      logger.warn('pdf_browser_disconnected');
    });
    return b;
  });
  browserPromise = launching;
  launching.catch(() => { if (browserPromise === launching) browserPromise = null; });
  return launching;
}

async function closeBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (p) {
    const b = await p.catch(() => null);
    if (b) await b.close().catch(() => {});
  }
}

// Errors meaning "the browser/page went away" — worth one retry on a fresh browser.
const BROWSER_GONE = /Protocol error|Connection closed|Target closed|Session closed|browser has disconnected|detached Frame/i;

async function renderOnce(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    const bytes = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: true, timeout: 30000,
    });
    // Puppeteer ≥22 returns a Uint8Array; Express/Nodemailer expect a Buffer.
    return Buffer.from(bytes);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Render advice -> PDF buffer (relaunches the browser once if it had died). */
async function renderToBuffer(advice, period) {
  const html = renderPayAdviceHtml(advice, period, getLogo());
  try {
    return await renderOnce(html);
  } catch (e) {
    if (!BROWSER_GONE.test(String(e && e.message))) throw e;
    logger.warn('pdf_browser_restart', { reason: String(e.message).slice(0, 120) });
    await closeBrowser();
    return renderOnce(html);
  }
}

/** Keep letters (any language), digits, spaces, . - ' ; drop everything else. */
const readable = (s, max) => String(s || '').normalize('NFC')
  .replace(/[^\p{L}\p{M}\p{N} .'-]+/gu, ' ').replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim().slice(0, max);

/** "<Employee Name> Pay Advice for June 2026.pdf" */
function adviceFilename(employee, period) {
  const name = readable(employee.name, 120) || 'Employee';
  const p = readable(period, 40);
  return `${name} Pay Advice for ${p}.pdf`;
}

/** ASCII-only fallback for HTTP headers (the UTF-8 name goes in filename*). */
function asciiFilename(filename) {
  return filename.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'Pay Advice.pdf';
}

module.exports = {
  renderToBuffer, adviceFilename, asciiFilename, closeBrowser, getBrowser,
};
