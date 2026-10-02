'use strict';

/* Сценарий проверок интерфейса для headless Edge. Подключается после
   app.js, ходит по интерфейсу теми же кнопками, что и человек (клик по
   элементу с data-action уходит в общий обработчик app.js), и пишет итог
   в <pre id="test-log">: строка на проверку — «OK имя» или «FAIL имя —
   причина», в конце «DONE». Какой сценарий — из ?scenario=… в адресе. */

(function () {
  const log = document.createElement('pre');
  log.id = 'test-log';
  log.style.display = 'none';
  document.body.appendChild(log);
  const errors = [];
  window.addEventListener('error', e => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', e => errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  // Вопросы пользователю отвечаем сами: имя точки, ветки и т. п.
  window.prompt = () => 'из сценария';
  window.confirm = () => true;

  const write = line => { log.textContent += line + '\n'; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const q = sel => document.querySelector(sel);
  const qa = sel => [...document.querySelectorAll(sel)];
  const text = sel => { const el = q(sel); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; };

  // until — ждёт, пока условие станет истинным (и возвращает его значение).
  async function until(what, fn, ms) {
    const end = Date.now() + (ms || 5000);
    for (;;) {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (Date.now() > end) throw new Error('не дождались: ' + what);
      await sleep(50);
    }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }
  function click(sel) {
    const el = typeof sel === 'string' ? q(sel) : sel;
    assert(el, 'нет элемента ' + sel);
    el.click();
    return el;
  }
  async function check(name, fn) {
    try {
      await fn();
      write('OK ' + name);
    } catch (e) {
      write('FAIL ' + name + ' — ' + String(e && e.message || e).replace(/\n/g, ' '));
    }
  }
  const windowOpen = () => $('window').open;
  async function openWin(name) {
    click('#windows-button');
    await until('список окон', () => windowOpen() && q('#window-body .wlist'));
    click(q(`#window-body [data-action="openWindow"][data-arg="${name}"]`));
    await until('окно ' + name, () => !text('#window-body').includes('загружаю') && $('window-title').textContent === app.windows[name].title && text('#window-body'));
  }
  const booted = () => until('загрузка диалога', () => app.conv && q('#feed').children.length, 8000);
  const exportURL = el => `/api/conversations/${app.conv.id}/export?kind=${encodeURIComponent(el.dataset.kind)}&id=${encodeURIComponent(el.dataset.arg)}`;

  const scenarios = {};

  /* Основной диалог: карточка рыси, раздел, узел дерева, реплика ведущему
     с правками профиля и памяти, точка, ветка «сравнение» со сравнением. */
  scenarios.main = async () => {
    await booted();

    await check('пульт: липкая шапка с показаниями', () => {
      const p = q('header.pult');
      assert(getComputedStyle(p).position === 'sticky', 'пульт не sticky');
      const r = text('#readings');
      assert(r.includes('Модель') && r.includes('Ходов') && r.includes('Собеседник'), 'показания: ' + r);
      assert(text('#readings').includes('me'), 'собеседник не показан');
    });

    await check('пульт: список диалогов и выбранный', () => {
      const opts = qa('#dialog-select option');
      assert(opts.length === 3, 'диалогов в списке ' + opts.length);
      assert($('dialog-select').value === app.conv.id, 'выбран не текущий диалог');
    });

    await check('ветки: дерево, активная ветка и точка сохранения', () => {
      const br = qa('#branches .branch');
      assert(br.length === 2, 'веток ' + br.length);
      assert(text('#branches .branch.active').includes('↳ сравнение: рысь и манул'), 'активна не ветка сравнения: ' + text('#branches .branch.active'));
      assert(qa('#branches [data-action="fork"]').some(b => b.textContent.includes('до сравнения')), 'нет кнопки точки «до сравнения»');
    });

    await check('ветки: «+ точка» ставит точку сохранения', async () => {
      const before = app.conv.checkpoints.length;
      click('#branches [data-action="mark"]');
      await until('новая точка', () => app.conv.checkpoints.length === before + 1);
      assert(qa('#branches [data-action="fork"]').some(b => b.textContent.includes('из сценария')), 'кнопки новой точки нет');
    });

    await check('механизмы: все из реестра, счётчик', () => {
      const m = qa('#mechanisms .mech');
      assert(m.length === app.meta.mechanisms.length && m.length >= 10, 'кнопок ' + m.length);
      const on = qa('#mechanisms .mech.on').length;
      assert(text('#mech-count') === `включено ${on} из ${m.length}`, 'счётчик: ' + text('#mech-count'));
      assert(m.every(b => b.title.includes('Выключен:')), 'в подсказке нет запасного пути');
    });

    await check('выключатель механизма: выкл и обратно', async () => {
      const sel = '#mechanisms .mech[data-arg="facts"]';
      assert(q(sel).classList.contains('on'), 'карточка фактов не включена');
      click(sel);
      await until('выключение', () => q(sel).classList.contains('off'));
      assert(app.conv.features.facts === false || !app.conv.mechanisms.find(m => m.name === 'facts').on, 'сервер не выключил');
      click(sel);
      await until('включение', () => q(sel).classList.contains('on'));
    });

    await check('контекст: шкала и бюджет', () => {
      assert(qa('#context .scale span').length >= 2, 'в шкале меньше двух частей');
      assert(text('#context .budget').includes('постоянная часть'), 'нет строки бюджета');
    });

    await check('лента: ходы и карточка с латынью', () => {
      assert(qa('#feed .turn').length === app.conv.turnList.length, 'ходов в ленте ' + qa('#feed .turn').length);
      const card = q('#feed article.acard');
      assert(card, 'нет карточки');
      assert(text('#feed .acard h3') === 'Обыкновенная рысь', 'название: ' + text('#feed .acard h3'));
      assert(text('#feed .acard .latin') === 'Lynx lynx', 'латынь: ' + text('#feed .acard .latin'));
      assert(qa('#feed .bubble.user.click').length >= 2, 'клики не помечены как клики');
    });

    await check('разделы: прочитанный раскрывается', async () => {
      const read = qa('#feed .acard details.section').find(d => d.textContent.includes('Питание'));
      assert(read, 'нет прочитанного раздела «Питание»');
      assert(read.querySelector('.s-read'), 'статус не «прочитан»');
      read.querySelector('summary').click();
      await until('раскрытие', () => read.open);
      assert(read.querySelector('.s-body').textContent.includes('Пересказ'), 'в разделе нет пересказа');
    });

    await check('разделы: непрочитанные с кнопкой «прочитать»', () => {
      const lynx = q('#feed .acard');
      assert(lynx.querySelector('h3').textContent === 'Обыкновенная рысь', 'первая карточка не рысь');
      const btns = [...lynx.querySelectorAll('[data-action="section"]')];
      assert(btns.length >= 3, 'кнопок «прочитать» ' + btns.length);
      assert(btns.every(b => b.dataset.card && b.dataset.topic && !b.disabled), 'кнопка без карточки/темы или выключена');
      assert(!btns.some(b => b.dataset.topic === 'diet'), 'прочитанный раздел снова предлагают прочитать');
    });

    await check('дерево: узлы кликабельны, сам вид не нажимается', () => {
      const nodes = qa('#feed .acard .tree [data-action="node"]');
      assert(nodes.length >= 2, 'узлов ' + nodes.length);
      assert(nodes.every(n => n.dataset.key && n.dataset.card), 'узел без ключа');
      assert(q('#feed .acard .tree button.self[disabled]'), 'сам вид не выделен');
    });

    await check('соседи узла: список видов «Кошачьи»', () => {
      const nb = q('#feed .acard .neighbors');
      assert(nb && nb.textContent.includes('Кошачьи'), 'нет блока соседей');
      assert(nb.querySelectorAll('[data-action="open"]').length >= 2, 'в соседях меньше двух видов');
    });

    await check('сравнение: таблица и выгрузка', async () => {
      const cmp = q('#feed .compare');
      assert(cmp, 'нет сравнения');
      assert(cmp.querySelectorAll('table.cmp tr').length >= 3, 'строк мало');
      assert(cmp.querySelector('td.nodata'), 'нет пометки «сведений нет»');
      const res = await fetch(exportURL(cmp.querySelector('[data-action="export"]')));
      assert(res.ok, 'выгрузка сравнения: HTTP ' + res.status);
    });

    await check('чипы: память и профиль под ответом', () => {
      const chips = qa('#feed .chips .chip').map(c => c.textContent);
      assert(chips.some(c => c.includes('🧠') && c.includes('интерес')), 'нет чипа памяти: ' + chips.join(' | '));
      assert(chips.some(c => c.includes('👤')), 'нет чипа профиля');
    });

    await check('панели человека: собеседник и память', () => {
      assert(text('#panel-person').includes('«me»'), 'нет панели собеседника');
      assert(text('#panel-person .chips').includes('Кратко') || qa('#panel-person .chip.ok').length > 0, 'анкета пуста');
      assert(text('#panel-memory').includes('хищники тайги'), 'в панели памяти нет записи');
    });

    await check('журнал: события последнего хода', () => {
      assert($('tab-events').classList.contains('active'), 'не открыт журнал');
      const evs = qa('#journal-body .ev');
      assert(evs.length > 0, 'событий нет');
      assert(text('#journal-turn').includes('событ'), 'нет счётчика событий');
    });

    await check('журнал: событие раскрывается', async () => {
      const ev = qa('#journal-body .ev').find(e => e.querySelector('.ev-detail'));
      assert(ev, 'нет события с подробностями');
      click(ev.querySelector('.ev-head'));
      await until('раскрытие', () => ev.classList.contains('open'));
      assert(getComputedStyle(ev.querySelector('.ev-detail')).display === 'block', 'подробности не видны');
    });

    await check('вкладка «Промпты»: системный промпт и блоки', async () => {
      click('#tab-prompts');
      await until('промпты', () => $('tab-prompts').classList.contains('active') && q('#journal-body .prompt-block'));
      assert(text('#journal-body').includes('системный промпт'), 'нет системного промпта');
      assert(text('#journal-body').includes('инструменты'), 'нет списка инструментов');
      click('#tab-events');
      await until('журнал', () => $('tab-events').classList.contains('active'));
    });

    await check('«журнал хода» переключает журнал', async () => {
      const first = app.conv.turnList[0].id;
      click(`#feed [data-action="selectTurn"][data-arg="${first}"]`);
      await until('выбор хода', () => app.selected === first && q(`#turn-${first}.selected`));
    });

    await check('«почему так» ведёт к событию журнала', async () => {
      const btn = qa('#feed .acard .why').find(b => b.dataset.call);
      assert(btn, 'нет кнопки «?» с вызовом');
      const call = btn.dataset.call;
      click(btn);
      await until('событие вызова', () => qa('#journal-body .ev.open').some(e => e.dataset.call === call));
      assert(app.selected === btn.dataset.turn, 'журнал не того хода');
    });

    await check('выгрузка карточки в markdown', async () => {
      const btn = q('#feed .acard [data-action="export"][data-kind="card"]');
      assert(btn, 'нет кнопки выгрузки');
      const res = await fetch(exportURL(btn));
      const body = await res.text();
      assert(res.ok, 'HTTP ' + res.status);
      assert(body.includes('Обыкновенная рысь') && body.includes('## Питание'), 'в markdown нет карточки: ' + body.slice(0, 120));
      assert((res.headers.get('Content-Disposition') || '').includes('attachment'), 'не вложение');
    });

    await check('окно «Окна»: список окон', async () => {
      click('#windows-button');
      await until('окно', () => windowOpen() && q('#window-body .wlist'));
      const names = qa('#window-body .wlist [data-action="openWindow"]').map(b => b.dataset.arg);
      ['file', 'people', 'memory', 'collections'].forEach(n => assert(names.includes(n), 'нет окна ' + n));
    });

    await check('окно «Файл диалога»', async () => {
      await openWin('file');
      assert(text('#window-body pre').includes('"schema"'), 'в файле нет schema');
      assert(text('#window-body .hint').length > 0, 'нет пути к файлу');
    });

    await check('окно «Картотека профилей»: правка анкеты', async () => {
      await openWin('people');
      const sel = q('#window-body select[data-field="level"]') || q('#window-body select[data-change="setProfileField"]');
      assert(sel, 'нет полей анкеты');
      const opt = [...sel.options].find(o => o.value && o.value !== sel.value);
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await until('тост', () => !$('toast').hidden && $('toast').textContent.includes('Анкета записана'));
      await until('перерисовка', () => q(`#window-body select[data-field="${sel.dataset.field}"]`).value === opt.value);
    });

    await check('окно «Память целиком»: запись и «забыть»', async () => {
      await openWin('memory');
      assert(text('#window-body table.grid').includes('интерес'), 'нет записи «интерес»');
      assert(q('#window-body [data-action="forgetMemory"]'), 'нет кнопки «забыть»');
    });

    await check('окно «Подборки»: список и выгрузка', async () => {
      await openWin('collections');
      assert(q('#window-body table.grid [data-action="continueCollection"]'), 'нет подборки');
      const a = q('#window-body a[href*="/export"]');
      const res = await fetch(a.getAttribute('href'));
      assert(res.ok && (await res.text()).includes('#'), 'выгрузка подборки');
      click('#window [data-action="closeWindow"]');
      await until('закрытие', () => !windowOpen());
    });

    await check('переход в другую ветку', async () => {
      const before = app.conv.turnList.length;
      const main = qa('#branches .branch').find(b => !b.classList.contains('active'));
      click(main.querySelector('[data-action="switchBranch"]'));
      await until('смена ветки', () => app.conv.turnList.length === before - 1 && !q('#feed .compare'));
      assert(q('#branches .branch.active') && !text('#branches .branch.active').includes('сравнение'), 'активна прежняя ветка');
    });

    await check('прокрутка: пульт у верха окна, журнал под ним', async () => {
      window.scrollTo(0, document.body.scrollHeight);
      await until('прокрутка', () => window.scrollY > 100, 2000);
      await sleep(100);
      const p = q('header.pult').getBoundingClientRect();
      assert(Math.abs(p.top) < 1, 'пульт съехал: top=' + p.top);
      const j = $('journal').getBoundingClientRect();
      assert(j.top >= p.bottom - 1, `журнал заходит под пульт: журнал ${Math.round(j.top)}, низ пульта ${Math.round(p.bottom)}`);
      assert(j.bottom <= window.innerHeight + 1, `журнал ниже окна: ${Math.round(j.bottom)} > ${window.innerHeight}`);
      assert(document.documentElement.scrollWidth <= window.innerWidth + 1, 'горизонтальная прокрутка');
    });
  };

  /* Диалог подборки: план утверждён, первый вид собран. */
  scenarios.collection = async () => {
    await booted();
    await check('подборка: панель с этапами', () => {
      const p = q('#panel-collection');
      assert(p, 'нет панели подборки');
      const steps = qa('#panel-collection .stage-step').map(s => s.textContent);
      assert(steps.join(',') === 'план,сбор,сверка,принята', 'этапы: ' + steps);
      assert(text('#panel-collection .stage-step.now') === 'сбор', 'текущий этап: ' + text('#panel-collection .stage-step.now'));
      assert(q('#panel-collection .stage-step.past'), 'нет пройденного этапа');
    });
    await check('подборка: виды и права этапа', () => {
      const items = qa('#panel-collection .items .item').map(i => i.textContent);
      assert(items.length === 2, 'видов ' + items.length);
      assert(items[0].includes('●'), 'первый вид не отмечен собранным: ' + items[0]);
      assert(qa('#panel-collection .chip.ok').length > 0, 'нет разрешённых инструментов');
      assert(qa('#panel-collection .chip.warn').some(c => c.textContent.includes('🔒')), 'нет запертых инструментов');
    });
    await check('подборка: чипы переходов в ленте', () => {
      const chips = qa('#feed .chip').map(c => c.textContent);
      assert(chips.some(c => c.includes('📋') && c.includes('→')), 'нет чипа перехода этапа: ' + chips.join(' | '));
    });
    await check('подборка: карточка собранного вида', () => {
      assert(q('#feed article.acard'), 'карточки вида нет в ленте');
      assert(q('#panel-collection [data-action="open"]'), 'у вида нет ссылки «карточка»');
    });
  };

  /* Пустой диалог: заглушка, затем «Новый диалог» и живой ход. */
  scenarios.empty = async () => {
    await until('загрузка', () => app.conv && q('#feed .empty-feed'), 8000);
    await check('пустое состояние: подсказка и примеры', () => {
      assert(text('#feed .empty-feed h2') === 'Спросите про животное', 'заголовок');
      assert(qa('#feed .examples [data-action="example"]').length === 5, 'примеров не пять');
      assert(text('#context').includes('появится'), 'шкала контекста без хода');
      assert(text('#journal-body').includes('Журнал хода появится'), 'журнал без хода');
    });
    await check('«Новый диалог» заводит пустой диалог', async () => {
      const before = app.convs.length, old = app.conv.id;
      click('#new-dialog');
      await until('новый диалог', () => app.conv.id !== old && app.convs.length === before + 1);
      assert(location.hash === '#c=' + app.conv.id, 'адрес не обновлён: ' + location.hash);
      assert(q('#feed .empty-feed'), 'новый диалог не пустой');
    });
    await check('живой ход из композера: карточка по мере сборки', async () => {
      $('composer-text').value = 'рысь';
      q('#composer button[type="submit"]').click();
      await until('ход пошёл', () => app.live || app.conv.turnList.length, 5000);
      await until('ход записан', () => !app.live && app.conv.turnList.length === 1, 20000);
      assert(text('#feed .acard h3') === 'Обыкновенная рысь', 'карточки нет: ' + text('#feed'));
      assert(!$('send-button').disabled, 'кнопка «Отправить» осталась выключенной');
      assert(qa('#dialog-select option').some(o => o.selected && o.textContent.includes('(1)')), 'список диалогов не обновился');
    });
  };

  /* «Интересные факты»: подставной демон (edgeFacts в edge_test.go) —
     подключён, лента из трёх выпусков (один с разметкой в текстах), две
     сводки; поиск «ошибка» отвечает 422. */
  const factsCalls = [];
  function spyFetch() {
    const orig = window.fetch;
    window.fetch = (url, opts) => {
      factsCalls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body });
      return orig(url, opts);
    };
  }
  const factsBody = () => text('#facts-body');
  async function openFacts() {
    await until('кнопка раздела на пульте', () => q('#facts-button'), 8000);
    click('#facts-button');
    await until('окно фактов', () => windowOpen() && q('#facts-root') && $('window-title').textContent === 'Интересные факты', 8000);
  }

  scenarios.facts = async () => {
    spyFetch();
    await booted();
    let asked = '';
    window.confirm = msg => { asked = msg; return true; };

    await check('факты: кнопка на пульте с состоянием демона', async () => {
      const b = await until('кнопка', () => q('#facts-button'));
      assert(b.closest('#pult'), 'кнопка не на пульте');
      await until('точка «подключён»', () => q('#facts-button .facts-dot.ok'));
      assert(b.title.includes('подключён'), 'подсказка: ' + b.title);
    });

    await check('факты: окно и строка состояния', async () => {
      await openFacts();
      const s = text('#facts-status');
      assert(s.includes('демон подключён'), 'нет «подключён»: ' + s);
      assert(s.includes('через 35 мин'), 'нет следующего выпуска: ' + s);
      assert(s.includes('осталось $0.4877'), 'нет остатка бюджета: ' + s);
      assert(app.facts.timer, 'опрос статуса не запущен');
    });

    await check('факты: лента карточками', () => {
      const cards = qa('#facts-body .facts-card');
      assert(cards.length === 3, 'карточек ' + cards.length);
      const c = cards[0];
      assert(text('#facts-body .facts-card h3') === 'Манул: кошка с круглыми зрачками', 'заголовок: ' + text('#facts-body .facts-card h3'));
      assert(c.querySelector('.facts-species').textContent.includes('Манул') && c.querySelector('.latin').textContent === 'Otocolobus manul', 'вид');
      assert(c.textContent.includes('МСОП: LC'), 'нет статуса МСОП');
      assert(c.querySelector('.facts-lead').textContent.includes('холодных степях'), 'нет вступления');
      assert(c.querySelectorAll('.facts-facts li').length === 3, 'фактов не три');
      assert(c.querySelector('.facts-meta').textContent.includes('$0.0021'), 'нет цены');
      assert(cards[1].classList.contains('facts-thin') && cards[1].textContent.includes('мало фактов'), 'тонкий выпуск не помечен');
    });

    await check('факты: номера источников это ссылки в новом окне', () => {
      const links = qa('#facts-body .facts-card:first-child a.facts-src');
      assert(links.length === 3, 'ссылок ' + links.length);
      assert(links.every(a => a.target === '_blank' && a.rel.includes('noopener') && /^https:/.test(a.href)), 'ссылка без _blank/noopener/https');
      assert(links[0].textContent === 'S1' && links[0].href.includes('mammaldiversity'), 'первая ссылка: ' + links[0].outerHTML);
      assert(!q('#facts-root a[href^="javascript"]'), 'javascript: стал ссылкой');
      assert(qa('#facts-body .facts-src.none').some(s => s.textContent === 'S3'), 'источник без годной ссылки не показан номером');
    });

    await check('факты: вне ареала MDD с пояснением', () => {
      const r = text('#facts-body .facts-card:first-child .facts-range');
      assert(r.includes('вне ареала MDD: Germany, Japan'), 'отметка: ' + r);
      assert(r.includes('зоопарки') && r.includes('интродукция'), 'нет пояснения: ' + r);
    });

    await check('факты: разметка из ответов показана буквами', () => {
      assert(!q('#facts-root img') && !q('#facts-root script') && !q('#facts-root b') && !q('#facts-root i'), 'в окне появился элемент из текста выпуска');
      assert(window.__xss === undefined, 'выполнился код из выпуска: ' + window.__xss);
      const hedgehog = qa('#facts-body .facts-card')[1];
      assert(hedgehog.textContent.includes('<img src=x onerror='), 'текст факта не виден буквами');
      assert(hedgehog.querySelector('h3').textContent.startsWith('<script>'), 'заголовок: ' + hedgehog.querySelector('h3').textContent);
    });

    await check('факты: клик по карточке открывает подробности', async () => {
      click('#facts-body .facts-card[data-issue="3"] .facts-lead');
      await until('подробности', () => q('#facts-body .facts-card.full') && q('#facts-body .facts-spend'));
      const b = factsBody();
      assert(b.includes('Манул — предок домашней кошки') && b.includes('причина: источник этого не говорит'), 'нет отброшенного факта с причиной');
      assert(b.includes('1 532') && b.includes('88'), 'нет наблюдений: ' + b.slice(0, 200));
      assert(q('#facts-body tr.facts-out'), 'страна вне ареала не выделена');
      assert(qa('#facts-body .facts-spend tr').length === 4 && b.includes('редактор') && b.includes('проверяющий'), 'нет расхода по шагам');
      assert(factsCalls.some(c => c.url.endsWith('/api/facts/issue?id=3')), 'не спросили /issue?id=3');
      click('#facts-back');
      await until('назад к ленте', () => qa('#facts-body .facts-card').length === 3);
    });

    await check('факты: клик по источнику не открывает подробности', async () => {
      const a = q('#facts-body .facts-card:first-child a.facts-src');
      a.addEventListener('click', e => e.preventDefault(), { once: true }); // не открывать вкладку в тесте
      const before = factsCalls.length;
      a.click();
      await sleep(200);
      assert(!q('#facts-body .facts-card.full'), 'открылись подробности');
      assert(!factsCalls.slice(before).some(c => c.url.includes('/issue')), 'ушёл запрос выпуска');
    });

    await check('факты: поиск над лентой', async () => {
      $('facts-query').value = 'манул';
      click('#facts-search button[type="submit"]');
      await until('выдача', () => q('#facts-body table.facts-found'));
      const rows = qa('#facts-body tr.facts-row');
      assert(rows.length === 1 && rows[0].textContent.includes('Otocolobus manul'), 'строк ' + rows.length);
      assert(factsCalls.some(c => c.url.includes('/api/facts/search?text=' + encodeURIComponent('манул'))), 'не ушёл /search');
      click(rows[0]);
      await until('выпуск из поиска', () => q('#facts-body .facts-card.full'));
      assert(text('#facts-back').includes('к поиску'), 'кнопка назад: ' + text('#facts-back'));
      click('#facts-back');
      await until('снова выдача', () => q('#facts-body table.facts-found'));
    });

    await check('факты: 422 на поиске показан текстом ошибки', async () => {
      $('facts-query').value = 'ошибка';
      click('#facts-search button[type="submit"]');
      await until('ошибка', () => q('#facts-body .facts-error'));
      assert(text('#facts-body .facts-error').includes('since: ожидалась дата'), 'текст: ' + text('#facts-body .facts-error'));
      assert(!q('#facts-body .facts-down'), '422 показан как «демон не подключён»');
      click('#facts-body [data-action="factsSearchReset"]');
      await until('лента', () => qa('#facts-body .facts-card').length === 3);
    });

    await check('факты: сводки: последняя, цифры, прошлые', async () => {
      click('#facts-tab-summaries');
      await until('сводка', () => q('#facts-summary'));
      const s = text('#facts-summary');
      assert(s.includes('Сводка №2') && s.includes('три выпуска'), 'нет текста сводки: ' + s.slice(0, 120));
      const figs = qa('#facts-summary .facts-fig').map(f => f.textContent.replace(/\s+/g, ' '));
      assert(figs.some(f => f.includes('3') && f.includes('выпусков')), 'нет числа выпусков: ' + figs);
      assert(figs.some(f => f.includes('отброшено 2 (29%)')), 'нет отбраковки: ' + figs);
      assert(figs.some(f => f.includes('$0.0081')), 'нет расхода: ' + figs);
      assert(s.includes('Carnivora') && s.includes('GBIF не ответил'), 'нет отрядов или сбоев');
      const rows = qa('#facts-body .facts-sum-row');
      assert(rows.length === 2, 'прошлых сводок ' + rows.length);
      click(rows[1]);
      await until('сводка №1', () => text('#facts-summary h3').includes('Сводка №1'));
      assert(q('#facts-body .facts-sum-row.current[data-arg="1"]'), 'открытая не отмечена');
    });

    await check('факты: «Собрать выпуск»: подтверждение, ожидание, POST, лента', async () => {
      click('#facts-tab-feed');
      await until('лента', () => qa('#facts-body .facts-card').length === 3);
      click('#facts-run-issue');
      assert(asked.includes('$0.002'), 'подтверждение без цены: ' + asked);
      await until('ожидание', () => q('#facts-wait .thinking'));
      assert($('facts-run-issue').disabled && $('facts-run-summary').disabled, 'кнопки не заблокированы');
      $('facts-run-issue').click(); // повторное нажатие — мимо
      await until('итог', () => q('#facts-result'), 8000);
      const posts = factsCalls.filter(c => c.method === 'POST' && c.url.endsWith('/api/facts/run'));
      assert(posts.length === 1, 'POST /run ушло ' + posts.length);
      assert(JSON.parse(posts[0].body).job === 'issue', 'тело: ' + posts[0].body);
      assert(text('#facts-result').includes('готово') && text('#facts-result').includes('Горный тапир'), 'итог: ' + text('#facts-result'));
      await until('лента обновилась', () => qa('#facts-body .facts-card').length === 4);
      assert(text('#facts-body .facts-card h3').includes('Горный тапир'), 'новый выпуск не первым');
      assert(!$('facts-run-issue').disabled, 'кнопка осталась выключенной');
    });

    await check('факты: «Собрать сводку»: POST с hours=24 и новая сводка', async () => {
      asked = '';
      click('#facts-run-summary');
      assert(asked.includes('$0.002'), 'нет подтверждения');
      await until('итог', () => q('#facts-result'), 8000);
      const post = factsCalls.find(c => c.method === 'POST' && c.url.endsWith('/api/facts/summary/build'));
      assert(post && JSON.parse(post.body).hours === 24, 'тело: ' + (post && post.body));
      assert(text('#facts-result').includes('Сводка №3 собрана'), 'итог: ' + text('#facts-result'));
      await until('сводка №3', () => text('#facts-summary h3').includes('Сводка №3'));
    });

    await check('факты: отказ в подтверждении, запроса нет', async () => {
      window.confirm = () => false;
      const before = factsCalls.filter(c => c.method === 'POST').length;
      click('#facts-run-issue');
      await sleep(100);
      assert(factsCalls.filter(c => c.method === 'POST').length === before, 'POST ушёл без согласия');
      window.confirm = msg => { asked = msg; return true; };
    });

    await check('факты: закрытие окна останавливает опрос', async () => {
      click('#window [data-action="closeWindow"]');
      await until('закрытие', () => !windowOpen());
      await until('опрос остановлен', () => !app.facts.timer, 2000);
    });
  };

  /* Демон не отвечает: status — conn=down с подсказкой, остальное 503. */
  scenarios['facts-down'] = async () => {
    await booted();
    await check('факты-503: кнопка на пульте, демон не отвечает', async () => {
      await until('красная точка', () => q('#facts-button .facts-dot.bad'), 8000);
      assert(q('#facts-button').title.includes('не отвечает'), 'подсказка: ' + q('#facts-button').title);
    });
    await check('факты-503: строка состояния с подсказкой', async () => {
      await openFacts();
      const s = text('#facts-status');
      assert(s.includes('демон не отвечает') && s.includes('animals-mcp -http 127.0.0.1:8766'), 'состояние: ' + s);
    });
    await check('факты-503: заглушка вместо ленты, кнопки выключены', () => {
      const d = q('#facts-body .facts-down');
      assert(d && d.textContent.includes('не подключён') && d.textContent.includes('animals-mcp -http'), 'нет заглушки: ' + factsBody());
      assert(!q('#facts-search'), 'строка поиска при недоступном демоне');
      assert(!q('#facts-body .facts-card') && !q('#facts-body .facts-error'), 'лишнее в ленте');
      assert($('facts-run-issue').disabled && $('facts-run-summary').disabled, 'кнопки запуска активны');
    });
    await check('факты-503: сводки, та же заглушка', async () => {
      click('#facts-tab-summaries');
      await until('заглушка сводок', () => q('#facts-body .facts-down') && $('facts-tab-summaries').classList.contains('active'));
      assert(qa('#facts-body .facts-down').length === 1, 'заглушек ' + qa('#facts-body .facts-down').length);
    });
  };

  /* Конвейер: вкладка окна «Интересные факты», подставной REST
     (edgePipe в edge_test.go) — каждый опрос продвигает прогон на полшага;
     вид «ошибка» обрывает цепочку на summarize. В итогах шагов, тексте
     ошибки и превью файла — разметка, она не должна стать элементами. */
  const pipeState = tool => { const el = q(`.pipe-step[data-tool="${tool}"]`); return el ? el.dataset.status : ''; };
  const pipePosts = () => factsCalls.filter(c => c.method === 'POST' && c.url.endsWith('/api/pipeline/runs'));
  async function openPipe() {
    await openFacts();
    click('#facts-tab-pipeline');
    await until('вкладка конвейера', () => q('#pipe-root') && $('facts-tab-pipeline').classList.contains('active') && q('#pipe-runs') && !text('#pipe-runs').includes('загружаю'));
  }

  scenarios.pipeline = async () => {
    spyFetch();
    await booted();
    window.__xss = undefined;

    await check('конвейер: вкладка и форма', async () => {
      await openPipe();
      const qi = $('pipe-query');
      assert(qi && qi.placeholder === 'манул, Otocolobus manul или 1006010', 'поле вида: ' + (qi && qi.placeholder));
      assert($('pipe-random') && $('pipe-random').type === 'checkbox', 'нет флажка «случайный вид»');
      assert($('pipe-format-md').checked && $('pipe-pass-inline').checked && $('pipe-mode-code').checked, 'умолчания формы');
      assert(q('#pipe-mode-agent') && q('#pipe-format-json') && q('#pipe-pass-ref'), 'нет вариантов формата, передачи или исполнителя');
      assert(text('#pipe-run') === 'Запустить цепочку' && !$('pipe-run').disabled, 'кнопка запуска');
    });

    await check('конвейер: схема из трёх шагов со стрелками', () => {
      const steps = qa('#pipe-chain .pipe-step');
      assert(steps.map(s => s.dataset.tool).join(',') === 'search,summarize,save_to_file', 'шаги: ' + steps.map(s => s.dataset.tool));
      assert(steps.every(s => s.dataset.status === 'pending' && s.textContent.includes('ожидает')), 'не все «ожидает»');
      assert(qa('#pipe-chain .pipe-arrow').length === 2, 'стрелок не две');
      assert(text('#pipe-runs').includes('Прогонов ещё не было'), 'список: ' + text('#pipe-runs'));
    });

    await check('конвейер: пустой вид: подсказка, запроса нет', async () => {
      $('pipe-query').value = '';
      click('#pipe-run');
      await until('подсказка', () => q('#pipe-error'));
      assert(text('#pipe-error').includes('случайный вид'), 'текст: ' + text('#pipe-error'));
      assert(!pipePosts().length, 'POST ушёл с пустым видом');
    });

    await check('конвейер: запуск: POST с параметрами формы', async () => {
      $('pipe-query').value = 'манул';
      $('pipe-query').dispatchEvent(new Event('input', { bubbles: true }));
      click('#pipe-pass-ref');
      click('#pipe-run');
      await until('POST', () => pipePosts().length === 1);
      const body = JSON.parse(pipePosts()[0].body);
      assert(body.query === 'манул' && body.random === false && body.format === 'md' && body.pass === 'ref' && body.mode === 'code',
        'тело: ' + pipePosts()[0].body);
      assert(!q('#pipe-error'), 'осталась подсказка о пустом виде');
    });

    await check('конвейер: шаги по мере выполнения, анимация у идущего', async () => {
      await until('search идёт', () => pipeState('search') === 'running');
      assert(pipeState('summarize') === 'pending' && pipeState('save_to_file') === 'pending', 'остальные не ждут');
      assert($('pipe-run').disabled, 'кнопка не заблокирована');
      const st = q('.pipe-step[data-tool="search"]');
      assert(getComputedStyle(st, '::after').animationName === 'pipe-run', 'нет анимации: ' + getComputedStyle(st, '::after').animationName);
      assert(q('#pipe-status .thinking'), 'нет «идёт» в строке прогона');
      await until('summarize идёт', () => pipeState('summarize') === 'running');
      assert(pipeState('search') === 'ok', 'search не готов');
      $('pipe-run').click(); // повторное нажатие — мимо
    });

    await check('конвейер: итог: три шага готовы, проверки и отпечатки', async () => {
      await until('конец', () => q('#pipe-result'), 8000);
      assert(['search', 'summarize', 'save_to_file'].every(t => pipeState(t) === 'ok'), 'не все готовы');
      assert(pipePosts().length === 1, 'POST ушёл повторно: ' + pipePosts().length);
      const s1 = q('.pipe-step[data-tool="search"]');
      assert(s1.querySelector('.pipe-summary').textContent.includes('Манул (Otocolobus manul): 9 материалов'), 'итог шага');
      assert(s1.querySelector('.pipe-digest code').textContent === '1111aaaa2222', 'отпечаток: ' + s1.querySelector('.pipe-digest code').textContent);
      const checks = qa('.pipe-step[data-tool="summarize"] .pipe-checks li');
      assert(checks.length === 3 && checks.every(li => li.classList.contains('ok') && li.textContent.includes('✓')), 'проверки: ' + checks.map(c => c.textContent));
      const links = qa('#pipe-chain .pipe-link');
      assert(links.length === 2 && links[0].textContent.includes('вход = выход шага 1 ✓') && links[1].textContent.includes('вход = выход шага 2 ✓'),
        'стрелки: ' + links.map(l => l.textContent));
      assert(text('.pipe-step[data-tool="summarize"] .pipe-meta').includes('$0.0021'), 'цена шага');
      assert(text('.pipe-step[data-tool="search"] .pipe-meta').includes('1,2 с'), 'время шага: ' + text('.pipe-step[data-tool="search"] .pipe-meta'));
      assert(text('#pipe-status').includes('готово'), 'строка прогона: ' + text('#pipe-status'));
    });

    await check('конвейер: файл: путь, размер, sha256, превью, цена и время', () => {
      assert(text('#pipe-file') === 'exports/otocolobus-manul.md', 'путь: ' + text('#pipe-file'));
      assert(text('#pipe-size') === '2,1 КБ', 'размер: ' + text('#pipe-size'));
      assert(text('#pipe-sha') === '5eed5eed0123', 'sha: ' + text('#pipe-sha'));
      const pre = $('pipe-preview');
      assert(pre && pre.tagName === 'PRE' && pre.textContent.includes('# Манул') && pre.textContent.includes('Зрачки манула'), 'превью');
      const r = text('#pipe-result');
      assert(r.includes('$0.0021') && r.includes('всего'), 'итог: ' + r);
      assert(!$('pipe-run').disabled, 'кнопка осталась выключенной');
    });

    await check('конвейер: разметка из данных не исполняется', () => {
      assert(window.__xss === undefined, 'исполнился код: __xss=' + window.__xss);
      assert(!q('#pipe-root img') && !q('#pipe-root script') && !qa('#pipe-root b').some(b => b.textContent === 'проверены'), 'элемент из данных в окне');
      assert(text('#pipe-preview').includes('<script>window.__xss=22</script>'), 'разметка превью не показана буквами');
      assert(text('.pipe-step[data-tool="search"] .pipe-summary').includes('<img src=x'), 'разметка итога не показана буквами');
    });

    await check('конвейер: список последних прогонов', async () => {
      await until('строка', () => q('#pipe-runs tr.pipe-run-row'));
      const rows = qa('#pipe-runs tr.pipe-run-row');
      assert(rows.length === 1 && rows[0].textContent.includes('манул') && rows[0].textContent.includes('готово') &&
        rows[0].textContent.includes('exports/otocolobus-manul.md'), 'строка: ' + (rows[0] && rows[0].textContent));
      assert(rows[0].classList.contains('current'), 'открытый прогон не отмечен');
    });

    await check('конвейер: ошибка шага красным, с текстом', async () => {
      $('pipe-query').value = 'ошибка';
      $('pipe-query').dispatchEvent(new Event('input', { bubbles: true }));
      click('#pipe-mode-agent');
      click('#pipe-run');
      await until('конец', () => q('#pipe-result.bad'), 8000);
      const body = JSON.parse(pipePosts()[1].body);
      assert(body.mode === 'agent' && body.pass === 'ref', 'тело: ' + pipePosts()[1].body);
      assert(pipeState('search') === 'ok' && pipeState('summarize') === 'failed' && pipeState('save_to_file') === 'pending', 'состояния шагов');
      const err = q('.pipe-step[data-tool="summarize"] .pipe-step-error');
      assert(err && err.textContent.includes('редактор не ответил вовремя'), 'текст шага');
      assert(getComputedStyle(err).color === getComputedStyle(q('#pipe-result.bad')).color, 'ошибка не тем цветом');
      assert(text('#pipe-result').includes('на шаге 2 (summarize)') && text('#pipe-result').includes('редактор не ответил'), 'итог: ' + text('#pipe-result'));
      assert(window.__xss === undefined && !q('#pipe-root script'), 'исполнился код из текста ошибки');
      await until('два прогона в списке', () => qa('#pipe-runs tr.pipe-run-row').length === 2);
      assert(q('#pipe-runs tr.pipe-run-row .chip.bad'), 'ошибка не отмечена в списке');
    });

    await check('конвейер: случайный вид: поле выключено, в запросе random', async () => {
      click('#pipe-random');
      await until('поле выключено', () => $('pipe-query').disabled);
      click('#pipe-run');
      await until('POST', () => pipePosts().length === 3);
      const body = JSON.parse(pipePosts()[2].body);
      assert(body.random === true && body.query === '', 'тело: ' + pipePosts()[2].body);
      await until('конец', () => q('#pipe-result.ok'), 8000);
      assert(text('#pipe-status').includes('случайный вид'), 'строка: ' + text('#pipe-status'));
    });

    await check('конвейер: старый прогон из списка', async () => {
      const row = qa('#pipe-runs tr.pipe-run-row').find(r => r.dataset.arg === 'p1');
      click(row);
      await until('прогон p1', () => q('#pipe-status[data-run="p1"]') && q('#pipe-result.ok'));
      assert(q('#pipe-runs tr.pipe-run-row.current[data-arg="p1"]'), 'не отмечен');
    });

    await check('конвейер: форма переживает перерисовку окна', async () => {
      $('pipe-query').value = 'рысь';
      $('pipe-query').dispatchEvent(new Event('input', { bubbles: true }));
      click('#facts-tab-feed');
      await until('лента', () => q('#facts-body .facts-card'));
      click('#facts-tab-pipeline');
      await until('вкладка', () => q('#pipe-root'));
      assert($('pipe-query').value === 'рысь' && $('pipe-mode-agent').checked && $('pipe-random').checked, 'форма сброшена');
    });
  };

  /* Снимки экрана: только довести страницу до нужного вида. */
  scenarios['shot-top'] = async () => { await until('загрузка', () => app.conv, 8000); await sleep(300); };
  scenarios['shot-bottom'] = async () => {
    await booted();
    await sleep(300);
    document.body.scrollTop = document.body.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
  };
  scenarios['shot-people'] = async () => { await booted(); await openWin('people'); };
  scenarios['shot-facts'] = async () => { await booted(); await openFacts(); };
  scenarios['shot-facts-detail'] = async () => {
    await booted();
    await openFacts();
    click('#facts-body .facts-card[data-issue="3"] .facts-lead');
    await until('подробности', () => q('#facts-body .facts-spend'));
  };
  scenarios['shot-facts-summary'] = async () => {
    await booted();
    await openFacts();
    click('#facts-tab-summaries');
    await until('сводка', () => q('#facts-summary'));
  };
  scenarios['shot-facts-down'] = async () => { await booted(); await openFacts(); };
  scenarios['shot-pipeline'] = async () => {
    await booted();
    await openPipe();
    $('pipe-query').value = 'манул';
    $('pipe-query').dispatchEvent(new Event('input', { bubbles: true }));
    click('#pipe-run');
    await until('итог', () => q('#pipe-result'), 8000);
  };

  // ===== Окно «MCP-серверы» (v20) =====

  /* Подставной REST (edgeHub в edge_test.go): настоящий hubapi с подставным
     реестром из трёх серверов (до «Подключить все» — idle) и прогоном,
     который двигается по опросам окна: каждый GET прогона завершает идущий
     вызов и начинает следующий. Флоу — 13 вызовов, facts_get отвечает
     ошибкой, в итоге одна проверка ⚠. В аргументах, ответе, превью и
     причине скрытого маршрута — разметка: она не должна стать элементами. */
  const hubPosts = path => factsCalls.filter(c => c.method === 'POST' && c.url.endsWith('/api/hub/' + path));
  const rgb = el => getComputedStyle(el).color;
  async function openHub() {
    await until('кнопка на пульте', () => q('#hub-button'), 8000);
    click('#hub-button');
    await until('окно серверов', () => windowOpen() && q('#hub-root') && $('window-title').textContent === 'MCP-серверы' && q('#hub-servers-root .hub-bar'), 8000);
  }
  async function hubConnect() {
    click('#hub-connect');
    await until('подключены', () => qa('.hub-server[data-status="ok"]').length === 3 && q('#hub-routes'), 8000);
  }
  async function hubStartFlow() {
    click('[data-hub-tab="flow"]');
    await until('форма флоу', () => q('#hub-form') && q('#hub-preset option') && q('#hub-runs table, #hub-runs p'));
    click('#hub-run');
  }

  scenarios.hub = async () => {
    spyFetch();
    await booted();
    window.__xss = undefined;

    await check('серверы: окно в списке окон, кнопка на пульте', async () => {
      click('#windows-button');
      await until('список окон', () => windowOpen() && q('#window-body .wlist'));
      assert(q('#window-body .wlist [data-arg="hub"]') && text('#window-body .wlist [data-arg="hub"]') === 'MCP-серверы', 'нет окна hub в списке');
      click('#window [data-action="closeWindow"]');
      await until('закрытие', () => !windowOpen());
      const b = await until('кнопка', () => q('#hub-button'));
      assert(b.closest('#pult'), 'кнопка не на пульте');
      await until('три точки серверов', () => qa('#hub-button .hub-pdot').length === 3);
      assert(b.title.includes('sources: не подключался'), 'подсказка: ' + b.title);
    });

    await check('серверы: три сервера до подключения', async () => {
      await openHub();
      assert(q('[data-hub-tab="servers"]').classList.contains('active'), 'открыта не вкладка «Серверы»');
      const rows = qa('.hub-server');
      assert(rows.map(r => r.dataset.name).join(',') === 'sources,daemon,notes', 'серверы: ' + rows.map(r => r.dataset.name));
      assert(rows.every(r => r.dataset.status === 'idle' && r.textContent.includes('не подключался')), 'не все idle');
      assert(text('.hub-server[data-name="daemon"] .hub-transport') === 'HTTP' && text('.hub-server[data-name="notes"] .hub-transport') === 'stdio', 'транспорт');
      assert(text('.hub-server[data-name="daemon"] .hub-addr') === 'http://127.0.0.1:8766/mcp', 'адрес: ' + text('.hub-server[data-name="daemon"] .hub-addr'));
      assert(q('#hub-routes-empty') && !q('.hub-route'), 'маршруты до подключения');
      assert(!hubPosts('connect').length, 'окно подключилось само');
    });

    await check('серверы: «Подключить все»: статусы, initialize, PID, цвета', async () => {
      click('#hub-connect');
      assert($('hub-connect').disabled && text('#hub-connect').includes('подключаю'), 'нет ожидания: ' + text('#hub-connect'));
      await until('подключены', () => qa('.hub-server[data-status="ok"]').length === 3, 8000);
      assert(hubPosts('connect').length === 1, 'POST connect ушло ' + hubPosts('connect').length);
      const d = text('.hub-server[data-name="daemon"]');
      assert(d.includes('animals-daemon') && d.includes('20.0.0') && d.includes('5120') && d.includes('3 выдано') && d.includes('5 скрыто'), 'строка демона: ' + d);
      assert(text('.hub-server[data-name="sources"] .hub-status') === 'подключён', 'статус');
      assert(getComputedStyle(q('.hub-server[data-name="sources"] .hub-swatch')).backgroundColor === 'rgb(47, 107, 79)', 'цвет sources');
      assert(getComputedStyle(q('.hub-server[data-name="notes"] .hub-swatch')).backgroundColor === 'rgb(165, 112, 26)', 'цвет notes');
      assert(qa('#hub-button .hub-pdot.ok').length === 3, 'точки на пульте не обновились');
    });

    await check('маршруты: инструмент → сервер, скрытые приглушены с причиной', () => {
      const rows = qa('.hub-route');
      assert(rows.length === 18 && qa('.hub-route.hidden').length === 6, `маршрутов ${rows.length}, скрытых ${qa('.hub-route.hidden').length}`);
      const mdd = q('.hub-route[data-tool="mdd_get"]');
      assert(mdd.dataset.server === 'daemon' && !mdd.classList.contains('hidden') && mdd.textContent.includes('выдан'), 'mdd_get');
      assert(rgb(mdd.querySelector('.hub-tag')) === 'rgb(44, 90, 133)', 'цвет метки: ' + rgb(mdd.querySelector('.hub-tag')));
      const dup = q('.hub-route.hidden[data-tool="search_wikipedia"]');
      assert(dup && dup.dataset.server === 'daemon' && dup.textContent.includes('дубль → sources'), 'дубль');
      assert(Number(getComputedStyle(dup.querySelector('td')).opacity) < 1, 'скрытая строка не приглушена');
      assert(q('.hub-route.hidden[data-tool="server_info"][data-server="notes"]').textContent.includes('служебный'), 'служебный');
      assert(q('.hub-route[data-tool="run_now"]').textContent.includes('не разрешён <img src=x'), 'причина не буквами');
      assert(text('.hub-sum').includes('модели выдано 12 инструментов, скрыто 6'), 'сводка: ' + text('.hub-sum'));
    });

    await check('флоу: вкладка, заготовка и вид по умолчанию', async () => {
      click('[data-hub-tab="flow"]');
      await until('форма', () => q('#hub-form') && q('[data-hub-tab="flow"]').classList.contains('active'));
      const opts = qa('#hub-preset option');
      assert(opts.length === 2 && $('hub-preset').value === 'passport' && opts[0].textContent === 'Паспорт вида в блокнот', 'заготовки');
      assert($('hub-species').value === 'манул', 'вид: ' + $('hub-species').value);
      assert(text('#hub-run') === 'Запустить флоу' && !$('hub-run').disabled, 'кнопка');
      assert(qa('#hub-legend .hub-tag').length === 3, 'легенда серверов');
      await until('список прогонов', () => text('#hub-runs').includes('Прогонов ещё не было'));
    });

    await check('флоу: другая заготовка, её вид', () => {
      const sel = $('hub-preset');
      sel.value = 'brief';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      assert($('hub-species').value === 'рысь', 'вид: ' + $('hub-species').value);
      sel.value = 'passport';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      assert($('hub-species').value === 'манул', 'вид не вернулся');
    });

    await check('флоу: запуск: POST с заготовкой и видом', async () => {
      click('#hub-run');
      await until('POST', () => hubPosts('flows').length === 1);
      const body = JSON.parse(hubPosts('flows')[0].body);
      assert(body.preset === 'passport' && body.species === 'манул', 'тело: ' + hubPosts('flows')[0].body);
    });

    await check('флоу: вызовы по мере хода, идущий подсвечен', async () => {
      await until('№1 идёт', () => q('.hub-call[data-n="1"][data-state="running"]'));
      assert($('hub-run').disabled, 'кнопка не заблокирована');
      assert(q('#hub-status .thinking'), 'нет «идёт» в строке прогона');
      await until('№3 идёт', () => q('.hub-call[data-n="3"][data-state="running"]'));
      assert(q('.hub-call[data-n="1"][data-state="ok"]') && q('.hub-call[data-n="2"][data-state="ok"]'), '№1–2 не готовы');
      assert(qa('.hub-call').length === 3, 'вызовов ' + qa('.hub-call').length);
      const row = q('.hub-call[data-n="3"]');
      assert(row.dataset.server === 'daemon' && row.dataset.tool === 'mdd_search', '№3: ' + row.dataset.server + ' ' + row.dataset.tool);
      assert(rgb(row.querySelector('.hub-tag')) === 'rgb(44, 90, 133)', 'цвет сервера у вызова');
      assert(getComputedStyle(row.children[0]).borderLeftColor === 'rgb(44, 90, 133)', 'полоса сервера: ' + getComputedStyle(row.children[0]).borderLeftColor);
      assert(getComputedStyle(row.children[1], '::after').animationName === 'pipe-run', 'нет анимации у идущего');
      assert(text('.hub-call[data-n="1"] .hub-args') === 'query: манул', 'аргументы: ' + text('.hub-call[data-n="1"] .hub-args'));
      $('hub-run').click(); // повторное нажатие — мимо
    });

    await check('флоу: итог: 13 вызовов трёх серверов, ошибка facts_get, «← из №k»', async () => {
      await until('итог', () => q('#hub-result'), 20000);
      const rows = qa('.hub-call');
      assert(rows.length === 13, 'вызовов ' + rows.length);
      assert([...new Set(rows.map(r => r.dataset.server))].sort().join(',') === 'daemon,notes,sources', 'серверы');
      const fg = q('.hub-call[data-tool="facts_get"]');
      assert(fg.dataset.state === 'fail' && fg.querySelector('.hub-mark').textContent === '✗' && fg.textContent.includes('выпуска о виде 1006010 нет'), 'facts_get');
      assert(qa('.hub-call[data-state="ok"]').length === 12, 'готовых не 12');
      assert(text('.hub-call[data-n="4"] .hub-from-cell') === '← из №3', '№4: ' + text('.hub-call[data-n="4"] .hub-from-cell'));
      assert(qa('.hub-call[data-n="10"] .hub-from').length === 2, 'у №10 не две стрелки');
      assert(hubPosts('flows').length === 1, 'POST ушёл повторно');
      assert(text('#hub-status').includes('готово') && text('#hub-status').includes('13 вызовов'), 'строка: ' + text('#hub-status'));
      assert(!$('hub-run').disabled, 'кнопка осталась выключенной');
    });

    await check('флоу: проверки ✓ и одна ⚠ с пояснением', () => {
      const cs = qa('.hub-check');
      assert(cs.length === 10, 'проверок ' + cs.length);
      const warn = qa('.hub-check[data-level="warn"]');
      assert(warn.length === 1 && warn[0].textContent.includes('⚠') && warn[0].textContent.includes('facts_get') && warn[0].textContent.includes('допустима'), 'предупреждение');
      assert(qa('.hub-check[data-level="ok"]').every(c => c.querySelector('.hub-check-mark').textContent === '✓'), 'нет ✓');
      assert(q('#hub-result.ok') && text('#hub-result').includes('Флоу прошёл проверки (предупреждений: 1)'), 'итог: ' + text('#hub-result .hub-result-head'));
    });

    await check('флоу: серверы подтвердили, ответ, файл, превью, цена', () => {
      assert(qa('.hub-delta').length === 3, 'дельт ' + qa('.hub-delta').length);
      assert(text('.hub-delta[data-server="notes"] .hub-dt[data-tool="nb_add"]') === 'nb_add 3 / 3 ✓', 'nb_add: ' + text('.hub-delta[data-server="notes"] .hub-dt[data-tool="nb_add"]'));
      assert(text('#hub-file') === 'notes/otocolobus-manul.md', 'файл: ' + text('#hub-file'));
      const pre = $('hub-preview');
      assert(pre && pre.tagName === 'PRE' && pre.textContent.includes('# Паспорт: манул') && pre.textContent.includes('Pallas'), 'превью');
      assert(text('#hub-cost') === '$0.0123' && text('#hub-result').includes('ходов 10'), 'цена и ходы');
      assert(text('#hub-answer').startsWith('Паспорт манула записан в блокнот'), 'ответ');
    });

    await check('флоу: разметка из данных не исполняется', () => {
      assert(window.__xss === undefined, 'исполнился код: __xss=' + window.__xss);
      assert(!q('#hub-root img') && !q('#hub-root script'), 'элемент из данных в окне');
      assert(text('#hub-answer').includes('<script>window.__xss=32</script>'), 'ответ не буквами');
      assert(text('#hub-preview').includes('<script>window.__xss=33</script>'), 'превью не буквами');
      assert(text('.hub-call[data-n="10"] .hub-args').includes('<img src=x'), 'аргументы не буквами');
    });

    await check('флоу: список прогонов', async () => {
      await until('строка', () => q('#hub-runs tr.hub-run-row'));
      const rows = qa('#hub-runs tr.hub-run-row');
      assert(rows.length === 1 && rows[0].textContent.includes('манул') && rows[0].textContent.includes('готово') && rows[0].textContent.includes('13'),
        'строка: ' + (rows[0] && rows[0].textContent));
      assert(rows[0].classList.contains('current'), 'открытый прогон не отмечен');
    });

    await check('флоу: вид переживает смену вкладок; счётчики серверов выросли', async () => {
      $('hub-species').value = 'рысь';
      $('hub-species').dispatchEvent(new Event('input', { bubbles: true }));
      click('[data-hub-tab="servers"]');
      await until('серверы', () => q('.hub-server'));
      const calls = name => q(`.hub-server[data-name="${name}"]`).lastElementChild.textContent.trim();
      assert(calls('sources') === '5' && calls('daemon') === '3' && calls('notes') === '5', `вызовов: ${calls('sources')}/${calls('daemon')}/${calls('notes')}`);
      click('[data-hub-tab="flow"]');
      await until('флоу', () => q('#hub-form'));
      assert($('hub-species').value === 'рысь', 'вид сброшен: ' + $('hub-species').value);
      assert(q('#hub-result'), 'итог прогона пропал');
    });
  };

  scenarios['shot-hub-servers'] = async () => {
    await booted();
    await openHub();
    await hubConnect();
  };
  scenarios['shot-hub'] = async () => {
    await booted();
    await openHub();
    await hubConnect();
    await hubStartFlow();
    await until('итог', () => q('#hub-result'), 20000);
    await sleep(300);
  };

  async function run() {
    const name = new URLSearchParams(location.search).get('scenario') || 'main';
    const fn = scenarios[name];
    if (!fn) { write('FAIL сценарий — нет сценария ' + name); write('DONE'); return; }
    try {
      await fn();
    } catch (e) {
      write('FAIL ' + name + ' — ' + (e && e.message || e));
    }
    if (!name.startsWith('shot')) {
      await check(name + ': без ошибок JavaScript', () => assert(!errors.length, errors.join('; ')));
    }
    write('DONE');
  }
  run();
})();
