/**
 * xlsxGuard.js — validate an uploaded .xlsx BEFORE ExcelJS parses it.
 *
 * An .xlsx file is a ZIP archive, so it is checked as untrusted ZIP input:
 *  - must be a ZIP (not legacy .xls / encrypted OLE file / anything else)
 *  - bounded number of entries, no ZIP64, no encrypted entries
 *  - no path-traversal entry names, no macros / ActiveX
 *  - must contain the parts every real workbook has
 *  - ZIP-bomb defence: every entry is actually inflated with a hard output
 *    budget (declared sizes in the archive can lie, so they are not trusted)
 *
 * Throws an Error with status 400 and a user-friendly message on failure.
 */
const zlib = require('zlib');

const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNZIPPED = 100 * 1024 * 1024; // 100 MB across all parts
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function findEocd(buf) {
  // EOCD is 22 bytes + optional comment (≤ 65535) at the very end
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

function inspectXlsx(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad('The file is empty or not a valid .xlsx workbook.');

  if (buf.readUInt32BE(0) === 0xd0cf11e0) {
    // OLE compound file: legacy .xls, or a password-protected/encrypted workbook
    throw bad('This file is an old-format (.xls) or password-protected workbook. Remove any password and save it as .xlsx (Excel Workbook), then upload again.');
  }
  if (buf.readUInt32LE(0) !== SIG_LOCAL) throw bad('The file is not a valid .xlsx workbook.');

  const eocd = findEocd(buf);
  if (eocd < 0) throw bad('The workbook file is damaged (incomplete ZIP structure).');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw bad('The workbook uses an unsupported large-archive (ZIP64) format.');
  }
  if (entries === 0 || entries > MAX_ENTRIES) throw bad('The workbook structure is not valid (unexpected number of parts).');
  if (cdOffset + cdSize > eocd) throw bad('The workbook file is damaged (invalid directory).');

  const names = new Set();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw bad('The workbook file is damaged (invalid directory entry).');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const declaredSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) throw bad('The workbook is encrypted. Remove the password and upload again.');
    if (name.includes('..') || name.startsWith('/') || name.includes('\\') || /^[a-z]:/i.test(name)) {
      throw bad('The workbook contains an invalid internal file name.');
    }
    const lower = name.toLowerCase();
    if (lower.endsWith('vbaproject.bin') || lower.startsWith('xl/activex/')) {
      throw bad('Macro-enabled workbooks are not accepted. Save the file as a normal .xlsx (Excel Workbook) and upload again.');
    }
    names.add(name);
    if (name.endsWith('/')) continue; // directory entry — no data

    // locate the data via the local header (its lengths can differ from the directory's)
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw bad('The workbook file is damaged (invalid entry header).');
    }
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (start + compSize > buf.length) throw bad('The workbook file is damaged (truncated entry).');
    const data = buf.subarray(start, start + compSize);

    const budget = MAX_TOTAL_UNZIPPED - total;
    let size;
    if (method === 0) {
      size = compSize;
    } else if (method === 8) {
      try {
        size = zlib.inflateRawSync(data, { maxOutputLength: budget + 1 }).length;
      } catch (e) {
        if (e && e.code === 'ERR_BUFFER_TOO_LARGE') throw bad('The workbook expands to an unreasonable size and was rejected.');
        throw bad('The workbook file is damaged (could not be decompressed).');
      }
    } else {
      throw bad('The workbook uses an unsupported compression method.');
    }
    if (size !== declaredSize) throw bad('The workbook file is damaged (size mismatch).');
    total += size;
    if (total > MAX_TOTAL_UNZIPPED) throw bad('The workbook expands to an unreasonable size and was rejected.');
  }

  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
    throw bad('The file is not an Excel workbook (.xlsx).');
  }
  return { entries, unzippedBytes: total };
}

module.exports = { inspectXlsx, MAX_TOTAL_UNZIPPED, MAX_ENTRIES };
