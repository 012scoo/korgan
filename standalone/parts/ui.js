/* Интерфейс «Қорған». Все решения принимает движок (KorganEngine); страница показывает его состояние и шлёт действия.
   api() повторяет маршруты backend/app.py, поэтому тот же интерфейс можно подключить к настоящему серверу.
   Движение: короткие переходы с замедлением (240 мс), нижние листы для подтверждений, экраны поверх для мастеров. */
(function () {
  'use strict';
  var E = KorganEngine.create();
  // Запуск: восстанавливаем демо с того места, где его закрыли; если сохранения нет — главный сценарий, экран «Главная».
  var SAVE_KEY = 'korgan-session-v2', restored = null;
  try { var sv = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (sv && sv.state && E.restore(sv.state)) restored = sv.view || {}; } catch (e) { restored = null; }
  if (!restored) E.reset(8);
  var SPM = 1;                                   // секунд реального времени на минуту сценария (переключатель «Ускоренное время»)
  var ui = {
    tab: 'Home', svc: 'main', svcFilter: 'all', hist: 'all', hide: false, font: false, scenario: null, booting: true,
    overlay: null, error: null, myOps: {}, shownBal: null,
    tr: { step: 'pick', mode: 'people', rid: null }, autoAsked: {}, moreScen: false, paused: false, favEdit: false
  };
  var S = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmtN = function (n) { return Math.round(Number(n)).toLocaleString('ru-RU'); };
  var fmt = function (n) { return fmtN(n) + ' ₸'; };
  var digits = function (s) { return String(s || '').replace(/\D/g, ''); };
  var ZONE = { green: ['green', 'Проведено сразу'], yellow: ['yellow', 'Нужно подтверждение'], red: ['red', 'Пауза и два подтверждения'] };
  var CALL_TEXT = { none: 'нет', known: 'знакомый', unknown: 'незнакомый номер' };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- иконки (собственные, линейные) ----------
  var P = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>',
    transfer: '<path d="M7 7h12m-3.5-3.5L19 7l-3.5 3.5M17 17H5m3.5 3.5L5 17l3.5-3.5"/>',
    pay: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M7.5 14.5h3"/>',
    hist: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    svc: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
    shield: '<path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    call: '<path d="M6.5 4h3l1.5 4-2 1.3a10 10 0 0 0 5.7 5.7l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"/>',
    alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5M12 14.5v2"/>',
    card: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M7.5 14.5h3"/>',
    house: '<path d="M5 19.5V10l7-5.5 7 5.5v9.5"/><path d="M3.5 19.5h17M10 19.5v-5h4v5"/>',
    bag: '<path d="M5.5 8h13l-1 11.5h-11z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
    wifi: '<path d="M4 9.5a12 12 0 0 1 16 0M7 13a7.5 7.5 0 0 1 10 0M10 16.5a3 3 0 0 1 4 0"/><path d="M12 19.5v.01"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
    bus: '<rect x="5" y="4" width="14" height="13" rx="3"/><path d="M5 11h14M8.5 20v-3M15.5 20v-3"/>',
    doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h5M12 9.5V16"/>',
    chev: '<path d="m9.5 6 6 6-6 6"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    check: '<path d="m6 12.5 4 4 8-9"/>',
    pause: '<path d="M9.5 7.5v9M14.5 7.5v9"/>',
    cross: '<path d="m7.5 7.5 9 9m0-9-9 9"/>',
    cart: '<path d="M3.5 5h2l2 10h10l2-7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
    pill: '<rect x="3.6" y="8.6" width="16.8" height="6.8" rx="3.4" transform="rotate(-40 12 12)"/><path d="m9.4 9.1 5.5 5.6"/>',
    star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
    gauge: '<path d="M4.5 16.5a7.5 7.5 0 1 1 15 0"/><path d="m12 16.5 3.5-4.5"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; }
  var CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round">' + P.chev + '</svg>';

  function setHTML(el, html) { if (!el || el._h === html) return false; el._h = html; el.innerHTML = html; return true; }
  function animate(el, cls) { if (!el || reduced) return; el.classList.remove('enter', 'enter-push', 'enter-pop', 'shake'); void el.offsetWidth; el.classList.add(cls || 'enter'); }
  function pill(zone, score) {
    if (!zone) return '<span class="pill gray">Не оценивалась</span>';
    var z = ZONE[zone];
    return '<span class="pill ' + z[0] + '">' + (score == null ? 'Риск не рассчитан' : 'Риск ' + score) + ' · ' + z[1] + '</span>';
  }
  function ago(min) {
    if (min < 1) return 'только что';
    if (min < 60) return Math.round(min) + ' мин назад';
    if (min < 60 * 24) return Math.round(min / 60) + ' ч назад';
    return Math.round(min / 60 / 24) + ' дн. назад';
  }
  function toast(text) { var t = $('toast'); t.textContent = text; t.hidden = true; void t.offsetWidth; t.hidden = false; clearTimeout(t._tm); t._tm = setTimeout(function () { t.hidden = true; }, 3800); }
  var HUES = ['#257a50', '#4f6b62', '#5a6862', '#3d7a68', '#5d6f66', '#2a6e57'];
  function initials(name) { var w = String(name).replace(/[«»"]/g, '').split(/[\s,]+/).filter(Boolean); return ((w[0] || '?')[0] + (w[1] && !/^[•\d]/.test(w[1]) ? w[1][0] : '')).toUpperCase(); }
  function ava(r) {
    var h = 0, s = String(r.id || r.name); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    var inner = r.card ? ic('card').replace('<svg', '<svg width="24" height="24" style="stroke:#fff;fill:none;stroke-width:1.8"') : esc(initials(r.name));
    return '<span class="ava" style="background:' + HUES[h % HUES.length] + '">' + inner + '</span>';
  }

  // ---------- локальный «сервер»: те же маршруты, что в backend/app.py ----------
  function route(path, method, b, actor) {
    var m;
    if (path === '/api/state') return E.fullState();
    if ((m = path.match(/^\/api\/scenario\/(\d+)$/))) { E.reset(Number(m[1])); return { ok: true }; }
    if (path === '/api/sim') { E.setSim(b); return { ok: true }; }
    if (path === '/api/demo/busy') { E.setBusy(b); return { ok: true }; }
    if (path === '/api/demo/tamper') { E.tamperAudit(); return { ok: true }; }
    if (path === '/api/ward/card-recipient') return E.addCardRecipient(b.card_number, b.name);
    if (path === '/api/ward/transfer') return E.brief(E.createTransfer(b.recipient_id, b.amount, b.big_purchase));
    if (path === '/api/ward/credit') return E.brief(E.createCredit(b.amount, b.product));
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/self-confirm$/))) return E.decide(Number(m[1]), 'ward', b.decision, b.called);
    if (path === '/api/ward/setup') { E.setup(b.first, b.whitelist, b.consent); return { ok: true }; }
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/verify$/))) return E.verify(Number(m[1]), b.answers);
    if (path === '/api/ward/trusted') return E.addTrusted(b.name, b.relation);
    if (path === '/api/ward/trusted/remove') return E.removeTrusted(b.role);
    if (path === '/api/ward/trusted/swap') return E.swapTrusted();
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/appeal$/))) return E.appeal(Number(m[1]));
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/request$/))) return E.requestConfirm(Number(m[1]), b.role);
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/pressure$/))) return E.pressure(Number(m[1]));
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/staff$/))) return E.callStaff(Number(m[1]));
    if (path === '/api/ward/sessions/reset') return E.resetSessions();
    if (path === '/api/ward/code') return E.changeCode(b.code);
    if (path === '/api/operator/safe-mode/off') return E.safeModeOff();
    if ((m = path.match(/^\/api\/ward\/ops\/(\d+)\/report$/))) return E.reportOp(Number(m[1]));
    if ((m = path.match(/^\/api\/operator\/cases\/([\w-]+)\/refund$/))) return E.caseRefund(m[1]);
    if (path === '/api/ward/trusted/complaint') return E.complainTrusted(b.role, b.text, b.remove);
    if (path === '/api/ward/consent/renew') return E.renewConsent();
    if ((m = path.match(/^\/api\/operator\/complaints\/(\d+)\/(\w+)$/))) return E.complaintAction(Number(m[1]), m[2]);
    if (path === '/api/ward/protection') return E.setProtection(b.on);
    if (path === '/api/ward/credit-lock') return E.setCreditLock(b.on);
    if (path === '/api/ward/credit-lock-mode') return E.setCreditLockMode(b.mode);
    if (path === '/api/ward/limits') return E.setLimits(b);
    if ((m = path.match(/^\/api\/ward\/favorites\/(\d+)\/pay$/))) return E.brief(E.payFavorite(Number(m[1])));
    if ((m = path.match(/^\/api\/ward\/favorites\/(\d+)\/remove$/))) return E.removeFavorite(Number(m[1]));
    if (path === '/api/ward/favorites') return E.addFavorite(b.recipient_id, b.amount, b.title);
    if ((m = path.match(/^\/api\/ward\/disable-requests\/(\d+)\/cancel$/))) return E.cancelDisable(Number(m[1]));
    if (path === '/api/ward/report') return E.reportFraud(b.op_id, b.what, b.got_goods);
    if ((m = path.match(/^\/api\/ops\/(\d+)\/decision$/))) return E.decide(Number(m[1]), actor, b.decision);
    if ((m = path.match(/^\/api\/operator\/incidents\/(\d+)\/(\w+)$/))) return E.incidentAction(Number(m[1]), m[2], b.police_report_no);
    if (path === '/api/operator/client/unblock') { E.unblockClient(); return { ok: true }; }
    throw { blocked: true, code: 'NOT_FOUND', message: 'Нет такого маршрута', status: 404 };
  }
  function api(path, method, body, actor) {
    return new Promise(function (res) {
      try { res({ ok: true, status: 200, data: route(path, method || 'GET', body || {}, actor) }); }
      catch (e) {
        if (e && e.blocked) res({ ok: false, status: e.status, data: { error: { code: e.code, message: e.message } } });
        else { if (window.console) console.error(e); res({ ok: false, status: 500, data: { error: { code: 'ERR', message: 'Внутренняя ошибка прототипа.' } } }); }
      }
    });
  }
  function act(path, body, actor) {
    return api(path, 'POST', body || {}, actor).then(function (r) {
      if (!r.ok) toast(r.data.error ? r.data.error.message : 'Ошибка ' + r.status);
      return refresh().then(function () { return r; });
    });
  }
  function refresh() { S = E.fullState(); render(); setHTML($('scenHint'), esc(S.demo.hint)); return Promise.resolve(); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduced ? 0 : ms); }); }

  // ---------- общий рендер ----------
  function render() {
    if (!S) return;
    if (ui.scenario !== S.demo.scenario) {
      ui.scenario = S.demo.scenario;
      if (ui.booting) { ui.booting = false; bootView(); }
      else prefill(S.demo.form);
    }
    // Доверенное лицо решило по переводу клиента — показываем клиенту чек или отказ.
    var nowHeld = {}; S.ward.pending.forEach(function (p) { nowHeld[p.id] = true; });
    Object.keys(ui.prevHeld || {}).forEach(function (id) {
      id = Number(id); if (nowHeld[id]) return;
      var info = opInfo(id).op; if (!info || (info.by !== 'guardian' && info.by !== 'second' && info.by !== 'operator')) return;
      if (!ui.overlay) openOverlay({ type: 'result', op: id });
      else if (ui.overlay.type === 'result' && ui.overlay.op === id) renderOverlay();
    });
    ui.prevHeld = nowHeld;
    renderScen(); renderWard(); renderTrusted('guardian'); renderTrusted('second'); renderOperator(); renderBank(); renderSim();
    if (ui.overlay) renderOverlay();
    // банк подключился, а помощник ещё не спросил: открываем чат сам (один раз на операцию)
    S.ward.pending.forEach(function (p) {
      if (p.operator_connected && !p.verification && !ui.autoAsked[p.id] && (!ui.overlay || ui.overlay.type === 'result')) {
        ui.autoAsked[p.id] = true;
        if (ui.overlay) closeOverlay(function () { openVerify(p.id); }); else openVerify(p.id);
      }
    });
  }
  // Демо для жюри: три главных сценария. Остальные спрятаны под «Ещё», в коде они остаются.
  var MAIN_SCEN = ['8', '2', '5', '6'], MORE_SCEN = ['1', '3', '4', '7'];
  function renderScen() {
    var d = S.demo, chip = function (k, label) { return '<button class="chip" data-act="scen" data-n="' + k + '" aria-pressed="' + (String(d.scenario) === k) + '">' + label + '</button>'; };
    var h = MAIN_SCEN.map(function (k, i) { return chip(k, (i + 1) + '. ' + esc(d.scenarios[k])); }).join('');
    h += '<button class="chip more" data-act="scen-more" aria-expanded="' + !!ui.moreScen + '">' + (ui.moreScen ? 'Скрыть' : 'Ещё сценарии') + '</button>';
    if (ui.moreScen || MORE_SCEN.indexOf(String(d.scenario)) >= 0) h += MORE_SCEN.map(function (k) { return chip(k, esc(d.scenarios[k])); }).join('');
    setHTML($('scenChips'), h);
    $('clock').textContent = 'Минута сценария: ' + Math.floor(d.now);
    setHTML($('speed'), '<span class="muted">Ускоренное время</span><div class="seg2" role="group" aria-label="Скорость времени">' +
      [[1, '1 с = 1 мин'], [0.2, '1 с = 5 мин'], [0, 'Пауза']].map(function (x) { return '<button data-act="speed" data-v="' + x[0] + '" aria-pressed="' + (SPM === x[0] || (x[0] === 0 && ui.paused)) + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<small class="muted">Ожидание доверенных лиц 5 и 15 минут идёт за секунды, охлаждение 24 ч сжато до 3 минут, предельное удержание — до 60 минут.</small>');
  }

  // ---------- телефон подопечного ----------
  var NAV = [['Home', 'Главная', 'home'], ['Transfer', 'Переводы', 'transfer'], ['Pay', 'Платежи', 'pay'], ['Hist', 'История', 'hist'], ['Svc', 'Сервисы', 'svc']];
  function item(icon, title, sub, attrs, extra) {
    return '<button class="item" ' + (attrs || '') + '><span class="ic">' + ic(icon) + (extra || '') + '</span><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><span class="chev">' + CHEV + '</span></button>';
  }
  function tile(icon, label, attrs, cls, badge) { return '<button class="tile ' + (cls || '') + '" ' + (attrs || '') + '><span class="ic">' + ic(icon) + (badge ? '<span class="new" aria-hidden="true"></span><span class="sr">новое</span>' : '') + '</span>' + esc(label) + '</button>'; }
  function badge(on, onText, offText) { return '<span class="shieldbadge' + (on ? '' : ' off') + '"><i></i>' + (on ? onText : offText) + '</span>'; }
  // Частые платежи: крупные кнопки «что и сколько», чтобы не искать получателя каждый раз.
  function favHTML(w, editable) {
    if (!w.favorites.length) return '<div class="empty">Частых платежей нет. После перевода нажмите «Сохранить как частый платёж».</div>';
    return '<div class="favs">' + w.favorites.map(function (f) {
      return '<div class="fav' + (editable ? ' editing' : '') + '"><button class="favbtn" data-act="fav" data-id="' + f.id + '"><span class="ic">' + ic(f.icon) + '</span><span class="ft"><b>' + esc(f.title) + '</b><small>' + esc(f.recipient.split(/[(,]/)[0].trim()) + '</small></span><span class="fa">' + fmt(f.amount) + '</span></button>' +
        (editable ? '<button class="favdel" data-act="fav-del" data-id="' + f.id + '" aria-label="Удалить частый платёж: ' + esc(f.title) + '">' + ic('cross') + '</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function favById(id) { var r = null; S.ward.favorites.forEach(function (f) { if (f.id === id) r = f; }); return r; }
  function recById(id) { var r = null; (S ? S.ward.recipients : []).forEach(function (x) { if (x.id === id) r = x; }); return r; }

  function renderWard() {
    var w = S.ward;
    var fontBtn = '<button class="ibtn fontbtn" data-act="font" aria-pressed="' + ui.font + '" aria-label="' + (ui.font ? 'Обычный шрифт' : 'Крупный шрифт') + '"><span aria-hidden="true">Aa</span> ' + (ui.font ? 'Мельче' : 'Крупнее') + '</button>';
    var h;
    if (ui.tab === 'Home') {
      h = '<div class="ahead"><div class="hrow"><div class="hello"><span class="avatar">' + ic('shield') + '</span><div><b>Сәлем, Нурлан-ата</b><small>' + (w.protection_on ? 'Қорған включён' : 'Қорған выключен') + '</small></div></div>' + fontBtn + '</div>' +
        '<div class="cardgrid"><div class="card wide"><div class="cardrow"><span>Карта ••3107</span><button class="eye" data-act="eye" aria-pressed="' + ui.hide + '">' + (ui.hide ? 'Показать' : 'Скрыть') + '</button></div><div class="bal" id="balNum">' + (ui.hide ? '•••••• ₸' : fmt(w.balance)) + '</div></div>' +
        '</div></div>';
    } else {
      var t = { Transfer: ['Переводы', 'Подтверждение доверенных лиц включится само, если перевод выглядит опасным.'], Pay: ['Платежи', 'Алматы'], Hist: ['История', ''], Svc: ['Сервисы', ''] }[ui.tab];
      if (ui.tab === 'Svc' && ui.svc === 'prot') t = ['Қорған', 'Доверенные лица видят только операцию, которая ждёт подтверждения.'];
      if (ui.tab === 'Svc' && ui.svc === 'credit') t = ['Рассрочка', 'Симуляция продукта'];
      if (ui.tab === 'Svc' && ui.svc === 'limits') t = ['Лимиты переводов', 'Сколько можно перевести без подтверждения доверенных лиц.'];
      if (ui.tab === 'Svc' && ui.svc === 'lock') t = ['Кредитный замок', 'Защита от кредитов, оформленных под давлением.'];
      if (ui.tab === 'Transfer' && ui.tr.step === 'amount') t = ['Перевод', ''];
      h = '<div class="ahead"><div class="hrow"><h2 class="pagetitle">' + t[0] + '</h2>' + fontBtn + '</div>' + (t[1] ? '<p class="pagesub">' + t[1] + '</p>' : '');
      if (ui.tab === 'Hist') h += '<div class="pillrow">' + [['all', 'Все'], ['in', 'Доходы'], ['out', 'Расходы']].map(function (x) { return '<button class="pchip" data-act="hist" data-f="' + x[0] + '" aria-pressed="' + (ui.hist === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
      if (ui.tab === 'Svc' && ui.svc === 'main') h += '<div class="pillrow">' + [['all', 'Все'], ['sec', 'Безопасность'], ['fin', 'Финансы']].map(function (x) { return '<button class="pchip" data-act="svcf" data-f="' + x[0] + '" aria-pressed="' + (ui.svcFilter === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
      h += '</div>';
    }
    setHTML($('wHead'), h);
    animateBalance(w.balance);

    // предупреждения над содержимым вкладки
    var a = '';
    if (ui.error && ui.tab === 'Home') a += '<div class="note bad"><b>' + esc(errTitle(ui.error.code)) + '</b>' + esc(ui.error.message) + '</div>';
    if (w.outgoing_blocked) a += '<div class="note info"><b>Исходящие переводы и карты заблокированы</b>Это автозащита после заявления. Снять её может сотрудник банка.</div>';
    if (ui.tab === 'Home') {
      // Экран паузы для пожилого: крупно, одно главное действие, без слов «подозрительно» и «риск».
      w.pending.forEach(function (p) {
        if (p.limit_only) {
          var lr = p.request && p.request.status === 'active';
          a += '<div class="note calm"><b class="calmtitle">Перевод на паузе</b><p class="calmtext">' + fmt(p.amount) + ' → ' + esc(p.recipient) + '. ' + (lr ? 'Ждём подтверждения: ' + esc(p.request.who.split(',')[0]) + '.' : 'Сумма больше вашего лимита.') + '</p><small>Деньги пока на вашем счёте.</small>' +
            '<button class="btn" data-act="show-op" data-op="' + p.id + '">' + (lr ? 'Открыть перевод' : 'Выбрать действие') + '</button></div>';
          return;
        }
        var bank = p.operator_connected || !p.guardian_acc, wait = bank ? (p.staff_called ? 'Сотрудник банка позвонит вам в приложении. Обычно это несколько минут.' : (p.verification ? 'Помощник не смог подтвердить перевод сам. Можно связаться с сотрудником банка.' : 'Ответьте помощнику банка: 4 коротких вопроса.')) : 'Ждём ' + esc(p.guardian_acc) + ', обычно это несколько минут.';
        var main = p.operator_connected && !p.verification ? '<button class="btn" data-act="verify" data-op="' + p.id + '">Ответить банку</button>'
          : (!bank ? '<button class="btn" data-act="call-trusted">Позвонить ' + esc(p.guardian_dat) + '</button>' : (p.staff_called ? '<button class="btn" data-act="call">Позвонить в банк</button>' : '<button class="btn" data-act="staff" data-op="' + p.id + '">Связаться с сотрудником банка</button>'));
        var nx = p.next || {}, mins = function (n) { n = Math.max(1, n); return n + ' мин'; };
        var step = nx.who === 'second' ? 'Через ' + mins(nx.in) + ' спросим ' + esc(p.second_dat) + '.' : nx.who === 'bank' ? 'Через ' + mins(nx.in) + ' подключится сотрудник банка.' : nx.who === 'assistant' ? 'Через ' + mins(nx.in) + ' помощник банка задаст 4 вопроса.' : 'Если никто не решит, через ' + mins(60 - p.elapsed) + ' операция отменится, деньги останутся у вас.';
        a += '<div class="note calm"><b class="calmtitle">Мы бережём ваши деньги</b><p class="calmtext">' + wait + '</p>' +
          '<div class="progress" role="status"><span class="pt">Ждём ' + mins(Math.floor(p.elapsed)) + '</span><span class="ps">' + step + '</span></div>' +
          '<small>' + (p.kind === 'credit' ? esc(p.recipient) + ', ' + fmt(p.amount) + '. Кредит пока не оформлен.' : fmt(p.amount) + ' → ' + esc(p.recipient) + '. Деньги на вашем счёте.') + (p.appeal ? ' Вы не согласились с отказом, решает банк.' : '') + '</small>' + main +
          '<div class="btnline"><button class="btn small sec" data-act="show-op" data-op="' + p.id + '">Кто подтверждает</button><button class="btn small sec" data-act="ward-cancel" data-op="' + p.id + '">Отменить</button></div></div>';
      });
      if (w.safe_mode) a += '<div class="note bad"><b>Режим безопасности</b>Вы сообщили о мошенничестве. Мошенники часто звонят повторно: «вернём деньги, переведите комиссию». Не переводите по чужой просьбе. Кредит наличными пока закрыт.<button class="btn sec" data-act="open-case" data-no="' + esc(w.safe_mode.case) + '">Обращение ' + esc(w.safe_mode.case) + '</button></div>';
      // Отказ доверенного не окончательный: клиент может не согласиться, тогда решает сотрудник банка.
      (w.appealable || []).forEach(function (r) {
        a += '<div class="note info"><b>' + esc(r.by_name.split(',')[0]) + ' отклонил ' + (r.kind === 'credit' ? 'кредит' : 'перевод') + ' ' + fmt(r.amount) + '</b>' + esc(r.recipient) + '. Деньги на вашем счёте. Если вы не согласны, решение примет сотрудник банка после звонка вам.' +
          '<button class="btn sec" data-act="appeal" data-op="' + r.id + '">Не согласен с решением</button></div>';
      });
      w.incidents.forEach(function (i) {
        a += '<div class="note ' + (i.status === 'DISPUTE_CIVIL' ? 'info' : 'warn') + '"><b>Заявление № ' + i.id + ': ' + esc(i.status_text) + '</b>' +
          '<div class="events" style="max-height:none;margin-top:6px">' + i.feed.slice(-5).map(function (f) { return '<span>• ' + esc(f.text) + '</span>'; }).join('') + '</div>' +
          (i.outcome ? '<p style="margin:8px 0 0"><b style="display:inline">Итог:</b> ' + esc(i.outcome) + '</p>' : '') +
          (i.status !== 'DISPUTE_CIVIL' ? '<p style="margin:8px 0 0"><b style="display:inline">Не платите никому за «возврат денег».</b> Банк и полиция не берут за это плату.</p>' : '') +
          (i.statement ? '<details><summary>Текст заявления в полицию</summary><div class="statement" id="stmt' + i.id + '">' + esc(i.statement) + '</div><button class="btn small sec" style="margin-top:8px" data-act="copy" data-id="' + i.id + '">Скопировать</button></details>' : '') + '</div>';
      });
    }
    setHTML($('wAlerts'), a ? '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:6px">' + a + '</div>' : '');

    // главная
    // Главная: баланс → частые платежи → перевод и «Меня обманули» → защита → остальное.
    setHTML($('tabHome'), '<h2>Частые платежи</h2>' + favHTML(w, false) +
      '<div class="actgrid"><button class="pchip" data-act="go" data-t="Transfer">' + ic('transfer') + 'Перевод</button><button class="pchip sos" data-act="sos">' + ic('alert') + 'Меня обманули</button><button class="pchip" data-act="go-card">' + ic('card') + 'На карту</button><button class="pchip" data-act="call">' + ic('call') + 'Связь с банком</button></div>' +
      '<h2>Ваша защита</h2><div class="cardgrid">' +
      '<button class="card" data-act="open-prot"><b>Қорған</b>' + badge(w.protection_on, 'Включён', 'Выключен') + '<small>' + (w.guardians.guardian ? 'Подтверждает ' + esc(w.guardians.guardian.split(',')[0]) : 'Решает сотрудник банка') + '</small></button>' +
      '<button class="card" data-act="open-lock"><b>Кредитный замок</b>' + badge(w.credit_lock, w.credit_lock_mode === 'full' ? 'Полный запрет' : 'Умный режим', 'Выключен') + '<small>' + (!w.credit_lock ? 'Нажмите, чтобы включить' : (w.credit_lock_mode === 'full' ? 'Кредиты запрещены' : 'Покупки в рассрочку проходят')) + '</small></button></div>' +
      item('gauge', 'Лимиты переводов', [w.limits.daily_on ? fmt(w.limits.daily) + ' в сутки' : '', w.limits.monthly_on !== false ? fmt(w.limits.monthly) + ' в месяц' : ''].filter(Boolean).join(', ') || 'Выключены', 'data-act="open-limits"') +
      item('call', 'Связь с банком', 'Звонок из приложения, оператор не звонит первым', 'data-act="call"') +
      item('alert', 'Меня обманули', 'Запрос на возврат и защита счёта за минуты', 'data-act="sos"') +
      '<div class="sect">Последние операции</div><div>' + txList(w.history.slice(0, 3), false) + '</div>');

    renderTransfer(w);
    amtLimitText();

    setHTML($('payFavs'), '<div class="sectrow"><span class="sect">Частые платежи</span><button class="linkbtn" data-act="fav-edit" aria-pressed="' + !!ui.favEdit + '">' + (ui.favEdit ? 'Готово' : 'Изменить') + '</button></div>' + favHTML(w, ui.favEdit));
    setHTML($('payTiles'), tile('house', 'Комм. услуги', 'data-act="pay" data-r="utility"') + tile('bag', 'Мебель и дом', 'data-act="pay" data-r="shop"') + tile('phone', 'Связь', '', 'off') + tile('wifi', 'Интернет и ТВ', '', 'off') +
      tile('bus', 'Транспорт', '', 'off') + tile('doc', 'Штрафы и налоги', '', 'off') + tile('coin', 'Кредиты', '', 'off') + tile('card', 'Карты', '', 'off'));

    var hist = w.history.filter(function (t) { return ui.hist === 'all' || (ui.hist === 'in' ? t.amount > 0 : t.amount < 0); });
    setHTML($('tabHist'), '<h2>Операции</h2>' + (hist.length ? '<div>' + txList(hist, true) + '</div>' : '<div class="empty">Операций нет.</div>'));

    renderServices(w);
    renderLock(w);
    renderLimits(w);
    renderPlate(w);
    setHTML($('appnav'), NAV.map(function (n) { return '<button data-tab="' + n[0] + '"' + (ui.tab === n[0] ? ' aria-current="page"' : '') + '>' + ic(n[2]) + n[1] + '</button>'; }).join(''));
  }

  function animateBalance(target) {
    var el = $('balNum');
    if (!el || ui.hide) { ui.shownBal = target; return; }
    if (ui.shownBal == null || reduced) { ui.shownBal = target; return; }
    if (ui.shownBal === target) return;
    var from = ui.shownBal, t0 = performance.now(), dur = 600;
    ui.shownBal = target;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), node = $('balNum');
      if (!node) return;
      node.textContent = fmt(from + (target - from) * e);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function renderTransfer(w) {
    var ppl = w.recipients.filter(function (r) { return !r.card || r.known; });
    var cards = w.recipients.filter(function (r) { return r.card && !r.known; });
    var recent = '<div class="sect">Недавние</div><div class="recent">' +
      '<button data-act="tr-mode" data-m="card"><span class="ava" style="background:var(--c-raised);color:var(--c-text)">' + ic('plus').replace('<svg', '<svg width="24" height="24" style="stroke:currentColor;fill:none;stroke-width:2"') + '</span><span class="rl">На карту</span></button>' +
      ppl.slice(0, 4).map(function (r) { return '<button data-act="tr-pick" data-r="' + r.id + '">' + ava(r) + '<span class="rl">' + esc(r.name.split(/[,(]/)[0].replace(/^ИП\s*/, '').replace(/[«»]/g, '')) + '</span></button>'; }).join('') + '</div>';
    var list = '<div class="sect">Все получатели</div>' + ppl.concat(cards).map(function (r) {
      var tag = r.whitelisted ? '<span class="tagw">белый список</span>' : (r.known ? '' : '<span class="tagw tagn">новый</span>');
      return '<button class="item" data-act="tr-pick" data-r="' + r.id + '">' + ava(r) + '<span><b>' + esc(r.name) + tag + '</b><small>' + esc(r.bank || '') + (r.card ? ' · по номеру карты' : '') + '</small></span><span class="chev">' + CHEV + '</span></button>';
    }).join('');
    setHTML($('trPeople'), recent + list);
    var r = recById(ui.tr.rid);
    setHTML($('trWho'), r ? ava(r) + '<span><b>' + esc(r.name) + '</b><small>' + esc(r.bank || '') + (r.whitelisted ? ' · белый список' : (r.known ? '' : ' · новый получатель')) + '</small></span>' : '');
    document.querySelectorAll('#trSeg [data-m]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-m') === ui.tr.mode)); });
  }

  function plural(n, one, few, many) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? one : (m >= 2 && m <= 4 && (h < 10 || h >= 20) ? few : many); }
  function txList(arr, withDispute) {
    return arr.map(function (t) {
      if (t.kind === 'debt') return '<div class="tx"><div><b>' + esc(t.title) + '</b><br><small>' + ago(S.demo.now - t.minute) + '</small></div><div class="a debt">' + fmt(t.amount) + '<small>в рассрочку</small></div></div>';
      var inc = t.amount > 0, inner = '<div><b>' + esc(t.title) + '</b><br><small>' + ago(S.demo.now - t.minute) + '</small></div><div class="a' + (inc ? ' in' : '') + '">' + (inc ? '+' : '−') + fmt(Math.abs(t.amount)) + '</div>';
      // Исходящий перевод открывает чек, а в чеке есть «Меня обманули».
      if (!inc && t.op_id) return '<button class="tx txbtn" data-act="receipt" data-op="' + t.op_id + '" aria-label="Чек: ' + esc(t.title) + ', ' + fmt(Math.abs(t.amount)) + '">' + inner + '</button>';
      return '<div class="tx">' + inner + '</div>';
    }).join('');
  }

  function renderServices(w) {
    var main = '', f = ui.svcFilter;
    if (f === 'all' || f === 'sec') main += '<div class="group"><h3>Безопасность</h3><div class="tiles">' +
      tile('shield', 'Қорған', 'data-act="open-prot"', 'green', true) + tile('lock', 'Кредитный замок', 'data-act="open-lock"', 'green') + tile('gauge', 'Лимиты переводов', 'data-act="open-limits"', 'green') + tile('alert', 'Меня обманули', 'data-act="sos"', 'green') + tile('call', 'Связь с банком', 'data-act="call"', 'green') + '</div></div>';
    if (f === 'all' || f === 'fin') main += '<div class="group"><h3>Финансы</h3><div class="tiles">' +
      tile('card', 'Рассрочка', 'data-act="open-credit"') + tile('coin', 'Кредит', 'data-act="open-credit"') + tile('house', 'Вклад', '', 'off') + tile('hist', 'Аналитика', '', 'off') + '</div></div>';
    setHTML($('svcMain'), main);

    var wl = w.recipients.filter(function (r) { return r.whitelisted; });
    setHTML($('svcProt'), '<button class="back" data-act="svc-back"><svg class="chev-l" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>Сервисы</button>' +
      '<div class="switch"><div><b>Қорған</b><small>' + (w.protection_on ? 'Опасные операции ждут подтверждения доверенных лиц' : 'Выключен') + '</small></div><button class="toggle" role="switch" aria-label="Қорған" aria-checked="' + w.protection_on + '" data-act="tog-prot"></button></div>' +
      (ui.error && ui.svc === 'prot' ? '<div class="note bad"><b>' + esc(errTitle(ui.error.code)) + '</b>' + esc(ui.error.message) + '</div>' : '') +
      w.disable_requests.filter(function (r) { return !isCreditReq(r); }).map(function (r) {
        var t = r.text.charAt(0).toUpperCase() + r.text.slice(1);
        return '<div class="note warn"><b>Запрос: ' + esc(t) + '</b>Вступит в силу через ' + Math.ceil(r.left) + ' мин сценария (период охлаждения). Доверенные лица уведомлены.<button class="btn sec" data-act="dis-cancel" data-id="' + r.id + '">Отменить запрос</button></div>';
      }).join('') +
      '<div class="sect">Доверенные лица · ' + w.trusted.length + ' из 2</div>' + w.trusted.map(function (t) {
        var only = w.trusted.length === 1;
        return '<div class="trow">' + ava({ id: t.key, name: t.name }) + '<span class="tinfo"><b>' + esc(t.name) + '</b><small>' + esc(t.relation) + ' · ' + (t.role === 'guardian' ? 'подтверждает первым' : 'второе доверенное лицо') + (t.removing ? ' · удаляется' : '') + '</small></span>' +
          '<span class="tact">' + (t.role === 'second' ? '<button class="btn small sec" data-act="tr-swap" aria-label="Сделать первым: ' + esc(t.name) + '">Первым</button>' : '') +
          '<button class="btn small sec" data-act="complain" data-role="' + t.role + '" aria-label="Пожаловаться: ' + esc(t.name) + '">Жалоба</button>' +
          (only ? '' : '<button class="btn small sec danger-t far" data-act="tr-remove" data-role="' + t.role + '"' + (t.removing ? ' disabled' : '') + ' aria-label="Удалить: ' + esc(t.name) + '">Удалить</button>') + '</span></div>';
      }).join('') +
      (w.trusted.length === 1 ? '<p class="muted small">Одно доверенное лицо: если оно не ответит, решение примет сотрудник банка. Опасный перевод подтверждают доверенное лицо и сотрудник банка.</p>' : '') +
      (w.trusted.length === 0 ? '<p class="muted small">Доверенных лиц нет: опасные операции решает сотрудник банка после звонка вам.</p>' : '') +
      (w.complaints || []).filter(function (c) { return c.status === 'open'; }).map(function (c) { return '<div class="note info"><b>Жалоба на ' + esc(c.who) + ' у сотрудника банка</b>Он позвонит вам из приложения и проверит личность. Если вы просили удалить доверенное лицо, это произойдёт сразу, без периода охлаждения.</div>'; }).join('') +
      '<div class="sect">Что делали доверенные лица</div>' + ((w.trusted_log || []).length ? '<div class="tlog">' + w.trusted_log.map(function (l) { return '<div><span>' + esc(l.who.split(',')[0]) + ' ' + esc(l.text) + '</span><small>' + esc(ago(S.demo.now - l.minute)) + '</small></div>'; }).join('') + '</div>' : '<div class="empty">Пока ничего. Здесь видно каждое решение доверенных лиц.</div>') +
      (w.trusted.length < 2 && !w.disable_requests.some(function (r) { return r.target === 'trusted_add'; }) ? '<button class="btn sec" data-act="tr-add">+ Добавить доверенного лица</button>' : '') +
      '<div class="sect">Белый список</div>' + (wl.length ? wl.map(function (r) { return '<div class="listrow"><span>' + esc(r.name) + '</span><span>без подтверждения</span></div>'; }).join('') : '<div class="empty">Пусто</div>') +
      '<div class="sect">Согласие</div><div class="note info">' + (w.consent.given ? 'Доверенные лица видят: ' + esc(w.consent.fields.join(', ')) + '. Не видят баланс, историю, номера счетов и коды. Срок ' + w.consent.valid_months + ' мес.: через год банк попросит подтвердить доверенных лиц заново. Согласие можно отозвать.' : 'Согласие не дано: доверенные лица не подключены.') + '</div>' +
      (w.consent.given ? '<button class="btn sec" data-act="renew">Подтвердить доверенных лиц ещё на 12 месяцев</button>' : '') +
      '<button class="btn" data-act="wizard">Настроить защиту</button><button class="btn sos" data-act="sos">Меня обманули</button>');
  }

  function isCreditReq(r) { return r.target === 'credit_lock' || r.target === 'credit_smart'; }
  function reqNote(r) {
    var t = r.text.charAt(0).toUpperCase() + r.text.slice(1);
    return '<div class="note warn"><b>Запрос: ' + esc(t) + '</b>Вступит в силу через ' + Math.ceil(r.left) + ' мин сценария (период охлаждения). Доверенные лица уведомлены.<button class="btn sec" data-act="dis-cancel" data-id="' + r.id + '">Отменить запрос</button></div>';
  }
  function renderLock(w) {
    setHTML($('svcLock'), '<button class="back" data-act="svc-back"><svg class="chev-l" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>Сервисы</button>' +
      '<div class="hero"><span class="ic">' + ic('lock') + '</span><div><b>Защита от чужих кредитов</b><small>Мошенники часто уговаривают пожилых взять кредит и перевести деньги. Замок работает отдельно от семейной защиты переводов.</small></div></div>' +
      '<div class="switch"><div><b>Кредитный замок</b><small>' + (!w.credit_lock ? 'Выключен' : (w.credit_lock_mode === 'full' ? 'Полный запрет' : 'Умный режим')) + '</small></div><button class="toggle" role="switch" aria-label="Кредитный замок" aria-checked="' + w.credit_lock + '" data-act="tog-lock"></button></div>' +
      (w.credit_lock ? '<div class="lockmode"><div class="seg" role="group" aria-label="Режим кредитного замка"><button data-act="lock-mode" data-v="smart" aria-selected="' + (w.credit_lock_mode === 'smart') + '">Умный</button><button data-act="lock-mode" data-v="full" aria-selected="' + (w.credit_lock_mode === 'full') + '">Полный запрет</button></div>' +
        (w.credit_lock_mode === 'smart'
          ? '<ul class="modelist"><li class="ok">Рассрочка на товар в магазине проходит сразу: деньги уходят продавцу.</li><li class="warn">Кредит наличными на карту ждёт подтверждения доверенных лиц.</li><li class="bad">Звонок или удалённый доступ: кредит заблокирован (требование АРРФР). Новое устройство: на паузе.</li><li class="warn">Перевод чужому в течение часа после кредита наличными: дополнительная проверка.</li></ul>'
          : '<ul class="modelist"><li class="bad">Никакие кредиты и рассрочки не оформляются.</li><li class="warn">Включается сам после заявления «Меня обманули». Ослабить до умного режима можно через период охлаждения.</li></ul>') + '</div>' : '') +
      (ui.error && ui.svc === 'lock' ? '<div class="note bad"><b>' + esc(errTitle(ui.error.code)) + '</b>' + esc(ui.error.message) + '</div>' : '') +
      w.disable_requests.filter(isCreditReq).map(reqNote).join('') +
      '<div class="sect">Как это работает</div>' +
      '<div class="examples"><div class="ex ok"><b>Телевизор в рассрочку в магазине</b><small>Деньги получает продавец. Без опасных сигналов оформляется сразу.</small></div>' +
      '<div class="ex warn"><b>Кредит наличными на карту</b><small>' + (w.credit_lock && w.credit_lock_mode === 'full' ? 'Запрещён в режиме полного запрета.' : 'Ждёт подтверждения доверенных лиц, а если они не ответят — проверки банком.') + '</small></div>' +
      '<div class="ex bad"><b>Кредит во время звонка или при удалённом доступе</b><small>Заблокирован по требованию АРРФР. Так выглядит почти каждая схема «оформите кредит, чтобы защитить деньги».</small></div></div>' +
      '<button class="btn sec" data-act="open-credit">Оформить рассрочку или кредит</button>');
  }
  function renderLimits(w) {
    var L = w.limits, used = w.spent_today, pct = Math.min(100, Math.round(used / L.daily * 100)), mpct = Math.min(100, Math.round(w.spent_month / L.monthly * 100));
    setHTML($('limInfo'), '<div class="hero"><span class="ic">' + ic('gauge') + '</span><div><b>Ваши лимиты</b><small>Переводы в пределах лимита проходят как обычно. Сверх лимита перевод не пропадает: он ждёт подтверждения доверенных лиц.</small></div></div>' +
      '<div class="usage">' + (L.monthly_on !== false ? '<div class="ur"><span>За месяц переведено</span><b>' + fmt(w.spent_month) + ' из ' + fmt(L.monthly) + '</b></div><div class="bar"><i style="width:' + mpct + '%"></i></div>' : '<div class="ur"><span>За месяц переведено</span><b>' + fmt(w.spent_month) + '</b></div>') +
      (L.daily_on ? '<div class="ur"><span>Сегодня переведено</span><b>' + fmt(used) + ' из ' + fmt(L.daily) + '</b></div><div class="bar"><i style="width:' + pct + '%"></i></div>' : '<div class="ur"><span>Сегодня переведено</span><b>' + fmt(used) + '</b></div>') + '</div>' +
      (ui.error && ui.svc === 'limits' ? '<div class="note bad"><b>' + esc(errTitle(ui.error.code)) + '</b>' + esc(ui.error.message) + '</div>' : '') +
      w.disable_requests.filter(function (r) { return r.target === 'limit_up'; }).map(reqNote).join(''));
  }
  function paintDailySw() {
    var on = !!ui.limDailyOn; $('limDailyOn').setAttribute('aria-checked', String(on)); $('limDailyBox').hidden = !on;
    $('limDailyNote').textContent = on ? 'Включён: перевод сверх суммы за сутки встаёт на паузу.' : 'Выключен. Включите, если хотите ограничить переводы за сутки.';
    var mo = ui.limMonthlyOn !== false; $('limMonthlyOn').setAttribute('aria-checked', String(mo)); $('limMonthlyBox').hidden = !mo;
    $('limMonthlyNote').textContent = mo ? 'Включён: перевод сверх суммы за месяц встаёт на паузу.' : 'Выключен. Включите, если хотите ограничить переводы за месяц.';
  }
  function fillLimits() { if (!S) return; ui.limDailyOn = !!S.ward.limits.daily_on; ui.limMonthlyOn = S.ward.limits.monthly_on !== false; paintDailySw(); $('limDaily').value = fmtN(S.ward.limits.daily); $('limMonthly').value = fmtN(S.ward.limits.monthly); $('limErr').textContent = ''; }
  function amtLimitText() {
    if (!S || !$('amtLimit')) return;
    var r = recById(ui.tr.rid), L = S.ward.limits, n = Number(digits($('amt').value)), left = Math.max(0, Math.min(L.daily_on ? L.daily - S.ward.spent_today : Infinity, L.monthly_on !== false ? L.monthly - S.ward.spent_month : Infinity)), el = $('amtLimit');
    if (r && r.whitelisted) { el.className = 'small muted'; el.textContent = 'Белый список: лимиты не применяются'; return; }
    if (!S.ward.protection_on) { el.className = 'small muted'; el.textContent = 'Защита выключена: лимиты не проверяются'; return; }
    if (n > left) { el.className = 'small warnline'; el.textContent = 'Больше вашего лимита: перевод встанет на паузу, деньги останутся на счёте'; return; }
    el.className = 'small muted'; el.textContent = left === Infinity ? 'Лимиты выключены' : (L.daily_on ? 'Осталось сегодня ' : 'Осталось в этом месяце ') + fmt(left);
  }
  function renderPlate(w) {
    var p = $('plate'), cls, title, sub, icon = 'shield';
    if (w.safe_mode) { cls = 'bad'; title = 'Режим безопасности'; sub = 'Остерегайтесь повторных звонков'; icon = 'alert'; }
    else if (w.outgoing_blocked) { cls = 'bad'; title = 'Переводы заблокированы'; sub = 'Автозащита после заявления. Оператор снимет блокировку.'; icon = 'alert'; }
    else if (w.pending.length && w.pending[0].limit_only) { var pl = w.pending[0]; cls = 'warn'; title = 'Перевод на паузе'; sub = pl.request && pl.request.status === 'active' ? 'Ждём подтверждения доверенного лица' : 'Сумма больше вашего лимита'; icon = 'pause'; }
    else if (w.pending.length) { var pd = w.pending[0]; cls = 'warn'; title = pd.operator_connected && !pd.verification ? 'Банк уточняет перевод' : 'Бережём ваши деньги'; sub = pd.operator_connected || !pd.guardian_acc ? (pd.operator_connected && !pd.verification ? 'Ответьте помощнику в приложении' : 'Ждём сотрудника банка') : 'Ждём ' + pd.guardian_acc; icon = pd.operator_connected && !pd.verification ? 'call' : 'lock'; }
    else if (!w.protection_on) { cls = 'off'; title = 'Қорған выключен'; sub = 'Нажмите, чтобы настроить'; }
    else { cls = 'calm'; title = 'Қорған включён'; sub = ''; }
    // В спокойном состоянии плашка не нужна: статус уже в шапке. Плашка появляется, когда есть что сказать.
    var hide = cls === 'calm' || (ui.tab === 'Transfer' && (ui.tr.step === 'amount' || ui.tr.mode === 'card'));
    p.className = 'plate' + (cls ? ' ' + cls : '') + (hide ? ' hide' : '');
    p.tabIndex = hide ? -1 : 0;
    setHTML(p, '<span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span><span class="pi">' + ic(icon) + '</span>');
  }

  function errTitle(code) {
    return { CALL_ACTIVE: 'Операция заблокирована на время звонка', SAFE_MODE: 'Режим безопасности', WEAK_CODE: 'Слишком простой код', BAD_CODE: 'Проверьте код', REMOTE_ACCESS: 'Обнаружен удалённый доступ', CREDIT_LOCK: 'Кредитный замок', OUTGOING_BLOCKED: 'Переводы заблокированы', NEW_DEVICE: 'Новое устройство', INSUFFICIENT_FUNDS: 'Недостаточно средств', BAD_AMOUNT: 'Проверьте сумму', BAD_CARD: 'Проверьте номер карты' }[code] || 'Операция не выполнена';
  }

  // ---------- опекун и второй доверенный ----------
  function renderTrusted(role) {
    var g = S[role], el = role === 'guardian' ? $('gReqs') : $('sReqs');
    if (role === 'guardian') { $('gTitle').textContent = 'Приложение доверенного лица (' + g.name + ')'; $('busyG').checked = g.busy; setHTML($('gAv'), ic('user')); }
    else { $('sTitle').textContent = 'Второе доверенное лицо (' + g.name + ')'; $('busyS').checked = g.busy; setHTML($('sAv'), ic('user')); }
    if (!g.name) {
      if (role === 'guardian') { $('gTitle').textContent = 'Доверенное лицо (не назначен)'; $('busyG').closest('label').hidden = true; setHTML($('gNotes'), ''); }
      else { $('sTitle').textContent = 'Второе доверенное лицо (не назначен)'; $('busyS').closest('label').hidden = true; }
      setHTML(el, '<div class="empty">' + (role === 'guardian' ? 'Доверенных лиц нет: опасные операции решает сотрудник банка.' : 'Второго доверенного лица нет. Клиент может добавить его в разделе «Сервисы → Защита».') + '</div>'); return;
    }
    $(role === 'second' ? 'busyS' : 'busyG').closest('label').hidden = false;
    var reqs = g.requests.slice().reverse(), active = reqs.filter(function (r) { return r.status === 'HELD'; }), show = active.length ? active : reqs.slice(0, 1);
    var h = show.length ? '' : '<div class="empty">Запросов нет.</div>';
    // Экран близкого: один вопрос и звонок прямо из уведомления. Видна только сумма, имя получателя и причина паузы.
    show.forEach(function (r) {
      h += '<div class="req enter"><div class="muted" style="font-size:.9em">Подтверждение запрашивает клиент: <b>' + esc(g.ward_name) + '</b></div><div><div class="sum">' + fmt(r.amount) + '</div><div>→ ' + esc(r.recipient) + '</div></div>' +
        (r.reasons.length ? '<ul>' + r.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '');
      if (r.appeal && r.status === 'HELD') h += '<div class="note info">' + esc(g.ward_name) + ' не согласен с отказом. Операцию решает сотрудник банка.</div>';
      else if (r.status !== 'HELD') h += '<div class="note info"><b>Запрос закрыт</b>' + (r.closed_by_client ? (r.pressure ? 'Клиент остановил перевод и обратился в банк.' : 'Клиент отменил перевод.') : ({ EXECUTED: 'Перевод выполнен.', REJECTED: 'Перевод отклонён.', EXPIRED: 'Срок истёк, перевод не выполнен.' }[r.status])) + '</div>';
      else if (r.approved_by_me) h += '<div class="note ok">Вы подтвердили. Нужно второе подтверждение.</div>';
      else if (g.busy) h += '<div class="note warn pulse">Уведомление пришло, но вы заняты и не отвечаете.</div>';
      else if (r.can_act) {
        if (r.other_approved) h += '<div class="note info">Первое доверенное лицо уже подтвердило. Нужно ваше решение.</div>';
        h += '<button class="btn sec" data-act="callg">Позвонить ' + esc(g.ward_name) + '</button><p class="muted small" style="margin:0">Спросите, кто попросил перевести деньги. Потом решите.</p>' +
          '<div class="btnrow"><button class="btn ok" data-act="decide" data-actor="' + role + '" data-op="' + r.id + '" data-d="approve">Подтвердить перевод</button><button class="btn danger" data-act="decide" data-actor="' + role + '" data-op="' + r.id + '" data-d="reject">Отклонить перевод</button></div>';
      }
      h += '</div>';
    });
    if (show.length) h += '<p class="muted small" style="margin:6px 0 0">Вы видите только эту операцию: без баланса, истории и номеров счетов.</p>';
    setHTML(el, h);
    if (role === 'guardian') setHTML($('gNotes'), g.notifications.length ? '<div class="sect">Уведомления</div>' + g.notifications.slice(-3).reverse().map(function (n) { return '<div class="note info" style="margin-top:8px">' + esc(n.text) + '</div>'; }).join('') : '');
  }

  // ---------- оператор и банк ----------
  function reasonsHTML(reasons) {
    if (!reasons || !reasons.length) return '<div class="muted">Сигналов риска нет</div>';
    return '<div class="rs">' + reasons.map(function (r) {
      var w = Math.min(100, Math.abs(r.points) * 2.5);
      return '<div>' + esc(r.text) + '</div><div class="pts">' + (r.points > 0 ? '+' : '') + r.points + '</div><div class="bar"><i class="' + (r.points < 0 ? 'neg' : '') + '" style="width:' + w + '%"></i></div>';
    }).join('') + '</div>';
  }
  function verifyHTML(v) {
    if (!v) return '';
    var head = { passed: ['green', 'Помощник: обычная операция, подтверждено'], failed: ['red', 'Помощник: признаки обмана'], needs_operator: ['yellow', 'Помощник: сам не подтверждает, нужен сотрудник'] }[v.status] || ['gray', 'Помощник: ждём ответов'];
    var a = v.answers || {}, map = { call: 'Звонили по поводу перевода', purpose: 'Цель', code: 'Просили код или секретность', pressure: 'Торопят или пугают' };
    var lab = function (k, val) { var q = QS.filter(function (x) { return x.key === k; })[0]; var o = q && q.opts.filter(function (x) { return x[0] === val; })[0]; return o ? o[1] : ({ unknown: 'не выяснено', other: 'другая цель' }[val] || val); };
    return '<div class="vbox"><span class="pill ' + head[0] + '">' + head[1] + '</span><dl class="kv">' + Object.keys(map).filter(function (k) { return a[k]; }).map(function (k) { return '<dt>' + map[k] + '</dt><dd>' + esc(lab(k, a[k])) + '</dd>'; }).join('') + '</dl>' +
      (v.flags_text && v.flags_text.length ? '<div class="muted" style="font-size:12px">Признаки: ' + esc(v.flags_text.join('; ')) + '</div>' : '') + '</div>';
  }
  function renderOperator() {
    var o = S.operator, h = '';
    o.queue.forEach(function (q) {
      h += '<div class="qcard"><div class="head"><b>' + (q.kind === 'credit' ? 'Кредит' : 'Перевод') + ' № ' + q.id + ' · ' + fmt(q.amount) + '</b>' + pill(q.zone, q.score) + '</div>' +
        (q.appeal ? '<div><span class="pill yellow">Клиент не согласен с решением доверенного лица</span></div>' : '') +
        '<div class="muted" style="font-size:13px">→ ' + esc(q.recipient) + ' · сигналы устройства (эмуляция): звонок ' + CALL_TEXT[q.device.call || 'none'] + (q.device.night ? ', ночь' : '') + (q.device.new_device ? ', новое устройство' : '') + (q.device.codes ? ', недавние коды входа' : '') + '</div>' +
        reasonsHTML(q.reasons) + verifyHTML(q.verification) + '<div class="events">' + q.events.map(function (e) { return '<span>+' + Math.floor(e.minute) + ' мин · ' + esc(e.text) + '</span>'; }).join('') + '</div>';
      if (q.my_turn) h += '<div class="btnrow"><button class="btn ok" data-act="decide" data-actor="operator" data-op="' + q.id + '" data-d="approve">Личность подтверждена, разрешить</button><button class="btn danger" data-act="decide" data-actor="operator" data-op="' + q.id + '" data-d="reject">Отклонить</button></div>';
      else if (q.status === 'HELD') h += '<div class="muted" style="font-size:13px">Оператор подключится через ' + Math.max(0, Math.ceil(q.operator_due)) + ' мин, если доверенные лица не решат. Предельный срок удержания: ' + Math.ceil(q.deadline_left) + ' мин.</div>';
      else h += '<div class="muted" style="font-size:13px">Статус: ' + { EXECUTED: 'проведена', REJECTED: 'остановлена', EXPIRED: 'срок истёк' }[q.status] + '</div>';
      h += '</div>';
    });
    setHTML($('opQueue'), h || '<div class="empty">Операций на паузе нет.</div>');
    setHTML($('clientBlock'), o.client.outgoing_blocked ? '<button class="btn small sec" data-act="unblock">Снять автоблокировку клиента</button>' : '');
    var ih = '';
    o.incidents.forEach(function (i) {
      var c = i.card, pr = { high: 'red', medium: 'yellow', low: 'gray' }[i.priority], loc = { in_bcc: 'на счёте в BCC', other_bank: 'в другом банке', cashed: 'сняты наличными' }[c.recipient.money_location] || '—';
      ih += '<div class="qcard"><div class="head"><b>Заявление № ' + i.id + '</b><span class="pill ' + pr + '">Приоритет: ' + { high: 'высокий', medium: 'средний', low: 'низкий' }[i.priority] + '</span></div>' +
        '<div><span class="pill gray">' + esc(i.status) + '</span> <span class="muted" style="font-size:13px">' + esc(i.status_text) + '</span></div>' +
        '<dl class="kv"><dt>Что произошло</dt><dd>' + esc(c.what) + (c.got_goods ? ', товар получен' : '') + '</dd>' +
        '<dt>Перевод</dt><dd>' + fmt(c.transfer.amount) + ' → ' + esc(c.transfer.recipient) + ' (' + esc(c.transfer.bank) + '), ' + ago(c.transfer.minutes_ago) + '</dd>' +
        '<dt>Оценка риска</dt><dd>' + (c.score == null ? 'не оценивалась (защита не была подключена)' : c.score) + '</dd>' +
        '<dt>Получатель</dt><dd>история ' + (c.recipient.history_months < 1 ? 'менее 1 мес.' : c.recipient.history_months + ' мес.') + ', жалоб ' + c.recipient.complaints + (c.recipient.flagged ? ', в базе подозрительных' : '') + '</dd>' +
        '<dt>Где деньги</dt><dd>' + loc + '</dd>' + (i.hold_left != null ? '<dt>Удержание</dt><dd>ещё ' + Math.ceil(i.hold_left) + ' мин' + (i.police_report_no ? ', заявление в полицию № ' + esc(i.police_report_no) : '') + '</dd>' : '') + '</dl>' + chainSVG(c) +
        '<div class="events">' + i.feed.slice(-4).map(function (f) { return '<span>+' + Math.floor(f.minute) + ' мин · ' + esc(f.text) + '</span>'; }).join('') + '</div>' + incidentActions(i) + '</div>';
    });
    var ch = (o.cases || []).map(function (c) {
      return '<div class="qcard"><div class="head"><b>Обращение ' + esc(c.number) + '</b><span class="pill ' + (c.status === 'refunded' ? 'green' : 'yellow') + '">' + (c.kind === 'stopped' ? 'Перевод остановлен' : (c.status === 'refunded' ? 'Деньги возвращены' : 'Проверка')) + '</span></div>' +
        '<div class="muted" style="font-size:13px">' + (c.kind === 'stopped' ? 'Клиент сообщил, что его вынуждают перевести деньги' : 'Клиент сообщил об обмане из чека') + ' · ' + fmt(c.amount) + ' → ' + esc(c.recipient) + '</div>' +
        (c.kind === 'after_send' && c.status === 'accepted' ? '<div class="btnline"><button class="btn small" data-act="case-refund" data-no="' + esc(c.number) + '">Деньги вернулись: зачислить клиенту</button></div>' : '') +
        (o.safe_mode && o.safe_mode.case === c.number ? '<div class="btnline"><button class="btn small sec" data-act="safe-off">Личность проверена: снять режим безопасности</button></div>' : '') + '</div>';
    }).join('');
    setHTML($('opIncidents'), ch + ih || '<div class="empty">Обращений нет.</div>');
    setHTML($('opComplaints'), (o.complaints || []).map(function (c) {
      var open = c.status === 'open';
      return '<div class="qcard"><div class="head"><b>' + (c.source === 'auto' ? 'Автопроверка' : 'Жалоба клиента') + ': ' + esc(c.who) + '</b><span class="pill ' + (open ? 'yellow' : 'gray') + '">' + { open: 'Открыта', removed: 'Доверенное лицо удалён', kept: 'Доверенное лицо оставлен' }[c.status] + '</span></div>' +
        '<div class="muted" style="font-size:13px">' + esc(c.text) + (/[.!?]$/.test(c.text) ? '' : '.') + (c.want_remove ? ' Клиент просит удалить доверенного лица сразу.' : '') + '</div>' +
        (c.log.length ? '<div class="events">' + c.log.map(function (t) { return '<span>• ' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
        (open ? '<div class="btnline"><button class="btn small danger" data-act="comp" data-id="' + c.id + '" data-a="remove">Личность клиента проверена, удалить доверенное лицо</button><button class="btn small sec" data-act="comp" data-id="' + c.id + '" data-a="keep">Оставить</button></div>' : '') + '</div>';
    }).join('') || '<div class="empty">Жалоб нет.</div>');
  }
  function incidentActions(i) {
    var b = function (a, t, cls) { return '<button class="btn small ' + (cls || 'sec') + '" data-act="inc" data-id="' + i.id + '" data-a="' + a + '">' + t + '</button>'; };
    if (i.status === 'TRIAGED') return '<div class="btnline">' + b('freeze', i.card.transfer.bank === 'BCC' ? 'Удержать средства у получателя' : 'Запросить заморозку через Антифрод-центр', '') + '</div>';
    if (i.status === 'HELD') return '<div class="btnline">' + b('explained', 'Получатель дал пояснения') + b('return', 'Вернуть клиенту', 'ok') + b('release', 'Снять удержание', 'danger') + '</div>' +
      (i.can_extend ? '<div class="inline"><input id="police' + i.id + '" placeholder="№ заявления в полицию" aria-label="Номер заявления в полицию">' + b('extend', 'Продлить') + '</div>' : '<div class="muted" style="font-size:12px">Достигнут предельный срок удержания.</div>');
    if (['RETURNED', 'RELEASED', 'EXPIRED', 'DISPUTE_CIVIL'].indexOf(i.status) >= 0) return '<div class="btnline">' + b('close', 'Закрыть заявление') + '</div>';
    if (i.status === 'CLOSED') return '<div class="muted" style="font-size:13px">Итог: ' + esc(i.outcome || '') + '</div>';
    return '';
  }
  function chainSVG(c) {
    var hops = c.chain || []; if (!hops.length) return '';
    var rowH = 46, H = 10 + (hops.length + 1) * rowH, s = '';
    var box = function (x, y, w, text, sub, dashed) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="34" rx="8" style="fill:var(--c-page);stroke:var(--c-line)"' + (dashed ? ' stroke-dasharray="4 3"' : '') + '/>' +
        '<text x="' + (x + 10) + '" y="' + (y + 15) + '" font-size="11" style="fill:var(--c-text)">' + esc(text) + '</text><text x="' + (x + 10) + '" y="' + (y + 28) + '" font-size="10" style="fill:var(--c-muted)">' + esc(sub) + '</text>';
    };
    s += box(4, 4, 300, c.transfer.recipient, fmt(c.transfer.amount) + ' от клиента', false);
    hops.forEach(function (hp, k) {
      var y = 4 + (k + 1) * rowH;
      s += '<path d="M24 ' + (y - 12) + ' V ' + (y + 17) + ' H 40" style="fill:none;stroke:var(--c-muted)"/>' + box(40, y, 264, hp.to, fmt(hp.amount) + (hp.kind === 'cash' ? ' · точка для полиции' : (hp.visible ? ' · видно в BCC' : ' · запрошено (эмуляция)')), !hp.visible);
    });
    return '<div class="chain"><svg viewBox="0 0 310 ' + H + '" role="img" aria-label="Цепочка переводов">' + s + '</svg></div>';
  }
  function renderBank() {
    var b = S.bank, st = b.stats;
    var items = [[st.transfers, 'Переводов'], [st.executed, 'Проведено'], [st.stopped, 'Остановлено'], [fmtN(st.saved_amount), 'Сохранено, ₸'], [st.call_blocks, 'Блокировок на звонке'], [st.credit_lock_blocks, 'Сработок кредитного замка'],
      [st.false_delay_share == null ? '—' : Math.round(st.false_delay_share * 100) + '%', 'Доля ложных задержек'], [st.time_to_freeze_minutes == null ? '—' : st.time_to_freeze_minutes + ' мин', 'Время до заморозки']];
    setHTML($('stats'), items.map(function (x) { return '<div class="stat"><div class="v">' + x[0] + '</div><div class="k">' + x[1] + '</div></div>'; }).join(''));
    var r = b.recent[0];
    setHTML($('lastScore'), r ? '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>' + fmt(r.amount) + ' → ' + esc(r.recipient) + '</b>' + pill(r.zone, r.score) + '</div>' + reasonsHTML(r.reasons) +
      '<div class="muted" style="font-size:12px;margin-top:6px">Зоны: до 30 — сразу; 30–69 — одно подтверждение; от 70 — два подтверждения или оператор.</div>' : '<div class="empty">Операций пока нет.</div>');
    setHTML($('auditOk'), b.audit_verify.ok ? '<span class="pill green">Цепочка хэшей цела · ' + b.audit_verify.records + '</span>' : '<span class="pill red">Нарушена на записи ' + b.audit_verify.broken_at + '</span>');
    setHTML($('audit'), b.audit.map(function (a) { return '<div><span class="num">+' + Math.floor(a.minute) + ' мин</span><span>' + esc(a.actor) + '</span><span>' + esc(a.action) + ' <code>' + a.hash.slice(0, 8) + '</code></span></div>'; }).join(''));
  }
  function renderSim() {
    var sim = S.demo.sim;
    document.querySelectorAll('#callSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === sim.call)); });
    $('simNight').checked = sim.night; $('simDevice').checked = sim.new_device; $('simRemote').checked = sim.remote_access; $('simCodes').checked = !!sim.codes;
  }

  // ---------- наложения внутри телефона: нижний лист (sheet) и экран поверх (full) ----------
  var FULL = { call: 1, wizard: 1, report: 1, result: 1, verify: 1 };
  // вопросы помощника банка: коротко, кнопками, без кодов и паролей
  var QS = [
    { key: 'call', q: function () { return 'Вам сейчас кто-то звонит или звонил по поводу этого перевода?'; }, opts: [['no', 'Нет, никто не звонил'], ['yes', 'Да, звонили']] },
    { key: 'purpose', q: function (p) { return p.kind === 'credit' ? 'Зачем вы оформляете ' + fmt(p.amount) + ' в кредит?' : 'Кому и зачем вы переводите ' + fmt(p.amount) + '?'; }, opts: [['family', 'Родным или знакомым, кого знаю лично'], ['purchase', 'За товар или услугу'], ['safe_account', 'На «безопасный счёт» по просьбе банка или полиции'], ['investment', 'Для инвестиций или заработка'], ['online_stranger', 'Человеку из интернета или соцсетей']] },
    { key: 'code', q: function () { return 'Вас просили назвать код из SMS, установить приложение или никому не говорить о переводе?'; }, opts: [['no', 'Нет'], ['yes', 'Да, просили']] },
    { key: 'pressure', q: function () { return 'Вас торопят или пугают, что иначе будут проблемы?'; }, opts: [['no', 'Нет, всё спокойно'], ['yes', 'Да, торопят или пугают']] }
  ];
  function pendById(id) { var r = null; S.ward.pending.forEach(function (x) { if (x.id === id) r = x; }); return r; }
  // Настоящий ИИ-помощник: страница открыта с сервера агента (eve на Vercel), он ставит window.KORGAN_AI.
  // Модель только понимает ответы человека (answers). Провести или остановить операцию решает движок.
  // Адрес развёрнутого агента (eve на Vercel). Задаётся в панели имитации и запоминается в этом браузере.
  // В артефакте Claude внешние запросы запрещены, поэтому там чат работает на правилах.
  // Поле адреса убрано из демо. Подключить развёрнутого агента можно, задав window.KORGAN_AI_URL до загрузки страницы.
  function aiUrl() { return String(window.KORGAN_AI_URL || '').replace(/\/+$/, ''); }
  function sid() { var a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return 'k' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function openVerifyAI(id) {
    var p = pendById(id); if (!p) return;
    var o = { type: 'verify', ai: true, op: id, session: sid(), step: 0, ans: {}, typing: true, done: null, quick: [], msgs: [] };
    openOverlay(o);
    var ctx = 'КОНТЕКСТ: клиент ' + S.ward.name + '. ' + (p.kind === 'credit' ? 'Оформление: ' + p.recipient + ' на ' + fmt(p.amount) : 'Перевод ' + fmt(p.amount) + ' получателю «' + p.recipient + '»') +
      '. Операция на паузе, доверенные лица не ответили. Сигналы по телефону клиента: ' + ((p.own_reasons || []).join('; ') || 'нет') + '.';
    aiSend(o, ctx, false);
  }
  function aiSend(o, text, mine) {
    if (mine) o.msgs.push({ from: 'me', text: text });
    o.typing = true; o.quick = []; renderOverlay();
    fetch(aiUrl() + '/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session: o.session, message: text }) })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) {
        if (ui.overlay !== o) return;
        o.msgs.push({ from: 'bot', text: d.reply }); o.quick = (d.quick_replies || []).slice(0, 4); o.typing = false;
        if (d.done) return aiFinish(o, d.answers || {});
        renderOverlay();
      })
      .catch(function () {
        if (ui.overlay !== o) return;
        o.ai = false; o.typing = false; o.step = 0; o.ans = {};
        var p = pendById(o.op) || { amount: 0 };
        o.msgs.push({ from: 'bot', text: 'ИИ-помощник сейчас недоступен, поэтому задам вопросы сам.' });
        o.msgs.push({ from: 'bot', text: QS[0].q(p) });
        renderOverlay();
      });
  }
  function aiFinish(o, answers) {
    o.typing = true; renderOverlay();
    api('/api/ward/ops/' + o.op + '/verify', 'POST', { answers: answers }).then(function (r) {
      o.typing = false;
      if (!r.ok) { o.msgs.push({ from: 'bot', text: r.data.error.message }); o.done = 'error'; }
      else {
        o.done = r.data.status;
        o.msgs.push({ from: 'sys', text: { passed: 'Помощник банка подтвердил перевод: признаков обмана нет.', failed: 'Банк остановил операцию. Деньги остаются на вашем счёте.', needs_operator: 'Помощник не смог подтвердить перевод сам. Если хотите, свяжитесь с сотрудником банка. Деньги пока на вашем счёте.' }[o.done] || '' });
      }
      refresh();
    });
  }
  function openVerify(id) {
    try { E.assistantOpened(id); } catch (e) {}
    if (aiUrl()) return openVerifyAI(id);
    var p = pendById(id); if (!p) return;
    var o = { type: 'verify', op: id, step: 0, ans: {}, typing: true, done: null,
      msgs: [{ from: 'bot', text: 'Здравствуйте, ' + S.ward.name + '! Я помощник службы безопасности банка. Ваши доверенные лица пока не ответили, поэтому задам 4 коротких вопроса о переводе ' + fmt(p.amount) + ' получателю «' + p.recipient + '». Деньги пока на вашем счёте. Решение примет сотрудник банка, ваши ответы помогут ему.' }] };
    openOverlay(o);
    wait(700).then(function () { if (ui.overlay !== o) return; o.msgs.push({ from: 'bot', text: QS[0].q(p) }); o.typing = false; renderOverlay(); });
  }
  function answerVerify(o, val) {
    var q = QS[o.step], p = pendById(o.op) || { amount: 0 };
    var label = q.opts.filter(function (x) { return x[0] === val; })[0][1];
    o.ans[q.key] = val; o.msgs.push({ from: 'me', text: label }); o.step++; o.typing = true; renderOverlay();
    wait(750).then(function () {
      if (ui.overlay !== o) return;
      if (o.step < QS.length) { o.msgs.push({ from: 'bot', text: QS[o.step].q(p) }); o.typing = false; renderOverlay(); return; }
      api('/api/ward/ops/' + o.op + '/verify', 'POST', { answers: o.ans }).then(function (r) {
        o.typing = false;
        if (!r.ok) { o.msgs.push({ from: 'bot', text: r.data.error.message }); o.done = 'error'; }
        else {
          o.done = r.data.status;
          o.msgs.push({ from: 'bot', text: {
            passed: 'Спасибо. Признаков обмана нет, я подтвердил перевод. Деньги отправлены.',
            failed: 'Похоже на мошенничество: ' + r.data.flags_text.join('; ') + '. Я остановил перевод, деньги остаются на вашем счёте. Положите трубку, если с вами говорят, и позвоните доверенным лицам. Настоящий банк никогда не просит переводить деньги на «безопасный счёт».',
            needs_operator: 'Спасибо. Подтвердить этот перевод сам я не могу: нужна проверка сотрудником банка. Если хотите, нажмите «Связаться с сотрудником банка». Если нет, перевод подождёт ответа доверенного лица. Деньги пока на вашем счёте.'
          }[o.done] });
        }
        refresh();
      });
    });
  }
  function openOverlay(o) {
    ui.overlay = o;
    var ov = $('overlay');
    clearTimeout(ov._tm);
    ov.className = 'overlay ' + (FULL[o.type] ? 'full' : 'sheet');
    ov.hidden = false; $('ovPanel')._h = null; $('ovPanel')._key = null; $('ovPanel')._key = null;
    renderOverlay();
    var f = $('ovPanel').querySelector('button,input'); if (f) f.focus({ preventScroll: true });
  }
  function closeOverlay(then) {
    var ov = $('overlay');
    if (!ui.overlay) { if (then) then(); return; }
    ui.overlay = null;
    ov.classList.add('closing');
    ov._tm = setTimeout(function () { ov.hidden = true; ov.classList.remove('closing'); $('ovPanel')._h = null; $('ovPanel').innerHTML = ''; if (then) then(); }, reduced ? 0 : 210);
  }
  function head(step, total, back) { return '<div class="wizhead"><button data-act="ov-back"><svg class="chev-l" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>' + (back || 'Назад') + '</button><div class="wizbar"><i style="width:' + Math.round(step / total * 100) + '%"></i></div><span>Шаг ' + step + ' из ' + total + '</span></div>'; }
  function opt(a, val, title, sub, pressed) { return '<button class="opt" data-act="' + a + '" data-v="' + esc(val) + '" aria-pressed="' + !!pressed + '"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>'; }
  function mark(kind, icon) { return '<div class="mark ' + kind + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + P[icon] + '</svg></div>'; }
  function opInfo(id) {
    var o = null; S.ward.recent_ops.forEach(function (x) { if (x.id === id) o = x; });
    var p = null; S.ward.pending.forEach(function (x) { if (x.id === id) p = x; });
    return { op: o, pend: p };
  }
  // Дата и время демо: реальная дата запуска сценария плюс минуты сценария.
  function fmtDT(minute) {
    var d = new Date((S.ward.epoch || Date.now()) + minute * 60000), z = function (n) { return (n < 10 ? '0' : '') + n; };
    return z(d.getDate()) + '.' + z(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + z(d.getHours()) + ':' + z(d.getMinutes());
  }
  function caseByOp(id) { var c = null; S.ward.cases.forEach(function (x) { if (x.op_id === id) c = x; }); return c; }
  function caseByNo(no) { var c = null; S.ward.cases.forEach(function (x) { if (x.number === no) c = x; }); return c; }
  // Причина паузы из данных операции: что уже переведено, сколько получится, какой лимит.
  function limitText(p) {
    var L = p.limit || [], day = null, mon = null; L.forEach(function (x) { if (x.period === 'day') day = x; else mon = x; });
    if (!day && !mon) return '';
    var t = 'Вы хотите перевести ' + fmt(p.amount) + '.';
    if (day) t += ' Сегодня вы уже перевели ' + fmt(day.spent) + '. С этим переводом получится ' + fmt(day.total) + ' при вашем дневном лимите ' + fmt(day.limit) + '.';
    if (mon) t += (day ? '<br><br>' : '') + ' За месяц вы уже перевели ' + fmt(mon.spent) + '. С этим переводом получится ' + fmt(mon.total) + ' при вашем месячном лимите ' + fmt(mon.limit) + '.';
    return t;
  }
  function kv(rows) { return '<dl class="kv receipt">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'; }
  function caseHTML(c) {
    var stopped = c.kind === 'stopped';
    var tr = stopped ? 'Перевод остановлен. Деньги остались на вашем счёте' : 'Перевод выполнен';
    var st = stopped ? 'Обращение принято' : (c.status === 'refunded' ? 'Банк вернул ' + fmt(c.refund.amount) + ' на ваш счёт' : 'Обращение принято. Банк проверит операцию');
    return '<div class="result">' + mark(stopped ? 'ok' : 'warn', stopped ? 'check' : 'alert') + '<h2>Обращение ' + esc(c.number) + '</h2><p class="calmtext" style="margin:0">' + tr + '.</p></div>' +
      kv([['Номер обращения', esc(c.number)], ['Дата и время', fmtDT(c.created_at)], ['Сумма', fmt(c.amount)], ['Получатель', esc(c.recipient)], ['Статус перевода', tr], ['Статус обращения', st]]) +
      protectHTML() + '<button class="btn" data-act="res-done">Готово</button>';
  }
  // «Защитите доступ»: что уже сделано автоматически и что клиент может сделать одной кнопкой.
  function protectHTML() {
    var w = S.ward, others = (w.devices || []).filter(function (d) { return !d.current; });
    var row = function (done, title, sub, btn) { return '<div class="prow' + (done ? ' done' : '') + '"><span class="pm" aria-hidden="true">' + (done ? ic('check') : '') + '</span><span class="pt"><b>' + title + '</b><small>' + sub + '</small></span></div>' + (btn || ''); };
    return '<div class="protect"><div class="sect">Защитите доступ</div>' +
      row(!!w.safe_mode, w.safe_mode ? 'Режим безопасности включён' : 'Режим безопасности снят', w.safe_mode ? 'Кредит наличными закрыт. Переводы работают, но перед переводом новому получателю мы напомним о повторных звонках мошенников. Снять режим может сотрудник банка.' : 'Сотрудник банка проверил личность и снял режим.') +
      row(!others.length, others.length ? 'Выйти на других устройствах' : 'Другие устройства отключены', others.length ? 'Сейчас вход открыт ещё на ' + others.length + ' ' + plural(others.length, 'устройстве', 'устройствах', 'устройствах') + ': ' + others.map(function (d) { return esc(d.name) + ' (' + esc(d.place) + ')'; }).join(', ') + '. Этот телефон останется.' : 'Вход открыт только на этом телефоне.',
        others.length ? '<button class="btn sec" data-act="sess-reset">Выйти на всех других устройствах</button>' : '') +
      row(w.code_changed_at != null, w.code_changed_at != null ? 'Код входа обновлён' : 'Сменить код входа', w.code_changed_at != null ? 'Старый код больше не подходит.' : 'Если вы называли код кому-то или вводили его по просьбе, смените его.',
        w.code_changed_at == null ? '<button class="btn sec" data-act="code-open">Сменить код входа</button>' : '') +
      ((w.guardians && w.guardians.guardian) ? row(true, 'Доверенное лицо уведомлено', esc(w.guardians.guardian.split(',')[0]) + ' знает об обращении и может вам позвонить.') : '') + '</div>';
  }
  function whyHTML(p) {
    var r = p.own_reasons || [];
    var other = p.reasons_hidden;
    if (!r.length) return '<div class="why"><b>Почему пауза</b><small>По данным банка перевод требует проверки. Подробности о получателе — банковская тайна.</small></div>';
    return '<div class="why"><b>Почему пауза</b><ul>' + r.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }
  function ladderHTML(p) {
    var g = S.ward.guardians, steps = [];
    var first = p.approvals > 0;
    if (g.guardian && !p.appeal) steps.push([first ? 'done' : 'now', g.guardian, first ? 'Подтвердил' : 'Запрос отправлен']);
    var secState = p.second_asked ? (p.needs_two && first && p.approvals > 1 ? 'done' : 'now') : '';
    if (g.second && !p.appeal) steps.push([secState, g.second, p.second_asked ? 'Запрос отправлен' : 'Через 5 минут, если доверенное лицо не ответит']);
    if (p.needs_two) steps.push([p.operator_connected ? 'now' : '', 'Сотрудник банка', p.operator_connected ? 'Проверит личность и примет решение' : (!g.second && first ? 'Через 5 минут после ответа доверенного лица' : 'Через 15 минут, если доверенные лица не решат')]);
    else steps.push([p.operator_connected ? 'now' : '', 'Помощник банка', p.operator_connected ? (p.verification === 'needs_operator' ? 'Сам не подтвердил. Сотрудник — по вашей просьбе' : 'Задаёт 4 вопроса: обычную покупку подтвердит сам') : 'Через 15 минут, если доверенные лица не ответят. Сотрудник банка — по вашей просьбе']);
    steps.push(['', 'Никто не ответил', 'Через 60 минут операция отменится, деньги останутся у вас']);
    return '<div class="ladder">' + steps.map(function (s) { return '<div class="step ' + s[0] + '"><i></i><span><b>' + esc(s[1]) + '</b><small>' + esc(s[2]) + '</small></span></div>'; }).join('') + '</div>';
  }

  function renderOverlay() {
    var o = ui.overlay, h = '', w = S.ward, key = o.type + ':' + (o.step == null ? '' : o.step);
    if (o.type === 'call') {
      h = '<div class="wizhead"><button data-act="ov-close"><svg class="chev-l" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>Назад</button></div><div class="callscreen"><div class="av">' + ic('call') + '</div><div class="wiztitle">Связь с банком</div>' +
        '<span class="pill green">Звонок из приложения · подлинность подтверждена (эмуляция)</span><p class="muted" style="margin:0">Оператор Дана, служба безопасности. Вы позвонили сами, поэтому это точно банк.</p></div>' +
        '<div class="note info"><b>Помните</b>Банк никогда не просит коды из SMS, не просит переводить деньги на «безопасный счёт» и не звонит первым с такой просьбой.</div>' +
        '<div class="note warn"><b>Демо</b>Звонок не соединяется с настоящим оператором банка. Это показ идеи.</div><button class="btn danger" data-act="ov-close">Завершить звонок</button>';
    } else if (o.type === 'confirm') {
      var r = recById(o.rid);
      h = '<h2 style="text-align:center">' + (o.fav ? esc(o.favTitle) : 'Проверьте перевод') + '</h2><div class="bigsum">' + fmt(o.amount) + '</div>' +
        '<div class="rows"><div><span>Откуда</span><span>Карта ••3107</span></div><div><span>Кому</span><span>' + esc(r ? r.name : '') + '</span></div><div><span>Банк получателя</span><span>' + esc(r ? r.bank : '') + '</span></div>' +
        '<div><span>Комиссия</span><span>0 ₸</span></div>' + (o.big ? '<div><span>Режим</span><span>Крупная покупка</span></div>' : '') + '</div>' +
        (o.warnSafe = S.ward.safe_mode && r && !r.whitelisted && !S.ward.favorites.some(function (f) { return f.recipient_id === o.rid; }), '') +
        (o.warnSafe ? '<div class="note bad"><b>Вы недавно сообщили о мошенничестве</b>Мошенники часто звонят второй раз: «мы из полиции» или «из банка, вернём деньги, переведите комиссию». Если вас просят сделать этот перевод, не переводите и положите трубку.</div>' : '') +
        (r && !r.known && !r.whitelisted && !o.warnSafe ? '<div class="note info">Вы раньше не переводили этому получателю. Если вас попросили сделать перевод по телефону, остановитесь.</div>' : '') +
        '<button class="btn" data-act="tr-send"' + (o.busy ? ' disabled' : '') + '>' + (o.busy ? '<span class="spin"></span>' : (o.fav ? 'Оплатить' : 'Перевести')) + '</button>' + (o.fav ? '<button class="btn sec" data-act="fav-other">Другая сумма</button><button class="btn sec" data-act="ov-close">Отмена</button>' : '<button class="btn sec" data-act="ov-close">Изменить</button>');
      key += o.busy ? ':busy' : '';
    } else if (o.type === 'credit') {
      var goods = o.product === 'goods';
      h = '<h2 style="text-align:center">' + (goods ? 'Оформить рассрочку?' : 'Оформить кредит?') + '</h2><div class="bigsum">' + fmt(o.amount) + '</div><div class="rows"><div><span>Продукт</span><span>' + (goods ? 'Рассрочка на товар, 12 мес.' : 'Кредит наличными') + '</span></div><div><span>Деньги получит</span><span>' + (goods ? 'Магазин «Техно Дом»' : 'Ваша карта ••3107') + '</span></div></div>' +
        (goods ? '' : '<div class="note warn">Если вас по телефону попросили взять кредит и перевести деньги, это мошенники. Настоящий банк так не делает.</div>') +
        '<button class="btn" data-act="cr-send"' + (o.busy ? ' disabled' : '') + '>' + (o.busy ? '<span class="spin"></span>' : 'Оформить') + '</button><button class="btn sec" data-act="ov-close">Отмена</button>';
      key += o.busy ? ':busy' : '';
    } else if (o.type === 'result') {
      if (o.error) {
        var call = o.error.code === 'CALL_ACTIVE';
        h = '<div class="result">' + mark('bad', 'cross') + '<h2>' + esc(errTitle(o.error.code)) + '</h2><p class="muted" style="margin:0">' + esc(o.error.message) + '</p></div>' +
          (call ? '<div class="note bad"><b>Положите трубку</b>Сотрудник банка никогда не просит переводить деньги. Деньги на месте.</div>' : '') +
          (call || o.error.code === 'REMOTE_ACCESS' ? '<p class="arrfr">Требование АРРФР для всех банков с ноября 2025 года. В Қорған реализовано так же.</p>' : '') +
          '<button class="btn" data-act="res-done">Понятно</button>';
        key += ':err';
      } else {
        var info = opInfo(o.op), op = info.op || {}, p = info.pend, what = op.kind === 'credit' ? 'Оформление' : 'Перевод';
        if (p && (p.limit_only || p.limit)) {
          // Экран «Перевод на паузе»: сумма, получатель, причина и три действия.
          var rq = p.request && p.request.status === 'active' ? p.request : null, autoReq = !p.limit_only;
          h = '<div class="result">' + mark('warn', 'pause') + '<h2>Перевод на паузе</h2><p class="calmtext" style="margin:0">' + limitText(p) + '</p><p class="muted" style="margin:0">' + fmt(p.amount) + ' → ' + esc(p.recipient) + '</p><p class="calmtext" style="margin:0"><b>Деньги пока на вашем счёте.</b></p></div>' +
            (autoReq ? whyHTML(p) : '') +
            (rq ? '<div class="note info"><b>Ждём подтверждения</b>Запрос отправлен доверенному лицу: ' + esc(rq.who) + '. Пока оно не ответило, вы можете остановить перевод.</div>'
              : (autoReq ? '<div class="note info"><b>Ждём подтверждения</b>Запрос доверенному лицу отправлен автоматически.</div>'
                : (p.has_trusted ? '<button class="btn" data-act="req-confirm" data-op="' + p.id + '">Запросить подтверждение</button>'
                  : '<div class="note warn"><b>Доверенное лицо не добавлено</b>Подтвердить перевод некому. Можно отменить перевод или обратиться в банк.</div><button class="btn sec" data-act="call">Связь с банком</button>'))) +
            (p.operator_connected && !p.verification ? '<button class="btn" data-act="verify" data-op="' + p.id + '">Ответить помощнику банка</button>' : '') +
            '<button class="btn danger" data-act="pressure" data-op="' + p.id + '">Меня просят перевести деньги</button>' +
            (rq && !p.staff_called ? '<button class="btn sec" data-act="staff" data-op="' + p.id + '">Связаться с сотрудником банка</button>' : '') +
            '<button class="btn sec" data-act="ward-cancel" data-op="' + p.id + '">Отменить перевод</button>';
          key += ':' + p.operator_connected + p.verification + p.staff_called + ':lim:' + (rq ? 'rq' : '') + p.has_trusted;
        } else if (p) {
          h = '<div class="result">' + mark('warn', 'pause') + '<h2>Мы бережём ваши деньги</h2><p class="calmtext" style="margin:0">' + what + ' ждёт подтверждения.</p><p class="muted" style="margin:0">' + fmt(p.amount) + (p.kind === 'credit' ? ' · ' + esc(p.recipient) + '. Кредит пока не оформлен.' : ' → ' + esc(p.recipient) + '. Деньги никуда не ушли.') +
            (p.needs_two ? (p.has_second ? ' Нужны два подтверждения.' : ' Нужны подтверждения доверенного лица и оператора банка.') : ' Нужно одно подтверждение.') + '</p></div>' + whyHTML(p) + ladderHTML(p) +
            '<div class="note warn"><b>Вам кто-то звонил с просьбой это сделать?</b>Если да, это мошенники. Отмените операцию.</div>' +
            (p.operator_connected && !p.verification ? '<button class="btn" data-act="verify" data-op="' + p.id + '">Ответить банку</button>' : '<button class="btn" data-act="res-done">На главную</button>') +
            '<button class="btn danger" data-act="pressure" data-op="' + p.id + '">Меня просят перевести деньги</button>' + (!p.staff_called && !p.needs_two ? '<button class="btn sec" data-act="staff" data-op="' + p.id + '">Связаться с сотрудником банка</button>' : '') + '<button class="btn sec" data-act="ward-cancel" data-op="' + p.id + '">Отменить перевод</button>';
          key += ':held:' + [(p.own_reasons || []).length, p.approvals, p.second_asked, p.appeal, p.operator_connected, p.verification, p.staff_called].join();
        } else if (op.status === 'EXECUTED') {
          // Чек выполненного перевода. «Меня обманули» доступна всем клиентам, даже без подключённой защиты.
          var cs = caseByOp(op.id), isTr = op.kind === 'transfer';
          h = '<div class="result">' + mark('ok', 'check') + '<h2>' + (op.kind === 'credit' ? 'Оформлено' : 'Перевод выполнен') + '</h2><div class="bigsum">' + fmt(op.amount) + '</div><p class="muted" style="margin:0">' + esc(op.recipient) +
            (op.by === 'guardian' || op.by === 'second' ? ' · подтвердило доверенное лицо' : (op.by === 'operator' ? ' · подтвердил сотрудник банка' : '')) + '</p></div>' +
            (isTr ? kv([['Дата и время', fmtDT(op.decided_at != null ? op.decided_at : op.created_at)], ['Получатель', esc(op.recipient)], ['Сумма', fmt(op.amount)], ['Статус', 'Выполнен']]) : '') +
            '<button class="btn" data-act="res-done">Готово</button>' +
            (isTr ? (cs ? '<button class="btn sec" data-act="open-case" data-no="' + esc(cs.number) + '">Обращение ' + esc(cs.number) + '</button>' : '<button class="btn sec danger-t" data-act="fraud" data-op="' + op.id + '">Меня обманули</button>') : '') +
            (o.saveRid ? (o.saved ? '<p class="muted small" style="text-align:center;margin:0">Сохранено в частых платежах</p>' : '<button class="btn sec" data-act="fav-save">' + ic('star') + 'Сохранить как частый платёж</button>') : '');
          key += ':ok:' + !!o.saved + ':' + (caseByOp(op.id) ? 'c' : '');
        } else if (op.status === 'REJECTED' || op.status === 'EXPIRED') {
          var byT = op.by === 'guardian' || op.by === 'second';
          h = '<div class="result">' + mark('bad', 'cross') + '<h2>' + (byT ? 'Перевод отклонён' : (op.status === 'EXPIRED' ? 'Срок ожидания истёк' : (op.by === 'ward' ? 'Перевод отменён' : 'Операция остановлена'))) + '</h2><p class="calmtext" style="margin:0">' +
            (byT ? 'Доверенное лицо отклонило перевод. Деньги остались на вашем счёте.' : 'Деньги остались на вашем счёте.') + '</p></div><button class="btn" data-act="res-done">Готово</button>';
          key += ':stop';
        }
      }
    } else if (o.type === 'fraud') {
      var fo = opInfo(o.op).op || {};
      h = '<h2>Меня обманули</h2><p class="muted" style="margin:0">Банк проверит перевод и покажет статус обращения.</p>' +
        kv([['Сумма', fmt(fo.amount)], ['Получатель', esc(fo.recipient)], ['Дата и время', fmtDT(fo.decided_at != null ? fo.decided_at : fo.created_at)]]) +
        '<button class="btn danger" data-act="fraud-send" data-op="' + fo.id + '">Сообщить банку</button><button class="btn sec" data-act="ov-close">Отмена</button>';
    } else if (o.type === 'case') {
      var cc = caseByNo(o.no); h = cc ? caseHTML(cc) : '<p>Обращение не найдено.</p>';
      key += ':' + (cc ? cc.status : '') + ':' + !!S.ward.safe_mode + ':' + (S.ward.devices || []).length + ':' + S.ward.code_changed_at;
    } else if (o.type === 'code') {
      h = '<h2>Новый код входа</h2><p class="muted" style="margin:0">Придумайте 4 цифры. Никому их не называйте, даже сотруднику банка.</p>' +
        '<div class="field"><label for="code1">Новый код</label><input id="code1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div>' +
        '<div class="field"><label for="code2">Повторите код</label><input id="code2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password"></div>' +
        '<p class="err" id="codeErr" role="alert"></p><button class="btn" data-act="code-save">Сохранить код</button><button class="btn sec" data-act="code-back">Назад</button>';
    } else if (o.type === 'pickop') {
      var outs = S.ward.recent_ops.filter(function (x) { return x.kind === 'transfer' && x.status === 'EXECUTED'; }).reverse();
      h = '<h2>Какой перевод?</h2><p class="muted" style="margin:0">Выберите перевод, по которому вас обманули.</p>' +
        (outs.length ? '<div class="opts">' + outs.map(function (x) { var cs = caseByOp(x.id); return opt(cs ? 'open-case-op' : 'fraud-pick', String(x.id), fmt(x.amount) + ' → ' + esc(x.recipient), fmtDT(x.decided_at != null ? x.decided_at : x.created_at) + (cs ? ' · обращение ' + esc(cs.number) : '')); }).join('') + '</div>'
          : '<div class="empty">Выполненных переводов нет.</div>') +
        '<button class="btn sec" data-act="call">Связь с банком</button><button class="btn sec" data-act="ov-close">Отмена</button>';
    } else if (o.type === 'verify') {
      var cur = QS[o.step];
      h = '<div class="wizhead"><button data-act="ov-close"><svg class="chev-l" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>Свернуть</button></div>' +
        '<div class="chathead"><span class="avatar">' + ic('shield') + '</span><span><b>Служба безопасности банка</b><small>' + (o.ai ? 'ИИ-помощник · модель через Vercel AI Gateway' : 'Помощник в приложении · правила (эмуляция ИИ)') + '</small></span></div>' +
        '<div class="demo-flag">Чат внутри приложения банка. Здесь никогда не спросят коды, пароли и данные карты.</div>' +
        '<div class="chat" aria-live="polite">' + o.msgs.map(function (m, i) { return '<div class="bub ' + m.from + (i === o.msgs.length - 1 ? ' fresh' : '') + '">' + esc(m.text) + '</div>'; }).join('') +
        (o.typing ? '<div class="bub bot typing" aria-label="Помощник печатает"><i></i><i></i><i></i></div>' : '') + '</div>' +
        (o.ai ? (!o.typing && !o.done ? (o.quick.length ? '<div class="replies">' + o.quick.map(function (q) { return '<button class="pchip reply" data-act="v-ai-quick" data-v="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>' : '') +
            '<form class="vform" id="vForm"><input id="vInput" maxlength="600" autocomplete="off" placeholder="Напишите ответ своими словами" aria-label="Ваш ответ"><button class="btn small" type="submit">Отправить</button></form>' : '')
          : (!o.typing && !o.done && cur ? '<div class="replies">' + cur.opts.map(function (x) { return '<button class="pchip reply" data-act="v-ans" data-v="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' : '')) +
        (o.done ? '<button class="btn" data-act="v-done">Готово</button>' : '') +
        (o.done === 'passed' || o.done === 'failed' ? '' : '<button class="btn sec" data-act="staff" data-op="' + o.op + '">Связаться с сотрудником банка</button>');
      key += ':' + o.msgs.length + ':' + o.typing + ':' + o.done + ':' + !!o.ai;
    } else if (o.type === 'tadd') {
      var rels = ['внук', 'внучка', 'сын', 'дочь', 'брат', 'сестра', 'другое'];
      h = '<h2>Новый доверенное лицо</h2><p class="muted" style="margin:0">Он будет получать запросы на подтверждение опасных операций. Баланс и историю он не видит.</p>' +
        '<div class="field"><label for="tName">Имя</label><input id="tName" maxlength="30" autocomplete="off" placeholder="Например, Дана" value="' + esc(o.name || '') + '"></div>' +
        '<div class="field"><span class="muted small" style="font-weight:600">Кем приходится</span><div class="pillrow" style="flex-wrap:wrap">' + rels.map(function (r) { return '<button class="pchip" data-act="t-rel" data-v="' + r + '" aria-pressed="' + (o.rel === r) + '">' + r + '</button>'; }).join('') + '</div></div>' +
        '<div class="note info">Вступит в силу через период охлаждения. Нынешнее доверенное лицо получит уведомление и сможет позвонить вам. Новый доверенное лицо получит приглашение (эмуляция).</div>' +
        '<p class="err" id="tErr"></p><button class="btn" data-act="t-add-go">Добавить</button><button class="btn sec" data-act="ov-close">Отмена</button>';
      key += ':' + o.rel;
    } else if (o.type === 'tremove') {
      var tr0 = w.trusted.filter(function (t) { return t.role === o.role; })[0] || {};
      h = '<h2>Удалить ' + esc(tr0.name || '') + '?</h2><p class="muted" style="margin:0">' + (o.role === 'guardian' ? 'Первым подтверждать будет второе доверенное лицо.' : 'Останется одно доверенное лицо; если оно не ответит, решение примет оператор банка.') + '</p>' +
        '<div class="note warn"><b>Это ослабляет защиту</b>Удаление вступит в силу через период охлаждения. Доверенные лица получат уведомление. Во время звонка удалить нельзя.</div>' +
        '<button class="btn danger" data-act="t-remove-go">Удалить</button><button class="btn sec" data-act="ov-close">Отмена</button>';
    } else if (o.type === 'complain') {
      var tc = w.trusted.filter(function (t) { return t.role === o.role; })[0] || {};
      h = '<h2>Жалоба на ' + esc(tc.name || '') + '</h2><p class="muted" style="margin:0">Жалобу получит сотрудник банка. Он позвонит вам из приложения и проверит личность. Доверенное лицо не узнает, что именно вы написали.</p><div class="opts">' +
        [['Отклоняет мои переводы без причины', 'Отклоняет без причины'], ['Давит на меня или требует денег', 'Давит или требует денег'], ['Следит за моими тратами', 'Следит за тратами'], ['Другое', 'Другое']].map(function (x) { return opt('c-reason', x[0], x[1], '', o.reason === x[0]); }).join('') + '</div>' +
        opt('c-remove', '1', (o.remove ? '✓ ' : '') + 'Удалить доверенное лицо сразу', 'Без суток ожидания: сотрудник банка удалит его после проверки личности', o.remove) +
        '<button class="btn" data-act="c-send"' + (o.reason ? '' : ' disabled') + '>Отправить жалобу</button><button class="btn sec" data-act="ov-close">Отмена</button>';
      key += ':' + o.reason + ':' + o.remove;
    } else if (o.type === 'wizard') {
      if (o.step === 1) h = head(1, 4, 'Отмена') + '<div class="wiztitle">Кто подтверждает операции первым?</div><p class="muted" style="margin:0">' +
        (w.trusted.length > 1 ? 'Второй получит запрос, если первый не ответит за 5 минут.' : 'Доверенное лицо одно. Если оно не ответит, подключится оператор банка. Добавить второго можно в разделе «Защита».') + '</p><div class="opts">' +
        w.trusted.map(function (t) { return opt('wiz-first', t.key, t.name + ', ' + t.relation, t.role === 'guardian' ? 'Сейчас подтверждает первым' : 'Сейчас второе доверенное лицо', o.first === t.key); }).join('') + '</div>';
      else if (o.step === 2) h = head(2, 4) + '<div class="wiztitle">Кому переводить без подтверждения?</div><p class="muted" style="margin:0">Белый список. Его можно изменить в любой момент.</p><div class="opts">' +
        w.recipients.filter(function (r) { return r.id !== 'stranger' && !r.card; }).map(function (r) { return opt('wiz-white', r.id, (o.white.indexOf(r.id) >= 0 ? '✓ ' : '') + r.name, '', o.white.indexOf(r.id) >= 0); }).join('') + '</div>';
      else if (o.step === 3) h = head(3, 4) + '<div class="wiztitle">Что увидят доверенные лица</div><div class="note info"><b>Видят</b>Сумму, имя получателя без номера счёта и причину паузы.</div><div class="note info"><b>Не видят</b>Баланс, историю операций, номера счетов, коды из SMS.</div><div class="note info"><b>Вы управляете сами</b>Видите каждое решение доверенных лиц, можете не согласиться с отказом и пожаловаться в банк. Согласие на 12 месяцев, отозвать можно в любой момент.</div>';
      else h = head(4, 4) + '<div class="wiztitle">Проверьте и включите защиту</div><dl class="kv"><dt>Первый</dt><dd>' + esc((w.trusted.filter(function (t) { return t.key === o.first; })[0] || {}).name || '') + '</dd><dt>Белый список</dt><dd>' +
        (o.white.length ? esc(o.white.map(function (id) { var r = recById(id); return r ? r.name : id; }).join(', ')) : 'пусто') + '</dd></dl>' +
        opt('wiz-consent', '1', (o.consent ? '✓ ' : '') + 'Я согласен', 'Доверенные лица видят только операцию на подтверждении', o.consent) + '<button class="btn" data-act="wiz-finish"' + (o.consent ? '' : ' disabled') + '>Включить защиту</button>';
      if (o.step < 4) h += '<button class="btn" data-act="ov-next">Продолжить</button>';
      key += ':' + o.first + ':' + o.white.join(',') + ':' + o.consent;
    } else if (o.type === 'report') {
      var callNow = S.demo.sim.call.indexOf('active') === 0, total = o.pre ? 2 : 3;
      if (o.step === 0) h = '<div class="wizhead"><button data-act="ov-close"><svg class="chev-l" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>Отмена</button></div><div class="wiztitle">Сначала положите трубку</div><div class="note bad">Если с вами сейчас говорят «из банка» или «из полиции», завершите разговор. Сотрудник банка не просит переводить деньги.</div><button class="btn" data-act="ov-next">Я положил трубку, продолжить</button>';
      else if (o.step === 1) h = head(1, total, 'Отмена') + '<div class="wiztitle">Что произошло?</div><div class="opts">' + [['bank_call', 'Звонили «из банка»'], ['police_call', 'Звонили «из полиции» или госоргана'], ['investment', 'Предложили инвестиции или заработок'], ['purchase', 'Покупал товар или услугу'], ['other', 'Другое']].map(function (x) { return opt('rep-what', x[0], x[1], '', o.what === x[0]); }).join('') + '</div>';
      else if (o.step === 2) h = head(2, total) + '<div class="wiztitle">Какой перевод?</div><div class="opts">' + (w.reportable.length ? w.reportable.map(function (r) { return opt('rep-op', r.id, fmt(r.amount) + ' → ' + r.recipient, ago(r.minutes_ago), o.op === r.id); }).join('') : '<div class="empty">Проведённых переводов нет.</div>') + '</div>';
      else if (o.step === 3) h = head(o.pre ? 2 : 3, total) + '<div class="wiztitle">Вы получили товар или услугу?</div><div class="opts">' + opt('rep-goods', 'yes', 'Да, получил', 'Например, товар оказался не таким', o.goods === true) + opt('rep-goods', 'no', 'Нет / ничего не покупал', '', o.goods === false) + '</div><button class="btn" data-act="rep-submit"' + (o.goods == null ? ' disabled' : '') + '>' + (o.busy ? '<span class="spin"></span>' : 'Отправить заявление') + '</button>';
      else h = '<div class="result">' + mark(o.result === 'DISPUTE_CIVIL' ? 'warn' : 'ok', o.result === 'DISPUTE_CIVIL' ? 'pause' : 'check') + '<h2>Заявление отправлено</h2></div><div class="note ' + (o.result === 'DISPUTE_CIVIL' ? 'info' : 'ok') + '"><b>' + (o.result === 'DISPUTE_CIVIL' ? 'Гражданский спор' : 'Мы уже действуем') + '</b>' +
        (o.result === 'DISPUTE_CIVIL' ? 'Банк не может вернуть деньги по желанию одной стороны. Подробности и что делать — на главной.' : 'Исходящие переводы и карты заблокированы, сессии на других устройствах сброшены, кредитный замок включён. Заявление у оператора.') + '</div><button class="btn" data-act="res-done">На главную</button>';
      if (o.step >= 1 && o.step <= 2) h += '<button class="btn" data-act="ov-next"' + ((o.step === 1 && !o.what) || (o.step === 2 && !o.op) ? ' disabled' : '') + '>Продолжить</button>';
      if (callNow && o.step > 0 && o.step < 4) h = '<div class="note bad">Идёт звонок. Положите трубку.</div>' + h;
      key += ':' + o.what + ':' + o.op + ':' + o.goods + ':' + !!o.busy + ':' + callNow;
    }
    // ключ меняется только при смене шага или выбора, поэтому анимация входа не повторяется каждую секунду
    var panel = $('ovPanel');
    if (panel._key === key && panel._h === h) return;
    var stepChanged = panel._key && panel._key.split(':')[1] !== key.split(':')[1];
    panel._key = key;
    if (setHTML(panel, '<div class="ov-in">' + h + '</div>') && !stepChanged) { var inner = panel.firstChild; if (inner) inner.style.animation = 'none'; }
    if (o.type === 'verify') panel.scrollTo({ top: panel.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }

  // ---------- вкладки, перевод, форма карты ----------
  var TAB_ORDER = ['Home', 'Transfer', 'Pay', 'Hist', 'Svc'];
  function setTab(t, opts) {
    var prev = ui.tab; ui.tab = t;
    TAB_ORDER.forEach(function (n) { $('tab' + n).hidden = n !== t; });
    if (t === 'Svc') showSvc(ui.svc, true);
    if (t === 'Transfer') showTr(true);
    if (S) renderWard();
    $('wScroll').scrollTo({ top: 0 });
    if (prev !== t || (opts && opts.force)) { animate($('tab' + t), 'enter'); animate($('wHead'), 'enter'); }
  }
  function showSvc(v, silent) {
    var prev = ui.svc; ui.svc = v;
    $('svcMain').hidden = v !== 'main'; $('svcProt').hidden = v !== 'prot'; $('svcCredit').hidden = v !== 'credit'; $('svcLock').hidden = v !== 'lock'; $('svcLimits').hidden = v !== 'limits';
    if (!silent && prev !== v) { animate($({ main: 'svcMain', prot: 'svcProt', credit: 'svcCredit', lock: 'svcLock', limits: 'svcLimits' }[v]), v === 'main' ? 'enter-pop' : 'enter-push'); $('wScroll').scrollTo({ top: 0 }); }
    if (S) renderWard();
  }
  function showTr(silent, dir) {
    var t = ui.tr;
    $('trPick').hidden = t.step !== 'pick'; $('trAmount').hidden = t.step !== 'amount';
    $('trPeople').hidden = t.mode !== 'people'; $('trCard').hidden = t.mode !== 'card';
    if (!silent) { animate($(t.step === 'amount' ? 'trAmount' : (t.mode === 'card' ? 'trCard' : 'trPeople')), dir || 'enter-push'); $('wScroll').scrollTo({ top: 0 }); }
    if (S) renderWard();
  }
  function goAmount(rid) {
    ui.tr.rid = rid; ui.tr.step = 'amount';
    var r = recById(rid);
    $('amtHint').textContent = 'С карты ••3107 · доступно ' + fmt(S.ward.balance);
    if (ui.tab !== 'Transfer') setTab('Transfer'); showTr(false, 'enter-push');
    if (r) setTimeout(function () { $('amt').focus({ preventScroll: true }); }, reduced ? 0 : 260);
  }
  function setAmount(n) { $('amt').value = n ? fmtN(n) : ''; }
  function prefill(f) {
    ui.error = null; ui.myOps = {}; ui.svc = 'main'; ui.shownBal = null; ui.autoAsked = {};
    if (ui.overlay) { ui.overlay = null; $('overlay').hidden = true; $('ovPanel')._h = null; $('ovPanel')._key = null; }
    ui.tr = { step: 'pick', mode: 'people', rid: null };
    clearCard();
    if (!f) return;
    if (f.kind === 'credit') { $('crAmt').value = fmtN(f.amount); $('crProd').value = f.product || 'goods'; crInfo(); ui.svc = 'credit'; setTab('Svc', { force: true }); return; }
    $('bigBuy').checked = !!f.big_purchase;
    if (S && S.demo.scenario >= 6) { setTab('Home', { force: true }); return; }
    ui.tr = { step: 'amount', mode: 'people', rid: f.recipient_id };
    setAmount(f.amount);
    $('amtHint').textContent = 'С карты ••3107';
    setTab('Transfer', { force: true });
  }

  // Первый экран после запуска: сохранённое место или «Главная».
  function bootView() {
    var v = restored;
    if (!v) { prefill(S.demo.form); setTab('Home', { force: true }); return; }  // форма перевода заполнена, но открывается главная
    if (v.tr && ['pick', 'amount'].indexOf(v.tr.step) >= 0) ui.tr = { step: v.tr.step === 'amount' && v.tr.rid && recById(v.tr.rid) ? 'amount' : 'pick', mode: v.tr.mode === 'card' ? 'card' : 'people', rid: v.tr.rid || null };
    if (ui.tr.step === 'amount') { setAmount(v.amount || 0); $('amtHint').textContent = 'С карты ••3107 · доступно ' + fmt(S.ward.balance); }
    if (v.svc && ['main', 'prot', 'credit', 'lock', 'limits'].indexOf(v.svc) >= 0) ui.svc = v.svc;
    if (v.hist) ui.hist = v.hist;
    if (v.speed != null) SPM = v.speed; ui.paused = !!v.paused; ui.moreScen = !!v.moreScen;
    if (v.font) { ui.font = true; $('wardPhone').classList.add('large'); }
    setTab(TAB_ORDER.indexOf(v.tab) >= 0 ? v.tab : 'Home', { force: true });
    if (v.scroll) setTimeout(function () { $('wScroll').scrollTo({ top: v.scroll }); }, 30);
  }
  var lastSave = 0;
  function saveSession(force) {
    var n = Date.now(); if (!force && n - lastSave < 2000) return; lastSave = n;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ state: E.snapshot(), view: { tab: ui.tab, svc: ui.svc, hist: ui.hist, tr: ui.tr, amount: Number(digits($('amt').value)) || 0, scroll: $('wScroll').scrollTop, speed: SPM, paused: ui.paused, moreScen: ui.moreScen, font: ui.font } }));
    } catch (e) {}
  }
  window.addEventListener('pagehide', function () { saveSession(true); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveSession(true); });

  function cardDigits() { return digits($('cardNum').value).slice(0, 19); }
  function paintCard() {
    var d = cardDigits(), out = '';
    for (var i = 0; i < 16; i++) { if (i && i % 4 === 0) out += ' '; out += i < d.length ? (i < 12 && d.length >= 16 && i >= 4 ? '•' : d[i]) : '•'; }
    $('cfNum').textContent = out;
    $('cfName').textContent = ($('cardName').value.trim() || 'Получатель').toUpperCase();
    var inp = $('cardNum');
    inp.classList.toggle('good', d.length >= 16 && KorganEngine.luhnOk(d));
    if (d.length < 16) inp.classList.remove('bad');
  }
  function clearCard() { $('cardNum').value = ''; $('cardName').value = ''; $('cardErr').textContent = ''; $('cardNum').classList.remove('bad', 'good'); paintCard(); }
  function cardError(msg) {
    $('cardErr').textContent = msg; $('cardNum').classList.add('bad');
    animate($('trCard').querySelector('.cardface'), 'shake');
  }

  // ---------- события ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act],[data-tab]');
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-tab')) {
      var tab = t.getAttribute('data-tab');
      closeOverlay();
      if (tab === 'Svc') ui.svc = 'main';
      if (tab === 'Transfer' && ui.tab === 'Transfer') { ui.tr.step = 'pick'; showTr(false, 'enter-pop'); return; }
      if (tab === 'Transfer') { ui.tr.step = ui.tr.rid ? ui.tr.step : 'pick'; }
      setTab(tab); return;
    }
    var a = t.getAttribute('data-act'), op = Number(t.getAttribute('data-op')), o = ui.overlay;
    switch (a) {
      case 'scen': ui.scenario = null; act('/api/scenario/' + t.getAttribute('data-n')); break;
      case 'fav': var fv = favById(Number(t.getAttribute('data-id'))); if (fv) openOverlay({ type: 'confirm', rid: fv.recipient_id, amount: fv.amount, big: false, fav: fv.id, favTitle: fv.title }); break;
      case 'fav-edit': ui.favEdit = !ui.favEdit; renderWard(); break;
      case 'fav-del': act('/api/ward/favorites/' + t.getAttribute('data-id') + '/remove').then(function (r) { if (r.ok) toast('Частый платёж удалён.'); }); break;
      case 'fav-other': var fo = favById(o.fav); closeOverlay(function () { ui.tr.mode = 'people'; goAmount(fo.recipient_id); setAmount(fo.amount); amtLimitText(); }); break;
      case 'fav-save': act('/api/ward/favorites', { recipient_id: o.saveRid, amount: o.saveAmount, title: o.saveTitle }).then(function (r) { if (r.ok) { o.saved = true; toast('Сохранено. Платёж теперь на главной.'); renderOverlay(); } }); break;
      case 'scen-more': ui.moreScen = !ui.moreScen; renderScen(); break;
      case 'speed': var sp = Number(t.getAttribute('data-v')); if (sp === 0) ui.paused = true; else { ui.paused = false; SPM = sp; } renderScen(); break;
      case 'appeal': act('/api/ward/ops/' + op + '/appeal').then(function (r) { if (r.ok) toast('Решение передано сотруднику банка. Он позвонит вам в приложении.'); }); break;
      case 'complain': openOverlay({ type: 'complain', role: t.getAttribute('data-role'), reason: null, remove: false }); break;
      case 'c-reason': o.reason = t.getAttribute('data-v'); renderOverlay(); break;
      case 'c-remove': o.remove = !o.remove; renderOverlay(); break;
      case 'c-send':
        api('/api/ward/trusted/complaint', 'POST', { role: o.role, text: o.reason, remove: o.remove }).then(function (r) {
          closeOverlay(); if (!r.ok) toast(r.data.error.message); else toast('Жалоба у сотрудника банка. Он позвонит вам и проверит личность.'); refresh();
        });
        break;
      case 'renew': act('/api/ward/consent/renew').then(function (r) { if (r.ok) toast('Доверенные лица подтверждены ещё на 12 месяцев.'); }); break;
      case 'comp': act('/api/operator/complaints/' + t.getAttribute('data-id') + '/' + t.getAttribute('data-a')); break;
      case 'plate': var pv = S.ward.pending.filter(function (x) { return x.operator_connected && !x.verification; })[0]; if (pv) openVerify(pv.id); else if (S.ward.pending.length || S.ward.outgoing_blocked) setTab('Home'); else { ui.svc = 'prot'; setTab('Svc'); } break;
      case 'font': ui.font = !ui.font; $('wardPhone').classList.toggle('large', ui.font); renderWard(); break;
      case 'eye': ui.hide = !ui.hide; renderWard(); break;
      case 'go': ui.tr.step = 'pick'; ui.tr.mode = 'people'; setTab(t.getAttribute('data-t')); break;
      case 'go-card': ui.tr.step = 'pick'; ui.tr.mode = 'card'; setTab('Transfer'); setTimeout(function () { $('cardNum').focus({ preventScroll: true }); }, 260); break;
      case 'open-prot': ui.error = null; if (ui.tab !== 'Svc') { ui.svc = 'prot'; setTab('Svc'); } else showSvc('prot'); break;
      case 'open-limits': ui.error = null; fillLimits(); if (ui.tab !== 'Svc') { ui.svc = 'limits'; setTab('Svc'); } else showSvc('limits'); break;
      case 'lim-q': $(t.getAttribute('data-f')).value = fmtN(Number(t.getAttribute('data-v'))); break;
      case 'open-lock': ui.error = null; if (ui.tab !== 'Svc') { ui.svc = 'lock'; setTab('Svc'); } else showSvc('lock'); break;
      case 'open-credit': if (ui.tab !== 'Svc') { ui.svc = 'credit'; setTab('Svc'); } else showSvc('credit'); break;
      case 'svc-back': ui.error = null; showSvc('main'); break;
      case 'svcf': ui.svcFilter = t.getAttribute('data-f'); renderWard(); animate($('svcMain')); break;
      case 'hist': ui.hist = t.getAttribute('data-f'); renderWard(); animate($('tabHist')); break;
      case 'pay': ui.tr.mode = 'people'; goAmount(t.getAttribute('data-r')); setAmount(0); break;
      case 'tr-mode': ui.tr.mode = t.getAttribute('data-m'); ui.tr.step = 'pick'; showTr(false, 'enter'); if (ui.tr.mode === 'card') setTimeout(function () { $('cardNum').focus({ preventScroll: true }); }, 260); break;
      case 'tr-pick': goAmount(t.getAttribute('data-r')); break;
      case 'tr-back': ui.tr.step = 'pick'; showTr(false, 'enter-pop'); break;
      case 'quick': setAmount(Number(t.getAttribute('data-v'))); amtLimitText(); break;
      case 'card-test': $('cardNum').value = t.getAttribute('data-v').replace(/(\d{4})(?=\d)/g, '$1 '); $('cardErr').textContent = ''; paintCard(); break;
      case 'call': if (ui.overlay) closeOverlay(function () { openOverlay({ type: 'call' }); }); else openOverlay({ type: 'call' }); break;
      case 'sos': openOverlay({ type: 'pickop' }); break;
      case 'sos-old': openOverlay({ type: 'report', step: S.demo.sim.call.indexOf('active') === 0 ? 0 : 1, what: null, op: S.ward.reportable[0] ? S.ward.reportable[0].id : null, goods: null }); break;
      case 'dispute-old': openOverlay({ type: 'report', step: S.demo.sim.call.indexOf('active') === 0 ? 0 : 1, what: null, op: op, goods: null, pre: true }); break;
      case 'wizard': openOverlay({ type: 'wizard', step: 1, first: S.ward.guardian_keys.guardian, white: S.ward.whitelist.slice(), consent: false }); break;
      case 'tog-prot': ui.error = null; api('/api/ward/protection', 'POST', { on: !S.ward.protection_on }).then(function (r) { if (!r.ok) { ui.error = r.data.error; toast(r.data.error.message); } refresh(); }); break;
      case 'lock-mode': ui.error = null; api('/api/ward/credit-lock-mode', 'POST', { mode: t.getAttribute('data-v') }).then(function (r) { if (!r.ok) { ui.error = r.data.error; toast(r.data.error.message); } else if (r.data.status === 'pending') toast('Умный режим включится через период охлаждения.'); refresh(); }); break;
      case 'tog-lock': ui.error = null; api('/api/ward/credit-lock', 'POST', { on: !S.ward.credit_lock }).then(function (r) { if (!r.ok) { ui.error = r.data.error; toast(r.data.error.message); } refresh(); }); break;
      case 'decide': act('/api/ops/' + op + '/decision', { decision: t.getAttribute('data-d') }, t.getAttribute('data-actor')).then(function (r) { if (r.ok && t.getAttribute('data-actor') !== 'operator') toast(t.getAttribute('data-d') === 'approve' ? 'Вы подтвердили перевод.' : 'Вы отклонили перевод.'); }); break;
      case 'callg': toast('Звонок клиенту (эмуляция).'); break;
      case 'call-trusted': toast('Звонок доверенному лицу (эмуляция).'); break;
      case 'ward-cancel':
        // «Отменить перевод»: закрываем перевод и запрос, возвращаем клиента к списку операций. Обращение не создаём.
        act('/api/ward/ops/' + op + '/self-confirm', { decision: 'reject' }).then(function (r) { if (!r.ok) return; toast('Перевод отменён. Деньги на вашем счёте.'); closeOverlay(function () { setTab('Hist'); }); });
        break;
      case 'sess-reset': act('/api/ward/sessions/reset').then(function (r) { if (r.ok) { toast('Вы вышли на ' + r.data.closed + ' ' + plural(r.data.closed, 'устройстве', 'устройствах', 'устройствах') + '. Этот телефон остался.'); renderOverlay(); } }); break;
      case 'code-open': ui.overlay = { type: 'code', back: o }; renderOverlay(); break;
      case 'code-back': ui.overlay = o.back; renderOverlay(); break;
      case 'code-save':
        var c1 = digits($('code1').value), c2 = digits($('code2').value);
        if (c1 !== c2) { $('codeErr').textContent = 'Коды не совпадают.'; break; }
        api('/api/ward/code', 'POST', { code: c1 }).then(function (r) {
          if (!r.ok) { $('codeErr').textContent = r.data.error.message; return; }
          toast('Код входа обновлён.'); refresh().then(function () { ui.overlay = o.back; renderOverlay(); });
        });
        break;
      case 'safe-off': act('/api/operator/safe-mode/off'); break;
      case 'staff': act('/api/ward/ops/' + op + '/staff').then(function (r) { if (r.ok) toast('Сотрудник банка свяжется с вами в приложении. Деньги пока на вашем счёте.'); }); break;
      case 'req-confirm': act('/api/ward/ops/' + op + '/request').then(function (r) { if (r.ok) toast('Запрос отправлен доверенному лицу.'); }); break;
      case 'pressure':
        api('/api/ward/ops/' + op + '/pressure', 'POST', {}).then(function (r) {
          if (!r.ok) { toast(r.data.error.message); return refresh(); }
          refresh().then(function () { if (ui.overlay) { ui.overlay = { type: 'case', no: r.data.number }; renderOverlay(); } else openOverlay({ type: 'case', no: r.data.number }); });
        });
        break;
      case 'receipt': openOverlay({ type: 'result', op: op }); break;
      case 'fraud': var ec = caseByOp(op); if (ec) { ui.overlay = { type: 'case', no: ec.number }; renderOverlay(); } else { ui.overlay = { type: 'fraud', op: op }; renderOverlay(); } break;
      case 'fraud-pick': var pid = Number(t.getAttribute('data-v')); ui.overlay = { type: 'fraud', op: pid }; renderOverlay(); break;
      case 'open-case-op': var pc = caseByOp(Number(t.getAttribute('data-v'))); if (pc) { ui.overlay = { type: 'case', no: pc.number }; renderOverlay(); } break;
      case 'fraud-send':
        api('/api/ward/ops/' + op + '/report', 'POST', {}).then(function (r) {
          if (!r.ok) { toast(r.data.error.message); return; }
          refresh().then(function () { ui.overlay = { type: 'case', no: r.data.number }; renderOverlay(); });
        });
        break;
      case 'open-case': var oc = t.getAttribute('data-no'); if (ui.overlay) { ui.overlay = { type: 'case', no: oc }; renderOverlay(); } else openOverlay({ type: 'case', no: oc }); break;
      case 'case-refund': act('/api/operator/cases/' + t.getAttribute('data-no') + '/refund'); break;
      case 'show-op': openOverlay({ type: 'result', op: op }); break;
      case 'verify': closeOverlay(function () { openVerify(op); }); break;
      case 'v-ans': answerVerify(o, t.getAttribute('data-v')); break;
      case 'v-ai-quick': aiSend(o, t.getAttribute('data-v'), true); break;
      case 'v-done': var vop = o.op; closeOverlay(function () { openOverlay({ type: 'result', op: vop }); }); break;
      case 'tr-add': openOverlay({ type: 'tadd', name: '', rel: 'внучка' }); break;
      case 't-rel': o.name = ($('tName') || {}).value || o.name; o.rel = t.getAttribute('data-v'); renderOverlay(); break;
      case 't-add-go':
        var nm = ($('tName') || {}).value || '';
        if (!nm.trim()) { $('tErr').textContent = 'Укажите имя.'; animate($('tName'), 'shake'); break; }
        api('/api/ward/trusted', 'POST', { name: nm, relation: o.rel }).then(function (r) {
          if (!r.ok) { $('tErr').textContent = r.data.error.message; return; }
          closeOverlay(); toast('Запрос отправлен: доверенное лицо добавится после периода охлаждения.'); refresh();
        });
        break;
      case 'tr-remove': openOverlay({ type: 'tremove', role: t.getAttribute('data-role') }); break;
      case 't-remove-go':
        api('/api/ward/trusted/remove', 'POST', { role: o.role }).then(function (r) {
          closeOverlay(); if (!r.ok) { ui.error = r.data.error; toast(r.data.error.message); } else toast('Удаление вступит в силу после периода охлаждения.'); refresh();
        });
        break;
      case 'tr-swap': act('/api/ward/trusted/swap').then(function (r) { if (r.ok) toast('Порядок изменён.'); }); break;
      case 'dis-cancel': act('/api/ward/disable-requests/' + t.getAttribute('data-id') + '/cancel'); break;
      case 'copy':
        var txt = $('stmt' + t.getAttribute('data-id')).textContent;
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Текст скопирован.'); }, function () { toast('Выделите текст и скопируйте вручную.'); });
        else toast('Выделите текст и скопируйте вручную.');
        break;
      case 'inc':
        var id = t.getAttribute('data-id'), ac = t.getAttribute('data-a'), body = {};
        if (ac === 'extend') body.police_report_no = ($('police' + id) || {}).value || null;
        act('/api/operator/incidents/' + id + '/' + ac, body); break;
      case 'unblock': act('/api/operator/client/unblock'); break;
      case 'tr-send':
        o.busy = true; renderOverlay();
        var sendRid = o.rid, sendAmt = o.amount, isFav = !!o.fav;
        wait(650).then(function () { return o.fav ? api('/api/ward/favorites/' + o.fav + '/pay', 'POST', {}) : api('/api/ward/transfer', 'POST', { recipient_id: o.rid, amount: o.amount, big_purchase: o.big }); })
          .then(function (r) { finishOp(r, isFav ? null : { rid: sendRid, amount: sendAmt }); });
        break;
      case 'cr-send':
        o.busy = true; renderOverlay();
        wait(650).then(function () { return api('/api/ward/credit', 'POST', { amount: o.amount, product: o.product }); }).then(function (r) { finishOp(r); });
        break;
      case 'res-done':
        var wasErr = o && o.error;
        closeOverlay(function () {
          if (wasErr) return;  // после блокировки остаёмся на экране суммы: данные не теряются
          if (ui.tab === 'Hist' || ui.tab === 'Svc') return;  // чек и обращение из истории: остаёмся там же
          ui.tr = { step: 'pick', mode: 'people', rid: null }; setAmount(0); clearCard(); setTab('Home');
        });
        break;
      case 'ov-backdrop': case 'ov-close': closeOverlay(); break;
      case 'ov-back': if ((o.type === 'wizard' && o.step === 1) || (o.type === 'report' && o.step <= 1)) closeOverlay(); else { o.step--; if (o.type === 'report' && o.pre && o.step === 2) o.step = 1; renderOverlay(); } break;
      case 'ov-next': o.step++; if (o.type === 'report' && o.pre && o.step === 2) o.step = 3; renderOverlay(); break;
      case 'wiz-first': o.first = t.getAttribute('data-v'); renderOverlay(); break;
      case 'wiz-white': var v = t.getAttribute('data-v'), k = o.white.indexOf(v); if (k >= 0) o.white.splice(k, 1); else o.white.push(v); renderOverlay(); break;
      case 'wiz-consent': o.consent = !o.consent; renderOverlay(); break;
      case 'wiz-finish': act('/api/ward/setup', { first: o.first, whitelist: o.white, consent: true }).then(function (r) { if (r.ok) { closeOverlay(); toast('Қорған включён.'); } }); break;
      case 'rep-what': o.what = t.getAttribute('data-v'); renderOverlay(); break;
      case 'rep-op': o.op = Number(t.getAttribute('data-v')); renderOverlay(); break;
      case 'rep-goods': o.goods = t.getAttribute('data-v') === 'yes'; renderOverlay(); break;
      case 'rep-submit':
        o.busy = true; renderOverlay();
        wait(500).then(function () { return act('/api/ward/report', { op_id: o.op, what: o.what, got_goods: o.goods }); }).then(function (r) { o.busy = false; if (r.ok) { o.step = 4; o.result = r.data.status; } renderOverlay(); });
        break;
    }
  });

  function finishOp(r, save) {
    if (r.ok) ui.myOps[r.data.id] = true;
    refresh().then(function () {
      var next = r.ok ? { type: 'result', op: r.data.id } : { type: 'result', error: r.data.error };
      if (r.ok && save && !S.ward.favorites.some(function (f) { return f.recipient_id === save.rid && f.amount === save.amount; })) {
        var rr = recById(save.rid); next.saveRid = save.rid; next.saveAmount = save.amount; next.saveTitle = rr ? rr.name.split(/[,(•]/)[0].trim() : '';
      }
      closeOverlay(function () { openOverlay(next); });
    });
  }

  // форма карты: группы по 4 цифры, проверка контрольной цифры (алгоритм Луна) прямо при вводе
  $('cardNum').addEventListener('input', function () {
    var d = cardDigits(), pos = this.selectionStart, before = this.value.length;
    this.value = d.replace(/(\d{4})(?=\d)/g, '$1 ');
    if (document.activeElement === this && pos != null) { var np = pos + (this.value.length - before); this.setSelectionRange(np, np); }
    $('cardErr').textContent = '';
    if (d.length >= 16 && !KorganEngine.luhnOk(d)) $('cardErr').textContent = 'В номере ошибка. Проверьте цифры.';
    paintCard();
  });
  $('cardName').addEventListener('input', paintCard);
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'vForm') {
      e.preventDefault();
      var o = ui.overlay, v = ($('vInput').value || '').trim();
      if (o && o.ai && v && !o.typing && !o.done) aiSend(o, v, true);
    }
  });
  $('trCard').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = cardDigits();
    if (d.length < 16) return cardError('Введите 16 цифр номера карты.');
    if (!KorganEngine.luhnOk(d)) return cardError('В номере ошибка. Проверьте цифры.');
    api('/api/ward/card-recipient', 'POST', { card_number: d, name: $('cardName').value }).then(function (r) {
      if (!r.ok) return cardError(r.data.error.message);
      refresh().then(function () { clearCard(); setAmount(0); goAmount(r.data.id); });
    });
  });
  $('amt').addEventListener('input', function () { var d = digits(this.value).slice(0, 9); this.value = d ? fmtN(Number(d)) : ''; amtLimitText(); });
  ['limDaily', 'limMonthly'].forEach(function (id) { $(id).addEventListener('input', function () { var d = digits(this.value).slice(0, 9); this.value = d ? fmtN(Number(d)) : ''; $('limErr').textContent = ''; }); });
  $('limMonthlyOn').onclick = function () { ui.limMonthlyOn = !(ui.limMonthlyOn !== false); paintDailySw(); $('limErr').textContent = ''; };
  $('limDailyOn').onclick = function () { ui.limDailyOn = !ui.limDailyOn; paintDailySw(); $('limErr').textContent = ''; };
  $('limSave').onclick = function () {
    var daily = Number(digits($('limDaily').value)), monthly = Number(digits($('limMonthly').value));
    ui.error = null;
    api('/api/ward/limits', 'POST', { daily_on: !!ui.limDailyOn, daily: daily, monthly_on: ui.limMonthlyOn !== false, monthly: monthly }).then(function (r) {
      if (!r.ok) { $('limErr').textContent = r.data.error.message; animate($('limSave'), 'shake'); return; }
      toast(r.data.status === 'pending' ? 'Более строгие значения уже действуют. Ослабление вступит в силу после периода охлаждения.' : 'Лимиты сохранены.');
      refresh().then(fillLimits);
    });
  };
  $('crAmt').addEventListener('input', function () { var d = digits(this.value).slice(0, 9); this.value = d ? fmtN(Number(d)) : ''; });
  function amountGo() {
    var n = Number(digits($('amt').value));
    if (!n) { animate($('amt').closest('.amountbox'), 'shake'); toast('Введите сумму.'); return; }
    if (n > S.ward.balance) { animate($('amt').closest('.amountbox'), 'shake'); toast('На счёте недостаточно средств.'); return; }
    openOverlay({ type: 'confirm', rid: ui.tr.rid, amount: n, big: $('bigBuy').checked });
  }
  $('amtGo').onclick = amountGo;
  $('amt').addEventListener('keydown', function (e) { if (e.key === 'Enter') amountGo(); });
  $('creditBtn').onclick = function () {
    var n = Number(digits($('crAmt').value));
    if (!n) { toast('Введите сумму.'); return; }
    openOverlay({ type: 'credit', amount: n, product: $('crProd').value });
  };
  function crInfo() {
    var goods = $('crProd').value === 'goods';
    $('crInfo').innerHTML = goods ? '<b>Деньги получит продавец</b>Магазин «Техно Дом» (партнёр). На карту ничего не приходит, поэтому мошеннику нечего забрать: при спокойной обстановке рассрочка оформляется сразу.'
      : '<b>Деньги придут на карту</b>Мошенники часто уговаривают взять кредит и перевести его «на безопасный счёт». Поэтому при кредитном замке такой кредит ждёт подтверждения доверенных лиц.';
  }
  $('crProd').addEventListener('change', crInfo); crInfo();
  $('tamperBtn').onclick = function () { act('/api/demo/tamper'); toast('Запись журнала изменена: цепочка хэшей нарушена.'); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.overlay) closeOverlay(); });
  document.querySelectorAll('#callSeg button').forEach(function (b) { b.onclick = function () { act('/api/sim', { call: b.getAttribute('data-v') }); }; });
  $('simNight').onchange = function () { act('/api/sim', { night: this.checked }); };
  $('simDevice').onchange = function () { act('/api/sim', { new_device: this.checked }); };
  $('simRemote').onchange = function () { act('/api/sim', { remote_access: this.checked }); };
  $('simCodes').onchange = function () { act('/api/sim', { codes: this.checked }); };
  (function () {
    var inp = $('aiUrlInput'); if (!inp) return;
    inp.value = aiUrl();
    var paint = function () { $('aiUrlState').textContent = aiUrl() ? 'Чат помощника работает через ИИ. Если адрес недоступен, вопросы задаются по правилам.' : 'Адрес не задан: чат помощника работает на правилах.'; };
    paint();
    $('aiUrlSave').onclick = function () { try { localStorage.setItem('korgan-ai-url', inp.value.trim()); } catch (e) {} paint(); toast(inp.value.trim() ? 'Адрес ИИ-помощника сохранён.' : 'ИИ-помощник отключён.'); };
  })();
  $('busyG').onchange = function () { act('/api/demo/busy', { guardian: this.checked }); };
  $('busyS').onchange = function () { act('/api/demo/busy', { second: this.checked }); };

  // ---------- тема: Авто (по системе) / Светлая / Тёмная, выбор запоминается в этом браузере ----------
  function applyTheme(mode, anim) {
    var root = document.documentElement;
    if (anim && !reduced) { root.classList.add('theme-anim'); clearTimeout(applyTheme._t); applyTheme._t = setTimeout(function () { root.classList.remove('theme-anim'); }, 450); }
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
    document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-theme-set') === mode)); });
    try { localStorage.setItem('korgan-theme', mode); } catch (e) {}
  }
  var savedTheme = 'system';
  try { savedTheme = localStorage.getItem('korgan-theme') || 'system'; } catch (e) {}
  applyTheme(savedTheme, false);
  document.querySelectorAll('[data-theme-set]').forEach(function (b) { b.onclick = function () { applyTheme(b.getAttribute('data-theme-set'), true); }; });

  // ---------- часы сценария: 1 с = 1 минута ----------
  var last = Date.now();
  setInterval(function () { var n = Date.now(), dt = Math.min(3, (n - last) / 1000 / SPM); last = n; if (!ui.paused && !(ui.overlay && ui.overlay.type === 'verify' && !ui.overlay.done)) E.advance(dt); }, 250);  // пока клиент отвечает помощнику, ускоренное время стоит
  setInterval(function () { if (document.hidden) return; refresh(); saveSession(); }, 1000);
  refresh();
  $('splash').classList.add('gone');
  // Заставка при каждом запуске: BCC → Қорған. Нажатие пропускает её.
  var intro = $('intro'), hideIntro = function () { intro.classList.add('gone'); setTimeout(function () { intro.hidden = true; }, 500); };
  intro.onclick = hideIntro;
  setTimeout(hideIntro, reduced ? 700 : 2300);
  window.__korgan = { E: E, ui: ui };  // для отладки в консоли
})();
