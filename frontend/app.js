/* Қорған — демо-страница. Все решения принимает бэкенд; страница только показывает /api/state и шлёт действия. */
(function () {
  'use strict';
  var TOKEN = null, S = null;
  var ui = { tab: 'Home', hide: false, scenario: null, overlay: null, error: null, myOps: {}, polling: false };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (n) { return Number(n).toLocaleString('ru-RU') + ' ₸'; };
  var ZONE = { green: ['green', 'Проведено сразу'], yellow: ['yellow', 'Нужно подтверждение'], red: ['red', 'Пауза и два подтверждения'] };
  var CALL_TEXT = { none: 'нет', known: 'знакомый', unknown: 'незнакомый номер' };

  function setHTML(el, html) { if (el._h === html) return; el._h = html; el.innerHTML = html; }
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
  function toast(text) {
    var t = $('toast'); t.textContent = text; t.hidden = false;
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.hidden = true; }, 3500);
  }

  // ------------------------------------------------------------------ API
  function api(path, method, body, actor) {
    var headers = { 'X-Korgan-Token': TOKEN, 'Content-Type': 'application/json' };
    if (actor) headers['X-Korgan-Actor'] = actor;
    return fetch(path, { method: method || 'GET', headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { error: { code: 'NETWORK', message: 'Нет связи с сервером. Проверьте, что он запущен.' } } }; });
  }
  function act(path, body, actor) {
    return api(path, 'POST', body || {}, actor).then(function (r) {
      if (!r.ok) toast(r.data.error ? r.data.error.message : 'Ошибка ' + r.status);
      return refresh().then(function () { return r; });
    });
  }
  function refresh() {
    return api('/api/state').then(function (r) {
      if (r.ok) { S = r.data; render(); setHTML($('scenHint'), esc(S.demo.hint)); }
      else setHTML($('scenHint'), '<span style="color:var(--color-risk-high)">' + esc(r.data.error.message) + '</span>');
    });
  }
  function loop() { refresh().then(function () { setTimeout(loop, 1000); }); }

  // ------------------------------------------------------------------ render
  function render() {
    if (!S) return;
    if (ui.scenario !== S.demo.scenario) { ui.scenario = S.demo.scenario; prefill(S.demo.form); }
    renderScen(); renderWard(); renderTrusted('guardian'); renderTrusted('second');
    renderOperator(); renderBank(); renderSim();
    if (ui.overlay) renderOverlay();
  }

  function renderScen() {
    var d = S.demo, h = '';
    Object.keys(d.scenarios).forEach(function (k) {
      h += '<button class="chip" data-act="scen" data-n="' + k + '" aria-pressed="' + (String(d.scenario) === k) + '">' + k + '. ' + esc(d.scenarios[k]) + '</button>';
    });
    setHTML($('scenChips'), h);
    $('clock').textContent = 'Минута сценария: ' + Math.floor(d.now);
  }

  function renderWard() {
    var w = S.ward;
    $('wardSub').textContent = w.protection_on ? 'Семейная защита включена' : 'Семейная защита выключена';
    $('bal').textContent = ui.hide ? '•••••• ₸' : fmt(w.balance);
    $('eyeBtn').textContent = ui.hide ? 'Показать' : 'Скрыть';
    $('eyeBtn').setAttribute('aria-pressed', String(ui.hide));

    // recipients select (keep selection)
    var sel = $('rec'), cur = sel.value;
    setHTML(sel, w.recipients.map(function (r) {
      return '<option value="' + r.id + '">' + esc(r.name) + (r.whitelisted ? ' · белый список' : (r.known ? '' : ' · новый получатель')) + '</option>';
    }).join(''));
    if (cur) sel.value = cur;

    // alerts
    var h = '';
    if (ui.error) h += '<div class="note bad"><b>' + esc(errTitle(ui.error.code)) + '</b>' + esc(ui.error.message) + '</div>';
    if (w.outgoing_blocked) h += '<div class="note info"><b>Исходящие переводы и карты заблокированы</b>Это автозащита после заявления. Снять её может сотрудник банка.</div>';
    w.pending.forEach(function (p) {
      var verb = p.kind === 'credit' ? 'оформляете «' + esc(p.recipient) + '» на ' + fmt(p.amount) : 'переводите ' + fmt(p.amount) + ' получателю «' + esc(p.recipient) + '»';
      h += '<div class="note warn"><b>Подождите минуту</b>Вы ' + verb + '.' + (p.new_recipient ? ' Вы ему раньше не платили.' : '') +
        ' Вам кто-то звонил с просьбой это сделать? Мы попросили ' + esc(p.guardian_acc) + ' подтвердить. Деньги никуда не ушли.' +
        (p.operator_connected ? '<br><br>Подключён оператор банка: он свяжется с вами и проверит личность.' : '') +
        (p.can_self_confirm ? '<button class="btn sec" data-act="ward-self" data-op="' + p.id + '">Я уверен, подтвердить сам</button>' : '') +
        '<button class="btn sec" data-act="ward-cancel" data-op="' + p.id + '">Отменить операцию</button></div>';
    });
    var last = w.last;
    if (last && ui.myOps[last.id] && last.status !== 'HELD') {
      var txt = { EXECUTED: ['ok', last.kind === 'credit' ? 'Оформлено' : 'Перевод выполнен', fmt(last.amount) + ' → ' + esc(last.recipient) + (last.decided_by && last.decided_by !== 'auto' ? '. Подтвердил: ' + esc(last.decided_by) + '.' : '')],
        REJECTED: ['bad', 'Операция остановлена', 'Деньги на счёте. Если это ошибка, позвоните в банк.'],
        EXPIRED: ['info', 'Срок ожидания истёк', 'Операция не проведена, деньги на счёте. Можно повторить.'] }[last.status];
      if (txt) h += '<div class="note ' + txt[0] + '"><b>' + txt[1] + '</b>' + txt[2] + '</div>';
    }
    setHTML($('wardAlerts'), h);

    // incidents for client
    var ih = '';
    w.incidents.forEach(function (i) {
      ih += '<div class="note ' + (i.status === 'DISPUTE_CIVIL' ? 'info' : 'warn') + '"><b>Заявление № ' + i.id + ': ' + esc(i.status_text) + '</b>' +
        '<div class="events" style="max-height:none;margin-top:6px">' + i.feed.slice(-5).map(function (f) { return '<span>• ' + esc(f.text) + '</span>'; }).join('') + '</div>' +
        (i.outcome ? '<p style="margin:8px 0 0"><b style="display:inline">Итог:</b> ' + esc(i.outcome) + '</p>' : '') +
        (i.status !== 'DISPUTE_CIVIL' ? '<p style="margin:8px 0 0"><b style="display:inline">Не платите никому за «возврат денег».</b> Банк и полиция не берут за это плату.</p>' : '') +
        (i.statement ? '<details style="margin-top:8px"><summary>Текст заявления в полицию</summary><div class="statement" id="stmt' + i.id + '">' + esc(i.statement) + '</div><button class="btn small sec" data-act="copy" data-id="' + i.id + '">Скопировать</button></details>' : '') +
        '</div>';
    });
    setHTML($('wardIncidents'), ih);

    setHTML($('txs'), w.history.map(function (t) {
      var inc = t.amount > 0;
      return '<div class="tx"><div><div class="n">' + esc(t.title) + '</div><div class="d">' + ago(S.demo.now - t.minute) + '</div></div><div class="a' + (inc ? ' in' : '') + '">' + (inc ? '+' : '−') + fmt(Math.abs(t.amount)) + '</div></div>';
    }).join(''));

    // protect tab
    $('protSub').textContent = w.protection_on ? 'Опасные операции ждут подтверждения' : 'Выключена';
    $('protBtn').textContent = w.protection_on ? 'Выключить' : 'Включить';
    $('lockBtn').textContent = w.credit_lock ? 'Снять' : 'Включить';
    setHTML($('disableReqs'), w.disable_requests.map(function (r) {
      return '<div class="note warn"><b>Запрос на отключение: ' + (r.target === 'protection' ? 'семейная защита' : 'кредитный замок') + '</b>Вступит в силу через ' + Math.ceil(r.left) + ' мин сценария (период охлаждения). Доверенные уведомлены.<button class="btn sec" data-act="dis-cancel" data-id="' + r.id + '">Отменить запрос</button></div>';
    }).join(''));
    setHTML($('trustList'), '<div class="listrow"><span>' + esc(w.guardians.guardian) + '</span><span>опекун</span></div><div class="listrow"><span>' + esc(w.guardians.second) + '</span><span>второй доверенный</span></div>');
    var wl = w.recipients.filter(function (r) { return r.whitelisted; });
    setHTML($('whiteList'), wl.length ? wl.map(function (r) { return '<div class="listrow"><span>' + esc(r.name) + '</span><span>без подтверждения</span></div>'; }).join('') : '<div class="empty">Пусто</div>');
    setHTML($('consentBox'), w.consent.given
      ? 'Доверенные видят: ' + esc(w.consent.fields.join(', ')) + '. Не видят баланс, историю и коды. Срок ' + w.consent.valid_months + ' мес., согласие можно отозвать.'
      : 'Согласие не дано: доверенные не подключены.');
  }

  function errTitle(code) {
    return { CALL_ACTIVE: 'Операция заблокирована на время звонка', REMOTE_ACCESS: 'Обнаружен удалённый доступ', CREDIT_LOCK: 'Кредитный замок',
      OUTGOING_BLOCKED: 'Переводы заблокированы', NEW_DEVICE: 'Новое устройство', INSUFFICIENT_FUNDS: 'Недостаточно средств' }[code] || 'Операция не выполнена';
  }

  function renderTrusted(role) {
    var g = S[role], el = role === 'guardian' ? $('gReqs') : $('sReqs');
    if (role === 'guardian') { $('gTitle').textContent = 'Приложение опекуна (' + g.name + ')'; $('busyG').checked = g.busy; }
    else { $('sTitle').textContent = 'Второй доверенный (' + g.name + ')'; $('busyS').checked = g.busy; }
    var reqs = g.requests.slice().reverse();
    var active = reqs.filter(function (r) { return r.status === 'HELD'; });
    var show = active.length ? active : reqs.slice(0, 1);
    var h = show.length ? '' : '<div class="empty">Запросов нет.</div>';
    show.forEach(function (r) {
      h += '<div class="req"><div><div class="muted" style="font-size:.85em">' + esc(g.ward_name) + (r.kind === 'credit' ? ' оформляет' : ' переводит') + '</div><div class="sum">' + fmt(r.amount) + '</div><div>→ ' + esc(r.recipient) + '</div></div>' +
        '<div>' + pill(r.zone, r.score) + '</div><ul>' + r.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if (r.status !== 'HELD') {
        h += '<div class="note info">' + { EXECUTED: 'Операция проведена.', REJECTED: 'Операция остановлена.', EXPIRED: 'Срок истёк, операция не проведена.' }[r.status] + '</div>';
      } else if (r.approved_by_me) {
        h += '<div class="note ok">Вы разрешили. Красная зона: нужно второе подтверждение.</div>';
      } else if (g.busy) {
        h += '<div class="note warn pulse">Уведомление пришло, но вы заняты и не отвечаете.</div>';
      } else if (r.can_act) {
        if (r.other_approved) h += '<div class="note info">Первый доверенный уже разрешил. Нужно ваше подтверждение.</div>';
        h += '<div class="btnrow"><button class="btn ok" data-act="decide" data-actor="' + role + '" data-op="' + r.id + '" data-d="approve">Разрешить</button>' +
          '<button class="btn danger" data-act="decide" data-actor="' + role + '" data-op="' + r.id + '" data-d="reject">Отклонить</button></div>' +
          '<button class="btn sec" data-act="callg">Позвонить ' + esc(g.ward_name) + '</button>';
      }
      h += '</div>';
    });
    setHTML(el, h);
    if (role === 'guardian') {
      setHTML($('gNotes'), g.notifications.length ? '<div class="sect">Уведомления</div>' + g.notifications.slice(-3).reverse().map(function (n) { return '<div class="note info">' + esc(n.text) + '</div>'; }).join('') : '');
    }
  }

  function reasonsHTML(reasons) {
    if (!reasons || !reasons.length) return '<div class="muted">Сигналов риска нет</div>';
    return '<div class="rs">' + reasons.map(function (r) {
      var w = Math.min(100, Math.abs(r.points) * 2.5);
      return '<div>' + esc(r.text) + '</div><div class="pts">' + (r.points > 0 ? '+' : '') + r.points + '</div><div class="bar"><i class="' + (r.points < 0 ? 'neg' : '') + '" style="width:' + w + '%"></i></div>';
    }).join('') + '</div>';
  }

  function renderOperator() {
    var o = S.operator, h = '';
    o.queue.forEach(function (q) {
      h += '<div class="card"><div class="head"><b>' + (q.kind === 'credit' ? 'Кредит' : 'Перевод') + ' № ' + q.id + ' · ' + fmt(q.amount) + '</b>' + pill(q.zone, q.score) + '</div>' +
        '<div class="muted" style="font-size:13px">→ ' + esc(q.recipient) + ' · сигналы устройства (эмуляция): звонок ' + CALL_TEXT[q.device.call || 'none'] + (q.device.night ? ', ночь' : '') + (q.device.new_device ? ', новое устройство' : '') + '</div>' +
        reasonsHTML(q.reasons) +
        '<div class="events">' + q.events.map(function (e) { return '<span>+' + Math.floor(e.minute) + ' мин · ' + esc(e.text) + '</span>'; }).join('') + '</div>';
      if (q.my_turn) {
        h += '<div class="btnrow"><button class="btn ok" data-act="decide" data-actor="operator" data-op="' + q.id + '" data-d="approve">Личность подтверждена, разрешить</button><button class="btn danger" data-act="decide" data-actor="operator" data-op="' + q.id + '" data-d="reject">Отклонить</button></div>';
      } else if (q.status === 'HELD') {
        h += '<div class="muted" style="font-size:13px">Оператор подключится через ' + Math.max(0, Math.ceil(q.operator_due)) + ' мин, если близкие не решат. Предельный срок удержания: ' + Math.ceil(q.deadline_left) + ' мин.</div>';
      } else {
        h += '<div class="muted" style="font-size:13px">Статус: ' + { EXECUTED: 'проведена', REJECTED: 'остановлена', EXPIRED: 'срок истёк' }[q.status] + '</div>';
      }
      h += '</div>';
    });
    setHTML($('opQueue'), h || '<div class="empty">Операций на паузе нет.</div>');

    setHTML($('clientBlock'), o.client.outgoing_blocked ? '<button class="btn small sec" data-act="unblock">Снять автоблокировку клиента</button>' : '');
    var ih = '';
    o.incidents.forEach(function (i) {
      var c = i.card, pr = { high: 'red', medium: 'yellow', low: 'gray' }[i.priority];
      var loc = { in_bcc: 'на счёте в BCC', other_bank: 'в другом банке', cashed: 'сняты наличными' }[c.recipient.money_location] || '—';
      ih += '<div class="card"><div class="head"><b>Заявление № ' + i.id + '</b><span class="pill ' + pr + '">Приоритет: ' + { high: 'высокий', medium: 'средний', low: 'низкий' }[i.priority] + '</span></div>' +
        '<div><span class="pill gray">' + esc(i.status) + '</span> <span class="muted" style="font-size:13px">' + esc(i.status_text) + '</span></div>' +
        '<dl class="kv"><dt>Что произошло</dt><dd>' + esc(c.what) + (c.got_goods ? ', товар получен' : '') + '</dd>' +
        '<dt>Перевод</dt><dd>' + fmt(c.transfer.amount) + ' → ' + esc(c.transfer.recipient) + ' (' + esc(c.transfer.bank) + '), ' + ago(c.transfer.minutes_ago) + '</dd>' +
        '<dt>Оценка риска</dt><dd>' + (c.score == null ? 'не оценивалась (защита не была подключена)' : c.score) + '</dd>' +
        '<dt>Получатель</dt><dd>история ' + (c.recipient.history_months < 1 ? 'менее 1 мес.' : c.recipient.history_months + ' мес.') + ', жалоб ' + c.recipient.complaints + (c.recipient.flagged ? ', в базе подозрительных' : '') + '</dd>' +
        '<dt>Где деньги</dt><dd>' + loc + '</dd>' +
        (i.hold_left != null ? '<dt>Удержание</dt><dd>ещё ' + Math.ceil(i.hold_left) + ' мин' + (i.police_report_no ? ', заявление в полицию № ' + esc(i.police_report_no) : '') + '</dd>' : '') +
        '</dl>' + chainSVG(c) +
        '<div class="events">' + i.feed.slice(-4).map(function (f) { return '<span>+' + Math.floor(f.minute) + ' мин · ' + esc(f.text) + '</span>'; }).join('') + '</div>' +
        incidentActions(i) + '</div>';
    });
    setHTML($('opIncidents'), ih || '<div class="empty">Заявлений нет.</div>');
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
    var hops = c.chain || [];
    if (!hops.length) return '';
    var rowH = 46, H = 40 + (hops.length + 1) * rowH, s = '';
    var box = function (x, y, w, text, sub, dashed) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="34" rx="8" fill="var(--color-surface)" stroke="var(--color-border)"' + (dashed ? ' stroke-dasharray="4 3"' : '') + '/>' +
        '<text x="' + (x + 10) + '" y="' + (y + 15) + '" font-size="11" fill="var(--color-text)">' + esc(text) + '</text>' +
        '<text x="' + (x + 10) + '" y="' + (y + 28) + '" font-size="10" fill="var(--color-text-muted)">' + esc(sub) + '</text>';
    };
    s += box(4, 4, 300, c.transfer.recipient, fmt(c.transfer.amount) + ' от клиента', false);
    hops.forEach(function (hp, k) {
      var y = 4 + (k + 1) * rowH;
      s += '<path d="M24 ' + (y - 12) + ' V ' + (y + 17) + ' H 40" fill="none" stroke="var(--color-text-muted)"/>';
      s += box(40, y, 264, hp.to, fmt(hp.amount) + (hp.kind === 'cash' ? ' · точка для полиции' : (hp.visible ? ' · видно в BCC' : ' · запрошено (эмуляция)')), !hp.visible);
    });
    return '<div class="chain" aria-label="Цепочка переводов"><svg viewBox="0 0 310 ' + (H - 30) + '" role="img">' + s + '</svg></div>';
  }

  function renderBank() {
    var b = S.bank, st = b.stats;
    var items = [[st.transfers, 'Переводов'], [st.executed, 'Проведено'], [st.stopped, 'Остановлено'], [Number(st.saved_amount).toLocaleString('ru-RU'), 'Сохранено, ₸'],
      [st.call_blocks, 'Блокировок на звонке'], [st.credit_lock_blocks, 'Сработок кредитного замка'],
      [st.false_delay_share == null ? '—' : Math.round(st.false_delay_share * 100) + '%', 'Доля ложных задержек'],
      [st.time_to_freeze_minutes == null ? '—' : st.time_to_freeze_minutes + ' мин', 'Время до заморозки']];
    setHTML($('stats'), items.map(function (x) { return '<div class="stat"><div class="v">' + x[0] + '</div><div class="k">' + x[1] + '</div></div>'; }).join(''));
    var r = b.recent[0];
    setHTML($('lastScore'), r ? '<div class="head" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"><b>' + fmt(r.amount) + ' → ' + esc(r.recipient) + '</b>' + pill(r.zone, r.score) + '</div>' + reasonsHTML(r.reasons) +
      '<div class="muted" style="font-size:12px;margin-top:6px">Зоны: до 30 — сразу; 30–69 — одно подтверждение; от 70 — два подтверждения или оператор.</div>' : '<div class="empty">Операций пока нет.</div>');
    setHTML($('auditOk'), b.audit_verify.ok ? '<span class="pill green">Цепочка хэшей цела · ' + b.audit_verify.records + '</span>' : '<span class="pill red">Нарушена на записи ' + b.audit_verify.broken_at + '</span>');
    setHTML($('audit'), b.audit.map(function (a) { return '<div><span class="num">+' + Math.floor(a.minute) + ' мин</span><span>' + esc(a.actor) + '</span><span>' + esc(a.action) + ' <code>' + a.hash.slice(0, 8) + '</code></span></div>'; }).join(''));
  }

  function renderSim() {
    var sim = S.demo.sim;
    document.querySelectorAll('#callSeg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === sim.call)); });
    $('simNight').checked = sim.night; $('simDevice').checked = sim.new_device; $('simRemote').checked = sim.remote_access;
  }

  // ------------------------------------------------------------------ overlays (inside ward phone)
  function openOverlay(o) { ui.overlay = o; $('overlay').hidden = false; renderOverlay(); var f = $('overlay').querySelector('button'); if (f) f.focus(); }
  function closeOverlay() { ui.overlay = null; $('overlay').hidden = true; $('overlay')._h = null; }

  function head(step, total, backLabel) {
    return '<div class="wizhead"><button data-act="ov-back">← ' + (backLabel || 'Назад') + '</button><div class="wizbar"><i style="width:' + Math.round(step / total * 100) + '%"></i></div><span>Шаг ' + step + ' из ' + total + '</span></div>';
  }
  function opt(act, val, title, sub, pressed) {
    return '<button class="opt" data-act="' + act + '" data-v="' + esc(val) + '" aria-pressed="' + !!pressed + '"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>';
  }

  function renderOverlay() {
    var o = ui.overlay, h = '';
    if (o.type === 'self') {
      h = '<div class="wizhead"><button data-act="ov-close">← Назад</button></div><div class="wiztitle">Вам кто-то звонил или просил сделать эту операцию?</div>' +
        '<p class="muted" style="margin:0">Если звонили «из банка», «из полиции» или просили «перевести на безопасный счёт», это мошенники.</p>' +
        '<div class="opts">' + opt('self-ans', 'yes', 'Да, звонили или просили', 'Операция останется на паузе, решит банк') + opt('self-ans', 'no', 'Нет, я решил сам', 'Операция будет проведена') + '</div>';
    } else if (o.type === 'wizard') {
      var w = S.ward;
      if (o.step === 1) {
        h = head(1, 4, 'Отмена') + '<div class="wiztitle">Кто подтверждает операции первым?</div><p class="muted" style="margin:0">Второй получит запрос, если первый не ответит за 5 минут.</p><div class="opts">' +
          opt('wiz-first', 'alibek', 'Алибек, внук', 'Обычно отвечает в течение дня', o.first === 'alibek') + opt('wiz-first', 'aigul', 'Айгуль, тётя', 'Запасной вариант по вечерам', o.first === 'aigul') + '</div>';
      } else if (o.step === 2) {
        h = head(2, 4) + '<div class="wiztitle">Кому переводить без подтверждения?</div><p class="muted" style="margin:0">Белый список. Его можно изменить в любой момент.</p><div class="opts">' +
          w.recipients.filter(function (r) { return r.id !== 'stranger'; }).map(function (r) { return opt('wiz-white', r.id, (o.white.indexOf(r.id) >= 0 ? '✓ ' : '') + r.name, '', o.white.indexOf(r.id) >= 0); }).join('') + '</div>';
      } else if (o.step === 3) {
        h = head(3, 4) + '<div class="wiztitle">Что увидят доверенные</div><div class="note info"><b>Видят</b>Сумму, получателя и причины, по которым операция на паузе.</div>' +
          '<div class="note info"><b>Не видят</b>Баланс, историю операций, коды из SMS.</div><div class="note info"><b>Срок и отзыв</b>Согласие на 12 месяцев. Отозвать можно в любой момент; отключение вступает в силу через период охлаждения.</div>';
      } else {
        h = head(4, 4) + '<div class="wiztitle">Проверьте и включите защиту</div><dl class="kv"><dt>Первый</dt><dd>' + (o.first === 'alibek' ? 'Алибек, внук' : 'Айгуль, тётя') + '</dd><dt>Белый список</dt><dd>' + (o.white.length ? esc(o.white.map(function (id) { var r = w.recipients.filter(function (x) { return x.id === id; })[0]; return r ? r.name : id; }).join(', ')) : 'пусто') + '</dd></dl>' +
          opt('wiz-consent', '1', (o.consent ? '✓ ' : '') + 'Я согласен', 'Доверенные видят только операцию на подтверждении', o.consent) +
          '<button class="btn" data-act="wiz-finish"' + (o.consent ? '' : ' disabled') + '>Включить защиту</button>';
      }
      if (o.step < 4) h += '<button class="btn" data-act="ov-next">Продолжить</button>';
    } else if (o.type === 'report') {
      var callNow = S.demo.sim.call.indexOf('active') === 0;
      if (o.step === 0) {
        h = '<div class="wizhead"><button data-act="ov-close">← Отмена</button></div><div class="wiztitle">Сначала положите трубку</div><div class="note bad">Если с вами сейчас говорят «из банка» или «из полиции», завершите разговор. Сотрудник банка не просит переводить деньги.</div>' +
          '<button class="btn" data-act="ov-next">Я положил трубку, продолжить</button>';
      } else if (o.step === 1) {
        h = head(1, 3, 'Отмена') + '<div class="wiztitle">Что произошло?</div><div class="opts">' +
          [['bank_call', 'Звонили «из банка»'], ['police_call', 'Звонили «из полиции» или госоргана'], ['investment', 'Предложили инвестиции или заработок'], ['purchase', 'Покупал товар или услугу'], ['other', 'Другое']]
            .map(function (x) { return opt('rep-what', x[0], x[1], '', o.what === x[0]); }).join('') + '</div>';
      } else if (o.step === 2) {
        h = head(2, 3) + '<div class="wiztitle">Какой перевод?</div><div class="opts">' +
          (S.ward.reportable.length ? S.ward.reportable.map(function (r) { return opt('rep-op', r.id, fmt(r.amount) + ' → ' + r.recipient, ago(r.minutes_ago), o.op === r.id); }).join('') : '<div class="empty">Проведённых переводов нет.</div>') + '</div>';
      } else if (o.step === 3) {
        h = head(3, 3) + '<div class="wiztitle">Вы получили товар или услугу?</div><div class="opts">' +
          opt('rep-goods', 'yes', 'Да, получил', 'Например, товар оказался не таким', o.goods === true) + opt('rep-goods', 'no', 'Нет / ничего не покупал', '', o.goods === false) + '</div>' +
          '<button class="btn" data-act="rep-submit"' + (o.goods == null ? ' disabled' : '') + '>Отправить заявление</button>';
      } else {
        h = '<div class="wiztitle">Заявление отправлено</div><div class="note ' + (o.result === 'DISPUTE_CIVIL' ? 'info' : 'ok') + '"><b>' + (o.result === 'DISPUTE_CIVIL' ? 'Гражданский спор' : 'Мы уже действуем') + '</b>' +
          (o.result === 'DISPUTE_CIVIL' ? 'Банк не может вернуть деньги по желанию одной стороны. Подробности и что делать — на главной.' : 'Исходящие переводы и карты заблокированы, сессии на других устройствах сброшены, кредитный замок включён. Заявление у оператора.') + '</div>' +
          '<button class="btn" data-act="ov-close">На главную</button>';
      }
      if (o.step >= 1 && o.step <= 2) h += '<button class="btn" data-act="ov-next"' + ((o.step === 1 && !o.what) || (o.step === 2 && !o.op) ? ' disabled' : '') + '>Продолжить</button>';
      if (callNow && o.step > 0 && o.step < 4) h = '<div class="note bad">Идёт звонок. Положите трубку.</div>' + h;
    }
    setHTML($('overlay'), h);
  }

  // ------------------------------------------------------------------ tabs and form
  function setTab(t) {
    ui.tab = t;
    ['Home', 'Transfer', 'Credit', 'Protect'].forEach(function (n) { $('tab' + n).hidden = n !== t; });
    document.querySelectorAll('.appnav button').forEach(function (b) {
      if (b.getAttribute('data-tab') === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function prefill(f) {
    ui.error = null; ui.myOps = {}; closeOverlay();
    if (!f) return;
    if (f.kind === 'credit') { $('crAmt').value = f.amount; setTab('Credit'); return; }
    if (S && S.ward) renderWard();
    $('rec').value = f.recipient_id; $('amt').value = f.amount; $('bigBuy').checked = !!f.big_purchase;
    setTab(S && S.demo.scenario >= 6 ? 'Home' : 'Transfer');
  }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act],[data-tab]');
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-tab')) { setTab(t.getAttribute('data-tab')); return; }
    var a = t.getAttribute('data-act'), op = Number(t.getAttribute('data-op')), o = ui.overlay;
    switch (a) {
      case 'scen': ui.scenario = null; act('/api/scenario/' + t.getAttribute('data-n')); break;
      case 'decide': act('/api/ops/' + op + '/decision', { decision: t.getAttribute('data-d') }, t.getAttribute('data-actor')); break;
      case 'callg': toast('Звонок подопечному (эмуляция).'); break;
      case 'ward-cancel': act('/api/ward/ops/' + op + '/self-confirm', { decision: 'reject' }); break;
      case 'ward-self': openOverlay({ type: 'self', op: op }); break;
      case 'self-ans': act('/api/ward/ops/' + o.op + '/self-confirm', { decision: 'approve', called: t.getAttribute('data-v') === 'yes' }); closeOverlay(); break;
      case 'dis-cancel': act('/api/ward/disable-requests/' + t.getAttribute('data-id') + '/cancel'); break;
      case 'copy':
        var txt = $('stmt' + t.getAttribute('data-id')).textContent;
        if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Текст скопирован.'); }, function () { toast('Выделите текст и скопируйте вручную.'); });
        break;
      case 'inc':
        var id = t.getAttribute('data-id'), ac = t.getAttribute('data-a'), body = {};
        if (ac === 'extend') body.police_report_no = ($('police' + id) || {}).value || null;
        act('/api/operator/incidents/' + id + '/' + ac, body); break;
      case 'unblock': act('/api/operator/client/unblock'); break;
      case 'ov-close': closeOverlay(); break;
      case 'ov-back': if ((o.type === 'wizard' && o.step === 1) || (o.type === 'report' && o.step <= 1)) closeOverlay(); else { o.step--; renderOverlay(); } break;
      case 'ov-next': o.step++; renderOverlay(); break;
      case 'wiz-first': o.first = t.getAttribute('data-v'); renderOverlay(); break;
      case 'wiz-white': var v = t.getAttribute('data-v'), k = o.white.indexOf(v); if (k >= 0) o.white.splice(k, 1); else o.white.push(v); renderOverlay(); break;
      case 'wiz-consent': o.consent = !o.consent; renderOverlay(); break;
      case 'wiz-finish': act('/api/ward/setup', { first: o.first, whitelist: o.white, consent: true }).then(function (r) { if (r.ok) { closeOverlay(); toast('Семейная защита включена.'); } }); break;
      case 'rep-what': o.what = t.getAttribute('data-v'); renderOverlay(); break;
      case 'rep-op': o.op = Number(t.getAttribute('data-v')); renderOverlay(); break;
      case 'rep-goods': o.goods = t.getAttribute('data-v') === 'yes'; renderOverlay(); break;
      case 'rep-submit': act('/api/ward/report', { op_id: o.op, what: o.what, got_goods: o.goods }).then(function (r) { if (r.ok) { o.step = 4; o.result = r.data.status; renderOverlay(); } }); break;
    }
  });

  function wardAction(path, body) {
    ui.error = null;
    return api(path, 'POST', body).then(function (r) {
      if (r.ok) { if (r.data.id) ui.myOps[r.data.id] = true; setTab('Home'); }
      else ui.error = r.data.error;
      return refresh();
    });
  }
  $('sendBtn').onclick = function () { wardAction('/api/ward/transfer', { recipient_id: $('rec').value, amount: parseInt($('amt').value, 10) || 0, big_purchase: $('bigBuy').checked }); };
  $('creditBtn').onclick = function () { wardAction('/api/ward/credit', { amount: parseInt($('crAmt').value, 10) || 0, product: $('crProd').value }); };
  $('protBtn').onclick = function () { ui.error = null; api('/api/ward/protection', 'POST', { on: !S.ward.protection_on }).then(function (r) { if (!r.ok) ui.error = r.data.error; refresh(); }); };
  $('lockBtn').onclick = function () { ui.error = null; api('/api/ward/credit-lock', 'POST', { on: !S.ward.credit_lock }).then(function (r) { if (!r.ok) ui.error = r.data.error; refresh(); }); };
  $('wizBtn').onclick = function () { var g = S.ward.guardian_keys; openOverlay({ type: 'wizard', step: 1, first: g.guardian, white: S.ward.whitelist.slice(), consent: false }); };
  $('sosBtn1').onclick = $('sosBtn2').onclick = function () {
    var callNow = S.demo.sim.call.indexOf('active') === 0;
    var first = S.ward.reportable[0];
    openOverlay({ type: 'report', step: callNow ? 0 : 1, what: null, op: first ? first.id : null, goods: null });
  };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ui.overlay) closeOverlay(); });
  $('eyeBtn').onclick = function () { ui.hide = !ui.hide; renderWard(); };
  $('fontBtn').onclick = function () { var on = !$('wardPhone').classList.contains('large'); $('wardPhone').classList.toggle('large', on); this.setAttribute('aria-pressed', String(on)); };
  $('themeBtn').onclick = function () {
    var r = document.documentElement, cur = r.getAttribute('data-theme');
    if (!cur) cur = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    r.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  };
  document.querySelectorAll('#callSeg button').forEach(function (b) { b.onclick = function () { act('/api/sim', { call: b.getAttribute('data-v') }); }; });
  $('simNight').onchange = function () { act('/api/sim', { night: this.checked }); };
  $('simDevice').onchange = function () { act('/api/sim', { new_device: this.checked }); };
  $('simRemote').onchange = function () { act('/api/sim', { remote_access: this.checked }); };
  $('busyG').onchange = function () { act('/api/demo/busy', { guardian: this.checked }); };
  $('busyS').onchange = function () { act('/api/demo/busy', { second: this.checked }); };

  api('/api/demo/config').then(function (r) {
    if (!r.ok) { setHTML($('scenHint'), esc(r.data.error ? r.data.error.message : 'Сервер недоступен')); return; }
    TOKEN = r.data.token; loop();
  });
})();
