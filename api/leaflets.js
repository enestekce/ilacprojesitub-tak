import { chromium } from 'playwright';

const sourceUrl = 'https://titck.gov.tr/kubkt';

/** Read only the official TİTCK KÜB/KT index. Never guess a PDF URL. */
export async function scrapeOfficialLeaflets() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'tr-TR' });
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => [...document.querySelectorAll('table')].some(table => {
      const header = table.querySelector('thead')?.innerText || '';
      return /İlaç Adı/i.test(header) && /Etkin Madde Adı/i.test(header) && /Küb Dokümanı/i.test(header);
    }), { timeout: 90000 });

    const result = await page.evaluate(async () => {
      const table = [...document.querySelectorAll('table')].find(candidate => {
        const header = candidate.querySelector('thead')?.innerText || '';
        return /İlaç Adı/i.test(header) && /Etkin Madde Adı/i.test(header) && /Küb Dokümanı/i.test(header);
      });
      if (!table) throw new Error('TİTCK KÜB/KT tablosu bulunamadı.');
      const headers = [...table.querySelectorAll('thead th')].map(cell => cell.innerText.trim());
      const parseRows = () => [...table.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => ({
        text: (cell.innerText || '').trim(),
        urls: [...cell.querySelectorAll('a[href]')].map(anchor => anchor.href)
      })));
      const jq = window.jQuery;
      const isDataTable = jq?.fn?.dataTable?.isDataTable(table);
      if (!isDataTable) return { headers, rows: parseRows(), total: parseRows().length };

      const api = jq(table).DataTable();
      const settings = api.settings()[0];
      if (!settings.oFeatures.bServerSide) {
        const rows = api.rows().nodes().toArray().map(row => [...row.cells].map(cell => ({
          text: (cell.innerText || '').trim(),
          urls: [...cell.querySelectorAll('a[href]')].map(anchor => anchor.href)
        })));
        return { headers, rows, total: api.page.info().recordsTotal };
      }

      const desiredPageLength = 100;
      let done = new Promise(resolve => api.one('draw.dt', resolve));
      api.page.len(desiredPageLength).draw();
      await done;
      const info = api.page.info();
      const rows = [];
      for (let pageNumber = 0; pageNumber < info.pages; pageNumber++) {
        if (api.page.info().page !== pageNumber) {
          done = new Promise(resolve => api.one('draw.dt', resolve));
          api.page(pageNumber).draw('page');
          await done;
        }
        rows.push(...parseRows());
      }
      return { headers, rows, total: info.recordsTotal };
    });

    const indexOf = regex => result.headers.findIndex(value => regex.test(value));
    const columns = {
      name: indexOf(/İlaç Adı/i), ingredient: indexOf(/Etkin Madde Adı/i), firm: indexOf(/Firma Adı/i),
      kubDate: indexOf(/Küb Onay Tarihi/i), ktDate: indexOf(/Kt Onay Tarihi/i),
      kub: indexOf(/Küb Dokümanı/i), kt: indexOf(/Kt Dokümanı/i)
    };
    const items = result.rows.map(cells => {
      const get = key => cells[columns[key]] || { text: '', urls: [] };
      return {
        name: get('name').text,
        activeIngredient: get('ingredient').text,
        firm: get('firm').text,
        kubDate: get('kubDate').text,
        ktDate: get('ktDate').text,
        kubUrl: get('kub').urls[0] || null,
        ktUrl: get('kt').urls[0] || null
      };
    }).filter(item => item.name && (item.kubUrl || item.ktUrl));

    if (items.length < 100 || (result.total && items.length < Math.min(result.total, 100))) {
      throw new Error(`TİTCK KÜB/KT listesi eksik geldi (${items.length}/${result.total || 'bilinmiyor'}). Eksik belge kataloğu kullanıma açılmadı.`);
    }
    return { sourceUrl, fetchedAt: new Date().toISOString(), totalRows: result.total || items.length, documents: items };
  } finally {
    await browser.close();
  }
}

