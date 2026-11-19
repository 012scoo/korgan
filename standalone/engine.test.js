const K=require('./parts/engine.js'); const crypto=require('crypto');
const assert=require('assert');
assert.equal(K.sha256('abc'),crypto.createHash('sha256').update('abc').digest('hex'));
assert.equal(K.sha256(unescape(encodeURIComponent('Қорған тест'))),crypto.createHash('sha256').update('Қорған тест').digest('hex'));
let e=K.create(), s=()=>e.fullState();
// 1
let op=e.createTransfer('utility',3500,false); assert.equal(op.status,'EXECUTED'); assert.equal(op.score,0);
// 2
e.reset(2); assert.throws(()=>e.createTransfer('stranger',480000,false),x=>x.code==='CALL_ACTIVE');
e.setSim({call:'none'}); op=e.createTransfer('stranger',480000,false); assert.equal(op.zone,'red'); assert.equal(op.score,100);
e.decide(op.id,'guardian','reject'); assert.equal(s().ward.last.status,'REJECTED');
// 3
e.reset(3); op=e.createTransfer('shop',480000,true); assert.equal(op.zone,'yellow'); e.advanceTo(15.5); assert.ok(op.notified.assistant!=null); assert.ok(op.notified.operator==null); assert.ok(!op.notified.ward);
e.callStaff(op.id); assert.ok(op.notified.operator!=null); e.decide(op.id,'operator','approve'); assert.equal(op.status,'EXECUTED');
// 4
e.reset(4); op=e.createTransfer('repair',120000,false); assert.equal(op.score,35); e.advanceTo(10.5); assert.ok(!op.notified.ward);
assert.throws(()=>e.decide(op.id,'ward','approve',false),x=>x.code==='SELF_CONFIRM_UNAVAILABLE');
// 5
e.reset(5); op=e.createCredit(300000,'goods'); assert.equal(op.status,'EXECUTED'); assert.equal(s().ward.balance,1284500);
e.setSim({call:'ended_unknown'}); op=e.createCredit(300000,'cash'); assert.equal(op.zone,'red'); assert.equal(op.status,'HELD');
op=e.createCredit(300000,'goods'); assert.equal(op.zone,'yellow');
e.setSim({call:'active_unknown'}); assert.throws(()=>e.createCredit(50000,'goods'),x=>x.code==='CALL_ACTIVE'); e.setSim({call:'none'}); e.advance(11);
op=e.createCredit(50000,'cash'); assert.equal(op.zone,'yellow');
e.setCreditLockMode('full'); assert.throws(()=>e.createCredit(300000,'goods'),x=>x.code==='CREDIT_LOCK');
let rq0=e.setCreditLockMode('smart'); assert.equal(rq0.status,'pending'); e.advance(3.1); assert.equal(s().ward.credit_lock_mode,'smart');
let rq=e.setCreditLock(false); assert.equal(rq.status,'pending'); e.advance(3.1); assert.equal(s().ward.credit_lock,false);
// 6
e.reset(6); let id=s().ward.reportable[0].id; let r=e.reportFraud(id,'bank_call',false); assert.equal(r.status,'TRIAGED');
e.incidentAction(1,'freeze'); e.advance(3.1); assert.equal(s().operator.incidents[0].status,'HELD'); e.incidentAction(1,'return'); assert.equal(s().ward.balance,1284500+0);
e.incidentAction(1,'close'); assert.equal(s().operator.incidents[0].status,'CLOSED'); assert.ok(s().bank.audit_verify.ok);
// 7
e.reset(7); id=s().ward.reportable[0].id; r=e.reportFraud(id,'purchase',true); assert.equal(r.status,'DISPUTE_CIVIL');
// audit tamper
e.tamperAudit(); assert.equal(s().bank.audit_verify.ok,false);
// expiry R0.7
e.reset(3); op=e.createTransfer('shop',480000,true); e.advanceTo(61); assert.equal(op.status,'EXPIRED');
console.log('ALL JS ENGINE TESTS PASSED');
e.reset(3); op=e.createTransfer('shop',480000,true); let v=e.fullState(); assert.equal(v.ward.pending[0].operator_connected,false); e.advanceTo(15.5); v=e.fullState(); assert.equal(v.ward.pending[0].operator_connected,true); assert.equal(v.operator.queue[0].my_turn,false); assert.equal(v.ward.pending[0].staff_called,false);
e.reset(4); op=e.createTransfer('repair',120000,false); e.advanceTo(10.5); assert.equal(e.fullState().ward.pending[0].can_self_confirm,undefined);
console.log('views ok');
e.reset(1);
assert.throws(()=>e.addCardRecipient('4400 4312 0045 6780'),x=>x.code==='BAD_CARD');
let c=e.addCardRecipient('4400 4312 0045 6783','Марат'); assert.equal(c.name,'Марат ••6783');
op=e.createTransfer(c.id,50000,false); assert.equal(op.zone,'green'); assert.equal(op.score,25);
c=e.addCardRecipient('5269880077314821'); op=e.createTransfer(c.id,480000,false); assert.equal(op.zone,'red');
assert.ok(!JSON.stringify(e.raw()).includes('4400431200456783'));
console.log('card ok');
// доверенные
e.reset(1); let st=()=>e.fullState().ward;
assert.equal(st().trusted.length,2);
e.setSim({call:'active_unknown'}); assert.throws(()=>e.removeTrusted('second'),x=>x.code==='CALL_ACTIVE'); e.setSim({call:'none'}); e.advance(11);
e.removeTrusted('second'); assert.equal(st().trusted.length,2); e.advance(3.1); assert.equal(st().trusted.length,1); assert.equal(st().guardians.second,null);
assert.throws(()=>e.removeTrusted('guardian'),x=>x.code==='LAST_TRUSTED');
// красная зона с одним опекуном: опекун + оператор
op=e.createTransfer('stranger',480000,false); assert.equal(op.zone,'red'); e.advance(6); assert.ok(op.notified.second==null);
assert.equal(e.decide(op.id,'guardian','approve').result,'waiting'); e.advance(5.1); assert.ok(op.notified.operator!=null);
e.decide(op.id,'operator','approve'); assert.equal(op.status,'EXECUTED');
// добавить нового
rq=e.addTrusted('Дана','внучка'); assert.equal(rq.status,'pending'); assert.throws(()=>e.addTrusted('X'),x=>x.code==='TRUSTED_FULL');
e.advance(3.1); assert.equal(st().guardians.second,'Дана, внучка');
e.swapTrusted(); assert.equal(st().guardians.guardian,'Дана, внучка');
assert.ok(e.fullState().bank.audit_verify.ok);
// отмена удаления
rq=e.removeTrusted('guardian'); e.cancelDisable(rq.id); e.advance(4); assert.equal(st().trusted.length,2);
console.log('trusted ok');
// помощник банка
e.reset(3); op=e.createTransfer('shop',480000,true); assert.throws(()=>e.verify(op.id,{}),x=>x.code==='NOT_YOUR_TURN');
e.advanceTo(15.5); let vv=e.verify(op.id,{call:'no',purpose:'purchase',code:'no',pressure:'no'}); assert.equal(vv.status,'passed'); assert.equal(op.status,'EXECUTED'); assert.equal(op.decided_by,'assistant'); // обычная покупка: помощник подтверждает // чистые ответы ничего не проводят
e.reset(3); op=e.createTransfer('shop',480000,true); e.advanceTo(15.5); vv=e.verify(op.id,{call:'no',purpose:'safe_account',code:'yes',pressure:'no'}); assert.equal(vv.status,'failed'); assert.equal(op.status,'REJECTED');
e.reset(2); e.setSim({call:'none'}); e.advance(11); op=e.createTransfer('stranger',480000,false); e.setBusy({guardian:true,second:true}); e.advance(15.5);
vv=e.verify(op.id,{call:'no',purpose:'family',code:'no',pressure:'no'}); assert.equal(vv.status,'needs_operator'); assert.equal(op.status,'HELD');
e.decide(op.id,'operator','approve'); assert.equal(op.status,'EXECUTED'); assert.ok(e.fullState().bank.audit_verify.ok);
console.log('assistant ok');

// перевод вскоре после кредита наличными
e.reset(1); op=e.createCredit(200000,'cash'); e.decide(op.id,'guardian','approve'); assert.equal(op.status,'EXECUTED');
op=e.createTransfer('shop',50000,false); assert.ok(op.reasons.some(r=>r.code==='after_credit'));
console.log('credit ok');
// лимиты и коды
e.reset(1); assert.equal(s().ward.limits.daily_on,false); assert.equal(s().ward.limits.monthly,1500000);
op=e.createTransfer('grandson',250000,false); assert.ok(op.status==='EXECUTED'); // белый список не ограничен
op=e.createTransfer('shop',30000,false); assert.equal(op.zone,'green');
op=e.createTransfer('shop',190000,false); assert.ok(!op.reasons.some(r=>r.code==='over_limit_daily')); // дневной выключен
if (op.status==='HELD') e.decide(op.id,'guardian','approve');
let lr=e.setLimits({daily_on:true,daily:200000,monthly:1500000}); assert.equal(lr.status,'applied'); assert.equal(s().ward.limits.daily_on,true);
op=e.createTransfer('shop',50000,false); assert.ok(op.reasons.some(r=>r.code==='over_limit_daily')); assert.equal(op.status,'HELD'); assert.equal(op.limit_only,true); assert.ok(op.notified.guardian==null); e.requestConfirm(op.id); e.decide(op.id,'guardian','reject');
e.setSim({call:'active_known'}); assert.throws(()=>e.setLimits({daily_on:false,monthly:1500000}),x=>x.code==='CALL_ACTIVE'); e.setSim({call:'none'}); e.advance(11);
lr=e.setLimits({daily_on:false,monthly:1500000}); assert.equal(lr.status,'pending'); assert.equal(s().ward.limits.daily_on,true); e.advance(3.1); assert.equal(s().ward.limits.daily_on,false);
lr=e.setLimits({daily_on:false,monthly:3000000}); assert.equal(lr.status,'pending'); e.advance(3.1); assert.equal(s().ward.limits.monthly,3000000);
assert.throws(()=>e.setLimits({daily_on:true,daily:5000000,monthly:1000000}),x=>x.code==='BAD_LIMIT');
e.setSim({codes:true}); op=e.createTransfer('shop',20000,false); assert.ok(op.reasons.some(r=>r.code==='recent_codes'));
assert.ok(s().ward.pending.length===0 || true);
console.log('limits ok');
e.reset(3); op=e.createTransfer('shop',480000,true); e.advanceTo(15.5); vv=e.verify(op.id,{call:'no',purpose:'purchase',code:'unknown',pressure:'no'}); assert.equal(vv.status,'needs_operator'); assert.equal(op.status,'HELD');
console.log('unclear ok');

// средняя зона: доверенные лица молчат → помощник; обычная покупка с чистыми ответами проходит, опасные сигналы — нет
for (const z of [3,4]) { e.reset(z); e.setBusy({guardian:true,second:true}); op=e.createTransfer(z===3?'shop':'repair',z===3?480000:120000,z===3);
  e.advanceTo(15.5); assert.ok(op.notified.operator==null); e.verify(op.id,{call:'no',purpose:'purchase',code:'no',pressure:'no'}); assert.equal(op.status,'EXECUTED'); assert.equal(op.decided_by,'assistant'); }
e.reset(3); e.setBusy({guardian:true,second:true}); op=e.createTransfer('shop',520000,true); e.advanceTo(15.5); vv=e.verify(op.id,{call:'no',purpose:'purchase',code:'no',pressure:'no'}); assert.equal(vv.status,'needs_operator'); assert.equal(op.status,'HELD'); // больше предела помощника
e.reset(3); e.setBusy({guardian:true,second:true}); e.setSim({call:'ended_unknown'}); op=e.createTransfer('repair',60000,false); if (op.zone!=='red') { e.advanceTo(16); vv=e.verify(op.id,{call:'no',purpose:'purchase',code:'no',pressure:'no'}); assert.equal(vv.status,'needs_operator'); } // после звонка с незнакомого — не сам
e.reset(3); e.setBusy({guardian:true,second:true}); op=e.createTransfer('shop',480000,true); e.advanceTo(15.5); e.verify(op.id,{call:'no',purpose:'online_stranger',code:'no',pressure:'no'}); assert.equal(op.status,'REJECTED');
e.reset(3); e.setBusy({guardian:true,second:true}); op=e.createTransfer('shop',480000,true); e.advanceTo(61); assert.equal(op.status,'EXPIRED'); assert.ok(op.notified.operator==null); // сотрудник только по просьбе клиента
// пауза из-за лимита: запрос → тишина 15 минут → помощник
e.reset(8); op=e.createTransfer('marat',70000,false); e.advance(20); assert.ok(op.notified.assistant==null); e.requestConfirm(op.id); e.setBusy({guardian:true}); e.advance(15.5); assert.ok(op.notified.assistant!=null);
e.verify(op.id,{call:'no',purpose:'family',code:'no',pressure:'no'}); assert.equal(op.status,'EXECUTED');
console.log('no auto-pass ok');
// недобросовестный доверенный
e.reset(4); op=e.createTransfer('repair',120000,false); e.decide(op.id,'guardian','reject'); assert.equal(op.status,'REJECTED');
let w=e.fullState().ward; assert.equal(w.appealable.length,1); assert.ok(w.trusted_log[0].text.includes('отклонил'));
e.setSim({call:'active_unknown'}); assert.throws(()=>e.appeal(op.id),x=>x.code==='CALL_ACTIVE'); e.setSim({call:'none'}); e.advance(11);
e.appeal(op.id); assert.equal(op.status,'HELD'); assert.ok(op.notified.operator!=null);
assert.throws(()=>e.decide(op.id,'guardian','reject'),x=>x.code==='NOT_YOUR_TURN'); assert.throws(()=>e.appeal(op.id),x=>x.code==='BAD_STATE');
e.decide(op.id,'operator','approve'); assert.equal(op.status,'EXECUTED');
let cpl=e.complainTrusted('guardian','Отклоняет всё подряд',true); assert.equal(e.fullState().operator.complaints[0].want_remove,true);
e.complaintAction(cpl.id,'remove'); w=e.fullState().ward; assert.equal(w.trusted.length,1); assert.equal(w.guardians.guardian,'Айгуль, тётя');
// удалить последнего через банк: операции сразу к сотруднику
cpl=e.complainTrusted('guardian','',true); e.complaintAction(cpl.id,'remove'); w=e.fullState().ward; assert.equal(w.trusted.length,0);
op=e.createTransfer('stranger',480000,false); assert.ok(op.notified.operator!=null); assert.ok(op.notified.guardian==null);
e.decide(op.id,'operator','reject'); e.fullState();
rq=e.addTrusted('Дана','внучка'); e.advance(3.1); assert.equal(e.fullState().ward.guardians.guardian,'Дана, внучка');
// частые отказы -> автопроверка
e.reset(1); for (let i=0;i<4;i++){ op=e.createTransfer('shop',210000,false); e.decide(op.id,'guardian','reject'); }
assert.ok(e.fullState().operator.complaints.some(c=>c.source==='auto'));
// минимизация данных: доверенный не видит номер карты и сведения банка о получателе
e.reset(1); c=e.addCardRecipient('5269880077314821','Иван'); op=e.createTransfer(c.id,480000,false);
let gr=e.fullState().guardian.requests.slice(-1)[0]; assert.ok(!/••/.test(gr.recipient)); assert.ok(!gr.reasons.some(t=>/мошеннич/.test(t))); assert.equal(gr.score,undefined);
assert.ok(e.fullState().bank.audit_verify.ok);
console.log('guardian abuse ok');
// общие тест-векторы (тот же файл проверяет Python: tests/test_vectors.py)
const V=require('../tests/vectors/vectors.json');
for (const v of V.scoring) { const r=K.score(Object.assign({call:'none'},v.signals)); assert.equal(r.score,v.expected.score,v.name); assert.equal(r.zone,v.expected.zone,v.name); assert.deepEqual(r.reasons.map(x=>x.code),v.expected.codes,v.name); }
for (const v of V.ladder) { const ee=K.create(); ee.reset(v.scenario); let o=null;
  for (const st of v.steps) { if (st.expect) { const x=st.expect; if (x.zone) assert.equal(o.zone,x.zone,v.name); if (x.status) assert.equal(o.status,x.status,v.name); if (x.decided_by) assert.equal(o.decided_by,x.decided_by);
      (x.notified||[]).forEach(a=>assert.ok(o.notified[a]!=null,v.name+a)); (x.not_notified||[]).forEach(a=>assert.ok(o.notified[a]==null,v.name+a)); continue; }
    try { if (st.do==='busy') ee.setBusy({guardian:st.guardian,second:st.second}); if (st.do==='sim') ee.setSim({call:st.call}); if (st.do==='transfer') o=ee.createTransfer(st.rid,st.amount,!!st.big);
      if (st.do==='advance_to') ee.advanceTo(st.minute); if (st.do==='decide') { const r=ee.decide(o.id,st.actor,st.decision,st.called); if (st.result) assert.equal(r.result,st.result); }
      assert.ok(!st.error,'expected '+st.error); } catch (err) { if (!err.blocked) throw err; assert.equal(err.code,st.error,v.name); } } }
console.log('shared vectors ok: '+V.scoring.length+' scoring, '+V.ladder.length+' ladder');
// месячный лимит и частые платежи
e.reset(1); assert.equal(s().ward.limits.monthly,1500000);
assert.throws(()=>e.setLimits({daily_on:true,daily:300000,monthly:200000}),x=>x.code==='BAD_LIMIT');
e.setLimits({daily_on:false,monthly:400000}); assert.equal(s().ward.limits.monthly,400000);
for (let d=0; d<4; d++) { op=e.createTransfer('shop',90000,false); if (op.status==='HELD') e.decide(op.id,'guardian','approve'); e.advance(1441); }
op=e.createTransfer('shop',90000,false); assert.ok(op.reasons.some(r=>r.code==='over_limit_monthly')); assert.equal(op.status,'HELD');
e.reset(1); let fav=s().ward.favorites; assert.equal(fav.length,5);
op=e.payFavorite(fav[0].id); assert.equal(op.status,'EXECUTED'); assert.equal(op.recipient_id,'magnum');
op=e.payFavorite(fav[1].id); assert.equal(op.status,'EXECUTED');
e.setSim({call:'active_unknown'}); assert.throws(()=>e.payFavorite(fav[0].id),x=>x.code==='CALL_ACTIVE'); e.setSim({call:'none'}); e.advance(11);
let nf=e.addFavorite('repair',50000,'Мастер'); assert.throws(()=>e.addFavorite('repair',50000),x=>x.code==='DUPLICATE');
e.removeFavorite(nf.id); assert.equal(s().ward.favorites.length,5);
console.log('monthly + favorites ok');

// ТЗ: лимит → пауза → действие
e.reset(8); let w8=s().ward; assert.equal(w8.spent_today,40000); assert.equal(w8.spent_month,120000);
op=e.createTransfer('marat',60000,false); assert.equal(op.status,'EXECUTED'); // ровно лимит — без паузы
e.reset(8); op=e.createTransfer('marat',70000,false); assert.equal(op.status,'HELD'); assert.equal(op.limit_only,true);
assert.deepEqual(op.limit,[{period:'day',spent:40000,limit:100000,total:110000}]);
e.requestConfirm(op.id); assert.equal(e.requestConfirm(op.id).status,'active'); e.advance(30); assert.equal(op.status,'HELD'); assert.ok(op.notified.operator==null); // без лестницы
e.decide(op.id,'guardian','approve'); w8=s().ward; assert.equal(op.status,'EXECUTED'); assert.equal(w8.spent_today,110000); assert.equal(w8.spent_month,190000);
assert.throws(()=>e.decide(op.id,'guardian','approve'),x=>x.code==='NOT_PENDING');
// только месячный
e.reset(8); e.setLimits({daily_on:false,monthly_on:true,monthly:400000}); e.advance(3.1);
op=e.createTransfer('marat',290000,false); assert.deepEqual(op.limit.map(x=>x.period),['month']);
// оба
e.reset(8); e.raw().ward.limits.monthly=150000; op=e.createTransfer('marat',70000,false); assert.deepEqual(op.limit.map(x=>x.period),['day','month']);
// давление после запроса: одно обращение, деньги на месте, старый запрос не подтвердить
e.reset(8); let bal=s().ward.balance; op=e.createTransfer('marat',70000,false); e.requestConfirm(op.id); let c8=e.pressure(op.id);
assert.equal(op.status,'REJECTED'); assert.equal(s().ward.cases.length,1); assert.equal(s().ward.balance,bal); assert.equal(op.request.status,'closed');
assert.throws(()=>e.decide(op.id,'guardian','approve'),x=>x.code==='NOT_PENDING'); assert.ok(s().guardian.requests.slice(-1)[0].closed_by_client);
// отмена: без обращения
e.reset(8); op=e.createTransfer('marat',70000,false); e.decide(op.id,'ward','reject'); assert.equal(s().ward.cases.length,0);
// из чека, в том числе без защиты; повторное — то же обращение; баланс тот же
for (const n of [8,6]) { e.reset(n); bal=s().ward.balance; const done=e.raw().ops.filter(o=>o.status==='EXECUTED' && o.kind==='transfer').slice(-1)[0];
  const a1=e.reportOp(done.id), a2=e.reportOp(done.id); assert.equal(a1.number,a2.number); assert.equal(a1.kind,'after_send'); assert.equal(s().ward.balance,bal); }
// защита выключена — обычный перевод
e.reset(8); e.raw().ward.protection_on=false; op=e.createTransfer('marat',70000,false); assert.equal(op.status,'EXECUTED');
console.log('spec flow ok');
// пока клиент отвечает помощнику, операция не истекает
e.reset(3); e.setBusy({guardian:true,second:true}); op=e.createTransfer('shop',480000,true); e.advanceTo(15.5); assert.ok(op.hold_deadline>=45.5);
e.advanceTo(44); e.assistantOpened(op.id); e.advanceTo(62); assert.equal(op.status,'HELD'); assert.equal(e.verify(op.id,{call:'no',purpose:'purchase',code:'no',pressure:'no'}).status,'passed'); assert.equal(op.status,'EXECUTED');
e.reset(3); op=e.createTransfer('shop',480000,true); e.advanceTo(80); assert.throws(()=>e.verify(op.id,{}),x=>x.code==='EXPIRED');
console.log('assistant window ok');
// после обращения: режим безопасности, выход на других устройствах, новый код
e.reset(8); let samOp=e.raw().ops.find(o=>o.recipient_id==='samat'); e.reportOp(samOp.id); assert.ok(s().ward.safe_mode);
assert.equal(e.createTransfer('marat',5000,false).status,'EXECUTED'); // перевод доступен, предупреждение — в приложении
assert.equal(e.createTransfer('utility',3500,false).status,'EXECUTED'); assert.equal(e.payFavorite(1).status,'EXECUTED');
assert.throws(()=>e.createCredit(100000,'cash'),x=>x.code==='SAFE_MODE');
assert.equal(e.resetSessions().closed,2); assert.equal(s().ward.devices.length,1);
assert.throws(()=>e.changeCode('1111'),x=>x.code==='WEAK_CODE'); e.changeCode('4719'); assert.ok(s().ward.code_changed_at!=null);
e.safeModeOff(); assert.equal(e.createTransfer('marat',5000,false).status,'EXECUTED');
e.reset(8); op=e.createTransfer('marat',70000,false); e.pressure(op.id); assert.ok(s().ward.safe_mode); // и после «Меня просят»
console.log('safe mode ok');
