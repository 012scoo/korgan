/* Прогон синтетического потока операций через тот же движок, что в демо (parts/engine.js).
   Запуск: node simulate.js [число_честных] [число_мошеннических] [seed]
   Результат: таблица в консоли и файлы ../docs/synthetic-run.md и ../docs/synthetic-run.json.
   Важно: поток и поведение людей придуманы нами (допущения ниже). Это проверка того, как ведут себя
   наши правила, а не измерение реальной эффективности. Реальные цифры даст только пилот на данных банка. */
'use strict';
const K = require('./parts/engine.js');
const fs = require('fs');
const path = require('path');

const N_HONEST = Number(process.argv[2]) || 10000;
const N_FRAUD = Number(process.argv[3]) || 1000;
const SEED = Number(process.argv[4]) || 20261119;

// ---- детерминированный генератор случайных чисел ----
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const chance = p => rnd() < p;
const uni = (a, b) => a + (b - a) * rnd();
const amt = (a, b) => Math.round(uni(a, b) / 500) * 500;
function lognormal(median, sigma) { const u = Math.max(1e-9, rnd()), v = rnd(); const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); return median * Math.exp(sigma * z); }
function pick(weights) { let r = rnd() * weights.reduce((a, w) => a + w[1], 0); for (const w of weights) { r -= w[1]; if (r <= 0) return w[0]; } return weights[weights.length - 1][0]; }

// ---- допущения о людях (меняются здесь) ----
const A = {
  guardian_answers: 0.80,        // доля случаев, когда опекун вообще отвечает в течение часа
  guardian_median_min: 3,        // медиана времени ответа близкого, минут
  guardian_sigma: 0.9,           // разброс (логнормальное распределение)
  guardian_catches_fraud: 0.90,  // близкий позвонил и понял, что это обман
  client_reveals_to_assistant: 0.40, // жертва под диктовку всё же называет признак обмана помощнику
  operator_call_min: [2, 8],     // через сколько минут сотрудник дозвонился и решил
  operator_reaches_honest: 0.97, // сотрудник дозвонился до честного клиента до предельного срока
  operator_catches_fraud: 0.85,  // сотрудник распознал обман на звонке
  honest_calls_staff: 0.7,       // честный клиент сам зовёт сотрудника, если помощник не подтвердил
  victim_calls_staff: 0.2        // жертва под диктовку зовёт сотрудника (обычно мошенник отговаривает)
};

// ---- честные операции пожилого клиента (доли) ----
const HONEST = [
  ['utility', 30], ['grandson', 12], ['friend', 18], ['known_shop', 15], ['new_small', 12],
  ['new_large', 5], ['goods_credit', 4], ['cash_credit', 1], ['during_known_call', 3]
];
// ---- мошеннические схемы (доли) ----
const FRAUD = [
  ['safe_account_on_call', 30],   // переводит прямо во время звонка «из банка»
  ['coached_after_call', 30],     // «положите трубку и переведите»: звонок закончился 1–9 минут назад
  ['coached_waited', 15],         // мошенник велел подождать больше 10 минут после звонка
  ['cash_credit_after_call', 10], // кредит наличными сразу после звонка
  ['remote_access', 10],          // установили программу удалённого доступа
  ['flagged_card', 5]             // перевод на карту из базы подозрительных (инвестиции, «знакомый» из сети)
];

function setupEngine() {
  const e = K.create(); // сценарий 1: защита включена, белый список — коммуналка и внук, два доверенных
  const S = e.raw();
  S.ward.credit_lock = true; S.ward.credit_lock_mode = 'smart';
  S.ward.balance = 5e7; // чтобы сумма не упиралась в баланс
  S.recipients.friend = { name: 'Сосед Ерлан', bank: 'BCC', known: true, flagged: false, history_months: 60, complaints: 0 };
  S.recipients.known_shop = { name: 'Аптека', bank: 'Другой банк', known: true, flagged: false, history_months: 80, complaints: 0 };
  return e;
}
function luhnCard(prefix) { let d = prefix; while (d.length < 15) d += Math.floor(rnd() * 10); for (let c = 0; c < 10; c++) if (K.luhnOk(d + c)) return d + c; }

// Создаёт операцию. Возвращает { op } или { blocked: code }.
function makeOp(e, kind, fraud) {
  const sim = { call: 'none', night: chance(0.05), new_device: chance(0.02), remote_access: false, codes: chance(0.02) };
  let create;
  if (!fraud) {
    if (chance(0.10)) sim.call = 'ended_known';
    switch (kind) {
      case 'utility': create = () => e.createTransfer('utility', amt(2000, 15000), false); break;
      case 'grandson': create = () => e.createTransfer('grandson', amt(5000, 100000), false); break;
      case 'friend': create = () => e.createTransfer('friend', amt(5000, 60000), false); break;
      case 'known_shop': create = () => e.createTransfer('known_shop', amt(3000, 40000), false); break;
      case 'new_small': { const c = e.addCardRecipient(luhnCard('4400'), 'Мастер'); create = () => e.createTransfer(c.id, amt(5000, 60000), false); break; }
      case 'new_large': create = () => e.createTransfer(chance(0.5) ? 'shop' : 'repair', amt(100000, 500000), chance(0.5)); break;
      case 'goods_credit': create = () => e.createCredit(amt(50000, 400000), 'goods'); break;
      case 'cash_credit': create = () => e.createCredit(amt(100000, 500000), 'cash'); break;
      case 'during_known_call': sim.call = 'active_known'; create = () => e.createTransfer('friend', amt(5000, 60000), false); break;
    }
  } else {
    sim.night = chance(0.10); sim.codes = chance(0.15);
    const stranger = () => e.addCardRecipient(luhnCard('5169'), 'Получатель').id;
    switch (kind) {
      case 'safe_account_on_call': sim.call = 'active_unknown'; create = () => e.createTransfer(stranger(), amt(200000, 1500000), false); break;
      case 'coached_after_call': sim.call = 'ended_unknown'; create = () => e.createTransfer(stranger(), amt(150000, 1500000), false); break;
      case 'coached_waited': create = () => e.createTransfer(stranger(), amt(150000, 1500000), false); break;
      case 'cash_credit_after_call': sim.call = 'ended_unknown'; create = () => e.createCredit(amt(300000, 2000000), 'cash'); break;
      case 'remote_access': sim.remote_access = true; create = () => e.createTransfer(stranger(), amt(100000, 1000000), false); break;
      case 'flagged_card': { const id = e.addCardRecipient('5269880077314821', 'Инвест').id; create = () => e.createTransfer(id, amt(50000, 150000), false); break; }
    }
  }
  e.setSim(sim);
  try { return { op: create() }; } catch (err) { if (err.blocked) return { blocked: err.code }; throw err; }
}

// Проигрывает поведение людей до решения или предельного срока.
function play(e, op, fraud) {
  const t0 = e.raw().now, plan = {};
  const respond = role => {
    if (plan[role]) return plan[role];
    plan[role] = chance(A.guardian_answers) ? { at: null, rt: Math.min(70, lognormal(A.guardian_median_min, A.guardian_sigma)), approve: fraud ? !chance(A.guardian_catches_fraud) : true } : { never: true };
    return plan[role];
  };
  let opPlan = null;
  for (let step = 0; step < 400 && op.status === 'HELD'; step++) {
    const now = e.raw().now;
    for (const role of ['guardian', 'second']) {
      if (op.notified[role] == null || op.appeal) continue;
      const p = respond(role);
      if (p.never || p.done) continue;
      if (p.at == null) p.at = op.notified[role] + p.rt;
      if (now >= p.at) { p.done = true; try { e.decide(op.id, role, p.approve ? 'approve' : 'reject'); } catch (x) { if (!x.blocked) throw x; } if (op.status !== 'HELD') break; }
    }
    if (op.status !== 'HELD') break;
    // Помощник банка (средняя зона): опрашивает клиента, обычную операцию подтверждает сам.
    if (op.notified.assistant != null && !op.verification && op.notified.operator == null) {
      if (now >= op.notified.assistant + 1) {
        const reveal = fraud && chance(A.client_reveals_to_assistant);
        const v = e.verify(op.id, reveal ? { call: 'yes', purpose: 'safe_account', code: 'no', pressure: 'yes' } : { call: 'no', purpose: fraud ? 'family' : 'purchase', code: 'no', pressure: 'no' });
        if (op.status !== 'HELD') break;
        if (v.status === 'needs_operator' && chance(fraud ? A.victim_calls_staff : A.honest_calls_staff)) e.callStaff(op.id);
      }
    }
    if (op.notified.operator != null) {
      if (!opPlan) {
        opPlan = { verifyAt: op.notified.operator + 1, decideAt: op.notified.operator + uni(A.operator_call_min[0], A.operator_call_min[1]),
          reach: fraud ? true : chance(A.operator_reaches_honest), approve: fraud ? !chance(A.operator_catches_fraud) : true };
      }
      if (!op.verification && now >= opPlan.verifyAt) {
        const reveal = fraud && chance(A.client_reveals_to_assistant);
        e.verify(op.id, reveal ? { call: 'yes', purpose: 'safe_account', code: 'no', pressure: 'yes' } : { call: 'no', purpose: fraud ? 'family' : 'purchase', code: 'no', pressure: 'no' });
        if (op.status !== 'HELD') break;
      }
      if (opPlan.reach && now >= opPlan.decideAt) { e.decide(op.id, 'operator', opPlan.approve ? 'approve' : 'reject'); break; }
    }
    e.advance(0.25);
  }
  return { status: op.status, by: op.decided_by, delay: op.decided_at != null ? op.decided_at - t0 : null, operator: op.notified.operator != null, zone: op.zone };
}

function quant(arr, q) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; }
const r1 = x => x == null ? '—' : (Math.round(x * 10) / 10).toString().replace('.', ',');
const pct = (a, b) => b ? (Math.round(a / b * 1000) / 10).toString().replace('.', ',') + '%' : '—';

function run(n, fraud) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const kind = pick(fraud ? FRAUD : HONEST), e = setupEngine(), m = makeOp(e, kind, fraud);
    if (m.blocked) { out.push({ kind, blocked: m.blocked, status: 'BLOCKED' }); continue; }
    const op = m.op;
    if (op.status === 'EXECUTED' && op.hold_deadline == null) { out.push({ kind, status: 'EXECUTED', instant: true, zone: op.zone }); continue; }
    const r = play(e, op, fraud); r.kind = kind; r.paused = true; out.push(r);
  }
  return out;
}

const H = run(N_HONEST, false), F = run(N_FRAUD, true);
const hPaused = H.filter(x => x.paused), hBlocked = H.filter(x => x.status === 'BLOCKED');
const hPausedDone = hPaused.filter(x => x.status === 'EXECUTED'), delays = hPausedDone.map(x => x.delay);
const hLost = hPaused.filter(x => x.status !== 'EXECUTED');
const fStopped = F.filter(x => x.status !== 'EXECUTED'), fLost = F.filter(x => x.status === 'EXECUTED');
const opLoad = H.filter(x => x.operator).length + F.filter(x => x.operator).length;

const rows = [
  ['Честных операций', N_HONEST.toLocaleString('ru-RU'), ''],
  ['Прошли сразу, без паузы', pct(H.filter(x => x.instant).length, N_HONEST), 'зелёная зона'],
  ['Ложные срабатывания: честная операция на паузе', pct(hPaused.length, N_HONEST), hPaused.length + ' операций'],
  ['Честная операция заблокирована на время звонка', pct(hBlocked.length, N_HONEST), 'требование АРРФР; повторить после звонка'],
  ['Медианная задержка честной операции на паузе', r1(quant(delays, 0.5)) + ' мин', ''],
  ['90-й перцентиль задержки', r1(quant(delays, 0.9)) + ' мин', ''],
  ['Максимальная задержка', r1(quant(delays, 1)) + ' мин', ''],
  ['Честная операция на паузе не прошла (отменена по сроку)', pct(hLost.length, N_HONEST), hLost.length + ' операций'],
  ['Мошеннических операций', N_FRAUD.toLocaleString('ru-RU'), ''],
  ['Остановлено до списания', pct(fStopped.length, N_FRAUD), ''],
  ['Прошло (потери)', pct(fLost.length, N_FRAUD), fLost.length + ' операций'],
  ['Дошло до сотрудника банка', pct(opLoad, N_HONEST + N_FRAUD), opLoad + ' операций из ' + (N_HONEST + N_FRAUD)]
];
const byFraud = FRAUD.map(([k]) => { const g = F.filter(x => x.kind === k); return [k, g.length, pct(g.filter(x => x.status !== 'EXECUTED').length, g.length)]; });
const FR_NAME = { safe_account_on_call: 'Перевод во время звонка «из банка»', coached_after_call: '«Положите трубку и переведите» (звонок 1–9 мин назад)', coached_waited: 'Ждал больше 10 минут после звонка', cash_credit_after_call: 'Кредит наличными сразу после звонка', remote_access: 'Удалённый доступ', flagged_card: 'Карта из базы подозрительных, без звонка' };
const byDecider = {}; hPausedDone.forEach(x => { byDecider[x.by] = (byDecider[x.by] || 0) + 1; });
const DEC = { guardian: 'доверенное лицо', second: 'второе доверенное лицо', operator: 'сотрудник банка', assistant: 'помощник банка' };

console.log('\nПрогон синтетического потока (seed ' + SEED + ')\n');
rows.forEach(r => console.log(r[0].padEnd(58) + String(r[1]).padStart(10) + '  ' + r[2]));
console.log('\nПо схемам мошенничества:'); byFraud.forEach(r => console.log('  ' + FR_NAME[r[0]].padEnd(56) + String(r[1]).padStart(5) + '  остановлено ' + r[2]));
console.log('\nКто подтвердил честные операции на паузе:', Object.keys(byDecider).map(k => (DEC[k] || k) + ' ' + pct(byDecider[k], hPausedDone.length)).join(', '));

const md = `# Прогон синтетического потока операций

Сгенерировано скриптом \`standalone/simulate.js\` (seed ${SEED}). Каждая операция прогоняется через тот же движок \`standalone/parts/engine.js\`, что работает в демо.

**Ограничение.** Поток операций и поведение людей придуманы нами. Таблица показывает, как ведут себя наши правила при этих допущениях, а не реальную эффективность. Реальные цифры даст только пилот на обезличенных данных банка.

## Итог

| Показатель | Значение | Комментарий |
|---|---|---|
${rows.map(r => '| ' + r.join(' | ') + ' |').join('\n')}

## По схемам мошенничества

| Схема | Операций | Остановлено |
|---|---|---|
${byFraud.map(r => '| ' + FR_NAME[r[0]] + ' | ' + r[1] + ' | ' + r[2] + ' |').join('\n')}

Кто подтвердил честные операции на паузе: ${Object.keys(byDecider).map(k => (DEC[k] || k) + ' ' + pct(byDecider[k], hPausedDone.length)).join(', ')}.

## Допущения

Честные операции пожилого клиента: коммуналка (белый список) 30%, внуку (белый список) 12%, знакомому 18%, в знакомый магазин 15%, новому получателю до 60 000 ₸ 12%, крупная покупка у нового продавца 100–500 тыс. ₸ 5%, рассрочка на товар 4%, кредит наличными 1%, перевод во время разговора со знакомым 3%. Ночь 5%, новое устройство 2%, недавние коды входа 2%, недавний звонок знакомого 10%.

Мошеннические схемы: ${FRAUD.map(f => FR_NAME[f[0]] + ' ' + f[1] + '%').join('; ')}.

| Параметр поведения | Значение |
|---|---|
| Близкий вообще отвечает в течение часа | ${A.guardian_answers * 100}% |
| Медиана времени ответа близкого | ${A.guardian_median_min} мин (логнормальное, σ = ${A.guardian_sigma}) |
| Близкий распознаёт обман после звонка родителю | ${A.guardian_catches_fraud * 100}% |
| Жертва называет помощнику признак обмана | ${A.client_reveals_to_assistant * 100}% |
| Сотрудник банка дозванивается и решает | через ${A.operator_call_min[0]}–${A.operator_call_min[1]} мин |
| Сотрудник дозвонился до честного клиента до предельного срока | ${A.operator_reaches_honest * 100}% |
| Сотрудник распознаёт обман на звонке | ${A.operator_catches_fraud * 100}% |

Правила те же, что в демо: пауза от 30 баллов, два подтверждения от 70, второе доверенное лицо через 5 минут. Средняя зона: через 15 минут помощник банка опрашивает клиента и сам подтверждает обычную операцию до 500 000 ₸ без опасных сигналов; сотрудника клиент зовёт сам (честный — в 70% случаев, жертва под диктовку — в 20%). Красная зона: сотрудник банка через 15 минут. Предельный срок 60 минут. Лимиты по умолчанию: 1 500 000 ₸ в месяц, дневной лимит выключен (клиент включает его сам).
`;
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'synthetic-run.md'), md);
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'synthetic-run.json'), JSON.stringify({ seed: SEED, assumptions: A, rows, by_fraud: byFraud, by_decider: byDecider }, null, 2));
console.log('\nЗаписано: docs/synthetic-run.md');
