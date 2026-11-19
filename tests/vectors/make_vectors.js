/* Генерирует общий набор тест-векторов из JS-движка. Python и JS проверяют себя по одному и тому же файлу.
   Запуск: node tests/vectors/make_vectors.js  → tests/vectors/vectors.json */
const K = require('../../standalone/parts/engine.js');
const fs = require('fs'), path = require('path');
// Скоринг: только сигналы, которые есть в обоих движках (кредитные сигналы и коды входа есть только в JS).
const sig = [
  ['коммуналка из белого списка', { amount: 3500, whitelisted: true }],
  ['знакомому, обычная сумма', { amount: 20000 }],
  ['новый получатель, обычная сумма', { amount: 50000, new_recipient: true }],
  ['новый получатель, крупная', { amount: 120000, new_recipient: true }],
  ['звонок мошенника + новый + огромная', { amount: 480000, new_recipient: true, flagged_recipient: true, call: 'unknown' }],
  ['после звонка незнакомого, новый, крупная', { amount: 150000, new_recipient: true, call: 'unknown' }],
  ['крупная покупка с режимом покупки', { amount: 480000, new_recipient: true, big_purchase: true }],
  ['крупная покупка без режима', { amount: 480000, new_recipient: true }],
  ['ночь + новое устройство + новый', { amount: 30000, new_recipient: true, night: true, new_device: true }],
  ['звонок знакомого во время перевода внуку', { amount: 60000, whitelisted: true, call: 'known' }],
  ['подозрительный получатель без звонка', { amount: 90000, new_recipient: true, flagged_recipient: true }],
  ['ровно порог крупной суммы', { amount: 100000 }],
  ['ровно порог огромной суммы', { amount: 200000, new_recipient: true }],
  ['белый список не уводит в минус', { amount: 1000, whitelisted: true, big_purchase: true }]
].map(([name, s]) => { const r = K.score(Object.assign({ call: 'none' }, s)); return { name, signals: s, expected: { score: r.score, zone: r.zone, codes: r.reasons.map(x => x.code) } }; });
// Лестница: шаги и ожидаемые исходы. Действия: transfer, sim, advance_to, decide, expect.
const ladder = [
  { name: 'Средняя зона: доверенные лица молчат, самоподтверждения нет', scenario: 3, steps: [
    { do: 'busy', guardian: true, second: true }, { do: 'transfer', rid: 'repair', amount: 120000 },
    { expect: { zone: 'yellow', status: 'HELD', notified: ['guardian'] } }, { do: 'advance_to', minute: 5.5 }, { expect: { notified: ['guardian', 'second'] } },
    { do: 'advance_to', minute: 10.5 }, { expect: { not_notified: ['ward'] } },
    { do: 'decide', actor: 'ward', decision: 'approve', called: false, error: 'SELF_CONFIRM_UNAVAILABLE' },
    { expect: { status: 'HELD' } }] },  // что дальше: в JS — помощник банка, в старом Python-движке — сотрудник; это не общий вектор
  { name: 'Средняя зона: никто не решил — отмена по сроку', scenario: 3, steps: [
    { do: 'busy', guardian: true, second: true }, { do: 'transfer', rid: 'repair', amount: 120000 }, { do: 'advance_to', minute: 61 }, { expect: { status: 'EXPIRED' } }] },
  { name: 'Красная зона: нужны два подтверждения', scenario: 1, steps: [
    { do: 'sim', call: 'ended_unknown' }, { do: 'transfer', rid: 'stranger', amount: 480000 }, { expect: { zone: 'red', status: 'HELD' } },
    { do: 'decide', actor: 'guardian', decision: 'approve', result: 'waiting' }, { expect: { status: 'HELD', notified: ['guardian', 'second'] } },
    { do: 'decide', actor: 'second', decision: 'approve' }, { expect: { status: 'EXECUTED' } }] },
  { name: 'Красная зона: второй молчит — сотрудник через 5 минут после первого', scenario: 1, steps: [
    { do: 'sim', call: 'ended_unknown' }, { do: 'transfer', rid: 'stranger', amount: 480000 }, { do: 'advance_to', minute: 2 },
    { do: 'decide', actor: 'guardian', decision: 'approve' }, { do: 'advance_to', minute: 6.5 }, { expect: { not_notified: ['operator'] } },
    { do: 'advance_to', minute: 7.5 }, { expect: { notified: ['guardian', 'second', 'operator'] } }] },
  { name: 'Один отказ останавливает', scenario: 1, steps: [
    { do: 'sim', call: 'ended_unknown' }, { do: 'transfer', rid: 'stranger', amount: 480000 }, { do: 'decide', actor: 'guardian', decision: 'reject' }, { expect: { status: 'REJECTED' } }] },
  { name: 'Во время звонка перевод заблокирован (АРРФР)', scenario: 1, steps: [
    { do: 'sim', call: 'active_unknown' }, { do: 'transfer', rid: 'stranger', amount: 480000, error: 'CALL_ACTIVE' }] },
  { name: 'Белый список проходит сразу', scenario: 1, steps: [
    { do: 'transfer', rid: 'utility', amount: 3500 }, { expect: { status: 'EXECUTED', zone: 'green' } }] }
];
// Прогоняем лестницу на JS, чтобы файл заведомо соответствовал движку.
function runJS(v) {
  const e = K.create(); e.reset(v.scenario); let op = null;
  for (const s of v.steps) {
    if (s.expect) { const x = s.expect; if (x.zone && op.zone !== x.zone) throw v.name + ' zone ' + op.zone; if (x.status && op.status !== x.status) throw v.name + ' status ' + op.status;
      if (x.decided_by && op.decided_by !== x.decided_by) throw v.name + ' by'; (x.notified || []).forEach(a => { if (op.notified[a] == null) throw v.name + ' notified ' + a; }); (x.not_notified || []).forEach(a => { if (op.notified[a] != null) throw v.name + ' not ' + a; }); continue; }
    try {
      if (s.do === 'busy') e.setBusy({ guardian: s.guardian, second: s.second });
      if (s.do === 'sim') e.setSim({ call: s.call });
      if (s.do === 'transfer') op = e.createTransfer(s.rid, s.amount, !!s.big);
      if (s.do === 'advance_to') e.advanceTo(s.minute);
      if (s.do === 'decide') { const r = e.decide(op.id, s.actor, s.decision, s.called); if (s.result && r.result !== s.result) throw v.name + ' result'; }
      if (s.error) throw v.name + ' expected error ' + s.error;
    } catch (err) { if (!err.blocked) throw err; if (err.code !== s.error) throw v.name + ' error ' + err.code; }
  }
}
ladder.forEach(runJS);
const out = { about: 'Общие тест-векторы движков «Қорған»: JS (standalone/parts/engine.js) и Python (backend/). Один файл, два прогона.', scoring: sig, ladder };
fs.writeFileSync(path.join(__dirname, 'vectors.json'), JSON.stringify(out, null, 2) + '\n');
console.log('vectors:', sig.length, 'scoring,', ladder.length, 'ladder — JS ok');
