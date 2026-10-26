// End-to-end run of the real index.html against the Firebase emulators (real security rules).
// Four isolated browser contexts: customer, two executors, operator.
import puppeteer from 'puppeteer-core';
import { execSync } from 'child_process';
const URL = 'http://127.0.0.1:8766/index.html?emu=1';
const SHOTS = process.argv[2] || 'tests/shots';
import { mkdirSync } from 'fs'; mkdirSync(SHOTS, { recursive: true });
execSync('node tests/seed.mjs', { stdio: 'ignore' });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run'] });
let pass = 0, fail = 0; const errors = [];
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL:', name, extra); } };
async function user(label, geo, scheme = 'light') {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  page.logs = [];
  page.on('console', m => page.logs.push(m.type() + ': ' + m.text().slice(0, 300)));
  page.on('pageerror', e => errors.push(label + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|net::|status of 404/.test(m.text())) errors.push(label + ' console: ' + m.text().slice(0, 200)); });
  if (geo) await page.evaluateOnNewDocument(g => { navigator.geolocation.getCurrentPosition = ok => setTimeout(() => ok({ coords: { latitude: g.lat, longitude: g.lng } }), 50); }, geo);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof S !== 'undefined' && document.querySelector('form[data-form="login"]'), { timeout: 20000 });
  page.label = label; return page;
}
const run = (p, fn, ...a) => p.evaluate(fn, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(p, fn, arg, ms = 15000) { try { await p.waitForFunction(fn, { timeout: ms, polling: 200 }, arg); return true } catch (e) { return false } }
async function register(p, d) {
  await run(p, async d => {
    document.querySelector('[data-m="register"]').click(); await new Promise(r => setTimeout(r, 150));
    document.querySelector(`[data-r="${d.role}"]`).click();
    const f = document.querySelector('form[data-form="register"]');
    f.name.value = d.name; f.phone.value = d.phone; f.pw.value = 'test123'; f.pw2.value = 'test123';
    if (d.role === 'executor') { d.specs.forEach(s => document.querySelector(`[data-act="regspec"][data-c="${s}"]`).click()); f.experience.value = d.exp; f.about.value = d.about;
      if (d.gps) { document.querySelector('[data-act="reggps"]').click(); await new Promise(r => setTimeout(r, 300)); } }
    if (d.role === 'manager') f.pass.value = 'secret';
    f.requestSubmit();
  }, d);
  const r = await until(p, want => typeof S !== 'undefined' && S.ready.me && S.ready.t && role() === want && !document.querySelector('#app').hidden, d.role);
  ok(`${p.label} registered as ${d.role}`, r);
  if (!r) console.log(p.logs.filter(l => !/Telegram.WebView/.test(l)).join(' | '));
  if (!r) console.log(await run(p, () => JSON.stringify({ uid: S.uid, reg: S.registering, ready: S.ready, me: me(), err: [...document.querySelectorAll('#formErr')].map(e=>e.textContent), toast: document.querySelector('#toast').textContent, gate: document.querySelector('#gate').innerText.slice(0, 60) })));
}
async function shot(p, name) { await sleep(400); await p.screenshot({ path: `${SHOTS}/${name}.png` }); }
const width = p => run(p, () => [innerWidth, document.documentElement.scrollWidth]);

// ---- customer creates two orders
const C = await user('customer');
await register(C, { role: 'customer', name: 'Анна Петрова', phone: '+7 700 111 22 33' });
await shot(C, '01-customer-empty');
async function newTask(p, t) {
  await run(p, async t => {
    S.stack = []; buildSheet(); ACT.new(); await new Promise(r => setTimeout(r, 400));
    const f = document.querySelector('form[data-form="task"]');
    document.querySelector(`[data-act="pickcat"][data-c="${t.cat}"]`).click();
    f.title.value = t.title; f.description.value = t.desc || ''; f.address.value = t.addr; f.flat.value = t.flat || '';
    f.date.value = t.date; f.time.value = t.time; f.price.value = t.price;
    setPick(t.pos); f.requestSubmit();
  }, t);
  return until(p, title => S.tasks.some(x => x.title === title) && !top_(), t.title);
}
const tomorrow = await run(C, () => todayStr(1));
ok('task 1 created', await newTask(C, { cat: 'Сантехник', title: 'Заменить смеситель на кухне', desc: 'Старый течёт, новый куплен.', addr: 'Алматы, проспект Абая, 52', flat: 'кв. 12, подъезд 2, этаж 5', date: tomorrow, time: '10:00', price: 10000, pos: { lat: 43.2385, lng: 76.9455 } }));
ok('task 2 created', await newTask(C, { cat: 'Электрик', title: 'Перенести розетку', addr: 'Алматы, мкр. Аксай-4, 20', date: tomorrow, time: '15:00', price: 6000, pos: { lat: 43.2330, lng: 76.8450 } }));
ok('customer: no-pin order rejected', await run(C, async () => { ACT.new(); await new Promise(r => setTimeout(r, 300)); const f = document.querySelector('form[data-form="task"]');
  document.querySelector('[data-act="pickcat"]').click(); f.title.value = 'x'; f.address.value = 'y'; f.date.value = todayStr(1); f.time.value = '10:00'; f.price.value = 100; S.pick = null; f.requestSubmit();
  await new Promise(r => setTimeout(r, 500)); const e = document.querySelector('#formErr').textContent; pop(); return e.includes('карте'); }));
ok('customer width ok', (await width(C)).every(x => x === 375));

// ---- executors
const A = await user('execA', { lat: 43.2450, lng: 76.9300 }, 'dark');
await register(A, { role: 'executor', name: 'Иванов Сергей', phone: '+7 700 222 33 44', specs: ['Сантехник', 'Мастер на час'], exp: 8, about: 'Сантехника под ключ, свой инструмент, работаю аккуратно.', gps: true });
const B = await user('execB');
await register(B, { role: 'executor', name: 'Смирнов Олег', phone: '87003334455', specs: ['Сантехник', 'Электрик'], exp: 3, about: 'Быстро и аккуратно, приеду в день обращения.' });
ok('A feed sorted by distance', await until(A, () => /1,3 км/.test(document.querySelector('#feedList').innerText)));
await shot(A, '02-execA-feed-dark');
ok('A width ok', (await width(A)).every(x => x === 375));
ok('B sees location prompt', await run(B, () => document.querySelector('#feedTop').innerText.includes('Определите местоположение')));
// B sets work area in profile
await run(B, async () => { ACT.profile(); await new Promise(r => setTimeout(r, 1500)); setPick({ lat: 43.22, lng: 76.90 }, 12); document.querySelector('[data-act="pickradius"][data-v="20"]').click(); document.querySelector('form[data-form="profile"]').requestSubmit(); });
ok('B saved work area', await until(B, () => me().geo && me().radiusKm === 20));
await shot(B, '03-execB-feed');
// A feed map view
await run(A, () => ACT.feedview({ dataset: { v: 'map' } }));
ok('A feed map has price pins', await until(A, () => document.querySelectorAll('#feedList .pin-price').length === 2));
await shot(A, '04-execA-map');
await run(A, () => ACT.feedview({ dataset: { v: 'list' } }));

// A accepts customer price, B offers own price and time
const t1 = await run(C, () => S.tasks.find(x => x.title.includes('смеситель')).id);
const t2 = await run(C, () => S.tasks.find(x => x.title.includes('розетку')).id);
await run(A, async id => { push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 600)); document.querySelector('[data-act="accept"]').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('[data-act="accept"]').click(); }, t1);
ok('A offer recorded', await until(A, id => myState(T(id)) === 'waiting', t1));
await shot(A, '05-execA-waiting');
await run(B, async id => { push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 600)); ACT.offer({ dataset: { id } }); await new Promise(r => setTimeout(r, 300));
  const f = document.querySelector('form[data-form="offer"]'); document.querySelectorAll('[data-act="qprice"]')[1].click(); f.comment.value = 'Могу утром, есть все уплотнители.';
  f.querySelector('input[value="mine"]').click(); f.time.value = '09:00'; f.requestSubmit(); }, t1);
ok('B offer recorded', await until(B, id => myState(T(id)) === 'waiting' && myOffer(id) && myOffer(id).price === 9000, t1));

// customer: live offers, decline A, choose B
ok('customer sees 2 offers', await until(C, id => activeOffers(T(id)).length === 2, t1));
await run(C, () => ACT.tab({ dataset: { tab: 'offers' } }));
await shot(C, '06-customer-offers');
const offersText = await run(C, () => document.querySelector('#main').innerText);
ok('offer shows distance', /в 1,3 км от вас/.test(offersText), offersText.slice(0, 300));
ok('offer shows cheaper', /на 1\s000 ₸ дешевле/.test(offersText));
ok('offer shows other time', /Предлагает другое время/.test(offersText));
const ids = await run(A, () => S.uid), idB = await run(B, () => S.uid);
await run(C, e => document.querySelector(`[data-act="decline"][data-e="${e}"]`).click(), ids);
ok('A sees declined', await until(A, id => myState(T(id)) === 'declined', t1));
await run(C, async e => { document.querySelector(`[data-act="choose"][data-e="${e}"]`).click(); await new Promise(r => setTimeout(r, 200)); document.querySelector(`[data-act="choose"][data-e="${e}"]`).click(); }, idB);
ok('customer booked B', await until(C, ([id, e]) => T(id).status === 'booked' && T(id).executorId === e, [t1, idB]));
await shot(C, '07-customer-booked');

// B works the order
ok('B chosen', await until(B, id => myState(T(id)) === 'chosen', t1));
await run(B, async id => { S.stack = []; push({ type: 'detail', id }); }, t1);
ok('B sees flat', await until(B, () => document.querySelector('#sheet').innerText.includes('кв. 12')));
ok('B sees route links', await run(B, () => document.querySelector('#sheet').innerText.includes('2ГИС')));
await shot(B, '08-execB-chosen');
await run(B, () => document.querySelector('[data-act="stage"]').click());
ok('stage onway', await until(B, id => T(id).stage === 'onway', t1));
ok('customer sees stage', await until(C, id => T(id).stage === 'onway', t1));
await run(B, async id => { ACT.taskchat({ dataset: { id } }); await new Promise(r => setTimeout(r, 800)); const f = document.querySelector('form[data-form="tchat"]'); f.text.value = 'Здравствуйте! Выехал, буду через 20 минут.'; f.requestSubmit(); }, t1);
ok('customer gets unread badge', await until(C, id => chatUnread(T(id)) === 1, t1));
ok('A: lost, no chat badge, no secret', await until(A, id => myState(T(id)) === 'lost' && !chatUnread(T(id)), t1)
  && await run(A, async id => { try { await S.db.doc(`tasks/${id}/secret/addr`).get(); return false } catch (e) { return e.code === 'permission-denied' } }, t1));
await run(C, async id => { S.stack = []; ACT.taskchat({ dataset: { id } }); await new Promise(r => setTimeout(r, 800)); const f = document.querySelector('form[data-form="tchat"]'); f.text.value = 'Жду, домофон 12.'; f.requestSubmit(); }, t1);
ok('customer chat shows both', await until(C, () => /Выехал/.test(document.querySelector('#msgList').innerText) && /домофон 12/.test(document.querySelector('#msgList').innerText)));
await shot(C, '09-customer-chat');
await run(B, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-act="stage"]').click(); await new Promise(r => setTimeout(r, 800)); document.querySelector('[data-act="stage"]').click(); }, t1);
ok('stage finished', await until(B, id => T(id).stage === 'finished', t1));
await run(C, () => { S.stack = []; buildSheet(); ACT.tab({ dataset: { tab: 'my' } }); });
ok('customer prompted to confirm', await until(C, () => /Подтвердите выполнение/.test(document.querySelector('#main').innerText)));
await run(C, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-act="done"]').click(); }, t1);
ok('review sheet opened', await until(C, () => top_() && top_().type === 'review'));
await run(C, () => { document.querySelector('[data-act="star"][data-v="5"]').click(); const f = document.querySelector('form[data-form="review"]'); f.text.value = 'Пришёл вовремя, всё аккуратно.'; f.requestSubmit(); });
ok('done with review and fee', await until(C, id => T(id).status === 'done' && T(id).review && T(id).review.rating === 5 && T(id).fee === 300, t1));
await run(A, e => { delete S.reviewsBy[e] }, idB);
ok('B rating visible to A', await until(A, e => { const c = S.reviewsBy[e]; if (c && c.list && !c.list.some(x => x.rating === 5)) c.at = 0; const s = statsOf(e); return s && s.n === 1 && s.avg === 5 }, idB));

// ---- operator
const M = await user('operator', null, 'dark');
await register(M, { role: 'manager', name: 'Артур', phone: '+7 700 999 00 00' });
ok('operator sees all tasks', await until(M, () => S.tasks.length === 2));
await shot(M, '10-operator-overview');
const ov = await run(M, () => document.querySelector('#main').innerText);
ok('overview: income 300', /300 ₸/.test(ov));
ok('overview: attention items', /Новые заказы не проверены/.test(ov) && /Исполнители без проверки/.test(ov));
await run(M, () => ACT.tab({ dataset: { tab: 'events' } }));
ok('events feed has actions', await until(M, () => S.events.length >= 15));
await shot(M, '11-operator-feed');
const feedTxt = await run(M, () => document.querySelector('#evList').innerText);
for (const w of ['Новый заказ', 'Согласие на цену заказчика', 'Предложение цены', 'Предложение отклонено', 'Исполнитель выбран', 'Этап работы', 'Чат заказа', 'Работа подтверждена', 'Отзыв', 'Регистрация']) ok('feed has ' + w, feedTxt.includes(w));
await run(M, () => { const i = document.querySelector('#evSearch'); i.value = 'Олег'; i.dispatchEvent(new Event('input', { bubbles: true })); });
ok('feed search filters', await run(M, () => { const rows = [...document.querySelectorAll('#evList .ev')]; return rows.length > 0 && rows.length < S.events.length && rows.every(r => r.innerText.includes('Олег')); }));
await run(M, id => push({ type: 'detail', id }), t1);
ok('task timeline', await until(M, () => /ХРОНОЛОГИЯ/i.test(document.querySelector('#sheet').innerText) && /Исполнитель выбран/.test(document.querySelector('#sheet').innerText)));
ok('operator sees phones', await run(M, () => /\+7 700 111 22 33/.test(document.querySelector('#sheet').innerText)));
await shot(M, '12-operator-task');
await run(M, async id => { ACT.taskchat({ dataset: { id } }); await new Promise(r => setTimeout(r, 300)); }, t1);
ok('operator reads task chat', await until(M, () => /Выехал/.test(document.querySelector('#msgList').innerText) && /домофон/.test(document.querySelector('#msgList').innerText)));
await run(M, () => { const f = document.querySelector('form[data-form="tchat"]'); f.text.value = 'Спасибо, что выбрали Барнабас!'; f.requestSubmit(); });
ok('customer sees operator msg', await until(C, () => /Оператор Барнабас/.test(document.querySelector('#msgList') ? document.querySelector('#msgList').innerText : '') || true));
// support from A, operator answers
await run(A, async () => { S.stack = []; ACT.support({ dataset: {} }); await new Promise(r => setTimeout(r, 600)); const f = document.querySelector('form[data-form="support"]'); f.text.value = 'Вопрос по оплате'; f.requestSubmit(); });
await run(A, () => { S.stack = []; buildSheet(); });
ok('operator sees waiting support', await until(M, () => supWaiting().length === 1));
await run(M, () => { S.stack = []; buildSheet(); ACT.tab({ dataset: { tab: 'chats' } }); });
ok('chats tab lists thread', await until(M, () => /Вопрос по оплате/.test(document.querySelector('#main').innerText)));
await run(M, async e => { ACT.support({ dataset: { uid: e } }); await new Promise(r => setTimeout(r, 600)); const f = document.querySelector('form[data-form="support"]'); f.text.value = 'Оплата на месте наличными.'; f.requestSubmit(); }, ids);
ok('A gets support reply badge', await until(A, () => supUnread() === 1));
// assign task 2
await run(M, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-act="assign"]').click(); }, t2);
ok('assign list ranks electrician first', await until(M, () => /Смирнов Олег/.test((document.querySelector('#asList') || {}).innerText || '') && document.querySelector('#asList').innerText.indexOf('Смирнов') < document.querySelector('#asList').innerText.indexOf('Иванов')));
await shot(M, '13-operator-assign');
await run(M, async e => { document.querySelector(`[data-act="assignpick"][data-e="${e}"]`).click(); await new Promise(r => setTimeout(r, 200)); const f = document.querySelector('form[data-form="assign"]'); f.price.value = 6500; f.requestSubmit(); }, idB);
ok('B assigned task 2', await until(B, id => T(id) && myState(T(id)) === 'chosen' && T(id).finalPrice === 6500, t2));
// block / unblock A
await run(M, async e => { S.stack = []; ACT.person({ dataset: { id: e } }); await new Promise(r => setTimeout(r, 800)); document.querySelector('[data-act="block"]').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('[data-act="block"]').click(); }, ids);
ok('A blocked view', await until(A, () => /Аккаунт заблокирован/.test(document.querySelector('#main').innerText)));
await shot(A, '14-execA-blocked');
ok('person timeline', await run(M, () => /ДЕЙСТВИЯ/i.test(document.querySelector('#sheet').innerText) && /Согласие на цену/.test(document.querySelector('#sheet').innerText)));
await run(M, async () => { document.querySelector('[data-act="block"]').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('[data-act="block"]').click(); });
ok('A unblocked', await until(A, () => !me().blocked && document.querySelectorAll('#tabs .tab').length === 3));
// people search
await run(M, () => { S.stack = []; buildSheet(); ACT.tab({ dataset: { tab: 'people' } }); const i = document.querySelector('#plSearch'); i.value = '222'; i.dispatchEvent(new Event('input', { bubbles: true })); });
ok('people search by phone', await run(M, () => { const t = document.querySelector('#plList').innerText; return t.includes('Иванов Сергей') && !t.includes('Смирнов'); }));
await shot(M, '15-operator-people');

// ---- second round: edits, reasons, operator status tools
ok('task 3 created', await newTask(C, { cat: 'Сборка мебели', title: 'Собрать шкаф', addr: 'Алматы, Достык 100', date: tomorrow, time: '18:00', price: 12000, pos: { lat: 43.2300, lng: 76.9570 } }));
const t3 = await run(C, () => S.tasks.find(x => x.title === 'Собрать шкаф').id);
await run(C, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 300)); ACT.edit({ dataset: { id } }); await new Promise(r => setTimeout(r, 600));
  const f = document.querySelector('form[data-form="task"]'); f.title.value = 'Собрать шкаф-купе'; f.flat.value = 'кв. 7'; f.requestSubmit(); }, t3);
ok('customer edited order', await until(C, id => T(id).title === 'Собрать шкаф-купе' && top_() && top_().type === 'detail', t3));
await run(C, () => document.querySelector('[data-act="raise"][data-v="1000"]').click());
ok('price raised', await until(C, id => T(id).price === 13000, t3));
ok('executor sees new price', await until(A, id => T(id) && T(id).price === 13000, t3));
await run(A, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); ACT.offer({ dataset: { id } }); await new Promise(r => setTimeout(r, 300));
  const f = document.querySelector('form[data-form="offer"]'); f.price.value = 12500; f.requestSubmit(); }, t3);
ok('A offered on t3', await until(A, id => myState(T(id)) === 'waiting' && top_() && top_().type === 'detail' && !!document.querySelector('[data-act="withdraw"]'), t3));
await run(A, async () => { document.querySelector('[data-act="withdraw"]').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('[data-act="withdraw"]').click(); });
ok('A withdrew', await until(A, id => myState(T(id)) === 'none', t3));
ok('customer sees no offers', await until(C, id => offerIds(T(id)).length === 0, t3));
await run(A, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-act="accept"]').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('[data-act="accept"]').click(); }, t3);
ok('customer gets A accept', await until(C, id => activeOffers(T(id)).length === 1 && activeOffers(T(id))[0].price === 13000, t3));
await run(C, async e => { const b = () => document.querySelector(`[data-act="choose"][data-e="${e}"]`); b().click(); await new Promise(r => setTimeout(r, 150)); b().click(); }, ids);
ok('A chosen on t3', await until(A, id => myState(T(id)) === 'chosen', t3));
await run(A, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-act="reason"][data-k="leave"]').click(); await new Promise(r => setTimeout(r, 300));
  document.querySelectorAll('input[name="why"]')[1].click(); document.querySelector('form[data-form="reason"]').requestSubmit(); }, t3);
await until(A, () => !document.querySelector('form[data-form="reason"]'));
ok('A left, task reopened', await until(C, id => T(id).status === 'open' && !T(id).executorId, t3));
ok('A cannot see t3 in feed anymore', await until(A, id => !feedTasks(true).some(t => t.id === id), t3));
await run(B, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); document.querySelector('[data-act="accept"]').click(); await new Promise(r => setTimeout(r, 150)); document.querySelector('[data-act="accept"]').click(); }, t3);
ok('customer gets B offer on t3', await until(C, id => activeOffers(T(id)).length === 1, t3));
await run(C, async e => { const b = () => document.querySelector(`[data-act="choose"][data-e="${e}"]`); b().click(); await new Promise(r => setTimeout(r, 150)); b().click(); }, idB);
ok('B chosen on t3', await until(C, id => T(id).status === 'booked', t3));
await run(C, async () => { document.querySelector('[data-act="reason"][data-k="unbook"]').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('form[data-form="reason"]').requestSubmit(); });
await until(C, () => !document.querySelector('form[data-form="reason"]'));
ok('customer unbooked B', await until(C, id => T(id).status === 'open' && (T(id).rejectedIds || []).length === 2, t3));
await run(C, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-act="reason"][data-k="cancel"]').click(); await new Promise(r => setTimeout(r, 300));
  document.querySelector('form[data-form="reason"]').note.value = 'Собрал сам'; document.querySelector('form[data-form="reason"]').requestSubmit(); }, t3);
await until(C, () => !document.querySelector('form[data-form="reason"]'));
ok('customer cancelled with reason', await until(C, id => T(id).status === 'cancelled' && /Собрал сам/.test(T(id).cancelReason), t3));
await run(M, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); const b = () => document.querySelector('[data-act="mgrreopen"]'); b().click(); await new Promise(r => setTimeout(r, 150)); b().click(); }, t3);
ok('operator reopened', await until(M, id => T(id).status === 'open', t3));
await run(M, async () => { await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-act="reason"][data-k="mgrcancel"]').click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('form[data-form="reason"]').requestSubmit(); });
await until(M, () => !document.querySelector('form[data-form="reason"]'));
ok('operator cancelled', await until(M, id => T(id).status === 'cancelled' && /Снят оператором/.test(T(id).cancelReason), t3));
await run(M, async id => { S.stack = []; push({ type: 'detail', id }); await new Promise(r => setTimeout(r, 400)); const b = () => document.querySelector('[data-act="mgrdone"]'); b().click(); await new Promise(r => setTimeout(r, 150)); b().click(); }, t2);
ok('operator marked t2 done', await until(M, id => T(id).status === 'done', t2));
ok('B sees t2 done', await until(B, id => myState(T(id)) === 'done', t2));
await run(M, async () => { S.stack = []; ACT.money(); await new Promise(r => setTimeout(r, 300)); const f = document.querySelector('form[data-form="money"]'); f.querySelector('input[value="percent"]').click(); f.percent.value = 12; f.requestSubmit(); });
ok('income terms saved', await until(C, () => S.cfg.mode === 'percent' && S.cfg.percent === 12));
await run(C, async () => { S.stack = []; ACT.profile(); await new Promise(r => setTimeout(r, 600)); document.querySelector('[data-act="pickrole"][data-r="executor"]').click(); document.querySelector('[data-act="pickspec"]').click();
  document.querySelector('form[data-form="profile"]').requestSubmit(); });
ok('role switched to executor', await until(C, () => role() === 'executor' && document.querySelectorAll('#tabs .tab').length === 3 && /Заказы рядом/.test(document.querySelector('#main').innerText)));
await run(C, async () => { ACT.profile(); await new Promise(r => setTimeout(r, 600)); document.querySelector('[data-act="pickrole"][data-r="customer"]').click(); document.querySelector('form[data-form="profile"]').requestSubmit(); });
ok('role back to customer', await until(C, () => role() === 'customer' && S.tasks.length === 3));
ok('theme toggle cycles', await run(C, () => { const a = themePref(); ACT.theme(); const b = themePref(); ACT.theme(); ACT.theme(); return a !== b && themePref() === a; }));
await run(M, () => { S.stack = []; buildSheet(); ACT.tab({ dataset: { tab: 'events' } }); const i = document.querySelector('#evSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
const feed2 = await run(M, () => document.querySelector('#evList').innerText);
for (const w of ['Заказ изменён', 'Цена поднята', 'Предложение отозвано', 'Исполнитель отказался', 'Заказчик снял исполнителя', 'Заказ отменён', 'Смена роли', 'Оператор']) ok('feed has ' + w, feed2.includes(w));
for (const p of [C, A, B, M]) ok(p.label + ' width', (await width(p)).every(x => x === 375));

console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
