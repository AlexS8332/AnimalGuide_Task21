'use strict';

/* Окно «База знаний» (v21): корпус, чанки документа в двух стратегиях,
   поиск по двум индексам рядом и последний отчёт сравнения стратегий.
   Подключается после app.js и пользуется его общими помощниками (app, esc,
   actions, factsAPI, factsURL, num, plural, toast).

   Вкладка «Корпус» — манифест (документы, страницы, символы, corpus_sha,
   лицензии), индексы базы, статус эмбеддера и таблица документов; клик по
   документу открывает его чанки. «Чанки» — канонический текст документа,
   где каждый чанк — блок своего фона с подписью (chunk_id, путь раздела,
   токены, «на стыке разделов»); перекрытие fixed подсвечено штриховкой.
   «Поиск» — один запрос сразу в оба индекса, выдачи рядом; клик по
   попаданию ведёт к чанку. «Сравнение» — таблицы последнего отчёта
   `kb eval` и вывод числами.

   Всё, что пришло из корпуса (заголовки, тексты, разделы, причины), —
   данные, а не разметка: только через esc(). Стабильные id и классы
   (#kb-button, [data-kb-tab], #kb-docs, .kb-doc[data-doc], #kb-chunks,
   #kb-doc, #kb-strategy, .kb-chunk[data-id], #kb-search, #kb-q, #kb-k,
   #kb-mode, #kb-go, .kb-result[data-index], .kb-hit[data-chunk],
   #kb-report, #kb-off) — для сценариев проверок и записи. */

const kb = {
  tab: 'docs',          // docs | chunks | search | report
  info: null,           // {ok, code, data, error} — GET /api/kb/info
  docs: null,           // {ok, code, data, error} — GET /api/kb/docs
  doc: '',              // документ вкладки «Чанки»
  strategy: 'structure',
  views: {},            // `${doc}|${index}` → {ok, code, data, error} — GET /api/kb/docs/{id}?index=
  focus: '',            // chunk_id, к которому прокрутить вкладку «Чанки»
  form: { q: '', k: 5, mode: 'dense' },
  result: null,         // {ok, code, data, error} — GET /api/kb/search
  searching: false,
  report: null,         // {ok, code, data, error} — GET /api/kb/report
};
app.kb = kb;

const kbTabs = [
  ['docs', 'Корпус', 'документы корпуса, индексы и эмбеддер'],
  ['chunks', 'Чанки', 'текст документа и границы чанков в двух стратегиях'],
  ['search', 'Поиск', 'один запрос в оба индекса — выдачи рядом'],
  ['report', 'Сравнение', 'последний отчёт сравнения стратегий (kb eval)'],
];
const kbStrategyText = { structure: 'structure — по разделам', fixed: 'fixed — окно с перекрытием' };
const kbBuild = 'go run ./cmd/kb index -strategy all';
const kbEval = 'go run ./cmd/kb eval';

/* ---------- мелочи ---------- */

const kbList = v => (Array.isArray(v) ? v : []);
function kbCut(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function kbPct(f) { return typeof f === 'number' && isFinite(f) ? (100 * f).toFixed(1) + ' %' : '—'; }
function kbNum2(f) { return typeof f === 'number' && isFinite(f) ? f.toFixed(2) : '—'; }
function kbShort(sha) { return String(sha || '').slice(0, 12); }
function kbPages(p) { return typeof p === 'number' && isFinite(p) ? p.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) : '—'; }
// kbOldURL — постоянная ссылка на ревизию статьи (…/w/index.php?oldid=),
// иначе адрес документа; только http/https.
function kbOldURL(d) {
  const u = factsURL(d.url);
  if (!u || !d.revid) return u;
  try { return new URL('/w/index.php?oldid=' + encodeURIComponent(d.revid), u).href; } catch (e) { return u; }
}
function kbParams(p) {
  p = p || {};
  if (p.size) return `size ${p.size}, overlap ${p.overlap || 0}`;
  if (p.max) return `max ${p.max}, min ${p.min || 0}`;
  return '—';
}
function kbPath(c) { return kbList(c.section_path).join(' › ') || c.section || ''; }
function kbBase() { return !!(kb.info && kb.info.ok); }
function kbIndexes() { return kbBase() ? kbList(kb.info.data.indexes) : []; }
function kbDocList() { return kb.docs && kb.docs.ok ? kbList(kb.docs.data) : []; }
function kbDocInfo(id) { return kbDocList().find(d => d.doc_id === id) || null; }
function kbStrategies() {
  const ids = kbIndexes().map(x => x.index_id);
  return ids.length ? ids : ['structure', 'fixed'];
}

/* ---------- загрузка ---------- */

async function kbLoadInfo() {
  kb.info = await factsAPI('GET', '/api/kb/info');
  kbRenderButton();
}
async function kbLoadDocs() {
  if (!kbBase()) return;
  kb.docs = await factsAPI('GET', '/api/kb/docs');
  if (!kb.doc && kbDocList().length) kb.doc = kbDocList()[0].doc_id;
}
async function kbLoadReport() { kb.report = kbBase() ? await factsAPI('GET', '/api/kb/report') : null; }
// kbLoadDoc — документ в обеих стратегиях: переключатель меняет вид
// мгновенно, а сводка сравнивает числа чанков.
async function kbLoadDoc(id) {
  if (!id || !kbBase()) return;
  await Promise.all(kbStrategies().map(async s => {
    const key = id + '|' + s;
    if (kb.views[key] && kb.views[key].ok) return;
    kb.views[key] = await factsAPI('GET', '/api/kb/docs/' + encodeURIComponent(id) + '?index=' + encodeURIComponent(s));
  }));
}

/* ---------- кнопка на пульте ---------- */

// Рядом с «MCP-серверы»: точка — база и эмбеддер (зелёная — dense,
// янтарная — эмбеддер не отвечает, поиск по BM25, кирпичная — базы нет).
function kbRenderButton() {
  let btn = $('kb-button');
  if (!btn) {
    const anchor = $('windows-button');
    if (!anchor) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'kb-button';
    btn.className = 'ghost kb-button';
    btn.dataset.action = 'openWindow';
    btn.dataset.arg = 'kb';
    // В конец ряда: кнопки «Факты» и «MCP-серверы» встают сразу за «Окна ▾»
    // по мере ответов своих разделов, «База знаний» остаётся последней.
    anchor.parentElement.appendChild(btn);
  }
  const r = kb.info;
  let cls = '', lines = ['База знаний: корпус, чанки, поиск по двум индексам, сравнение стратегий'];
  if (r && r.ok) {
    const emb = r.data.embedder || {};
    cls = emb.ok ? 'ok' : 'warn';
    lines.push(`документов ${r.data.docs}, индексов ${kbList(r.data.indexes).length}`);
    lines.push(emb.ok ? 'эмбеддер: ' + (emb.model || '') : 'эмбеддер не отвечает — поиск по BM25');
  } else if (r) {
    cls = 'bad';
    lines.push(r.code === 404 ? 'сервер приложения не знает /api/kb' : (r.data && r.data.why) || r.error);
  }
  btn.innerHTML = `<span class="kb-dot ${cls}"></span>База знаний`;
  btn.title = lines.join('\n');
}

/* ---------- окно ---------- */

app.windows.kb = {
  title: 'База знаний',
  async render() {
    await kbLoadInfo();
    await kbLoadDocs();
    await kbLoadTab();
    if (kb.focus) setTimeout(kbScrollFocus, 0); // после отрисовки окна
    return `<div id="kb-root" class="kb">
      <div class="tabs kb-tabs" id="kb-tabs">${kbTabsHTML()}</div>
      <div id="kb-body" class="kb-body">${kbBodyHTML()}</div>
    </div>`;
  },
};

// kbLoadTab — что нужно открытой вкладке.
async function kbLoadTab() {
  if (!kbBase()) return;
  if (kb.tab === 'chunks') await kbLoadDoc(kb.doc);
  if (kb.tab === 'report' && (!kb.report || !kb.report.ok)) await kbLoadReport();
}

function kbTabsHTML() {
  return kbTabs.map(([id, label, title]) => {
    let n = '';
    if (id === 'docs' && kbBase()) n = ' · ' + kb.info.data.docs;
    return `<button type="button" class="tab${kb.tab === id ? ' active' : ''}" data-action="kbTab" data-arg="${id}" data-kb-tab="${id}" id="kb-tab-${id}" title="${esc(title)}">${esc(label + n)}</button>`;
  }).join('');
}

function kbBodyHTML() {
  if (!kb.info) return '<p class="hint">загружаю…</p>';
  if (!kb.info.ok) return kbOffHTML();
  switch (kb.tab) {
    case 'chunks': return kbChunksHTML();
    case 'search': return kbSearchHTML();
    case 'report': return kbReportHTML();
    default: return kbDocsHTML();
  }
}

function kbPaint(...parts) {
  if (!$('kb-root')) return;
  if (parts.includes('tabs')) $('kb-tabs').innerHTML = kbTabsHTML();
  if (parts.includes('body')) $('kb-body').innerHTML = kbBodyHTML();
  if (parts.includes('results') && $('kb-results')) $('kb-results').outerHTML = kbResultsHTML();
  const go = $('kb-go');
  if (go) { go.disabled = kb.searching; go.innerHTML = kb.searching ? '<span class="thinking">ищу</span>' : 'Найти'; }
}

// kbOffHTML — базы нет (503) или сервер не знает /api/kb.
function kbOffHTML() {
  const r = kb.info;
  const d = r.data || {};
  if (r.code === 404) {
    return `<div class="facts-down kb-off" id="kb-off"><b>База знаний недоступна.</b><div>сервер приложения не знает /api/kb — обновите приложение</div></div>`;
  }
  return `<div class="facts-down kb-off" id="kb-off">
    <b>Базы знаний нет.</b>
    <div class="kb-why">${esc(d.why || r.error)}</div>
    ${d.hint ? `<div class="facts-hint">${esc(d.hint)}</div>` : ''}
    <div class="kb-steps">Как собрать:
      <ol>
        <li>эмбеддер (по желанию): <code>uv run embedder/server.py</code> — без него индекс соберётся только для BM25;</li>
        <li>индекс обеих стратегий: <code>${esc(kbBuild)}</code>;</li>
        <li>отчёт сравнения: <code>${esc(kbEval)}</code>;</li>
        <li>перезапустите приложение и откройте окно снова.</li>
      </ol></div>
    ${d.embedder ? `<div class="hint kb-off-emb">эмбеддер: ${esc(d.embedder.ok ? (d.embedder.model || '') + ' отвечает' : 'не отвечает — ' + (d.embedder.why || ''))}</div>` : ''}
    ${d.path ? `<div class="hint">база ищется здесь: <code>${esc(d.path)}</code> (флаг -kb или KB_DB)</div>` : ''}
  </div>`;
}

/* ---------- вкладка «Корпус» ---------- */

function kbEmbedderHTML(e) {
  e = e || {};
  if (e.ok) {
    return `<div class="kb-emb ok" id="kb-embedder"><span class="kb-dot ok"></span>
      <span>Эмбеддер <b>${esc(e.model || '')}</b>${e.device ? ' · ' + esc(e.device) : ''}${e.dims ? ' · ' + esc(e.dims) + ' изм.' : ''}</span>
      <span class="hint">${esc(e.url || '')}</span></div>`;
  }
  return `<div class="kb-emb bad" id="kb-embedder"><span class="kb-dot warn"></span>
    <span><b>Эмбеддер не отвечает — поиск по BM25.</b> ${esc(e.why || '')}</span>
    ${e.hint ? `<div class="facts-hint">${esc(e.hint)}</div>` : ''}</div>`;
}

function kbDocsHTML() {
  const v = kb.info.data;
  const m = v.manifest || {};
  const docs = kbDocList();
  const licenses = [...new Set(docs.map(d => d.license).filter(Boolean))];
  const chars = m.chars || docs.reduce((s, d) => s + (d.chars || 0), 0);
  let html = `<div id="kb-docs" class="kb-docs">
    <div class="kb-stats" id="kb-stats">
      <div class="kb-stat"><span>документов</span><b id="kb-n-docs">${esc(v.docs)}</b></div>
      <div class="kb-stat"><span>страниц</span><b id="kb-n-pages">${esc(kbPages(v.pages))}</b></div>
      <div class="kb-stat"><span>символов</span><b id="kb-n-chars">${esc(num(chars))}</b></div>
      <div class="kb-stat"><span>corpus_sha</span><b><code id="kb-sha" title="${esc(m.corpus_sha || '')}">${esc(kbShort(m.corpus_sha) || '—')}</code></b></div>
      <div class="kb-stat wide"><span>лицензии</span><b id="kb-licenses">${licenses.map(l => `<span class="chip">${esc(l)}</span>`).join(' ') || '—'}</b></div>
    </div>
    ${kbEmbedderHTML(v.embedder)}
    <div class="kb-indexes" id="kb-indexes">${kbIndexes().map(x => `<span class="kb-index" data-index="${esc(x.index_id)}">
      <b>${esc(x.index_id)}</b> ${esc(num(x.chunks))} чанков · ${esc(kbParams(x.params))} · ${esc(x.embedder || 'без векторов')}${x.dims ? ' · ' + esc(x.dims) + ' изм.' : ''}</span>`).join('') ||
      `<span class="hint">индексов нет — соберите: <code>${esc(kbBuild)}</code></span>`}</div>`;
  if (kb.docs && !kb.docs.ok) return html + `<div class="facts-error">${esc(kb.docs.error)}</div></div>`;
  html += `<table class="grid kb-doc-table" id="kb-doc-table"><tr><th>№</th><th>документ</th><th>источник</th><th class="kb-r">символов</th><th class="kb-r">страниц</th><th>revid</th><th>лицензия</th></tr>
    ${docs.map((d, i) => {
      const u = kbOldURL(d);
      return `<tr class="kb-doc" data-doc="${esc(d.doc_id)}" data-action="kbOpenDoc" data-arg="${esc(d.doc_id)}" title="чанки документа">
        <td class="kb-r hint">${i + 1}</td>
        <td><b class="kb-doc-title">${esc(d.title)}</b> <span class="hint">${esc(d.doc_id)}</span></td>
        <td>${esc(d.source)}</td>
        <td class="kb-r">${esc(num(d.chars))}</td><td class="kb-r">${esc(kbPages(d.pages))}</td>
        <td>${u ? `<a class="kb-ext" href="${esc(u)}" target="_blank" rel="noopener noreferrer" title="${esc(u)}">${esc(d.revid || 'ссылка')} ↗</a>` : esc(d.revid || '—')}</td>
        <td class="hint">${esc(d.license)}</td></tr>`;
    }).join('')}</table>`;
  return html + '</div>';
}

// Ссылка на ревизию внутри строки документа — переход, а не «открыть чанки»:
// общий обработчик app.js отменяет переход у элементов внутри data-action.
document.addEventListener('click', ev => {
  if (ev.target.closest && ev.target.closest('a.kb-ext')) ev.stopPropagation();
}, true);

/* ---------- вкладка «Чанки» ---------- */

function kbChunksHTML() {
  const docs = kbDocList();
  const strategies = kbStrategies();
  let html = `<div id="kb-chunks" class="kb-chunks">
    <div class="kb-bar">
      <label class="lbl" for="kb-doc">документ</label>
      <select id="kb-doc" data-change="kbPickDoc">${docs.map(d => `<option value="${esc(d.doc_id)}"${d.doc_id === kb.doc ? ' selected' : ''}>${esc(d.title)}</option>`).join('')}</select>
      <label class="lbl" for="kb-strategy">стратегия</label>
      <select id="kb-strategy" data-change="kbPickStrategy">${strategies.map(s => `<option value="${esc(s)}"${s === kb.strategy ? ' selected' : ''}>${esc(kbStrategyText[s] || s)}</option>`).join('')}</select>
      <span class="kb-seg">${strategies.map(s => `<button type="button" class="small${s === kb.strategy ? ' on' : ''}" data-action="kbPickStrategy" data-arg="${esc(s)}" data-kb-strategy="${esc(s)}">${esc(s)}</button>`).join('')}</span>
    </div>`;
  if (!kb.doc) return html + '<p class="hint">Документов в базе нет.</p></div>';
  const r = kb.views[kb.doc + '|' + kb.strategy];
  if (!r) return html + '<p class="hint">загружаю…</p></div>';
  if (!r.ok) return html + `<div class="facts-error" id="kb-doc-error">${esc(r.error)}</div></div>`;
  html += kbChunkSummaryHTML(r.data);
  html += `<div class="kb-text" id="kb-text" data-doc="${esc(kb.doc)}" data-index="${esc(r.data.index)}">${kbTextHTML(r.data)}</div>`;
  return html + '</div>';
}

// kbChunkSummaryHTML — сводка по документу: чанков в каждой стратегии,
// сколько на стыке разделов, медиана токенов.
function kbChunkSummaryHTML(v) {
  const d = v.doc || {};
  const u = kbOldURL(d);
  const cells = kbStrategies().map(s => {
    const r = kb.views[kb.doc + '|' + s];
    if (!r || !r.ok) return `<span class="kb-sum-s" data-index="${esc(s)}"><b>${esc(s)}</b> —</span>`;
    const cs = kbList(r.data.chunks);
    const mixed = cs.filter(c => c.mixed).length;
    const toks = cs.map(c => c.tokens || 0).sort((a, b) => a - b);
    const p50 = toks.length ? toks[Math.floor((toks.length - 1) / 2)] : 0;
    return `<span class="kb-sum-s${s === kb.strategy ? ' on' : ''}" data-index="${esc(s)}"><b>${esc(s)}</b>
      <span class="kb-sum-n">${esc(plural(cs.length, 'чанк', 'чанка', 'чанков'))}</span>, на стыке разделов ${esc(mixed)}, p50 ${esc(p50)} ток.</span>`;
  }).join('');
  return `<div class="kb-summary" id="kb-summary">
    <div class="kb-sum-doc"><b>${esc(d.title || kb.doc)}</b> <span class="hint">${esc(num(d.chars))} символов · ${esc(kbPages(d.pages))} стр.</span>
      ${u ? `<a class="kb-ext" href="${esc(u)}" target="_blank" rel="noopener noreferrer">ревизия ${esc(d.revid || '')} ↗</a>` : ''}</div>
    <div class="kb-sum-row">${cells}</div>
  </div>`;
}

// kbPlain — кусок текста документа: строки «## Путь › Раздел» —
// заголовками; всё — через esc().
function kbPlain(s) {
  return s.split('\n').map(line => line.startsWith('## ')
    ? `<span class="kb-hd">${esc(line.slice(3))}</span>` : esc(line)).join('\n');
}

// kbTextHTML — текст документа блоками чанков. Смещения — в рунах, поэтому
// текст режется по кодовым точкам. Каждая руна текста выводится один раз:
// перекрытие fixed (начало чанка внутри предыдущего) остаётся в хвосте
// предыдущего блока и подсвечено; промежутки между чанками (заголовки,
// пустые строки) — обычный текст.
function kbTextHTML(v) {
  const t = Array.from(v.text || '');
  const cs = kbList(v.chunks).slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const piece = (a, b) => t.slice(a, b).join('');
  // Промежуток между блоками — без крайних переводов строк: блок и так с новой строки.
  const gap = (a, b) => {
    const s = piece(a, b).replace(/^\n+|\n+$/g, '');
    return s.trim() ? `<div class="kb-gap">${kbPlain(s)}</div>` : '';
  };
  let pos = 0;
  let html = '';
  cs.forEach((c, i) => {
    const start = Math.max(c.start, pos);
    const end = Math.min(Math.max(c.end, start), t.length);
    if (start > pos) html += gap(pos, start);
    const next = cs[i + 1];
    const ov = next && next.start < end ? Math.max(next.start, start) : end;
    const tags = [];
    if (c.mixed) tags.push('<span class="chip warn kb-mixed">на стыке разделов</span>');
    if (ov < end) tags.push(`<span class="chip kb-ovl">перекрытие ${esc(end - ov)} симв.</span>`);
    html += `<div class="kb-chunk ${i % 2 ? 'odd' : 'even'}${c.mixed ? ' mixed' : ''}${c.chunk_id === kb.focus ? ' focus' : ''}" data-id="${esc(c.chunk_id)}" data-ord="${esc(c.ord)}">
      <div class="kb-chunk-head"><code class="kb-cid">${esc(c.chunk_id)}</code><span class="kb-cpath">${esc(kbPath(c))}</span><span class="kb-ctok">${esc(c.tokens)} ток. · ${esc(c.start)}–${esc(c.end)}</span>${tags.join('')}</div>
      <div class="kb-chunk-text">${kbPlain(piece(start, ov).replace(/^[ \t]+/, ''))}${ov < end ? `<span class="kb-overlap" title="этот текст входит и в следующий чанк">${kbPlain(piece(ov, end))}</span>` : ''}</div></div>`;
    pos = Math.max(pos, end);
  });
  if (pos < t.length) html += gap(pos, t.length);
  if (!cs.length) html += '<p class="hint">В этом индексе у документа нет чанков.</p>';
  return html;
}

function kbScrollFocus() {
  if (!kb.focus || !$('kb-text')) return;
  const el = [...document.querySelectorAll('#kb-text .kb-chunk')].find(x => x.dataset.id === kb.focus);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}

async function kbShowChunks(paintFirst) {
  if (kb.tab !== 'chunks') return;
  if (paintFirst) kbPaint('body');
  await kbLoadDoc(kb.doc);
  if (kb.tab !== 'chunks') return;
  kbPaint('body');
  kbScrollFocus();
}

/* ---------- вкладка «Поиск» ---------- */

function kbSearchHTML() {
  const f = kb.form;
  const ks = [1, 3, 5, 8, 10, 20];
  return `<div id="kb-search" class="kb-search">
    <form id="kb-search-form" class="kb-form" data-submit="kbSearch" autocomplete="off">
      <input type="text" id="kb-q" value="${esc(f.q)}" placeholder="чем питается харза" maxlength="500">
      <label class="lbl" for="kb-k">k</label>
      <select id="kb-k">${ks.map(k => `<option value="${k}"${k === f.k ? ' selected' : ''}>${k}</option>`).join('')}</select>
      <label class="lbl" for="kb-mode">режим</label>
      <select id="kb-mode">
        <option value="dense"${f.mode === 'dense' ? ' selected' : ''}>dense — векторы</option>
        <option value="bm25"${f.mode === 'bm25' ? ' selected' : ''}>BM25 — слова</option>
      </select>
      <button type="submit" class="solid" id="kb-go"${kb.searching ? ' disabled' : ''}>${kb.searching ? '<span class="thinking">ищу</span>' : 'Найти'}</button>
    </form>
    <div class="hint">Запрос уходит сразу в оба индекса — выдачи рядом. dense без эмбеддера откатывается на BM25 и говорит об этом. Клик по попаданию — к чанку в тексте документа.</div>
    ${kbResultsHTML()}
  </div>`;
}

function kbModeLine(info) {
  info = info || {};
  if (info.mode === 'dense') return `<span class="kb-mode dense">dense · ${esc(info.embedder || '')}</span>`;
  if (info.fallback) return `<span class="kb-mode fallback" title="${esc(info.fallback)}">BM25 — откат: ${esc(info.fallback)}</span>`;
  return `<span class="kb-mode bm25">BM25</span>`;
}

function kbResultsHTML() {
  const r = kb.result;
  if (!r) return '<div id="kb-results" class="kb-results-empty hint">Введите вопрос — например, «чем питается харза».</div>';
  if (!r.ok) return `<div id="kb-results"><div class="facts-error" id="kb-search-error">${esc(r.error)}</div></div>`;
  const res = kbList(r.data.results);
  return `<div id="kb-results" class="kb-results" data-query="${esc(r.data.query)}" style="--kb-cols:${Math.max(1, Math.min(res.length, 3))}">${res.map(x => {
    const info = x.info || {};
    const hits = kbList(x.hits);
    return `<section class="kb-result" data-index="${esc(info.index)}" data-mode="${esc(info.mode || '')}">
      <div class="kb-result-head"><b>${esc(info.index)}</b>${kbModeLine(info)}<span class="hint">${esc(typeof info.ms === 'number' ? info.ms.toFixed(1) + ' мс' : '')}</span></div>
      ${x.error ? `<div class="facts-error">${esc(x.error)}</div>` : ''}
      ${hits.length ? hits.map(h => `<div class="kb-hit" data-chunk="${esc(h.chunk_id)}" data-doc="${esc(h.doc_id)}" data-index="${esc(info.index)}" data-action="kbOpenChunk" data-arg="${esc(h.chunk_id)}" title="открыть чанк в тексте документа">
        <div class="kb-hit-head"><span class="kb-rank">${esc(h.rank)}</span><span class="kb-score">${esc(typeof h.score === 'number' ? h.score.toFixed(3) : '')}</span>
          <span class="kb-hit-where"><b>${esc(h.title)}</b> › ${esc(kbPath(h))}</span></div>
        <div class="kb-hit-text">${esc(kbCut(h.text, 300))}</div>
        <div class="kb-hit-foot"><code>${esc(h.chunk_id)}</code> · ${esc(h.tokens)} ток.${h.mixed ? ' · <span class="kb-mixed-t">на стыке разделов</span>' : ''}</div>
      </div>`).join('') : (x.error ? '' : '<p class="hint">Ничего не нашлось.</p>')}
    </section>`;
  }).join('')}</div>`;
}

function kbReadForm() {
  const q = $('kb-q'), k = $('kb-k'), m = $('kb-mode');
  if (q) kb.form.q = q.value;
  if (k) kb.form.k = Number(k.value) || 5;
  if (m) kb.form.mode = m.value;
}

async function kbSearch() {
  if (kb.searching) return;
  kbReadForm();
  const q = kb.form.q.trim();
  if (!q) { $('kb-q') && $('kb-q').focus(); return; }
  kb.searching = true;
  kbPaint();
  const qs = new URLSearchParams({ q, k: String(kb.form.k), mode: kb.form.mode });
  kb.result = await factsAPI('GET', '/api/kb/search?' + qs.toString());
  kb.searching = false;
  kbPaint('results');
}

document.addEventListener('input', ev => { if (ev.target.closest && ev.target.closest('#kb-search-form')) kbReadForm(); });
document.addEventListener('change', ev => { if (ev.target.closest && ev.target.closest('#kb-search-form')) kbReadForm(); });

/* ---------- вкладка «Сравнение» ---------- */

function kbReportHTML() {
  const r = kb.report;
  if (!r) return '<div id="kb-report"><p class="hint">загружаю…</p></div>';
  if (!r.ok) {
    if (r.code === 404) {
      return `<div id="kb-report" class="kb-report"><div class="facts-down" id="kb-report-none"><b>Отчёта сравнения ещё нет.</b>
        <div>Соберите его: <code>${esc(kbEval)}</code> — он прогонит контрольные вопросы по обоим индексам и сохранит таблицы в базу (и в examples/kb/chunking.md).</div></div></div>`;
    }
    return `<div id="kb-report"><div class="facts-error">${esc(r.error)}</div></div>`;
  }
  const d = r.data;
  const created = d.created ? new Date(d.created).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  let html = `<div id="kb-report" class="kb-report">
    <div class="kb-report-meta" id="kb-report-meta">
      <span>отчёт от <b id="kb-report-date">${esc(created)}</b></span>
      <span>эмбеддер <b>${esc(d.embedder || '—')}</b></span>
      <span>corpus_sha <code title="${esc(d.corpus_sha)}">${esc(kbShort(d.corpus_sha))}</code></span>
      <span>документов ${esc(d.docs)}, страниц ${esc(kbPages(d.pages))}</span>
      <span>бюджет топа ${esc(d.budget)} ток.</span>
    </div>`;
  const concl = kbList(d.conclusion);
  if (concl.length) {
    html += `<h4 class="kb-h">Вывод</h4><ul class="kb-conclusion" id="kb-conclusion">${concl.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  const stats = kbList(d.stats);
  html += `<h4 class="kb-h">Структура индексов</h4>
    <table class="grid kb-table" id="kb-stats-table"><tr><th>индекс</th><th>параметры</th><th class="kb-r">чанков</th><th class="kb-r">токенов</th><th class="kb-r">p50</th><th class="kb-r">p95</th>
      <th class="kb-r">на стыке разделов</th><th class="kb-r">разрезано разделов</th><th class="kb-r">перекрытие</th><th class="kb-r">оборвано посреди предложения</th><th class="kb-r">сборка, с</th><th class="kb-r">размер, КБ</th></tr>
    ${stats.map(s => `<tr class="kb-stat-row" data-index="${esc(s.index)}"><td><b>${esc(s.index)}</b></td><td>${esc(kbParams(s.params))}</td>
      <td class="kb-r">${esc(num(s.chunks))}</td><td class="kb-r">${esc(num(s.tokens))}</td><td class="kb-r">${esc(s.p50_tokens)}</td><td class="kb-r">${esc(s.p95_tokens)}</td>
      <td class="kb-r">${esc(kbPct(s.mixed_share))}</td><td class="kb-r">${esc(kbPct(s.split_sections))}</td><td class="kb-r">${esc(kbPct(s.overlap_share))}</td><td class="kb-r">${esc(kbPct(s.mid_sentence))}</td>
      <td class="kb-r">${esc(typeof s.build_seconds === 'number' ? s.build_seconds.toFixed(1) : '—')}</td><td class="kb-r">${esc(num(Math.round((s.bytes || 0) / 1024)))}</td></tr>`).join('')}</table>`;
  const ret = kbList(d.retrieval);
  // Лучшее значение колонки (среди строк того же набора и режима) — жирным.
  const best = (x, f) => {
    const peers = ret.filter(y => y.split === x.split && y.mode === x.mode).map(f);
    return peers.length > 1 && f(x) === Math.max(...peers) ? ' best' : '';
  };
  const rc = k => x => (x.recall || {})[k] || 0;
  html += `<h4 class="kb-h">Поиск по наборам вопросов</h4>
    <table class="grid kb-table" id="kb-retrieval-table"><tr><th>индекс</th><th>режим</th><th>набор</th><th class="kb-r">вопросов</th><th class="kb-r">разорвано доказательств</th>
      <th class="kb-r">recall@1</th><th class="kb-r">recall@3</th><th class="kb-r">recall@5</th><th class="kb-r">MRR</th><th class="kb-r">recall при ${esc(d.budget)} ток.</th></tr>
    ${ret.map(x => `<tr class="kb-ret-row" data-index="${esc(x.index)}" data-mode="${esc(x.mode)}" data-split="${esc(x.split)}">
      <td><b>${esc(x.index)}</b></td><td>${esc(x.mode)}${x.fallback ? ` <span class="chip warn" title="${esc(x.fallback)}">откат</span>` : ''}</td><td>${esc(x.split)}</td>
      <td class="kb-r">${esc(x.n)}</td><td class="kb-r">${esc(kbPct(x.broken_evidence))}</td>
      <td class="kb-r${best(x, rc(1))}">${esc(kbNum2(rc(1)(x)))}</td><td class="kb-r${best(x, rc(3))}">${esc(kbNum2(rc(3)(x)))}</td><td class="kb-r${best(x, rc(5))}">${esc(kbNum2(rc(5)(x)))}</td>
      <td class="kb-r${best(x, y => y.mrr || 0)}">${esc(kbNum2(x.mrr))}</td><td class="kb-r${best(x, y => y.recall_budget || 0)}">${esc(kbNum2(x.recall_budget))}</td></tr>`).join('')}</table>`;
  html += kbQuestionsHTML(ret);
  return html + '</div>';
}

// kbQuestionsHTML — вопросы test: ранг первого релевантного чанка в
// каждом индексе и режиме (— — нет в топ-20).
function kbQuestionsHTML(ret) {
  const cols = ret.filter(x => x.split === 'test');
  if (!cols.length) return '';
  const qs = [];
  for (const c of cols) for (const row of kbList(c.rows)) if (!qs.some(q => q.id === row.id)) qs.push(row);
  if (!qs.length) return '';
  return `<details class="kb-questions"><summary>Вопросы test: ранг первого релевантного чанка</summary>
    <table class="grid kb-table"><tr><th>id</th><th>вопрос</th>${cols.map(c => `<th class="kb-r">${esc(c.index)} ${esc(c.mode)}</th>`).join('')}</tr>
    ${qs.map(q => `<tr><td>${esc(q.id)}</td><td>${esc(kbCut(q.q, 110))}</td>${cols.map(c => {
      const row = kbList(c.rows).find(x => x.id === q.id);
      const rank = row ? row.rank : 0;
      return `<td class="kb-r${rank === 1 ? ' best' : ''}">${rank ? esc(rank) : '—'}</td>`;
    }).join('')}</tr>`).join('')}</table></details>`;
}

/* ---------- действия ---------- */

Object.assign(actions, {
  async kbTab(tab) {
    if (!kbTabs.some(([id]) => id === tab)) return;
    if (kb.tab === 'search') kbReadForm();
    kb.tab = tab;
    if (tab !== 'chunks') kb.focus = '';
    kbPaint('tabs', 'body');
    if (tab === 'chunks') await kbShowChunks(false);
    if (tab === 'report' && (!kb.report || !kb.report.ok)) {
      await kbLoadReport();
      if (kb.tab === 'report') kbPaint('body');
    }
  },
  async kbOpenDoc(id) {
    if (!id) return;
    kb.doc = id;
    kb.focus = '';
    kb.tab = 'chunks';
    kbPaint('tabs');
    await kbShowChunks(true);
    const t = $('kb-text');
    if (t) t.scrollIntoView({ block: 'start' });
  },
  async kbOpenChunk(id, el) {
    if (!id || !el) return;
    kbReadForm();
    kb.doc = el.dataset.doc || kb.doc;
    if (el.dataset.index) kb.strategy = el.dataset.index;
    kb.focus = id;
    kb.tab = 'chunks';
    kbPaint('tabs');
    await kbShowChunks(true);
  },
  async kbPickDoc(id) {
    if (!id) return;
    kb.doc = id;
    kb.focus = '';
    await kbShowChunks(true);
  },
  async kbPickStrategy(s) {
    if (!s || s === kb.strategy) return;
    kb.strategy = s;
    // Чанк из другой стратегии — не тот, к которому прокручивать.
    if (kb.focus && !kb.focus.includes('/' + s + '/')) kb.focus = '';
    const top = $('window-body') ? $('window-body').scrollTop : 0;
    await kbShowChunks(true);
    if (!kb.focus && $('window-body')) $('window-body').scrollTop = top;
  },
  kbSearch() { kbSearch(); },
});

// kbPlaceButton — «База знаний» сразу за «MCP-серверы»: кнопки разделов
// встают за «Окна ▾» по мере ответов своих REST, порядок заранее не известен.
function kbPlaceButton() {
  const b = $('kb-button'), h = $('hub-button');
  if (b && h && h.nextElementSibling !== b) h.insertAdjacentElement('afterend', b);
}

kbRenderButton();
if ($('kb-button')) new MutationObserver(kbPlaceButton).observe($('kb-button').parentElement, { childList: true });
kbLoadInfo();
