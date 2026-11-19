/* Движок «Қорған» на JavaScript: тот же набор правил, что в backend/*.py, но работает прямо в браузере.
   Числа берутся из CFG (зеркало config.yaml). Время сценария: 1 секунда = 1 минута. */
(function (root) {
  'use strict';
  var CFG = {
    scoring: { typical: 40000, large: 100000, huge: 5, yellow: 30, red: 70,
      pts: { new_recipient: 25, flagged_recipient: 30, huge_amount: 25, large_amount: 10, call_unknown: 35, call_known: 5, night: 15, new_device: 10, whitelist: -30, big_purchase: -20, cash_loan: 30, goods_installment: -15, after_credit: 25, recent_codes: 20 } },
    window: 10, cooldown: 3, maxHold: 60, holdInit: 20, antifraud: 3, civilMonths: 12, civilComplaints: 1,
    second: 5, operatorAfter: 15, opAfterFirst: 5, maxAttempts: 5, abuseRejects: 3, week: 10080, afterCredit: 60, limitDaily: 500000, limitMonthly: 1500000, limitHold: 10080, assistantAfter: 15, assistantMax: 500000, assistantWindow: 30, day: 1440, month: 43200
  };

  // ---- SHA-256 (синхронный, для цепочки хэшей журнала) ----
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mp = Math.pow, mw = mp(2, 32), i, j, result = '', words = [], abl = ascii.length * 8;
    var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], pc = k.length, ic = {};
    for (var c = 2; pc < 64; c++) {
      if (!ic[c]) { for (i = 0; i < 313; i += c) ic[i] = c; hash[pc] = (mp(c, 0.5) * mw) | 0; k[pc++] = (mp(c, 1 / 3) * mw) | 0; }
    }
    ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((abl / mw) | 0); words[words.length] = abl;
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), old = hash; hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash); hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }
  function utf8(s) { return unescape(encodeURIComponent(s)); }
  function sortKeys(o) { if (Array.isArray(o)) return o.map(sortKeys); if (o && typeof o === 'object') { var r = {}; Object.keys(o).sort().forEach(function (k) { r[k] = sortKeys(o[k]); }); return r; } return o; }

  function Blocked(code, message, status) { var e = new Error(message); e.blocked = true; e.code = code; e.status = status || 409; return e; }
  var MESSAGES = {
    CALL_ACTIVE: 'Во время разговора по телефону переводы и кредиты недоступны. Если вас просят перевести деньги, это мошенники. Положите трубку.',
    REMOTE_ACCESS: 'На телефоне включён удалённый доступ. Денежные операции и снятие защиты недоступны. Отключите программу удалённого доступа: настоящий сотрудник банка никогда её не просит.',
    CREDIT_LOCK: 'Кредитный замок в режиме «Полный запрет»: кредиты и рассрочки сейчас не оформляются. Перейти на умный режим можно в разделе «Защита», он включится через период охлаждения.',
    OUTGOING_BLOCKED: 'Исходящие переводы временно заблокированы после заявления о спорной операции. Разблокировать их может сотрудник банка.',
    NEW_DEVICE: 'Снять защиту с нового устройства нельзя в первые сутки.'
  };
  var ACTOR = { guardian: 'доверенное лицо', second: 'второе доверенное лицо', ward: 'клиент', operator: 'оператор банка', assistant: 'помощник банка' };
  var STATUS_TEXT = {
    NEW: 'Заявление принято', TRIAGED: 'Карточка собрана, заявление в очереди оператора',
    FREEZE_REQUESTED: 'Запрос на удержание отправлен в банк получателя через Антифрод-центр (эмуляция)',
    HELD: 'Средства удержаны на счёте получателя', RETURNED: 'Средства возвращены на ваш счёт',
    RELEASED: 'Удержание снято решением банка', EXPIRED: 'Срок удержания истёк без продления, удержание снято',
    DISPUTE_CIVIL: 'Гражданский спор: удержание не применяется', CLOSED: 'Заявление закрыто'
  };
  var WHAT = { bank_call: 'Звонок «из банка»', police_call: 'Звонок «из полиции» или госоргана', investment: 'Предложение инвестиций или заработка', purchase: 'Покупка товара или услуги', other: 'Другое' };
  var OUTCOME = { returned: 'средства удержаны и возвращены', released: 'удержание снято, вернуть не удалось', not_returned: 'вернуть не удалось', civil: 'гражданский спор, удержание не применялось' };

  var BASE_RECIPIENTS = {
    utility: { name: 'Алматы Су (коммуналка)', bank: 'BCC', known: true, flagged: false, history_months: 240, complaints: 0 },
    grandson: { name: 'Алибек, внук', bank: 'BCC', known: true, flagged: false, history_months: 60, complaints: 0 },
    shop: { name: 'Мебель Плюс', bank: 'Другой банк', known: false, flagged: false, history_months: 36, complaints: 0 },
    repair: { name: 'ИП «Ремонт под ключ»', bank: 'Другой банк', known: false, flagged: false, history_months: 24, complaints: 0 },
    stranger: { name: 'Иванов С. Н. ••4821', bank: 'Другой банк', known: false, flagged: true, history_months: 1, complaints: 4, senders_7d: 9 },
    receiver_bcc: { name: 'Сейткали Д. ••7710', bank: 'BCC', known: false, flagged: false, history_months: 0.5, complaints: 2, money_location: 'in_bcc',
      chain: [{ to: 'Счёт ••2291 в BCC', amount: 300000, kind: 'transfer', visible: true }, { to: 'Счёт в другом банке', amount: 120000, kind: 'transfer', visible: false }, { to: 'Снятие наличных, банкомат, Алматы', amount: 60000, kind: 'cash', visible: true }] },
    samat: { name: 'Самат Б.', bank: 'Другой банк', known: false, flagged: false, history_months: 40, complaints: 0 },
    marat: { name: 'Марат Т.', bank: 'Другой банк', known: false, flagged: false, history_months: 36, complaints: 0 },
    magnum: { name: 'Магнум (продукты)', bank: 'Другой банк', known: true, flagged: false, history_months: 120, complaints: 0 },
    pharmacy: { name: 'Аптека «Биосфера»', bank: 'Другой банк', known: true, flagged: false, history_months: 96, complaints: 0 },
    mobile: { name: 'Beeline (связь)', bank: 'Другой банк', known: true, flagged: false, history_months: 120, complaints: 0 },
    seller: { name: 'Ержан К., частный продавец', bank: 'BCC', known: false, flagged: false, history_months: 48, complaints: 0 }
  };
  // Номера карт из «базы подозрительных счетов» (демо). Полный номер нигде не хранится: только последние 4 цифры.
  var FLAGGED_CARDS = { '5269880077314821': true };
  function luhnOk(pan) {
    var sum = 0;
    for (var i = 0; i < pan.length; i++) {
      var d = +pan[pan.length - 1 - i];
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
    }
    return sum % 10 === 0;
  }
  // Доверенный видит минимум: сумму, имя получателя без номера счёта и причину паузы, которая касается самого клиента.
  var CONSENT_FIELDS = ['сумма', 'имя получателя без номера счёта', 'причина паузы'];
  var PEOPLE = { alibek: { name: 'Алибек', relation: 'внук', acc: 'Алибека', dat: 'Алибеку' }, aigul: { name: 'Айгуль', relation: 'тётя', acc: 'Айгуль', dat: 'Айгуль' } };
  var SCENARIOS = {
    8: { title: 'Лимит → пауза', hint: 'Дневной лимит 100 000 ₸, сегодня уже переведено 40 000 ₸. Переведите 70 000 ₸ Марату: перевод встанет на паузу. Дальше: «Запросить подтверждение» (доверенное лицо подтверждает или отклоняет в своём приложении), «Меня просят перевести деньги» или «Отменить перевод». Перевод 60 000 ₸ пройдёт как обычно. Сценарий «Меня обманули»: История → перевод Самату на 40 000 ₸ → чек.', form: { kind: 'transfer', recipient_id: 'marat', amount: 70000, big_purchase: false } },
    1: { title: 'Коммуналка без паузы', hint: 'Переводы → «Продолжить» → «Перевести»: балл 0, перевод проходит сразу.', form: { kind: 'transfer', recipient_id: 'utility', amount: 3500, big_purchase: false } },
    2: { title: 'Звонок + перевод', hint: 'Шаг 1: переведите во время звонка — сработает блокировка. Шаг 2: в имитации выберите «Звонка нет» (дед положил трубку) и переведите снова — красная зона, доверенное лицо отклоняет. Тот же эффект даёт перевод на тестовую «карту мошенника».', form: { kind: 'transfer', recipient_id: 'stranger', amount: 480000, big_purchase: false } },
    3: { title: 'Реальная покупка, доверенные лица заняты', hint: 'Переведите: операция ждёт подтверждения. Доверенные лица не отвечают. На 15-й минуте помощник банка задаёт 4 вопроса. Обычная покупка с чистыми ответами подтверждается сразу; сотрудника банка клиент зовёт сам, если захочет.', form: { kind: 'transfer', recipient_id: 'shop', amount: 480000, big_purchase: true } },
    4: { title: 'Доверенное лицо отклоняет без причины', hint: 'Переведите мастеру за ремонт. Доверенное лицо отклоняет перевод. На главной у деда появится «Не согласен с решением»: операцию решит сотрудник банка после звонка. В разделе «Защита» видно каждое действие доверенного лица, там же можно пожаловаться и удалить его через банк сразу.', form: { kind: 'transfer', recipient_id: 'repair', amount: 120000, big_purchase: false } },
    5: { title: 'Кредит наличными', hint: 'Замок в умном режиме. Шаг 1: оформите «Рассрочку на товар» в магазине — деньги уходят продавцу, признаков опасности нет, проходит сразу. Шаг 2: в имитации выберите «Завершён: незнакомый» (мошенник только что звонил) и оформите «Кредит наличными на карту» — красная зона, пауза и подтверждение доверенных лиц. В разделе «Защита» можно включить полный запрет.', form: { kind: 'credit', amount: 300000, product: 'goods' } },
    6: { title: 'Меня обманули', hint: 'Защита не подключена, 20 минут назад ушёл перевод 480 000 ₸. Откройте его чек в «Истории» (или «Меня обманули» на главной) и нажмите «Меня обманули» → «Сообщить банку». В колонке банка можно отметить, что деньги вернулись.', form: { kind: 'transfer', recipient_id: 'utility', amount: 3500, big_purchase: false } },
    7: { title: 'Спорный товар', hint: 'Нажмите «Меня обманули», причина «покупка», ответ «товар получил»: заморозки нет.', form: { kind: 'transfer', recipient_id: 'utility', amount: 3500, big_purchase: false } }
  };

  // Частые платежи: получатель и привычная сумма в одно нажатие. Это не обходит проверок: платёж оценивается как обычный перевод.
  var BASE_FAVORITES = [
    { id: 1, title: 'Продукты', recipient_id: 'magnum', amount: 15000, icon: 'cart' },
    { id: 2, title: 'Коммуналка', recipient_id: 'utility', amount: 3500, icon: 'house' },
    { id: 3, title: 'Внуку Алибеку', recipient_id: 'grandson', amount: 20000, icon: 'user' },
    { id: 4, title: 'Аптека', recipient_id: 'pharmacy', amount: 8000, icon: 'pill' },
    { id: 5, title: 'Связь', recipient_id: 'mobile', amount: 3000, icon: 'phone' }
  ];
  // Причины, которые касаются самого клиента и его телефона: их можно показать ему. Сведения о получателе остаются внутри банка.
  var OWN_REASONS = ['call_unknown', 'call_known', 'night', 'new_device', 'recent_codes', 'huge_amount', 'large_amount', 'new_recipient', 'over_limit_daily', 'over_limit_monthly', 'after_credit', 'cash_loan', 'credit_lock', 'client_reported_call'];
  function fmtKzt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸'; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function round(x, d) { var m = Math.pow(10, d || 0); return Math.round(x * m) / m; }

  // ---- слой 1: скоринг ----
  function zoneFor(s) { return s >= CFG.scoring.red ? 'red' : (s >= CFG.scoring.yellow ? 'yellow' : 'green'); }
  function score(sig) {
    var sc = CFG.scoring, P = sc.pts, r = [];
    function add(code, text) { r.push({ code: code, text: text, points: P[code] }); }
    if (sig.new_recipient) add('new_recipient', 'Новый получатель: раньше переводов ему не было');
    if (sig.flagged_recipient) add('flagged_recipient', 'По данным банка получатель связан с мошенническими операциями');
    var ratio = sig.amount / sc.typical;
    if (ratio >= sc.huge) r.push({ code: 'huge_amount', text: 'Сумма в ' + Math.round(ratio) + ' раз больше обычной', points: P.huge_amount });
    else if (sig.amount >= sc.large) add('large_amount', 'Крупная сумма');
    if (sig.call === 'unknown') add('call_unknown', 'Звонок с незнакомого номера во время операции или незадолго до неё');
    else if (sig.call === 'known') add('call_known', 'Звонок знакомого во время операции или незадолго до неё');
    if (sig.night) add('night', 'Ночное время');
    if (sig.new_device) add('new_device', 'Новое устройство');
    if (sig.whitelisted) add('whitelist', 'Получатель из белого списка');
    if (sig.big_purchase) add('big_purchase', 'Включён режим «Я совершаю крупную покупку»');
    if (sig.credit_kind === 'cash') add('cash_loan', 'Кредит наличными: деньги приходят на карту, и их можно сразу перевести');
    if (sig.credit_kind === 'goods') add('goods_installment', 'Рассрочка на товар: деньги уходят продавцу, а не на карту');
    if (sig.after_credit) add('after_credit', 'Перевод вскоре после кредита наличными: так действуют мошенники');
    if (sig.codes) add('recent_codes', 'Недавно приходили коды входа или была попытка войти с другого устройства');
    var raw = r.reduce(function (a, x) { return a + x.points; }, 0), s = Math.max(0, Math.min(100, raw));
    return { score: s, zone: zoneFor(s), reasons: r };
  }

  function create() {
    var E = { cfg: CFG };
    var audit = [], GEN = new Array(65).join('0');
    function aAppend(minute, actor, action, payload) {
      var prev = audit.length ? audit[audit.length - 1].hash : GEN, data = JSON.stringify(sortKeys(payload || {}));
      var h = sha256(utf8(JSON.stringify([prev, round(minute, 4), actor, action, data])));
      audit.push({ id: audit.length + 1, minute: minute, actor: actor, action: action, data: data, prev: prev, hash: h });
    }
    function aVerify() {
      var prev = GEN;
      for (var i = 0; i < audit.length; i++) {
        var a = audit[i];
        if (a.prev !== prev || sha256(utf8(JSON.stringify([prev, round(a.minute, 4), a.actor, a.action, a.data]))) !== a.hash) return { ok: false, broken_at: a.id, records: audit.length };
        prev = a.hash;
      }
      return { ok: true, broken_at: null, records: audit.length };
    }
    E.tamperAudit = function () { if (audit.length > 1) audit[1].data = '{"tampered":true}'; };

    var S;  // всё изменяемое состояние
    function sim() { return S.sim; }
    function setCall(state) {
      var s = S.sim;
      if (state === 'active_known' || state === 'active_unknown') { s.call = state.split('_')[1]; return; }
      if (state === 'ended_known' || state === 'ended_unknown') { s.call = 'none'; s.last_call_type = state.split('_')[1]; s.last_call_end = S.now; return; }
      if (state !== 'none') throw Blocked('BAD_SIM', 'Неизвестное состояние звонка.', 400);
      if (s.call !== 'none') { s.last_call_type = s.call; s.last_call_end = S.now; s.call = 'none'; }
      else { s.last_call_type = null; s.last_call_end = null; }
    }
    function displayCall() {
      var s = S.sim;
      if (s.call !== 'none') return 'active_' + s.call;
      if (s.last_call_end != null && S.now - s.last_call_end < CFG.window) return 'ended_' + s.last_call_type;
      return 'none';
    }
    function effectiveCall() {
      var s = S.sim;
      if (s.call !== 'none') return s.call;
      if (s.last_call_end != null && S.now - s.last_call_end < CFG.window) return s.last_call_type || 'none';
      return 'none';
    }

    E.reset = function (n) {
      if (!SCENARIOS[n]) throw Blocked('NOT_FOUND', 'Нет такого сценария.', 404);
      audit.length = 0;
      S = {
        now: 0, scenario: n, sim: { call: 'none', last_call_type: null, last_call_end: null, night: false, new_device: false, remote_access: false, codes: false },
        recipients: clone(BASE_RECIPIENTS),
        ward: { name: 'Нурлан-ата', balance: 1284500, protection_on: true, credit_lock: false, credit_lock_mode: 'smart', cash_credit_at: null, limits: { daily_on: false, daily: CFG.limitDaily, monthly_on: true, monthly: CFG.limitMonthly }, outgoing_blocked: false, cards_blocked: false, sessions_reset: 0, safe_mode: null, code_changed_at: null,
          devices: [{ id: 'this', name: 'Этот телефон', place: 'Алматы', current: true }, { id: 'pc', name: 'Windows · Chrome', place: 'Алматы', current: false }, { id: 'unk', name: 'Android · неизвестное устройство', place: 'Шымкент', current: false }],
          whitelist: ['utility', 'grandson'], guardians: { guardian: 'alibek', second: 'aigul' },
          consent: { given: true, given_at: 0, valid_months: 12, revocable: true, fields: CONSENT_FIELDS } },
        history: [{ title: 'Пенсия', amount: 182000, minute: -60 * 24, kind: 'in' }, { title: 'Магнум', amount: -14700, minute: -60 * 30, kind: 'out' }, { title: 'Алматы Су (коммуналка)', amount: -3500, minute: -60 * 24 * 6, kind: 'out' }],
        ops: [], incidents: [], disable_requests: [], notifications: [], people: clone(PEOPLE), nextPerson: 1,
        counters: { call_blocks: 0, remote_blocks: 0, credit_lock_blocks: 0, outgoing_blocks: 0, attempts: 0 },
        busy: { guardian: false, second: false }, nextId: 1, nextReq: 1,
        trusted_log: [], complaints: [], rejections: {}, nextComplaint: 1,
        favorites: clone(BASE_FAVORITES), nextFav: BASE_FAVORITES.length + 1,
        cases: [], nextCase: 1, epoch: Date.now()
      };
      aAppend(0, 'system', 'scenario_reset', { scenario: n });
      if (n === 2) setCall('active_unknown');
      if (n === 3) S.busy = { guardian: true, second: true };
      if (n === 5) { S.ward.credit_lock = true; S.ward.credit_lock_mode = 'smart'; }
      if (n === 6) { S.ward.protection_on = false; S.ward.consent.given = false; seedExecuted('receiver_bcc', 480000, 20, false); }
      if (n === 7) seedExecuted('seller', 85000, 60 * 24 * 2, true);
      if (n === 8) {
        // Исходное состояние для показа: один доверенный (внук), дневной 100 000, месячный 400 000, сегодня уже 40 000, за месяц 120 000.
        S.ward.guardians = { guardian: 'alibek', second: null };
        S.ward.limits = { daily_on: true, daily: 100000, monthly_on: true, monthly: 400000 };
        seedExecuted('repair', 80000, 60 * 24 * 9, true);
        seedExecuted('samat', 40000, 90, true);
      }
    };
    function newOp(kind, amount, rid, rname, created, big) {
      return { id: S.nextId++, kind: kind, amount: amount, recipient_id: rid, recipient_name: rname, created_at: created, score: 0, zone: 'green', reasons: [], device: {},
        status: 'HELD', notified: {}, approvals: {}, first_trusted_approval_at: null, attempts: {}, decided_by: null, decided_at: null, hold_deadline: null,
        big_purchase: !!big, scoring_failed: false, called_answer: null, events: [] };
    }
    function ev(op, minute, text) { op.events.push({ minute: round(minute, 2), text: text }); }
    function seedExecuted(rid, amount, ago, known) {
      var rec = S.recipients[rid], op = newOp('transfer', amount, rid, rec.name, S.now - ago);
      op.status = 'EXECUTED'; op.device = { call: 'none', night: false, new_device: false, remote_access: false };
      if (known) { var r = score({ amount: amount, new_recipient: true }); op.score = r.score; op.zone = r.zone; op.reasons = r.reasons; }
      else { op.score = null; op.zone = null; ev(op, op.created_at, 'Операция проведена без оценки: семейная защита не была подключена.'); }
      op.decided_by = 'auto'; op.decided_at = op.created_at; S.ops.push(op); S.ward.balance -= amount;
      S.history.push({ title: rec.name, amount: -amount, minute: op.created_at, kind: 'out', op_id: op.id }); rec.known = true;
    }

    // ---- получатель по номеру карты ----
    E.addCardRecipient = function (pan, name) {
      pan = String(pan || '').replace(/\D/g, '');
      if (pan.length < 16 || pan.length > 19 || !luhnOk(pan)) throw Blocked('BAD_CARD', 'Проверьте номер карты: в нём ошибка.', 400);
      var last4 = pan.slice(-4), flagged = !!FLAGGED_CARDS[pan], id = 'card_' + last4 + (flagged ? 'f' : '');
      if (!S.recipients[id]) {
        var who = String(name || '').trim().slice(0, 40);
        S.recipients[id] = { name: (who ? who + ' ' : 'Карта ') + '••' + last4, bank: 'Другой банк', known: false, flagged: flagged,
          history_months: flagged ? 1 : 18, complaints: flagged ? 3 : 0, senders_7d: flagged ? 14 : 0, card: true, last4: last4 };
        aAppend(S.now, 'ward', 'card_recipient_added', { last4: last4 });
      }
      return { id: id, name: S.recipients[id].name, known: S.recipients[id].known };
    };

    // ---- время ----
    E.advance = function (m) { S.now += m; E.tick(); };
    E.advanceTo = function (minute, step) { step = step || 0.5; while (S.now + step <= minute) E.advance(step); if (S.now < minute) E.advance(minute - S.now); };
    E.tick = function () {
      S.ops.forEach(function (op) {
        if (op.status !== 'HELD') return;
        ladderTick(op).forEach(function (a) { aAppend(S.now, 'system', 'request_sent', { op: op.id, to: a }); });
        if (op.hold_deadline != null && S.now >= op.hold_deadline) { finish(op, 'EXPIRED', 'system', 'Истёк предельный срок удержания. Операция не проведена, деньги на счёте.'); aAppend(S.now, 'system', 'hold_expired', { op: op.id }); }
      });
      S.incidents.forEach(function (inc) {
        var before = inc.status;
        if (inc.status === 'FREEZE_REQUESTED' && inc.reply_at != null && S.now >= inc.reply_at) hold(inc, 'Ответ Антифрод-центра (эмуляция): банк получателя удержал средства.');
        else if (inc.status === 'HELD' && inc.hold_until != null && S.now >= inc.hold_until) { inc.outcome = 'not_returned'; setInc(inc, 'EXPIRED'); }
        if (inc.status !== before) aAppend(S.now, 'system', 'incident_' + inc.status.toLowerCase(), { incident: inc.id });
      });
      S.disable_requests.forEach(function (rq) {
        if (rq.status === 'pending' && S.now >= rq.effective_at) {
          rq.status = 'applied';
          if (rq.target === 'trusted_add' || rq.target === 'trusted_remove') { applyTrusted(rq); return; }
          if (rq.target === 'limit_up') { S.ward.limits = { daily_on: rq.to.daily_on, daily: rq.to.daily, monthly_on: rq.to.monthly_on !== false, monthly: rq.to.monthly }; notify('Вступило в силу: ' + limitsText(rq.to) + '.'); aAppend(S.now, 'system', 'limit_up_applied', rq.to); return; }
          if (rq.target === 'credit_smart') { S.ward.credit_lock_mode = 'smart'; notify('Вступило в силу: кредитный замок в умном режиме.'); aAppend(S.now, 'system', 'credit_smart_applied', {}); return; }
          S.ward[rq.target === 'protection' ? 'protection_on' : 'credit_lock'] = false;
          notify('Вступило в силу: ' + targetText(rq.target) + ' отключена.'); aAppend(S.now, 'system', 'disable_applied', { target: rq.target });
        }
      });
    };

    // ---- сигналы и предохранители ----
    E.setSim = function (b) {
      if (b.call != null) setCall(b.call);
      if (b.night != null) S.sim.night = !!b.night;
      if (b.new_device != null) S.sim.new_device = !!b.new_device;
      if (b.remote_access != null) S.sim.remote_access = !!b.remote_access;
      if (b.codes != null) S.sim.codes = !!b.codes;
      aAppend(S.now, 'demo', 'simulation_changed', { call: displayCall(), night: S.sim.night, new_device: S.sim.new_device, remote_access: S.sim.remote_access, codes: S.sim.codes });
    };
    E.setBusy = function (b) { if (b.guardian != null) S.busy.guardian = !!b.guardian; if (b.second != null) S.busy.second = !!b.second; };
    function guard(kind, amount) {
      var s = S.sim, p = S.ward.protection_on || (kind === 'credit' && S.ward.credit_lock), code = null;
      if (p && s.remote_access) code = 'REMOTE_ACCESS';
      else if (p && s.call !== 'none') code = 'CALL_ACTIVE';
      else if (kind === 'credit' && S.ward.credit_lock && S.ward.credit_lock_mode === 'full') code = 'CREDIT_LOCK';
      if (code) {
        var key = { CALL_ACTIVE: 'call_blocks', REMOTE_ACCESS: 'remote_blocks', CREDIT_LOCK: 'credit_lock_blocks' }[code]; S.counters[key]++;
        aAppend(S.now, 'ward', 'blocked_' + code.toLowerCase(), { kind: kind, amount: amount }); throw Blocked(code, MESSAGES[code]);
      }
    }
    function checkAmount(a, credit) {
      if (typeof a !== 'number' || a % 1 !== 0 || a <= 0) throw Blocked('BAD_AMOUNT', 'Сумма должна быть положительным целым числом.', 400);
      if (!credit && a > S.ward.balance) throw Blocked('INSUFFICIENT_FUNDS', 'На счёте недостаточно средств.', 400);
    }

    // ---- операции ----
    E.createTransfer = function (rid, amount, big) {
      var rec = S.recipients[rid]; if (!rec) throw Blocked('NOT_FOUND', 'Получатель не найден.', 404);
      checkAmount(amount); S.counters.attempts++;
      if (S.ward.outgoing_blocked) { S.counters.outgoing_blocks++; aAppend(S.now, 'ward', 'blocked_outgoing_blocked', { amount: amount }); throw Blocked('OUTGOING_BLOCKED', MESSAGES.OUTGOING_BLOCKED); }
      guard('transfer', amount);
      safeModeCheck('transfer', rid, amount);
      var op = newOp('transfer', amount, rid, rec.name, S.now, big);
      evaluate(op, { amount: amount, new_recipient: !rec.known, flagged_recipient: !!rec.flagged, whitelisted: S.ward.whitelist.indexOf(rid) >= 0, call: effectiveCall(), night: S.sim.night, new_device: S.sim.new_device, big_purchase: !!big,
        after_credit: S.ward.cash_credit_at != null && S.now - S.ward.cash_credit_at <= CFG.afterCredit && S.ward.whitelist.indexOf(rid) < 0, codes: S.sim.codes }, limitCheck(rid, amount));
      return op;
    };
    // Кредит: рассрочка на товар (деньги продавцу) или кредит наличными (деньги на карту).
    // Умный замок пропускает настоящую покупку без опасных сигналов и ставит на паузу то, что похоже на обман.
    var PRODUCTS = { goods: { name: 'Рассрочка на товар', merchant: 'Магазин «Техно Дом»' }, cash: { name: 'Кредит наличными на карту' } };
    E.createCredit = function (amount, product) {
      var kind = product === 'cash' || product === 'goods' ? product : (/наличн|потреб/i.test(String(product || '')) ? 'cash' : 'goods');
      checkAmount(amount, true); S.counters.attempts++; guard('credit', amount); safeModeCheck('credit', null, amount, kind);
      var pr = PRODUCTS[kind], op = newOp('credit', amount, 'credit', pr.name + (pr.merchant ? ' · ' + pr.merchant : ''), S.now);
      op.credit_kind = kind;
      evaluate(op, { amount: amount, call: effectiveCall(), night: S.sim.night, new_device: S.sim.new_device, credit_kind: kind, codes: S.sim.codes });
      return op;
    };
    // ---- пауза из-за лимита: запрос доверенному лицу, «Меня просят перевести деньги», обращения ----
    function closeRequest(op) { if (op.request && op.request.status === 'active') op.request.status = 'closed'; }
    function caseNo(c) { return 'QR-' + String(1020 + c.id); }
    function openCase(op, kind) {
      var ex = null; S.cases.forEach(function (c) { if (c.op_id === op.id) ex = c; });
      if (ex) return ex;
      var c = { id: S.nextCase++, op_id: op.id, kind: kind, amount: op.amount, recipient: op.recipient_name, created_at: S.now, status: 'accepted', refund: null };
      c.number = caseNo(c); S.cases.push(c);
      // Режим безопасности: кредит наличными закрыт, перед переводом новому получателю — предупреждение о повторном звонке.
      if (!S.ward.safe_mode) { S.ward.safe_mode = { since: S.now, case: c.number }; aAppend(S.now, 'system', 'safe_mode_on', { case: c.number }); }
      if (S.ward.guardians.guardian || S.ward.guardians.second) notify(S.ward.name + ' сообщил банку о мошенничестве (обращение ' + c.number + '). Мошенники часто звонят повторно — позвоните ему.');
      aAppend(S.now, 'ward', 'case_opened', { case: c.number, op: op.id, kind: kind });
      return c;
    }
    E.requestConfirm = function (id, role) {
      var op = opById(id);
      if (op.status !== 'HELD') throw Blocked('NOT_PENDING', 'Перевод уже не ждёт решения.', 409);
      if (op.request && op.request.status === 'active') return op.request;
      role = role || (S.ward.guardians.guardian ? 'guardian' : (S.ward.guardians.second ? 'second' : null));
      if (!role || !S.ward.guardians[role]) throw Blocked('NO_TRUSTED', 'Доверенное лицо не добавлено. Можно отменить перевод или обратиться в банк.', 409);
      op.request = { role: role, key: S.ward.guardians[role], status: 'active', at: S.now };
      op.notified[role] = S.now;
      ev(op, S.now, 'Клиент запросил подтверждение у доверенного лица: ' + pname(op.request.key) + '.');
      aAppend(S.now, 'ward', 'confirm_requested', { op: op.id, to: role });
      return op.request;
    };
    E.pressure = function (id) {
      var op = opById(id);
      if (op.status !== 'HELD') throw Blocked('NOT_PENDING', 'Перевод уже не ждёт решения.', 409);
      finish(op, 'REJECTED', 'ward', 'Клиент сообщил, что его вынуждают перевести деньги. Перевод остановлен.');
      op.pressure = true; closeRequest(op);
      return openCase(op, 'stopped');
    };
    E.reportOp = function (id) {
      var op = opById(id);
      if (op.kind !== 'transfer' || op.status !== 'EXECUTED') throw Blocked('BAD_STATE', 'Сообщить об обмане можно по выполненному исходящему переводу.', 400);
      return openCase(op, 'after_send');
    };
    E.caseRefund = function (no) {
      var c = null; S.cases.forEach(function (x) { if (x.number === no) c = x; });
      if (!c || c.kind !== 'after_send' || c.status !== 'accepted') throw Blocked('BAD_STATE', 'Вернуть можно только по принятому обращению о выполненном переводе.', 400);
      c.status = 'refunded'; c.refund = { amount: c.amount, at: S.now };
      S.ward.balance += c.amount; S.history.push({ title: 'Возврат по обращению ' + c.number, amount: c.amount, minute: S.now, kind: 'in' });
      notify('Банк вернул ' + fmtKzt(c.amount) + ' по обращению ' + c.number + '.');
      aAppend(S.now, 'operator', 'case_refunded', { case: c.number });
      return c;
    };
    function safeModeCheck(kind, rid, amount, creditKind) {
      if (!S.ward.safe_mode) return;
      if (kind === 'credit') { if (creditKind === 'goods') return; throw Blocked('SAFE_MODE', 'После обращения о мошенничестве кредиты наличными остановлены. Снять ограничение может сотрудник банка.'); }
      // Переводы после обращения доступны: клиент видит предупреждение о повторном звонке мошенников (в приложении), проверки те же.
      aAppend(S.now, 'ward', 'transfer_in_safe_mode', { amount: amount });
    }
    E.safeModeOff = function () {
      if (!S.ward.safe_mode) throw Blocked('BAD_STATE', 'Режим безопасности не включён.', 400);
      S.ward.safe_mode = null; aAppend(S.now, 'operator', 'safe_mode_off', {});
      notify('Сотрудник банка проверил личность ' + S.ward.name + ' и снял режим безопасности.'); return { ok: true };
    };
    // Выйти на всех других устройствах: текущий телефон остаётся, чтобы клиент не потерял доступ.
    E.resetSessions = function () {
      var n = S.ward.devices.filter(function (d) { return !d.current; }).length;
      S.ward.devices = S.ward.devices.filter(function (d) { return d.current; }); S.ward.sessions_reset++;
      aAppend(S.now, 'ward', 'sessions_reset', { closed: n }); return { closed: n };
    };
    // Новый код входа. В демо код никуда не сохраняется: запоминаем только время смены.
    E.changeCode = function (code) {
      code = String(code || '');
      if (!/^\d{4}$/.test(code)) throw Blocked('BAD_CODE', 'Код входа — 4 цифры.', 400);
      if (/^(\d)\1{3}$/.test(code) || '0123456789'.indexOf(code) >= 0 || '9876543210'.indexOf(code) >= 0) throw Blocked('WEAK_CODE', 'Слишком простой код. Не используйте одинаковые цифры и цифры подряд.', 400);
      S.ward.code_changed_at = S.now; aAppend(S.now, 'ward', 'login_code_changed', {}); return { ok: true };
    };
    function caseView(c) { return { id: c.id, number: c.number, op_id: c.op_id, kind: c.kind, amount: c.amount, recipient: c.recipient, created_at: c.created_at, status: c.status, refund: c.refund }; }

    // ---- частые платежи ----
    E.payFavorite = function (id) {
      var f = null; S.favorites.forEach(function (x) { if (x.id === id) f = x; }); if (!f) throw Blocked('NOT_FOUND', 'Такого частого платежа нет.', 404);
      return E.createTransfer(f.recipient_id, f.amount, false);
    };
    E.addFavorite = function (rid, amount, title) {
      if (!S.recipients[rid]) throw Blocked('NOT_FOUND', 'Получатель не найден.', 404);
      amount = Math.round(amount); if (!(amount > 0)) throw Blocked('BAD_AMOUNT', 'Сумма должна быть больше нуля.', 400);
      if (S.favorites.length >= 8) throw Blocked('FAV_FULL', 'Частых платежей может быть не больше восьми. Удалите один.', 409);
      if (S.favorites.some(function (f) { return f.recipient_id === rid && f.amount === amount; })) throw Blocked('DUPLICATE', 'Такой частый платёж уже есть.', 409);
      var f = { id: S.nextFav++, title: String(title || S.recipients[rid].name).trim().slice(0, 24), recipient_id: rid, amount: amount, icon: 'star' };
      S.favorites.push(f); aAppend(S.now, 'ward', 'favorite_added', { id: f.id }); return f;
    };
    E.removeFavorite = function (id) {
      var n = S.favorites.length; S.favorites = S.favorites.filter(function (f) { return f.id !== id; });
      if (S.favorites.length === n) throw Blocked('NOT_FOUND', 'Такого частого платежа нет.', 404);
      aAppend(S.now, 'ward', 'favorite_removed', { id: id }); return { ok: true };
    };
    // ---- лимиты, которые клиент задаёт сам. Сверх лимита перевод не пропадает, а ждёт подтверждения ----
    function spentWithin(win) {
      return S.ops.filter(function (o) { return o.kind === 'transfer' && o.status === 'EXECUTED' && S.now - o.created_at < win && S.ward.whitelist.indexOf(o.recipient_id) < 0; })
        .reduce(function (a, o) { return a + o.amount; }, 0);
    }
    function spentToday() { return spentWithin(CFG.day); }
    function spentMonth() { return spentWithin(CFG.month); }
    // Лимиты, которые клиент задаёт сам: месячный есть всегда, дневной клиент включает по желанию.
    function limitsText(L) { return (L.daily_on ? 'до ' + fmtKzt(L.daily) + ' в сутки' : 'дневной лимит выключен') + ', ' + (L.monthly_on !== false ? 'до ' + fmtKzt(L.monthly) + ' в месяц' : 'месячный лимит выключен'); }
    function limitCheck(rid, amount) {
      if (S.ward.whitelist.indexOf(rid) >= 0) return [];
      var L = S.ward.limits, out = [];
      // Пауза только если сумма строго больше лимита; ровно лимит — обычное подтверждение.
      var d = spentToday(), m = spentMonth();
      if (L.daily_on && d + amount > L.daily) out.push({ code: 'over_limit_daily', points: 0, period: 'day', spent: d, limit: L.daily, total: d + amount, text: 'Превышен дневной лимит переводов (' + fmtKzt(L.daily) + ')' });
      if (L.monthly_on !== false && m + amount > L.monthly) out.push({ code: 'over_limit_monthly', points: 0, period: 'month', spent: m, limit: L.monthly, total: m + amount, text: 'Превышен месячный лимит переводов (' + fmtKzt(L.monthly) + ')' });
      return out;
    }
    E.setLimits = function (o) {
      var L = S.ward.limits, mOn = L.monthly_on !== false, to = { daily_on: !!o.daily_on, daily: Math.round(o.daily == null ? L.daily : o.daily), monthly_on: o.monthly_on == null ? mOn : !!o.monthly_on, monthly: Math.round(o.monthly == null ? L.monthly : o.monthly) };
      if ((to.monthly_on && !(to.monthly >= 1000 && to.monthly <= 100000000)) || (to.daily_on && !(to.daily >= 1000 && to.daily <= 20000000))) throw Blocked('BAD_LIMIT', 'Лимит должен быть от 1 000 ₸: до 20 млн в сутки и до 100 млн в месяц.', 400);
      if (to.daily_on && to.monthly_on && to.daily > to.monthly) throw Blocked('BAD_LIMIT', 'Дневной лимит не может быть больше месячного.', 400);
      // Строже — сразу. Мягче (выключить дневной, поднять сумму) — через период охлаждения.
      var tighterDaily = to.daily_on && (!L.daily_on || to.daily <= L.daily);
      var tighterMonthly = to.monthly_on && (!mOn || to.monthly <= L.monthly);
      var down = { daily_on: L.daily_on || to.daily_on, daily: tighterDaily ? to.daily : L.daily, monthly_on: mOn || to.monthly_on, monthly: tighterMonthly ? to.monthly : L.monthly };
      if (!L.daily_on && to.daily_on) down.daily = to.daily;
      var up = (L.daily_on && !to.daily_on) || (L.daily_on && to.daily_on && to.daily > L.daily) || (mOn && !to.monthly_on) || (mOn && to.monthly_on && to.monthly > L.monthly);
      S.ward.limits = down; aAppend(S.now, 'ward', 'limits_set', down);
      if (!up) { S.disable_requests.forEach(function (r) { if (r.target === 'limit_up' && r.status === 'pending') r.status = 'cancelled'; }); return { status: 'applied', limits: down }; }
      var s = S.sim, code = null;
      if (s.remote_access) code = 'REMOTE_ACCESS'; else if (s.call !== 'none') code = 'CALL_ACTIVE'; else if (s.new_device) code = 'NEW_DEVICE';
      if (code) { aAppend(S.now, 'ward', 'limit_up_refused_' + code.toLowerCase(), {}); throw Blocked(code, code === 'CALL_ACTIVE' ? 'Во время звонка ослабить лимит нельзя. Если вас об этом просят, это мошенники.' : (code === 'REMOTE_ACCESS' ? MESSAGES.REMOTE_ACCESS : 'С нового устройства ослабить лимит нельзя в первые сутки.')); }
      S.disable_requests.forEach(function (r) { if (r.target === 'limit_up' && r.status === 'pending') r.status = 'cancelled'; });
      var rq = { id: S.nextReq++, target: 'limit_up', to: to, requested_at: S.now, effective_at: S.now + CFG.cooldown, status: 'pending' };
      S.disable_requests.push(rq);
      notify(S.ward.name + ' меняет лимиты переводов: ' + limitsText(to) + '. Вступит в силу через период охлаждения.');
      aAppend(S.now, 'ward', 'limit_up_requested', rq.to); return rq;
    };
    function evaluate(op, sig, extra) {
      op.device = { call: sig.call, night: sig.night, new_device: sig.new_device, remote_access: S.sim.remote_access, codes: !!sig.codes };
      try { var r = score(sig); op.score = r.score; op.zone = r.zone; op.reasons = r.reasons; }
      catch (e) { op.score = null; op.zone = 'yellow'; op.scoring_failed = true; op.reasons = [{ code: 'scoring_failed', points: 0, text: 'Оценка риска временно недоступна: операция на паузе для подтверждения' }]; aAppend(S.now, 'system', 'scoring_failed', { op: op.id }); }
      var riskGreen = op.zone === 'green';
      if (extra && extra.length) {
        op.limit = extra.map(function (x) { return { period: x.period, spent: x.spent, limit: x.limit, total: x.total }; });
        op.reasons = op.reasons.concat(extra.map(function (x) { return { code: x.code, points: 0, text: x.text }; }));
        if (op.zone === 'green') op.zone = 'yellow';
        op.limit_only = riskGreen;  // пауза только из-за лимита: подтверждение клиент запрашивает сам
      }
      if (op.kind === 'credit' && S.ward.credit_lock && op.credit_kind === 'cash' && op.zone === 'green') {
        op.zone = 'yellow'; op.reasons.push({ code: 'credit_lock', points: 0, text: 'Кредитный замок: кредит наличными подтверждают доверенные лица' });
      }
      S.ops.push(op);
      var guarded = S.ward.protection_on || (op.kind === 'credit' && S.ward.credit_lock);
      if (!guarded) { ev(op, S.now, 'Қорған выключен: операция проведена без подтверждения.'); execute(op, 'auto'); }
      else if (op.zone === 'green') { ev(op, S.now, 'Риск ' + op.score + ': зелёная зона, операция проведена сразу.'); execute(op, 'auto'); }
      else {
        op.status = 'HELD'; op.hold_deadline = S.now + (op.limit_only ? CFG.limitHold : CFG.maxHold); aAppend(S.now, 'system', 'held', { op: op.id, score: op.score, zone: op.zone });
        if (op.limit_only) { ev(op, S.now, 'Перевод на паузе: превышен лимит. Деньги на счёте клиента.'); }
        else if (S.ward.guardians.guardian) { op.notified.guardian = S.now; ev(op, S.now, 'Операция на паузе. Запрос отправлен доверенному лицу.'); aAppend(S.now, 'system', 'request_sent', { op: op.id, to: 'guardian' }); }
        else if (op.zone !== 'red') { op.notified.assistant = S.now; assistantWindow(op); ev(op, S.now, 'Операция на паузе. Доверенных лиц нет: помощник банка задаст клиенту 4 вопроса.'); }
        else { op.notified.operator = S.now; ev(op, S.now, 'Операция на паузе. Доверенных лиц нет: решение сразу за сотрудником банка.'); aAppend(S.now, 'system', 'request_sent', { op: op.id, to: 'operator' }); }
      }
    }
    function execute(op, actor) {
      op.status = 'EXECUTED'; if (op.decided_by == null) { op.decided_by = actor; op.decided_at = S.now; }
      if (op.kind === 'transfer') { S.ward.balance -= op.amount; S.recipients[op.recipient_id].known = true; S.history.push({ title: op.recipient_name, amount: -op.amount, minute: S.now, kind: 'out', op_id: op.id }); }
      else if (op.credit_kind === 'goods') { S.history.push({ title: op.recipient_name + ': товар оплачен продавцу', amount: op.amount, minute: S.now, kind: 'debt', op_id: op.id }); }
      else { S.ward.balance += op.amount; S.ward.cash_credit_at = S.now; S.history.push({ title: op.recipient_name + ': зачислено', amount: op.amount, minute: S.now, kind: 'in', op_id: op.id }); }
      aAppend(S.now, actor, 'executed', { op: op.id, amount: op.amount });
    }
    function opById(id) { for (var i = 0; i < S.ops.length; i++) if (S.ops[i].id === id) return S.ops[i]; throw Blocked('NOT_FOUND', 'Операция не найдена.', 404); }

    // ---- слой 2: лестница ----
    // Самоподтверждения нет: мошенник, который стоит рядом или на телефоне, продиктует «никто не звонил».
    // Если близкие молчат, операцию решает живой сотрудник банка, иначе через предельный срок она отменяется.
    function operatorDue(op) {
      var due = op.created_at + CFG.operatorAfter;
      if (op.zone === 'red' && op.first_trusted_approval_at != null) due = Math.min(due, op.first_trusted_approval_at + CFG.opAfterFirst);
      return due;
    }
    // Пока клиент отвечает помощнику, операция не должна истечь: даём не меньше 30 минут с начала разговора.
    function assistantWindow(op) { op.hold_deadline = Math.max(op.hold_deadline || 0, S.now + CFG.assistantWindow); }
    E.assistantOpened = function (id) { var op = opById(id); if (op.status === 'HELD' && op.notified.assistant != null) assistantWindow(op); return { ok: true }; };
    function ladderTick(op) {
      var nw = [], rel = S.now - op.created_at;
      // Пауза из-за лимита: пока клиент сам не запросил подтверждение, ничего не происходит.
      // Если запросил, а доверенное лицо молчит 15 минут, клиента опрашивает помощник банка.
      if (op.limit_only) {
        if (op.request && op.request.status === 'active' && op.notified.assistant == null && S.now - op.request.at >= CFG.assistantAfter) { op.notified.assistant = S.now; assistantWindow(op); ev(op, S.now, 'Доверенное лицо не ответило: помощник банка задаст клиенту 4 вопроса.'); nw.push('assistant'); }
        return nw;
      }
      if (op.notified.second == null && S.ward.guardians.second && !op.appeal && rel >= CFG.second) { op.notified.second = S.now; ev(op, S.now, 'Доверенное лицо не ответило. Запрос отправлен второму доверенному лицу.'); nw.push('second'); }
      // Средняя зона: доверенные лица молчат — опрашивает помощник банка, сотрудника клиент зовёт сам, если захочет.
      // Красная зона: как раньше, подключается сотрудник банка.
      if (op.zone === 'red') { if (op.notified.operator == null && S.now >= operatorDue(op)) { op.notified.operator = S.now; ev(op, S.now, 'Подключён оператор банка: карточка риска в очереди.'); nw.push('operator'); } }
      else if (op.notified.assistant == null && op.notified.operator == null && rel >= CFG.assistantAfter) { op.notified.assistant = S.now; assistantWindow(op); ev(op, S.now, 'Доверенные лица не ответили: помощник банка задаст клиенту 4 вопроса.'); nw.push('assistant'); }
      return nw;
    }
    // ---- проверка помощником банка (ИИ-помощник в приложении, эмуляция) ----
    var FLAG_TEXT = { call_reported: 'клиенту звонили по поводу перевода', safe_account: 'перевод на «безопасный счёт» по просьбе «банка» или «полиции»',
      investment: 'перевод ради инвестиций или заработка', online_stranger: 'получатель знаком только по интернету', code_or_secret: 'просили код, приложение или держать перевод в секрете',
      pressure: 'клиента торопят или пугают' };
    E.verify = function (id, ans) {
      var op = opById(id);
      if (op.status === 'EXPIRED') throw Blocked('EXPIRED', 'Время ожидания истекло, перевод не выполнен. Деньги на вашем счёте, перевод можно отправить заново.', 409);
      if (op.status !== 'HELD') throw Blocked('NOT_PENDING', 'По этой операции решение уже принято.', 409);
      if (op.notified.operator == null && op.notified.assistant == null) throw Blocked('NOT_YOUR_TURN', 'Помощник банка ещё не подключился.', 403);
      if (op.verification && op.verification.status !== 'pending') return op.verification;
      ans = ans || {}; var flags = [];
      if (ans.call === 'yes') flags.push('call_reported');
      if (ans.purpose === 'safe_account' || ans.purpose === 'investment' || ans.purpose === 'online_stranger') flags.push(ans.purpose);
      if (ans.code === 'yes') flags.push('code_or_secret');
      if (ans.pressure === 'yes') flags.push('pressure');
      var v = { status: 'pending', answers: ans, flags: flags, flags_text: flags.map(function (f) { return FLAG_TEXT[f]; }), at: S.now };
      op.verification = v;
      var unclear = ['call', 'purpose', 'code', 'pressure'].some(function (k) { return !ans[k] || ans[k] === 'unknown'; });
      if (flags.length) {
        v.status = 'failed';
        finish(op, 'REJECTED', 'assistant', 'Помощник банка нашёл признаки обмана: ' + v.flags_text.join('; ') + '. Операция остановлена, деньги на счёте.');
        notify('Помощник банка остановил операцию ' + S.ward.name + ' на ' + fmtKzt(op.amount) + ': есть признаки мошенничества. Позвоните ему.');
      } else if (!unclear && assistantMayApprove(op, ans)) {
        // Обычная покупка или перевод знакомому, ответы чистые, опасных сигналов нет: помощник подтверждает сам.
        v.status = 'passed';
        finish(op, 'EXECUTED', 'assistant', 'Помощник банка уточнил детали: признаков обмана нет, обычная операция. Перевод подтверждён.');
        if (op.request) op.request.status = 'closed';
      } else {
        // Ответы неполные или есть опасные сигналы: сам помощник не подтверждает. Клиент может позвать сотрудника банка.
        v.status = 'needs_operator';
        ev(op, S.now, unclear ? 'Помощник банка: ответы неполные. Сотрудник банка позвонит клиенту и примет решение.' : 'Помощник банка: признаков обмана в ответах нет. Сотрудник банка позвонит клиенту, проверит личность и примет решение.');
      }
      aAppend(S.now, 'assistant', 'verification_' + v.status, { op: op.id, flags: flags });
      if (op.status === 'EXECUTED') execute(op, 'assistant');
      return v;
    };
    var NO_AUTO = ['call_unknown', 'flagged_recipient', 'recent_codes', 'after_credit', 'cash_loan', 'new_device'];
    function assistantMayApprove(op, ans) {
      if (op.zone === 'red' || op.notified.operator != null) return false;
      if (ans.purpose !== 'purchase' && ans.purpose !== 'family') return false;
      if (op.amount > CFG.assistantMax) return false;
      return !op.reasons.some(function (r) { return NO_AUTO.indexOf(r.code) >= 0; });
    }
    // Клиент сам просит связать его с сотрудником банка.
    E.callStaff = function (id) {
      var op = opById(id);
      if (op.status !== 'HELD') throw Blocked('NOT_PENDING', 'Перевод уже не ждёт решения.', 409);
      if (op.notified.operator == null) { op.notified.operator = S.now; ev(op, S.now, 'Клиент попросил связаться с сотрудником банка.'); aAppend(S.now, 'ward', 'staff_requested', { op: op.id }); }
      return { ok: true };
    };
    function finish(op, status, actor, text) { op.status = status; op.decided_by = actor; op.decided_at = S.now; ev(op, S.now, text); }
    E.decide = function (id, actor, decision, called) {
      var op = opById(id);
      if (decision !== 'approve' && decision !== 'reject') throw Blocked('BAD_DECISION', 'Решение должно быть approve или reject.', 400);
      if (op.status !== 'HELD') throw Blocked('NOT_PENDING', 'Запрос закрыт: по этому переводу решение уже принято.', 409);
      op.attempts[actor] = (op.attempts[actor] || 0) + 1;
      if (op.attempts[actor] > CFG.maxAttempts) throw Blocked('TOO_MANY_ATTEMPTS', 'Слишком много попыток подтверждения по этой операции.', 429);
      var label = ACTOR[actor] || actor, result;
      if (decision === 'reject' && actor === 'ward') { finish(op, 'REJECTED', actor, 'Клиент отменил операцию.'); closeRequest(op); result = 'rejected'; }
      else if (actor === 'ward') throw Blocked('SELF_CONFIRM_UNAVAILABLE', 'Подтвердить операцию самому нельзя: её подтверждают доверенные лица или сотрудник банка.', 403);
      else if (op.appeal && actor !== 'operator') throw Blocked('NOT_YOUR_TURN', 'Клиент не согласен с решением: операцию решает сотрудник банка.', 403);
      else {
        if (op.notified[actor] == null) throw Blocked('NOT_YOUR_TURN', 'Запрос этому участнику ещё не поступал.', 403);
        if (decision === 'reject') { finish(op, 'REJECTED', actor, 'Отклонил ' + label + '. Операция остановлена.'); result = 'rejected'; }
        else if (op.zone === 'yellow' || actor === 'operator') {
          finish(op, 'EXECUTED', actor, actor === 'operator' ? 'Оператор проверил личность и разрешил операцию.' : 'Разрешил ' + label + '.'); result = 'approved';
        } else {
          op.approvals[actor] = S.now; var others = ['guardian', 'second'].filter(function (a) { return a !== actor && S.ward.guardians[a]; });
          if (others.some(function (a) { return op.approvals[a] != null; })) { finish(op, 'EXECUTED', actor, 'Оба доверенных лица подтвердили операцию.'); result = 'approved'; }
          else {
            if (op.first_trusted_approval_at == null) op.first_trusted_approval_at = S.now;
            ev(op, S.now, 'Разрешил ' + label + (others.length ? '. Красная зона: нужно второе подтверждение.' : '. Красная зона: второго доверенного лица нет, решение за оператором банка.'));
            others.forEach(function (o) { if (op.notified[o] == null) { op.notified[o] = S.now; ev(op, S.now, 'Запрос сразу отправлен: ' + ACTOR[o] + '.'); } });
            result = 'waiting';
          }
        }
      }
      aAppend(S.now, actor, 'decision_' + decision, { op: op.id, result: result });
      if (actor === 'guardian' || actor === 'second') trustedAction(actor, op, decision);
      if (op.status === 'EXECUTED') execute(op, actor);
      return { result: result, status: op.status, zone: op.zone };
    };

    // ---- защита от недобросовестного доверенного ----
    // Клиент видит каждое действие доверенного, может не согласиться с отказом, пожаловаться и удалить доверенного через банк сразу.
    function tlog(key, text) { S.trusted_log.push({ minute: round(S.now, 2), key: key, who: pname(key), text: text }); }
    function trustedAction(role, op, decision) {
      var key = S.ward.guardians[role]; if (!key) return;
      var what = (op.kind === 'credit' ? 'кредит ' : 'перевод ') + fmtKzt(op.amount);
      tlog(key, (decision === 'approve' ? 'разрешил ' : 'отклонил ') + what);
      if (decision !== 'reject') return;
      var r = S.rejections[key] = (S.rejections[key] || []).filter(function (m) { return S.now - m < CFG.week; });
      r.push(S.now);
      if (r.length > CFG.abuseRejects && !S.complaints.some(function (c) { return c.key === key && c.status === 'open' && c.source === 'auto'; })) {
        openComplaint(key, 'auto', 'Частые отказы: ' + r.length + ' за неделю. Банк проверит, не злоупотребляет ли доверенное лицо.');
      }
    }
    function openComplaint(key, source, text, wantRemove) {
      var c = { id: S.nextComplaint++, key: key, who: pname(key), source: source, text: text, want_remove: !!wantRemove, status: 'open', created_at: S.now };
      S.complaints.push(c);
      aAppend(S.now, source === 'auto' ? 'system' : 'ward', 'trusted_complaint', { complaint: c.id, key: key, remove: !!wantRemove });
      return c;
    }
    E.appeal = function (id) {
      var op = opById(id);
      if (op.status !== 'REJECTED' || (op.decided_by !== 'guardian' && op.decided_by !== 'second')) throw Blocked('BAD_STATE', 'Обжаловать можно только отказ доверенного лица.', 400);
      if (op.appealed) throw Blocked('DUPLICATE', 'Вы уже обжаловали это решение.', 409);
      var s = S.sim;
      if (s.remote_access) throw Blocked('REMOTE_ACCESS', MESSAGES.REMOTE_ACCESS);
      if (s.call !== 'none') throw Blocked('CALL_ACTIVE', 'Во время звонка обжаловать решение нельзя. Если вас просят это сделать, это мошенники. Положите трубку.');
      var who = ACTOR[op.decided_by];
      op.appealed = true; op.appeal = true; op.status = 'HELD'; op.decided_by = null; op.decided_at = null;
      op.hold_deadline = S.now + CFG.maxHold; op.notified.operator = S.now;
      ev(op, S.now, 'Клиент не согласен с отказом (' + who + '). Решение за сотрудником банка после звонка клиенту.');
      notify(S.ward.name + ' не согласен с вашим отказом по операции на ' + fmtKzt(op.amount) + '. Её решит сотрудник банка.');
      aAppend(S.now, 'ward', 'appeal', { op: op.id });
      return brief(op);
    };
    E.complainTrusted = function (role, text, wantRemove) {
      var key = S.ward.guardians[role]; if (!key) throw Blocked('NOT_FOUND', 'Такого доверенного лица нет.', 404);
      if (S.complaints.some(function (c) { return c.key === key && c.status === 'open' && c.source === 'ward'; })) throw Blocked('DUPLICATE', 'Жалоба на это доверенное лицо уже у сотрудника банка.', 409);
      var c = openComplaint(key, 'ward', String(text || '').trim().slice(0, 200) || 'Клиент жалуется на действия доверенного лица.', wantRemove);
      notify('Жалоба передана сотруднику банка. Он позвонит ' + S.ward.name + ' и проверит личность.');
      return c;
    };
    E.complaintAction = function (id, action) {
      var c = null; S.complaints.forEach(function (x) { if (x.id === id) c = x; });
      if (!c || c.status !== 'open') throw Blocked('NOT_FOUND', 'Открытая жалоба не найдена.', 404);
      if (action === 'remove') {
        var g = S.ward.guardians;
        if (g.guardian === c.key) { g.guardian = g.second; g.second = null; } else if (g.second === c.key) g.second = null;
        S.disable_requests.forEach(function (r) { if (r.status === 'pending' && r.key === c.key) r.status = 'cancelled'; });
        S.ops.forEach(function (op) { if (op.status === 'HELD') { op.appeal = true; if (op.notified.operator == null) { op.notified.operator = S.now; ev(op, S.now, 'Доверенное лицо удалён банком: решение за сотрудником.'); } } });
        c.status = 'removed'; tlog(c.key, 'удалён сотрудником банка по обращению клиента');
        notify('Сотрудник банка проверил личность ' + S.ward.name + ' и удалил доверенное лицо: ' + c.who + '. Без периода охлаждения.');
      } else if (action === 'keep') { c.status = 'kept'; notify('Сотрудник банка рассмотрел жалобу на ' + c.who + ': доверенное лицо остаётся.'); }
      else throw Blocked('BAD_ACTION', 'Неизвестное действие.', 400);
      aAppend(S.now, 'operator', 'complaint_' + action, { complaint: c.id, key: c.key });
      return c;
    };
    E.renewConsent = function () {
      if (!S.ward.consent.given) throw Blocked('CONSENT_REQUIRED', 'Согласие не дано.', 400);
      S.ward.consent.given_at = S.now; tlog(S.ward.guardians.guardian || 'none', 'клиент подтвердил доверенных лиц ещё на 12 месяцев');
      aAppend(S.now, 'ward', 'consent_renewed', {}); return { ok: true };
    };

    // ---- настройки защиты ----
    E.setup = function (first, whitelist, consent) {
      if (!consent) throw Blocked('CONSENT_REQUIRED', 'Без согласия клиента доверенные лица не подключаются.', 400);
      var cur = [S.ward.guardians.guardian, S.ward.guardians.second].filter(Boolean);
      if (cur.indexOf(first) < 0) throw Blocked('BAD_GUARDIAN', 'Неизвестный доверенное лицо.', 400);
      if (whitelist.some(function (w) { return !S.recipients[w]; })) throw Blocked('BAD_WHITELIST', 'Неизвестный получатель в белом списке.', 400);
      S.ward.guardians = { guardian: first, second: cur.filter(function (k) { return k !== first; })[0] || null }; S.ward.whitelist = whitelist.slice();
      S.ward.consent = { given: true, given_at: S.now, valid_months: 12, revocable: true, fields: CONSENT_FIELDS };
      S.ward.protection_on = true; aAppend(S.now, 'ward', 'protection_setup', { first: first, whitelist: whitelist, consent: true });
    };
    function targetText(t) { return t === 'protection' ? 'семейная защита' : 'кредитный замок'; }
    function pname(k) { var p = S.people[k]; return p ? p.name + ', ' + p.relation : 'нет'; }
    function reqText(r) {
      if (r.target === 'trusted_add') return 'добавление доверенного лица: ' + pname(r.key);
      if (r.target === 'trusted_remove') return 'удаление доверенного лица: ' + pname(r.key);
      if (r.target === 'limit_up') return 'новые лимиты: ' + limitsText(r.to);
      if (r.target === 'credit_smart') return 'кредитный замок: с полного запрета на умный режим';
      return 'отключение: ' + targetText(r.target);
    }
    function notify(text) { S.notifications.push({ minute: round(S.now, 2), text: text }); }
    function cancelPending(target, text) { S.disable_requests.forEach(function (r) { if (r.target === target && r.status === 'pending') { r.status = 'cancelled'; notify(text); } }); }
    E.setProtection = function (on) {
      if (on) {
        if (!S.ward.consent.given) throw Blocked('CONSENT_REQUIRED', 'Сначала пройдите настройку и дайте согласие.', 400);
        S.ward.protection_on = true; cancelPending('protection', 'Защита снова включена.'); aAppend(S.now, 'ward', 'protection_on', {}); return { protection_on: true };
      }
      return requestDisable('protection');
    };
    E.setCreditLock = function (on) {
      if (on) { S.ward.credit_lock = true; cancelPending('credit_lock', 'Кредитный замок снова включён.'); aAppend(S.now, 'ward', 'credit_lock_on', {}); return { credit_lock: true }; }
      return requestDisable('credit_lock');
    };
    E.setCreditLockMode = function (mode) {
      if (mode !== 'smart' && mode !== 'full') throw Blocked('BAD_MODE', 'Неизвестный режим.', 400);
      if (mode === 'full') {
        S.ward.credit_lock = true; S.ward.credit_lock_mode = 'full'; cancelPending('credit_smart', 'Кредитный замок остаётся в режиме полного запрета.');
        aAppend(S.now, 'ward', 'credit_lock_full', {}); return { credit_lock_mode: 'full' };
      }
      if (!S.ward.credit_lock || S.ward.credit_lock_mode === 'smart') { S.ward.credit_lock_mode = 'smart'; return { credit_lock_mode: 'smart' }; }
      var s = S.sim, code = null;
      if (s.remote_access) code = 'REMOTE_ACCESS'; else if (s.call !== 'none') code = 'CALL_ACTIVE'; else if (s.new_device) code = 'NEW_DEVICE';
      if (code) { aAppend(S.now, 'ward', 'credit_mode_refused_' + code.toLowerCase(), {}); throw Blocked(code, code === 'CALL_ACTIVE' ? 'Во время звонка ослабить кредитный замок нельзя. Если вас об этом просят, это мошенники.' : (code === 'REMOTE_ACCESS' ? MESSAGES.REMOTE_ACCESS : MESSAGES.NEW_DEVICE)); }
      for (var i = 0; i < S.disable_requests.length; i++) { var r0 = S.disable_requests[i]; if (r0.target === 'credit_smart' && r0.status === 'pending') return r0; }
      var rq = { id: S.nextReq++, target: 'credit_smart', requested_at: S.now, effective_at: S.now + CFG.cooldown, status: 'pending' };
      S.disable_requests.push(rq);
      notify(S.ward.name + ' переводит кредитный замок с полного запрета на умный режим. Вступит в силу через период охлаждения.');
      aAppend(S.now, 'ward', 'credit_smart_requested', {}); return rq;
    };
    function requestDisable(target) {
      var key = target === 'protection' ? 'protection_on' : 'credit_lock';
      if (!S.ward[key]) return { status: 'already_off' };
      var s = S.sim, code = null, text = null;
      if (s.remote_access) { code = 'REMOTE_ACCESS'; text = MESSAGES.REMOTE_ACCESS; }
      else if (s.call !== 'none') { code = 'CALL_ACTIVE'; text = 'Во время звонка снять защиту нельзя. Если вас просят отключить защиту, это мошенники.'; }
      else if (s.new_device) { code = 'NEW_DEVICE'; text = MESSAGES.NEW_DEVICE; }
      if (code) { aAppend(S.now, 'ward', 'disable_refused_' + code.toLowerCase(), { target: target }); throw Blocked(code, text); }
      for (var i = 0; i < S.disable_requests.length; i++) { var r0 = S.disable_requests[i]; if (r0.target === target && r0.status === 'pending') return r0; }
      var rq = { id: S.nextReq++, target: target, requested_at: S.now, effective_at: S.now + CFG.cooldown, status: 'pending' };
      S.disable_requests.push(rq);
      notify(S.ward.name + ' запросил отключение: ' + targetText(target) + '. Вступит в силу через период охлаждения, если запрос не отменят.');
      aAppend(S.now, 'ward', 'disable_requested', { target: target, effective_at: rq.effective_at }); return rq;
    }
    // ---- доверенные: 1 или 2 человека. Ослабление и смена круга доверенных идут через охлаждение ----
    function weakenGuard(action) {
      var s = S.sim, code = null, text = null;
      if (s.remote_access) { code = 'REMOTE_ACCESS'; text = MESSAGES.REMOTE_ACCESS; }
      else if (s.call !== 'none') { code = 'CALL_ACTIVE'; text = 'Во время звонка менять доверенных лиц нельзя. Если вас просят убрать доверенное лицо или добавить «сотрудника банка», это мошенники.'; }
      else if (s.new_device) { code = 'NEW_DEVICE'; text = 'С нового устройства менять доверенных лиц нельзя в первые сутки.'; }
      if (code) { aAppend(S.now, 'ward', 'trusted_refused_' + code.toLowerCase(), { action: action }); throw Blocked(code, text); }
    }
    function trustedKeys() { return [S.ward.guardians.guardian, S.ward.guardians.second].filter(Boolean); }
    function pendingTrusted(target, key) { for (var i = 0; i < S.disable_requests.length; i++) { var r = S.disable_requests[i]; if (r.status === 'pending' && r.target === target && (key == null || r.key === key)) return r; } return null; }
    E.addTrusted = function (name, relation) {
      name = String(name || '').trim().slice(0, 30); relation = String(relation || '').trim().slice(0, 20) || 'доверенное лицо';
      if (!name) throw Blocked('BAD_NAME', 'Укажите имя доверенного лица.', 400);
      if (trustedKeys().length >= 2 || pendingTrusted('trusted_add')) throw Blocked('TRUSTED_FULL', 'Доверенных лиц может быть не больше двух. Сначала удалите одного.', 409);
      weakenGuard('add');
      var key = 'p' + (S.nextPerson++);
      S.people[key] = { name: name, relation: relation, acc: name, dat: name, custom: true };
      var rq = { id: S.nextReq++, target: 'trusted_add', key: key, requested_at: S.now, effective_at: S.now + CFG.cooldown, status: 'pending' };
      S.disable_requests.push(rq);
      notify(S.ward.name + ' добавляет доверенного лица: ' + pname(key) + '. Вступит в силу через период охлаждения, если запрос не отменят.');
      aAppend(S.now, 'ward', 'trusted_add_requested', { key: key }); return rq;
    };
    E.removeTrusted = function (role) {
      var key = S.ward.guardians[role];
      if (!key) throw Blocked('NOT_FOUND', 'Такого доверенного лица нет.', 404);
      if (trustedKeys().length < 2) throw Blocked('LAST_TRUSTED', 'Это единственное доверенное лицо: без него защита не работает. Чтобы отключить защиту, выключите её в разделе «Защита».', 409);
      var ex = pendingTrusted('trusted_remove', key); if (ex) return ex;
      weakenGuard('remove');
      var rq = { id: S.nextReq++, target: 'trusted_remove', key: key, requested_at: S.now, effective_at: S.now + CFG.cooldown, status: 'pending' };
      S.disable_requests.push(rq);
      notify(S.ward.name + ' удаляет доверенного лица: ' + pname(key) + '. Вступит в силу через период охлаждения, если запрос не отменят.');
      aAppend(S.now, 'ward', 'trusted_remove_requested', { key: key }); return rq;
    };
    E.swapTrusted = function () {
      var g = S.ward.guardians; if (!g.second) throw Blocked('NOT_FOUND', 'Второго доверенного лица нет.', 404);
      S.ward.guardians = { guardian: g.second, second: g.guardian };
      notify('Порядок доверенных лиц изменён: первым подтверждает ' + pname(g.second) + '.'); aAppend(S.now, 'ward', 'trusted_swapped', {});
      return { ok: true };
    };
    function applyTrusted(rq) {
      var g = S.ward.guardians;
      if (rq.target === 'trusted_add') {
        if (g.second) { rq.status = 'cancelled'; notify('Добавление отменено: доверенных лиц уже двое.'); return; }
        if (!g.guardian) g.guardian = rq.key; else g.second = rq.key; notify('Вступило в силу: ' + pname(rq.key) + ' теперь второе доверенное лицо. Приглашение отправлено (эмуляция).');
      } else {
        if (trustedKeys().length < 2 || trustedKeys().indexOf(rq.key) < 0) { rq.status = 'cancelled'; return; }
        if (g.guardian === rq.key) { g.guardian = g.second; g.second = null; } else g.second = null;
        notify('Вступило в силу: ' + pname(rq.key) + ' больше не доверенное лицо.');
      }
      aAppend(S.now, 'system', rq.target + '_applied', { key: rq.key });
    }
    E.cancelDisable = function (id) {
      for (var i = 0; i < S.disable_requests.length; i++) { var r = S.disable_requests[i]; if (r.id === id && r.status === 'pending') { r.status = 'cancelled'; notify('Запрос отменён: ' + reqText(r) + '.'); aAppend(S.now, 'ward', 'disable_cancelled', { target: r.target }); return r; } }
      throw Blocked('NOT_FOUND', 'Активный запрос не найден.', 404);
    };

    // ---- слой 3: первые 60 минут ----
    function setInc(inc, status, text) { inc.status = status; incLog(inc, text || STATUS_TEXT[status]); }
    function incLog(inc, text) { inc.feed.push({ minute: round(S.now, 2), status: inc.status, text: text }); }
    function hold(inc, text) {
      inc.hold_started_at = S.now; inc.frozen_at = S.now; inc.hold_max_until = S.now + CFG.maxHold; inc.hold_until = Math.min(S.now + CFG.holdInit, inc.hold_max_until);
      setInc(inc, 'HELD', text); incLog(inc, 'Банк получателя уведомляет его о причинах удержания; получатель вправе дать пояснения.');
    }
    function priorityFor(since, amount, loc) {
      var p = 0; p += since <= 60 ? 2 : (since <= 1440 ? 1 : 0); p += amount >= 300000 ? 2 : (amount >= 100000 ? 1 : 0); p += loc === 'in_bcc' ? 2 : (loc === 'other_bank' ? 1 : 0);
      return p >= 5 ? 'high' : (p >= 3 ? 'medium' : 'low');
    }
    function isCivil(goods, rec) { return goods && !rec.flagged && (rec.history_months || 0) >= CFG.civilMonths && (rec.complaints || 0) <= CFG.civilComplaints; }
    E.reportFraud = function (opId, what, gotGoods) {
      var op = opById(opId);
      if (op.kind !== 'transfer' || op.status !== 'EXECUTED') throw Blocked('BAD_STATE', 'Заявление подаётся по проведённому переводу.', 400);
      if (S.incidents.some(function (i) { return i.op_id === opId && i.status !== 'CLOSED'; })) throw Blocked('DUPLICATE', 'По этому переводу заявление уже подано.', 409);
      var hangUp = S.sim.call !== 'none';
      S.ward.outgoing_blocked = true; S.ward.cards_blocked = true; S.ward.credit_lock = true; S.ward.credit_lock_mode = 'full'; S.ward.sessions_reset++;
      var rec = S.recipients[op.recipient_id];
      var inc = { id: S.incidents.length + 1, op_id: op.id, amount: op.amount, recipient_id: op.recipient_id, recipient_name: op.recipient_name, recipient_bank: rec.bank, transfer_minute: op.created_at, created_at: S.now,
        what: what, got_goods: !!gotGoods, status: 'NEW', priority: 'medium', card: {}, feed: [], hold_started_at: null, hold_until: null, hold_max_until: null, reply_at: null, police_report_no: null, recipient_explained: false, outcome: null, frozen_at: null };
      setInc(inc, 'NEW');
      var loc = rec.money_location || (rec.bank === 'BCC' ? 'in_bcc' : 'other_bank');
      inc.priority = priorityFor(S.now - inc.transfer_minute, inc.amount, loc);
      inc.card = { transfer: { amount: inc.amount, recipient: inc.recipient_name, bank: inc.recipient_bank, minutes_ago: round(S.now - inc.transfer_minute, 1) }, device: op.device, score: op.score, zone: op.zone, reasons: op.reasons,
        recipient: { history_months: rec.history_months, complaints: rec.complaints || 0, flagged: !!rec.flagged, money_location: loc }, chain: rec.chain || [], what: WHAT[what] || what, got_goods: !!gotGoods };
      if (isCivil(!!gotGoods, rec)) setInc(inc, 'DISPUTE_CIVIL', 'Вы получили товар, а у получателя долгая история без жалоб. Банк не может вернуть деньги по желанию одной стороны: это гражданский спор. Направьте продавцу письменную претензию; если он не ответит, обратитесь в органы по защите прав потребителей или в суд.');
      else setInc(inc, 'TRIAGED');
      incLog(inc, 'Автозащита: исходящие переводы и карты заблокированы, сессии на других устройствах сброшены, кредитный замок включён.');
      S.incidents.push(inc); notify(S.ward.name + ' подал заявление о спорной операции на ' + fmtKzt(op.amount) + '.');
      aAppend(S.now, 'ward', 'incident_opened', { incident: inc.id, op: op.id, status: inc.status });
      return { incident: inc.id, status: inc.status, hang_up: hangUp };
    };
    E.incidentAction = function (id, action, police) {
      var inc = null; S.incidents.forEach(function (i) { if (i.id === id) inc = i; }); if (!inc) throw Blocked('NOT_FOUND', 'Заявление не найдено.', 404);
      var before = inc.status;
      if (action === 'freeze') {
        if (inc.status !== 'TRIAGED') throw Blocked('BAD_STATE', 'Удержание можно запросить только для заявления в очереди.');
        if (inc.recipient_bank === 'BCC') hold(inc, 'Средства удержаны на счёте получателя в BCC.');
        else { inc.reply_at = S.now + CFG.antifraud; setInc(inc, 'FREEZE_REQUESTED'); }
      } else if (action === 'extend') {
        if (inc.status !== 'HELD') throw Blocked('BAD_STATE', 'Продлить можно только действующее удержание.');
        if (!police) throw Blocked('POLICE_REPORT_REQUIRED', 'Для продления нужен номер заявления в полиции.', 400);
        if (inc.hold_until >= inc.hold_max_until) throw Blocked('HOLD_LIMIT', 'Достигнут предельный срок удержания (R0.7).');
        inc.police_report_no = police; inc.hold_until = Math.min(inc.hold_until + CFG.holdInit, inc.hold_max_until); incLog(inc, 'Удержание продлено по заявлению в полицию № ' + police + '.');
      } else if (action === 'explained') {
        if (inc.status !== 'HELD' && inc.status !== 'FREEZE_REQUESTED') throw Blocked('BAD_STATE', 'Пояснения принимаются при действующем удержании.');
        inc.recipient_explained = true; incLog(inc, 'Получатель уведомлён о причинах и дал пояснения. Решение за оператором.');
      } else if (action === 'return') {
        if (inc.status !== 'HELD') throw Blocked('BAD_STATE', 'Вернуть можно только удержанные средства.');
        inc.outcome = 'returned'; setInc(inc, 'RETURNED');
      } else if (action === 'release') {
        if (inc.status !== 'HELD') throw Blocked('BAD_STATE', 'Снять можно только действующее удержание.');
        inc.outcome = 'released'; setInc(inc, 'RELEASED');
      } else if (action === 'close') {
        if (['RETURNED', 'RELEASED', 'EXPIRED', 'DISPUTE_CIVIL'].indexOf(inc.status) < 0) throw Blocked('BAD_STATE', 'Закрыть можно после решения по удержанию.');
        if (inc.outcome == null) inc.outcome = inc.status === 'DISPUTE_CIVIL' ? 'civil' : 'not_returned';
        setInc(inc, 'CLOSED', 'Заявление закрыто. Итог: ' + OUTCOME[inc.outcome] + '.');
      } else throw Blocked('BAD_ACTION', 'Неизвестное действие ' + action + '.', 400);
      if (inc.status === 'RETURNED' && before !== 'RETURNED') { S.ward.balance += inc.amount; S.history.push({ title: 'Возврат по заявлению № ' + inc.id, amount: inc.amount, minute: S.now, kind: 'in' }); }
      if (action === 'close' && inc.outcome !== 'civil') { S.recipients[inc.recipient_id].flagged = true; incLog(inc, 'Получатель внесён в базу подозрительных счетов банка.'); }
      aAppend(S.now, 'operator', 'incident_' + action, { incident: inc.id, from: before, to: inc.status });
      return { status: inc.status };
    };
    E.unblockClient = function () { S.ward.outgoing_blocked = false; S.ward.cards_blocked = false; aAppend(S.now, 'operator', 'client_unblocked', {}); };
    function policeStatement(inc) {
      return 'Начальнику отдела полиции\nот ' + S.ward.name + '\n\nЗАЯВЛЕНИЕ\n\nПрошу принять меры в связи с операцией, совершённой под влиянием обмана. Обстоятельства: ' + (WHAT[inc.what] || inc.what).toLowerCase() +
        '. Перевод на сумму ' + fmtKzt(inc.amount) + ' получателю «' + inc.recipient_name + '» (' + inc.recipient_bank + '). Банк зарегистрировал заявление о спорной операции № ' + inc.id + '.\n\nДата, подпись';
    }

    // ---- статистика и представления ----
    E.stats = function () {
      var tr = S.ops.filter(function (o) { return o.kind === 'transfer'; }), heldEver = S.ops.filter(function (o) { return o.hold_deadline != null; }), heldDone = heldEver.filter(function (o) { return o.status !== 'HELD'; });
      var falseD = heldDone.filter(function (o) { return o.status === 'EXECUTED'; }), fr = S.incidents.filter(function (i) { return i.frozen_at != null; }).map(function (i) { return i.frozen_at - i.transfer_minute; });
      var st = function (s) { return S.ops.filter(function (o) { return o.status === s; }).length; };
      return { synthetic: true, attempts: S.counters.attempts, transfers: tr.length, executed: st('EXECUTED'), held_now: st('HELD'), stopped: st('REJECTED'), expired: st('EXPIRED'),
        saved_amount: S.ops.filter(function (o) { return o.status === 'REJECTED' && o.kind === 'transfer'; }).reduce(function (a, o) { return a + o.amount; }, 0),
        call_blocks: S.counters.call_blocks, remote_blocks: S.counters.remote_blocks, credit_lock_blocks: S.counters.credit_lock_blocks,
        false_delay_share: heldDone.length ? round(falseD.length / heldDone.length, 2) : null,
        time_to_freeze_minutes: fr.length ? round(fr.reduce(function (a, b) { return a + b; }, 0) / fr.length, 1) : null, incidents: S.incidents.length };
    };
    function gname(role) { var k = S.ward.guardians[role]; return k ? pname(k) : null; }
    function brief(op) { return { id: op.id, kind: op.kind, amount: op.amount, recipient: op.recipient_name, status: op.status, zone: op.zone, score: op.score, decided_by: ACTOR[op.decided_by] || op.decided_by, by: op.decided_by, created_at: op.created_at, decided_at: op.decided_at, pressure: !!op.pressure, limit_only: !!op.limit_only }; }
    E.brief = brief;
    // Что будет дальше с операцией на паузе: показываем пожилому ход ожидания, а не просто «подождите».
    function nextStep(op) {
      var g = S.ward.guardians, rel = S.now - op.created_at;
      if (op.notified.operator != null || op.notified.assistant != null) return { who: 'bank_now', in: 0 };
      if (g.second && op.notified.second == null && !op.appeal && !op.limit_only) return { who: 'second', in: Math.max(0, Math.ceil(CFG.second - rel)) };
      if (op.zone === 'red') return { who: 'bank', in: Math.max(0, Math.ceil(operatorDue(op) - S.now)) };
      var start = op.limit_only ? (op.request ? op.request.at : null) : op.created_at;
      return start == null ? { who: 'none', in: 0 } : { who: 'assistant', in: Math.max(0, Math.ceil(start + CFG.assistantAfter - S.now)) };
    }
    function viewWard() {
      var w = S.ward, pending = [];
      S.ops.forEach(function (op) {
        if (op.status === 'HELD') pending.push({ id: op.id, kind: op.kind, amount: op.amount, recipient: op.recipient_name, zone: op.zone,
          new_recipient: op.reasons.some(function (r) { return r.code === 'new_recipient'; }), call_reason: op.reasons.some(function (r) { return r.code === 'call_unknown'; }),
          appeal: !!op.appeal, operator_connected: op.notified.operator != null || op.notified.assistant != null, staff_called: op.notified.operator != null, guardian_acc: w.guardians.guardian ? S.people[w.guardians.guardian].acc : null, guardian_first: w.guardians.guardian ? S.people[w.guardians.guardian].name : null, guardian_dat: w.guardians.guardian ? S.people[w.guardians.guardian].dat : null, minutes: round(S.now - op.created_at, 1),
          own_reasons: op.reasons.filter(function (r) { return OWN_REASONS.indexOf(r.code) >= 0; }).map(function (r) { return r.text; }),
          second_asked: op.notified.second != null, has_second: !!w.guardians.second, limit_only: !!op.limit_only, limit: op.limit || null, request: op.request ? { status: op.request.status, who: pname(op.request.key), dat: S.people[op.request.key] ? S.people[op.request.key].dat : '' } : null, has_trusted: !!(w.guardians.guardian || w.guardians.second), second_dat: w.guardians.second ? S.people[w.guardians.second].dat : null, elapsed: round(S.now - op.created_at, 1), next: nextStep(op), verification: op.verification ? op.verification.status : null, approvals: Object.keys(op.approvals).length, needs_two: op.zone === 'red' });
      });
      var last = S.ops.length ? S.ops[S.ops.length - 1] : null;
      return { name: w.name, balance: w.balance, protection_on: w.protection_on, credit_lock: w.credit_lock, credit_lock_mode: w.credit_lock_mode, limits: w.limits, spent_today: spentToday(), spent_month: spentMonth(),
        favorites: S.favorites.map(function (f) { var r = S.recipients[f.recipient_id]; return { id: f.id, title: f.title, amount: f.amount, icon: f.icon, recipient_id: f.recipient_id, recipient: r ? r.name : '', whitelisted: w.whitelist.indexOf(f.recipient_id) >= 0 }; }), outgoing_blocked: w.outgoing_blocked, cards_blocked: w.cards_blocked, consent: w.consent,
        guardians: { guardian: gname('guardian'), second: gname('second') }, guardian_keys: w.guardians, whitelist: w.whitelist,
        trusted: trustedKeys().map(function (k) { var p = S.people[k]; return { key: k, name: p.name, relation: p.relation, role: k === w.guardians.guardian ? 'guardian' : 'second',
          removing: !!pendingTrusted('trusted_remove', k) }; }),
        recipients: Object.keys(S.recipients).filter(function (k) { return ['receiver_bcc', 'seller', 'pharmacy', 'mobile'].indexOf(k) < 0; }).map(function (k) { var v = S.recipients[k]; return { id: k, name: v.name, whitelisted: w.whitelist.indexOf(k) >= 0, known: v.known, card: !!v.card, bank: v.bank, flagged: !!v.flagged, complaints: v.complaints || 0, history_months: v.history_months, senders_7d: v.senders_7d || 0 }; }),
        history: S.history.slice().sort(function (a, b) { return b.minute - a.minute; }).slice(0, 12),
        cases: S.cases.map(caseView), epoch: S.epoch, safe_mode: w.safe_mode, devices: w.devices, code_changed_at: w.code_changed_at,
        appealable: S.ops.filter(function (o) { return o.status === 'REJECTED' && (o.decided_by === 'guardian' || o.decided_by === 'second') && !o.appealed && S.now - o.decided_at < CFG.day; }).map(function (o) { return { id: o.id, kind: o.kind, amount: o.amount, recipient: o.recipient_name, by: ACTOR[o.decided_by], by_name: pname(S.ward.guardians[o.decided_by] || '') }; }),
        trusted_log: S.trusted_log.slice(-8).reverse(), complaints: S.complaints.filter(function (c) { return c.source === 'ward'; }).map(function (c) { return { id: c.id, who: c.who, status: c.status }; }),
        consent_until_months: w.consent.valid_months,
        reportable: S.ops.filter(function (o) { return o.kind === 'transfer' && o.status === 'EXECUTED'; }).reverse().slice(0, 5).map(function (o) { return { id: o.id, recipient: o.recipient_name, amount: o.amount, minutes_ago: Math.round(S.now - o.created_at) }; }),
        pending: pending, last: last ? brief(last) : null, recent_ops: S.ops.slice(-12).map(brief),
        disable_requests: S.disable_requests.filter(function (r) { return r.status === 'pending'; }).map(function (r) { return Object.assign({}, r, { text: reqText(r), left: round(Math.max(0, r.effective_at - S.now), 1) }); }),
        incidents: S.incidents.map(function (i) { return { id: i.id, status: i.status, status_text: STATUS_TEXT[i.status], amount: i.amount, recipient: i.recipient_name, feed: i.feed, outcome: i.outcome ? OUTCOME[i.outcome] : null, statement: i.status !== 'DISPUTE_CIVIL' ? policeStatement(i) : null }; }) };
    }
    function viewTrusted(role) {
      var reqs = [];
      S.ops.forEach(function (op) {
        if (op.notified[role] == null) return;
        var other = role === 'guardian' ? 'second' : 'guardian';
        // Доверенный видит минимум: сумму, имя получателя без номера и причину, которая касается самого клиента.
        reqs.push({ id: op.id, kind: op.kind, amount: op.amount, recipient: String(op.recipient_name).replace(/\s*••\d+/g, '').trim(), zone: op.zone, reasons: op.reasons.filter(function (r) { return r.points >= 0 && OWN_REASONS.indexOf(r.code) >= 0; }).map(function (r) { return r.text; }), status: op.status,
          appeal: !!op.appeal, decided_by_me: op.decided_by === role, limit: op.limit || null, closed_by_client: op.decided_by === 'ward', pressure: !!op.pressure,
          can_act: op.status === 'HELD' && !op.appeal && op.approvals[role] == null, approved_by_me: op.approvals[role] != null, other_approved: op.approvals[other] != null, needs_second: op.zone === 'red', minutes: round(S.now - op.created_at, 1) });
      });
      return { role: role, name: gname(role), busy: S.busy[role] || false, ward_name: S.ward.name, requests: reqs.slice(-5), notifications: S.notifications.slice(-6) };
    }
    function viewOperator() {
      var queue = [];
      S.ops.forEach(function (op) {
        if (op.hold_deadline == null) return; var held = op.status === 'HELD', ap = {};
        Object.keys(op.approvals).forEach(function (a) { ap[ACTOR[a]] = op.approvals[a]; });
        queue.push({ id: op.id, kind: op.kind, amount: op.amount, recipient: op.recipient_name, zone: op.zone, score: op.score, reasons: op.reasons, device: op.device, status: op.status, my_turn: held && op.notified.operator != null, appeal: !!op.appeal,
          approvals: ap, operator_due: held ? round(operatorDue(op) - S.now, 1) : null, deadline_left: held ? round(op.hold_deadline - S.now, 1) : null, events: op.events.slice(-8), scoring_failed: op.scoring_failed, verification: op.verification || null });
      });
      var incs = S.incidents.map(function (i) {
        return { id: i.id, status: i.status, status_text: STATUS_TEXT[i.status], priority: i.priority, card: i.card, feed: i.feed, police_report_no: i.police_report_no, recipient_explained: i.recipient_explained,
          hold_left: i.status === 'HELD' ? round(i.hold_until - S.now, 1) : null, can_extend: i.status === 'HELD' && i.hold_until < i.hold_max_until, outcome: i.outcome ? OUTCOME[i.outcome] : null };
      });
      var comps = S.complaints.map(function (c) { return { id: c.id, who: c.who, source: c.source, text: c.text, want_remove: c.want_remove, status: c.status, minutes: round(S.now - c.created_at, 1), log: S.trusted_log.filter(function (l) { return l.key === c.key; }).slice(-5).map(function (l) { return l.text; }) }; }).reverse();
      return { queue: queue.reverse().slice(0, 8), incidents: incs.reverse(), complaints: comps, cases: S.cases.map(caseView).reverse(), epoch: S.epoch, safe_mode: S.ward.safe_mode, client: { outgoing_blocked: S.ward.outgoing_blocked, cards_blocked: S.ward.cards_blocked } };
    }
    function viewBank() {
      var recent = S.ops.slice().reverse().slice(0, 6).map(function (o) { return { id: o.id, kind: o.kind, amount: o.amount, recipient: o.recipient_name, score: o.score, zone: o.zone, status: o.status, reasons: o.reasons }; });
      var tail = audit.slice(-25).reverse().map(function (a) { return { id: a.id, minute: a.minute, actor: a.actor, action: a.action, hash: a.hash }; });
      return { stats: E.stats(), recent: recent, audit: tail, audit_verify: aVerify() };
    }
    function viewDemo() {
      var s = SCENARIOS[S.scenario], titles = {}; Object.keys(SCENARIOS).forEach(function (k) { titles[k] = SCENARIOS[k].title; });
      return { now: round(S.now, 2), scenario: S.scenario, title: s.title, hint: s.hint, form: s.form, busy: S.busy,
        sim: { call: displayCall(), night: S.sim.night, new_device: S.sim.new_device, remote_access: S.sim.remote_access, codes: S.sim.codes }, scenarios: titles };
    }
    E.fullState = function () { return { ward: viewWard(), guardian: viewTrusted('guardian'), second: viewTrusted('second'), operator: viewOperator(), bank: viewBank(), demo: viewDemo() }; };
    E.raw = function () { return S; };
    // Сохранение демо между запусками: состояние — обычные данные, их можно записать и прочитать как JSON.
    E.snapshot = function () { return JSON.stringify(S); };
    E.restore = function (json) {
      var o = JSON.parse(json);
      if (!o || !o.ward || !Array.isArray(o.ops) || !o.recipients || !SCENARIOS[o.scenario] || !Array.isArray(o.favorites)) throw new Error('bad snapshot');
      S = o; return true;
    };
    E.reset(1);
    return E;
  }

  var api = { luhnOk: luhnOk, create: create, score: score, CFG: CFG, sha256: sha256, fmtKzt: fmtKzt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KorganEngine = api;
})(typeof window !== 'undefined' ? window : this);
