import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import XLSX from 'xlsx';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scrapeOfficialLeaflets } from './leaflets.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const bookPath = path.join(dataDir, 'titck.xlsx');
const jsonPath = path.join(dataDir, 'medicines.json');
const metadataPath = path.join(dataDir, 'metadata.json');
const leafletsPath = path.join(dataDir, 'leaflets.json');
const sectionCachePath = path.join(dataDir, 'official-sections.json');
const sourcePage = process.env.TITCK_LIST_URL || 'https://titck.gov.tr/dinamikmodul/85';
const port = Number(process.env.PORT || 3000);
const records = [];
const sheetRecords = new Map();
let metadata = null;
let leafletIndex = null;
let leafletByBrand = new Map();
const sectionCache = new Map();
let refreshPromise = null;

const turkishFold = value => String(value ?? '').toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
const text = value => value === null || value === undefined ? '' : String(value).trim();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(v => v.trim()).filter(Boolean);

function extractListLink(html, pageUrl) {
  const $ = cheerio.load(html);
  const anchors = $('a[href]').toArray().map(anchor => {
    const href = $(anchor).attr('href');
    let url;
    try { url = new URL(href, pageUrl); } catch { return null; }
    if (!['http:', 'https:'].includes(url.protocol) || !/\.xlsx(?:$|\?)/i.test(url.href)) return null;
    const label = `${$(anchor).text()} ${$(anchor).closest('tr').text()}`;
    const dateMatch = label.match(/\b\d{2}[/.]\d{2}[/.]\d{4}\b/);
    return { url: url.href, label, date: dateMatch?.[0] || null };
  }).filter(Boolean);
  if (!anchors.length) throw new Error('TİTCK sayfasında XLSX bağlantısı bulunamadı. Kaynak sayfası veya bağlantı yapısı değişmiş olabilir.');
  // The official page lists releases newest-first. Choose the first workbook whose label
  // identifies the licensed human-medicine registry; retain the release label as provenance.
  return anchors.find(item => /ruhsatli.*beseri.*tibbi/.test(turkishFold(item.label))) || anchors[0];
}

async function downloadWorkbook() {
  await fs.mkdir(dataDir, { recursive: true });
  const getWithRetry = async (url, options, label) => {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        return await axios.get(url, options);
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const transient = !status || status === 408 || status === 425 || status === 429 || status >= 500;
        if (!transient || attempt === 4) break;
        const waitMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
        console.warn(`${label} isteği geçici olarak başarısız (deneme ${attempt}/4, HTTP ${status || 'ağ hatası'}); ${waitMs} ms sonra yeniden denenecek.`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
    throw lastError;
  };
  const page = await getWithRetry(sourcePage, { timeout: 30000, maxContentLength: 12 * 1024 * 1024, headers: { 'User-Agent': 'IlacRehberi/1.0 (TITCK public-list importer)' } }, 'TİTCK kaynak sayfası');
  const source = extractListLink(page.data, sourcePage);
  const response = await getWithRetry(source.url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: 100 * 1024 * 1024, headers: { 'User-Agent': 'IlacRehberi/1.0', Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }, 'TİTCK ilaç listesi');
  const buffer = Buffer.from(response.data);
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error('İndirilen dosya XLSX arşivi olarak doğrulanamadı.');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const foundSheets = new Map();
  const flat = [];
  for (const sheetName of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
    const headerIndex = matrix.findIndex((row, index) => index < 8 && row.some(cell => /^(ilac|urun) adi$/.test(turkishFold(text(cell)))));
    if (headerIndex < 0) continue;
    const headers = matrix[headerIndex].map(text);
    const normalized = matrix.slice(headerIndex + 1).filter(row => row.some(cell => text(cell))).map((row, i) => {
      const item = Object.create(null);
      headers.forEach((key, column) => { if (key) item[key] = text(row[column]); });
      const id = crypto.createHash('sha1').update(`${sheetName}:${i}:${JSON.stringify(item)}`).digest('hex').slice(0, 16);
      return { ...item, _sheet: sheetName, id };
    });
    foundSheets.set(sheetName, normalized);
    flat.push(...normalized);
  }
  if (!flat.length) throw new Error('XLSX dosyasında kayıtlı ürün satırı bulunamadı.');
  const temp = `${bookPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, buffer);
  await fs.rename(temp, bookPath);
  const nextMeta = { downloadedAt: new Date().toISOString(), sourceDateLabel: source.date, sourceLabel: source.label.trim().slice(0, 240), sourcePage, sourceFile: source.url, recordCount: flat.length, sheetCounts: Object.fromEntries([...foundSheets].map(([name, rows]) => [name, rows.length])), sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  const tempJson = `${jsonPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempJson, JSON.stringify(flat));
  await fs.rename(tempJson, jsonPath);
  await fs.writeFile(metadataPath, JSON.stringify(nextMeta, null, 2));
  records.splice(0, records.length, ...flat);
  sheetRecords.clear();
  for (const [name, rows] of foundSheets) sheetRecords.set(name, rows);
  metadata = nextMeta;
  console.log(`Loaded ${records.length} TİTCK workbook rows from ${source.date || source.url}`);
  return nextMeta;
}

async function loadSavedData() {
  try {
    const [saved, savedMeta] = await Promise.all([fs.readFile(jsonPath, 'utf8'), fs.readFile(metadataPath, 'utf8')]);
    const parsed = JSON.parse(saved), meta = JSON.parse(savedMeta);
    if (!Array.isArray(parsed) || !parsed.length) return false;
    records.splice(0, records.length, ...parsed);
    metadata = meta;
    for (const row of parsed) {
      const name = row._sheet || 'TİTCK kayıtları';
      if (!sheetRecords.has(name)) sheetRecords.set(name, []);
      sheetRecords.get(name).push(row);
    }
    return true;
  } catch { return false; }
}

function productName(row) {
  for (const [key, value] of Object.entries(row)) if (/^(ilac|urun) adi$/.test(turkishFold(key)) && text(value)) return text(value);
  return Object.entries(row).find(([key, value]) => !key.startsWith('_') && /^(ilac|urun) /.test(turkishFold(key)) && /ad[ıi]$/.test(turkishFold(key)) && text(value))?.[1] || '';
}
function activeSheet(sheet) { return /aktif|piyasada|satista/i.test(turkishFold(sheet)); }
function getFields(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('_') || key === 'id' || value === '') continue;
    out[key] = value;
  }
  return out;
}
function productPayload(row) {
  return { id: row.id, name: productName(row), sheet: row._sheet, active: activeSheet(row._sheet || ''), fields: getFields(row), officialDocs: matchOfficialDocuments(row) };
}

function cleanProductTokens(value) {
  return turkishFold(value).replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:adet|tablet|tbl|kapsul|kaps|flakon|ampul|sase|saşe|g|gr|gram|ml|l|litre|doz|puf|saat)\b/g, ' ')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ').split(/\s+/)
    .filter(token => token.length > 1 && !['ve', 'ile', 'icin', 'jel', 'krem', 'tablet', 'film', 'cozelti', 'surup', 'damla', 'merhem'].includes(token));
}

function matchOfficialDocuments(row) {
  const products = leafletIndex?.documents || [];
  if (!products.length) return [];
  const name = productName(row);
  const nameTokens = cleanProductTokens(name);
  const productIngredient = cleanProductTokens(Object.entries(row).filter(([key]) => /etkin|etken madde/i.test(turkishFold(key))).map(([, value]) => value).join(' '));
  const productFirm = turkishFold(Object.entries(row).find(([key]) => /firma|ruhsat sahibi/i.test(turkishFold(key)))?.[1] || '');
  if (!nameTokens.length) return [];
  const candidates = leafletByBrand.get(nameTokens[0]) || products.filter(document => cleanProductTokens(document.name)[0] === nameTokens[0]);
  return candidates.map(document => {
    const docTokens = cleanProductTokens(document.name);
    const first = nameTokens[0];
    if (!docTokens.includes(first)) return null;
    const overlap = nameTokens.filter(token => docTokens.includes(token)).length / Math.max(nameTokens.length, docTokens.length, 1);
    const productStrengths = name.match(/\d+(?:[.,]\d+)?\s*(?:%|mg|mcg|g|iu|ml)\b/gi) || [];
    const documentStrengths = document.name.match(/\d+(?:[.,]\d+)?\s*(?:%|mg|mcg|g|iu|ml)\b/gi) || [];
    const strengthsMatch = !productStrengths.length || productStrengths.every(value => documentStrengths.some(other => turkishFold(other).replace(/\s/g, '') === turkishFold(value).replace(/\s/g, '')));
    const ingredientTokens = cleanProductTokens(document.activeIngredient);
    const ingredientMatch = productIngredient.length > 0 && productIngredient.some(token => ingredientTokens.includes(token));
    const firmMatch = productFirm && turkishFold(document.firm || '').split(/\s+/).some(token => token.length > 3 && productFirm.includes(token));
    let score = overlap * 0.72 + (ingredientMatch ? 0.18 : 0) + (firmMatch ? 0.10 : 0);
    if (nameTokens.join(' ') === docTokens.join(' ')) score = Math.max(score, 0.98);
    if (!strengthsMatch) score = 0;
    if (overlap < 0.55) return null;
    return { name: document.name, activeIngredient: document.activeIngredient, firm: document.firm, kubDate: document.kubDate, ktDate: document.ktDate, kubUrl: document.kubUrl, ktUrl: document.ktUrl, score: Math.min(1, score), confidence: score >= 0.85 ? 'high' : score >= 0.7 ? 'medium' : 'low' };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 2);
}

function indexOfficialDocuments(index) {
  leafletIndex = index;
  leafletByBrand = new Map();
  for (const document of index?.documents || []) {
    const brand = cleanProductTokens(document.name)[0];
    if (!brand) continue;
    if (!leafletByBrand.has(brand)) leafletByBrand.set(brand, []);
    leafletByBrand.get(brand).push(document);
  }
}

async function refreshOfficialIndex() {
  const next = await scrapeOfficialLeaflets();
  const temp = `${leafletsPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next));
  await fs.rename(temp, leafletsPath);
  indexOfficialDocuments(next);
  console.log(`Loaded ${next.documents.length} official TİTCK KÜB/KT documents.`);
  return next;
}

async function loadSavedOfficialIndex() {
  try {
    const saved = JSON.parse(await fs.readFile(leafletsPath, 'utf8'));
    if (!Array.isArray(saved.documents) || saved.documents.length < 100) return false;
    indexOfficialDocuments(saved);
    return true;
  } catch { return false; }
}

async function loadSavedSections() {
  try {
    const saved = JSON.parse(await fs.readFile(sectionCachePath, 'utf8'));
    if (!saved || typeof saved !== 'object') return false;
    for (const [key, value] of Object.entries(saved)) sectionCache.set(key, value);
    return true;
  } catch { return false; }
}

async function extractPdfText(url) {
  if (!url || !/^https:\/\/((www\.)?titck\.gov\.tr)\//i.test(url)) throw new Error('Resmî olmayan belge adresi reddedildi.');
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 45000, maxContentLength: 25 * 1024 * 1024, headers: { 'User-Agent': 'IlacRehberi/1.0 (official leaflet reader)', Accept: 'application/pdf' } });
  const bytes = Buffer.from(response.data);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('TİTCK belgesi PDF olarak doğrulanamadı.');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 120); pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = new Map();
      for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        const y = Math.round(item.transform?.[5] || 0);
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y).push({ x: item.transform?.[4] || 0, text: item.str });
      }
      pages.push([...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')).join('\n'));
      page.cleanup();
    }
    return pages.join('\n');
  } finally { await pdf.destroy(); }
}

function numberedSections(source, pattern) {
  const textValue = source.replace(/\r/g, '').replace(/[\u00a0\t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  const markers = [...textValue.matchAll(pattern)];
  const result = {};
  markers.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < markers.length ? markers[index + 1].index : textValue.length;
    result[match[1]] = textValue.slice(start, end).trim().slice(0, 12000);
  });
  return result;
}

function parseOfficialSections(kubText, ktText) {
  const kub = numberedSections(kubText, /^\s*(4\.(?:1|2|3|4|5|6|8)|6\.1)\.?\s+[^\n]*$/gm);
  const kt = numberedSections(ktText, /^\s*([1-6])\.?\s+[^\n]*$/gm);
  return {
    purpose: kub['4.1'] || kt['1'] || '', usage: kt['3'] || kub['4.2'] || '',
    contraindications: kub['4.3'] || '', warnings: kub['4.4'] || kt['2'] || '',
    interactions: kub['4.5'] || '', pregnancy: kub['4.6'] || '',
    sideEffects: kub['4.8'] || kt['4'] || '', excipients: kub['6.1'] || '',
    ktBeforeUse: kt['2'] || '', storage: kt['5'] || ''
  };
}

async function getOfficialInfo(row) {
  const matches = matchOfficialDocuments(row);
  const document = matches.find(item => item.score >= 0.7);
  if (!document) return { status: 'unmatched', officialSearchUrl: 'https://titck.gov.tr/kubkt', note: 'Ürün ile resmî KÜB/KT kaydı yeterli güvenle eşleştirilemedi; benzer adlı başka bir ilacın belgesi kullanılmadı.' };
  const cacheKey = crypto.createHash('sha256').update(`${document.kubUrl || ''}|${document.ktUrl || ''}`).digest('hex');
  if (sectionCache.has(cacheKey)) return sectionCache.get(cacheKey);
  let kubText = '', ktText = '';
  if (document.kubUrl) kubText = await extractPdfText(document.kubUrl);
  if (document.ktUrl) ktText = await extractPdfText(document.ktUrl);
  const info = { status: 'matched', matchConfidence: document.confidence, matchedDocument: document.name, activeIngredient: document.activeIngredient, firm: document.firm, kubDate: document.kubDate, ktDate: document.ktDate, kubUrl: document.kubUrl, ktUrl: document.ktUrl, sections: parseOfficialSections(kubText, ktText), source: 'TİTCK KÜB/KT' };
  sectionCache.set(cacheKey, info);
  try { await fs.writeFile(sectionCachePath, JSON.stringify(Object.fromEntries(sectionCache))); } catch {}
  return info;
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', dataLoaded: records.length > 0, recordCount: records.length, lastUpdate: metadata?.downloadedAt || null, sourceDate: metadata?.sourceDateLabel || null, sourceDateLabel: metadata?.sourceDateLabel || null, officialDocumentCount: leafletIndex?.documents?.length || 0, officialDocumentIndexDate: leafletIndex?.fetchedAt || null }));
app.get('/api/stats', (_req, res) => {
  if (!records.length) return res.status(503).json({ error: 'İlaç verisi hazır değil.' });
  const sheets = Object.fromEntries([...sheetRecords].map(([name, rows]) => [name, { records: rows.length, active: activeSheet(name) }]));
  const activeCount = [...sheetRecords].filter(([name]) => activeSheet(name)).reduce((sum, [, rows]) => sum + rows.length, 0);
  res.json({ totalRecords: records.length, activeRecords: activeCount || null, sheets, metadata });
});
app.get('/api/sheets', (_req, res) => res.json({ sheets: [...sheetRecords].map(([name, rows]) => ({ name, count: rows.length, active: activeSheet(name) })), metadata }));
app.get('/api/medicines', (req, res) => {
  if (!records.length) return res.status(503).json({ error: 'İlaç verisi hazır değil.' });
  const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 50));
  const rows = req.query.status === 'active' ? records.filter(row => activeSheet(row._sheet || '')) : records;
  const start = (page - 1) * limit;
  res.json({ page, limit, total: rows.length, totalPages: Math.ceil(rows.length / limit), data: rows.slice(start, start + limit).map(productPayload) });
});
app.get('/api/medicines/search', (req, res) => {
  if (!records.length) return res.status(503).json({ error: 'İlaç verisi yükleniyor. Biraz sonra yeniden deneyin.' });
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));
  const kind = req.query.status === 'active' ? 'active' : 'all';
  if (q.length < 2) return res.status(400).json({ error: 'Arama için en az iki karakter girin.' });
  const query = turkishFold(q);
  const result = records.filter(row => {
    if (kind === 'active' && !activeSheet(row._sheet || '')) return false;
    return Object.entries(row).some(([key, value]) => key !== 'id' && turkishFold(value).includes(query));
  });
  const start = (page - 1) * limit;
  res.json({ query: q, page, limit, total: result.length, totalPages: Math.ceil(result.length / limit), data: result.slice(start, start + limit).map(productPayload) });
});
app.get('/api/medicines/:id/official-info', async (req, res) => {
  const requestedName = typeof req.query.name === 'string' ? turkishFold(req.query.name).trim() : '';
  const row = records.find(item => item.id === req.params.id) || (requestedName ? records.find(item => turkishFold(productName(item)).trim() === requestedName) : null);
  if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  try {
    const info = await getOfficialInfo(row);
    if (info.status === 'unmatched') return res.status(404).json(info);
    res.json(info);
  } catch (error) {
    console.error(`Official leaflet parse failed for ${req.params.id}: ${error.message}`);
    res.status(502).json({ error: 'TİTCK belgesi şu anda indirilemedi veya metne çevrilemedi.', officialSearchUrl: 'https://titck.gov.tr/kubkt' });
  }
});
app.get('/api/medicines/:id', (req, res) => {
  const row = records.find(item => item.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  res.json({ ...productPayload(row), metadata });
});
app.get('/api/metadata', (_req, res) => metadata ? res.json(metadata) : res.status(503).json({ error: 'Veri henüz yüklenmedi.' }));

async function refreshData() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = downloadWorkbook().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

if (process.argv.includes('--download-only')) {
  await refreshData();
} else if (process.argv.includes('--export-static')) {
  await refreshData();
  await refreshOfficialIndex();
  const outputPath = path.resolve(process.env.STATIC_CATALOG_PATH || path.join(root, '..', 'data', 'catalog.json'));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const payload = { metadata, officialLeafletSource: leafletIndex.sourceUrl, officialLeafletFetchedAt: leafletIndex.fetchedAt, products: records.map(productPayload) };
  const temp = `${outputPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(payload));
  await fs.rename(temp, outputPath);
  console.log(`Static catalog exported: ${payload.products.length} rows at ${outputPath}`);
} else {
  const loaded = await loadSavedData();
  if (!loaded) {
    try { await refreshData(); }
    catch (error) { console.error(`Initial TİTCK import failed: ${error.message}`); }
  }
  const indexLoaded = await loadSavedOfficialIndex();
  await loadSavedSections();
  if (!indexLoaded) {
    try { await refreshOfficialIndex(); }
    catch (error) { console.error(`Initial TİTCK KÜB/KT index import failed: ${error.message}`); }
  }
  app.listen(port, () => console.log(`İlaç Rehberi API listening on ${port}`));
  // Refresh both official indexes weekly; keep the last good snapshot on transient source failures.
  const refreshTimer = setInterval(() => {
    refreshData().catch(error => console.error(`Weekly TİTCK medicine update failed: ${error.message}`));
    refreshOfficialIndex().catch(error => console.error(`Weekly TİTCK KÜB/KT update failed: ${error.message}`));
  }, 7 * 24 * 60 * 60 * 1000);
  refreshTimer.unref();
}

