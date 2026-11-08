import axios from 'axios';
import * as cheerio from 'cheerio';

const sourceUrl = 'https://www.titck.gov.tr/kubkt';
const dataUrl = 'https://www.titck.gov.tr/getkubktviewdatatable';
const columns = ['name', 'element', 'firmName', 'confirmationDateKub', 'confirmationDateKt', 'documentPathKub', 'documentPathKt'];

function csrfToken(html) {
  const match = html.match(/_token\s*:\s*['"]([^'"]+)['"]/i);
  if (!match) throw new Error('TİTCK KÜB/KT sayfasında güvenlik anahtarı bulunamadı.');
  return match[1];
}

function pdfUrl(markup) {
  const $ = cheerio.load(markup || '');
  const href = $('a[href]').map((_, anchor) => $(anchor).attr('href')).get().find(value => /\.pdf(?:$|[?#])/i.test(value || ''));
  if (!href) return null;
  try {
    const url = new URL(href.replace(/\\\//g, '/'), sourceUrl);
    return url.protocol === 'https:' && ['titck.gov.tr', 'www.titck.gov.tr'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function requestBody(token, start, length) {
  const body = new URLSearchParams({
    draw: String(Math.floor(start / length) + 1), start: String(start), length: String(length),
    '_token': token, 'search[value]': '', 'search[regex]': 'false',
    'order[0][column]': '0', 'order[0][dir]': 'asc'
  });
  columns.forEach((name, index) => {
    body.set(`columns[${index}][data]`, name);
    body.set(`columns[${index}][name]`, '');
    body.set(`columns[${index}][searchable]`, 'true');
    body.set(`columns[${index}][orderable]`, 'true');
    body.set(`columns[${index}][search][value]`, '');
    body.set(`columns[${index}][search][regex]`, 'false');
  });
  return body.toString();
}

async function fetchPage(client, token, cookies, start, length) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await client.post(dataUrl, requestBody(token, start, length), {
        timeout: 60000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': sourceUrl,
          'Origin': 'https://www.titck.gov.tr',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          ...(cookies ? { Cookie: cookies } : {})
        }
      });
      if (!Array.isArray(response.data?.data)) throw new Error('TİTCK KÜB/KT tablosu beklenen kayıt biçimini döndürmedi.');
      return response.data;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const transient = !status || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!transient || attempt === 4) break;
      const wait = Math.min(12000, 1000 * 2 ** (attempt - 1));
      console.warn(`TİTCK KÜB/KT isteği geçici olarak başarısız (deneme ${attempt}/4); ${wait} ms sonra yeniden denenecek.`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

/** Read the official TİTCK KÜB/KT index through its own DataTables endpoint. */
export async function scrapeOfficialLeaflets() {
  const client = axios.create({ headers: { 'User-Agent': 'Mozilla/5.0 (compatible; IlacRehberi/1.0; TİTCK public index reader)' } });
  const page = await client.get(sourceUrl, { timeout: 60000, maxContentLength: 10 * 1024 * 1024 });
  const token = csrfToken(page.data);
  const cookies = (page.headers['set-cookie'] || []).map(value => value.split(';')[0]).filter(Boolean).join('; ');
  const pageLength = 1000;
  const first = await fetchPage(client, token, cookies, 0, pageLength);
  const total = Number(first.recordsFiltered || first.recordsTotal || first.data.length);
  if (!Number.isFinite(total) || total < 100) throw new Error(`TİTCK KÜB/KT listesi beklenenden kısa geldi (${total}).`);
  const rows = [...first.data];
  for (let start = pageLength; start < total; start += pageLength) {
    const next = await fetchPage(client, token, cookies, start, pageLength);
    rows.push(...next.data);
    if (rows.length < start + Math.min(pageLength, total - start)) throw new Error(`TİTCK KÜB/KT sayfalaması eksik kaldı (${rows.length}/${total}).`);
    if (start + pageLength < total) await new Promise(resolve => setTimeout(resolve, 180));
  }

  const documents = rows.map(row => ({
    name: String(row.name || '').trim(),
    activeIngredient: String(row.element || '').trim(),
    firm: String(row.firmName || '').trim(),
    kubDate: String(row.confirmationDateKub || '').trim(),
    ktDate: String(row.confirmationDateKt || '').trim(),
    kubUrl: pdfUrl(row.documentPathKub),
    ktUrl: pdfUrl(row.documentPathKt)
  })).filter(item => item.name && (item.kubUrl || item.ktUrl));

  if (documents.length < 100 || documents.length < Math.min(total, 100)) {
    throw new Error(`TİTCK KÜB/KT listesi eksik geldi (${documents.length}/${total}); eksik belge kataloğu kullanıma açılmadı.`);
  }
  return { sourceUrl, fetchedAt: new Date().toISOString(), totalRows: total, documents };
}

