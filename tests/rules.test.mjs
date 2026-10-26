import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, orderBy, limit, writeBatch, arrayUnion, addDoc, deleteField } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-barnabas',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();
const now = Date.now();
await env.withSecurityRulesDisabled(async c => {
  const d = c.firestore();
  await setDoc(doc(d, 'managerKeys/secret'), {});
  await setDoc(doc(d, 'managers/mgr'), { key: 'secret' });
  await setDoc(doc(d, 'managers/fake'), { key: 'wrong' });
  for (const [id, role, extra] of [['cust', 'customer'], ['cust2', 'customer'], ['ex1', 'executor'], ['ex2', 'executor'], ['ex3', 'executor'], ['blk', 'executor', { blocked: true }], ['blkc', 'customer', { blocked: true }], ['mgr', 'manager'], ['fake', 'manager']])
    await setDoc(doc(d, 'profiles/' + id), { name: id, role, verified: false, createdAt: now, ...(extra || {}) });
  await setDoc(doc(d, 'tasks/old'), { customerId: 'cust2', status: 'done', executorId: 'ex3', offerBy: ['ex3'], rejectedIds: [], price: 5000, title: 'old', createdAt: now - 1e6 });
});
const db = uid => env.authenticatedContext(uid).firestore();
let pass = 0, fail = 0;
async function t(name, p, expectOk = true) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; }
  catch (e) { fail++; console.log('FAIL:', name, '-', (e && e.message || e).toString().slice(0, 300)); }
}
const newTask = (o = {}) => ({ customerId: 'cust', customerName: 'cust', status: 'open', executorId: null, offerBy: [], rejectedIds: [], checked: false, price: 10000, title: 'Смеситель', description: '', category: 'Сантехник', address: 'ул. Абая 10', lat: 43.2, lng: 76.9, date: '2026-12-01', time: '10:00', photoCount: 0, createdAt: now, ...o });

// --- create
await t('customer creates task', setDoc(doc(db('cust'), 'tasks/t1'), newTask()));
await t('customer creates task t2', setDoc(doc(db('cust'), 'tasks/t2'), newTask({ title: 'Розетка' })));
await t('create with offerBy filled denied', setDoc(doc(db('cust'), 'tasks/bad1'), newTask({ offerBy: ['ex1'] })), false);
await t('create for someone else denied', setDoc(doc(db('cust'), 'tasks/bad2'), newTask({ customerId: 'cust2' })), false);
await t('blocked customer cannot create', setDoc(doc(db('blkc'), 'tasks/bad3'), newTask({ customerId: 'blkc' })), false);
await t('zero price denied', setDoc(doc(db('cust'), 'tasks/bad4'), newTask({ price: 0 })), false);
await t('secret written by customer', setDoc(doc(db('cust'), 'tasks/t1/secret/addr'), { flat: 'кв 5, подъезд 2' }));
await t('secret written by executor denied', setDoc(doc(db('ex1'), 'tasks/t1/secret/addr'), { flat: 'x' }), false);

// --- reading tasks
await t('executor reads open task', getDoc(doc(db('ex1'), 'tasks/t1')));
await t('executor queries open tasks', getDocs(query(collection(db('ex1'), 'tasks'), where('status', '==', 'open'))));
await t('executor cannot list all tasks', getDocs(collection(db('ex1'), 'tasks')), false);
await t('executor cannot read foreign done task', getDoc(doc(db('ex1'), 'tasks/old')), false);
await t('customer queries own tasks', getDocs(query(collection(db('cust'), 'tasks'), where('customerId', '==', 'cust'))));
await t('customer cannot query foreign tasks', getDocs(query(collection(db('cust'), 'tasks'), where('customerId', '==', 'cust2'))), false);
await t('manager lists all tasks', getDocs(query(collection(db('mgr'), 'tasks'), orderBy('createdAt', 'desc'), limit(300))));
await t('fake manager cannot list all', getDocs(query(collection(db('fake'), 'tasks'), orderBy('createdAt', 'desc'))), false);
await t('executor reads secret of open task denied', getDoc(doc(db('ex1'), 'tasks/t1/secret/addr')), false);

// --- offers
const offer = (d, uid, tid, price) => { const b = writeBatch(d); b.set(doc(d, `tasks/${tid}/offers/${uid}`), { executorId: uid, price, comment: '', date: '2026-12-01', time: '10:00', createdAt: now, updatedAt: now }); b.update(doc(d, 'tasks/' + tid), { offerBy: arrayUnion(uid) }); return b.commit(); };
await t('ex1 offers 8000', offer(db('ex1'), 'ex1', 't1', 8000));
await t('ex2 offers 9000', offer(db('ex2'), 'ex2', 't1', 9000));
await t('ex3 offers on t2', offer(db('ex3'), 'ex3', 't2', 7000));
await t('blocked executor cannot offer', offer(db('blk'), 'blk', 't1', 100), false);
await t('customer cannot offer', offer(db('cust'), 'cust', 't1', 100), false);
await t('ex1 cannot write offer as ex2', setDoc(doc(db('ex1'), 'tasks/t1/offers/ex2'), { executorId: 'ex2', price: 1, comment: '' }), false);
await t('ex2 cannot read ex1 offer', getDoc(doc(db('ex2'), 'tasks/t1/offers/ex1')), false);
await t('customer lists offers', getDocs(collection(db('cust'), 'tasks/t1/offers')));
await t('ex1 cannot list all offers', getDocs(collection(db('ex1'), 'tasks/t1/offers')), false);
await t('executor cannot add someone else to offerBy', updateDoc(doc(db('ex1'), 'tasks/t1'), { offerBy: arrayUnion('ex3') }), false);
await t('executor cannot change price', updateDoc(doc(db('ex1'), 'tasks/t1'), { price: 1 }), false);
await t('ex2 queries offered tasks (array-contains)', getDocs(query(collection(db('ex2'), 'tasks'), where('offerBy', 'array-contains', 'ex2'))));

// --- customer edits while open
await t('customer raises price while open', updateDoc(doc(db('cust'), 'tasks/t1'), { price: 11000, priceUpAt: now }));
await t('customer declines ex2 offer', updateDoc(doc(db('cust'), 'tasks/t1'), { ['declined.ex2']: now }));
await t('customer cannot touch offerBy', updateDoc(doc(db('cust'), 'tasks/t1'), { offerBy: [] }), false);
await t('customer cannot mark checked', updateDoc(doc(db('cust'), 'tasks/t1'), { checked: true }), false);
await t('customer cannot jump open->done', updateDoc(doc(db('cust'), 'tasks/t1'), { status: 'done' }), false);

// --- choose
await t('choose with wrong price denied', updateDoc(doc(db('cust'), 'tasks/t1'), { status: 'booked', executorId: 'ex1', finalPrice: 5000, bookedAt: now }), false);
await t('choose someone who did not offer denied', updateDoc(doc(db('cust'), 'tasks/t1'), { status: 'booked', executorId: 'ex3', finalPrice: 7000, bookedAt: now }), false);
await t('choose ex1 at 8000', updateDoc(doc(db('cust'), 'tasks/t1'), { status: 'booked', executorId: 'ex1', finalPrice: 8000, execDate: '2026-12-01', execTime: '10:00', bookedAt: now }));
await t('loser ex2 still reads booked task', getDoc(doc(db('ex2'), 'tasks/t1')));
await t('outsider ex3 cannot read booked task', getDoc(doc(db('ex3'), 'tasks/t1')), false);
await t('executor queries own booked', getDocs(query(collection(db('ex1'), 'tasks'), where('executorId', '==', 'ex1'))));
await t('ex1 reads secret after booking', getDoc(doc(db('ex1'), 'tasks/t1/secret/addr')));
await t('ex2 cannot read secret', getDoc(doc(db('ex2'), 'tasks/t1/secret/addr')), false);
await t('ex2 cannot offer after booking', setDoc(doc(db('ex2'), 'tasks/t1/offers/ex2'), { executorId: 'ex2', price: 1, comment: '' }), false);
await t('customer cannot edit price after booking', updateDoc(doc(db('cust'), 'tasks/t1'), { price: 1 }), false);

// --- stages
await t('ex1 sets stage onway', updateDoc(doc(db('ex1'), 'tasks/t1'), { stage: 'onway', stageAt: now }));
await t('ex2 cannot set stage', updateDoc(doc(db('ex2'), 'tasks/t1'), { stage: 'started', stageAt: now }), false);
await t('customer cannot set stage', updateDoc(doc(db('cust'), 'tasks/t1'), { stage: 'finished' }), false);
await t('ex1 cannot set done', updateDoc(doc(db('ex1'), 'tasks/t1'), { status: 'done' }), false);
await t('ex1 bad stage value', updateDoc(doc(db('ex1'), 'tasks/t1'), { stage: 'paid' }), false);

// --- chat
await t('ex1 writes chat', addDoc(collection(db('ex1'), 'tasks/t1/messages'), { authorId: 'ex1', text: 'Еду', createdAt: now }));
await t('ex1 marks last message', updateDoc(doc(db('ex1'), 'tasks/t1'), { lastMsgAt: now, lastMsgFrom: 'ex1' }));
await t('customer writes chat', addDoc(collection(db('cust'), 'tasks/t1/messages'), { authorId: 'cust', text: 'Жду', createdAt: now }));
await t('customer marks last message', updateDoc(doc(db('cust'), 'tasks/t1'), { lastMsgAt: now, lastMsgFrom: 'cust' }));
await t('ex2 cannot write chat', addDoc(collection(db('ex2'), 'tasks/t1/messages'), { authorId: 'ex2', text: 'hi', createdAt: now }), false);
await t('ex2 cannot read chat', getDocs(collection(db('ex2'), 'tasks/t1/messages')), false);
await t('customer reads chat', getDocs(collection(db('cust'), 'tasks/t1/messages')));
await t('manager writes chat', addDoc(collection(db('mgr'), 'tasks/t1/messages'), { authorId: 'mgr', text: 'Оператор на связи', createdAt: now }));
await t('cannot spoof author', addDoc(collection(db('cust'), 'tasks/t1/messages'), { authorId: 'ex1', text: 'x', createdAt: now }), false);
await t('chat on open task denied', addDoc(collection(db('cust'), 'tasks/t2/messages'), { authorId: 'cust', text: 'x', createdAt: now }), false);

// --- executor leaves t2-like flow on separate task
await t('customer creates t3', setDoc(doc(db('cust'), 'tasks/t3'), newTask({ title: 'Шкаф' })));
await t('ex3 offers t3', offer(db('ex3'), 'ex3', 't3', 9500));
await t('choose ex3 on t3', updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'booked', executorId: 'ex3', finalPrice: 9500, bookedAt: now }));
await t('ex3 leaves t3', updateDoc(doc(db('ex3'), 'tasks/t3'), { status: 'open', executorId: null, finalPrice: null, bookedAt: null, rejectedIds: arrayUnion('ex3'), stage: null }));
await t('ex3 cannot re-offer after leaving', setDoc(doc(db('ex3'), 'tasks/t3/offers/ex3'), { executorId: 'ex3', price: 9000, comment: '' }), false);
await t('customer cannot re-choose rejected ex3', updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'booked', executorId: 'ex3', finalPrice: 9500, bookedAt: now }), false);
await t('ex2 offers t3', offer(db('ex2'), 'ex2', 't3', 9900));
await t('choose ex2 on t3', updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'booked', executorId: 'ex2', finalPrice: 9900, bookedAt: now }));
await t('customer unbooks ex2', updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'open', executorId: null, finalPrice: null, bookedAt: null, stage: null, rejectedIds: arrayUnion('ex2') }));
await t('customer unbook without rejecting denied', (async () => {
  await updateDoc(doc(db('ex1'), 'tasks/t3'), { offerBy: arrayUnion('ex1') }).catch(() => {});
  await setDoc(doc(db('ex1'), 'tasks/t3/offers/ex1'), { executorId: 'ex1', price: 9000, comment: '' });
  await updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'booked', executorId: 'ex1', finalPrice: 9000, bookedAt: now });
  return updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'open', executorId: null });
})(), false);
await t('customer cancels booked t3', updateDoc(doc(db('cust'), 'tasks/t3'), { status: 'cancelled', cancelledAt: now, cancelReason: 'Передумал' }));

// --- done + review
const doneBatch = d => { const b = writeBatch(d); b.update(doc(d, 'tasks/t1'), { status: 'done', doneAt: now, fee: 600, feeMode: 'savings' }); b.set(doc(d, 'reviews/t1'), { executorId: 'ex1', customerId: 'cust', rating: 0, text: '', category: 'Сантехник', customerName: 'cust', at: now }); return b.commit(); };
await t('review created alone before done denied', setDoc(doc(db('cust'), 'reviews/t1'), { executorId: 'ex1', customerId: 'cust', rating: 0, text: '' }), false);
await t('customer marks done + review stub', doneBatch(db('cust')));
await t('review for wrong executor denied', setDoc(doc(db('cust2'), 'reviews/old'), { executorId: 'ex1', customerId: 'cust2', rating: 5, text: '' }), false);
await t('customer rates 5', updateDoc(doc(db('cust'), 'reviews/t1'), { rating: 5, text: 'Отлично', at: now }));
await t('customer stores review on task', updateDoc(doc(db('cust'), 'tasks/t1'), { review: { rating: 5, text: 'Отлично', at: now } }));
await t('executor cannot edit review', updateDoc(doc(db('ex1'), 'reviews/t1'), { rating: 1 }), false);
await t('anyone reads reviews by executor', getDocs(query(collection(db('ex2'), 'reviews'), where('executorId', '==', 'ex1'))));
await t('rating 7 denied', updateDoc(doc(db('cust'), 'reviews/t1'), { rating: 7, text: '', at: now }), false);

// --- events
await t('event own', addDoc(collection(db('cust'), 'events'), { type: 'task_new', actorId: 'cust', actorName: 'cust', actorRole: 'customer', taskId: 't1', targetId: null, text: '«Смеситель»', at: now }));
await t('event spoofed actor denied', addDoc(collection(db('cust'), 'events'), { type: 'x', actorId: 'ex1', text: '', at: now }), false);
await t('customer cannot read events', getDocs(collection(db('cust'), 'events')), false);
await t('manager reads events', getDocs(query(collection(db('mgr'), 'events'), orderBy('at', 'desc'), limit(200))));
await t('manager events by actor', getDocs(query(collection(db('mgr'), 'events'), where('actorId', '==', 'cust'))));
await t('event cannot be deleted', (async () => { const s = await env.withSecurityRulesDisabled(async c => (await getDocs(collection(c.firestore(), 'events'))).docs[0].id); return deleteDoc(doc(db('cust'), 'events/' + s)); })(), false);

// --- private & profiles
await t('own private with phone', setDoc(doc(db('cust'), 'private/cust'), { phone: '+7 700 111 22 33', tgId: 123 }));
await t('private with extra field denied', setDoc(doc(db('ex1'), 'private/ex1'), { phone: '+7', role: 'x' }), false);
await t('owner cannot change phone', updateDoc(doc(db('cust'), 'private/cust'), { phone: '+7 000' }), false);
await t('owner updates tg', updateDoc(doc(db('cust'), 'private/cust'), { tgUser: 'anna' }));
await t('others cannot read private', getDoc(doc(db('ex1'), 'private/cust')), false);
await t('manager reads private', getDoc(doc(db('mgr'), 'private/cust')));
await t('manager lists private', getDocs(collection(db('mgr'), 'private')));
await t('profile create with phone denied', setDoc(doc(db('newbie'), 'profiles/newbie'), { name: 'n', role: 'customer', phone: '+7' }), false);
await t('profile create ok', setDoc(doc(db('newbie'), 'profiles/newbie'), { name: 'n', role: 'customer', verified: false, createdAt: now }));
await t('owner cannot self-verify', updateDoc(doc(db('ex1'), 'profiles/ex1'), { verified: true }), false);
await t('owner cannot unblock self', updateDoc(doc(db('blk'), 'profiles/blk'), { blocked: false }), false);
await t('owner updates lastSeen/geo', updateDoc(doc(db('ex1'), 'profiles/ex1'), { lastSeen: now, geo: { lat: 43.24, lng: 76.9 }, radiusKm: 10 }));
await t('manager verifies', updateDoc(doc(db('mgr'), 'profiles/ex1'), { verified: true }));
await t('manager blocks', updateDoc(doc(db('mgr'), 'profiles/ex2'), { blocked: true, blockedAt: now }));
await t('manager cannot rename user', updateDoc(doc(db('mgr'), 'profiles/ex1'), { name: 'X' }), false);
await t('blocked ex2 cannot write chat on t3', addDoc(collection(db('ex2'), 'tasks/t1/messages'), { authorId: 'ex2', text: 'x', createdAt: now }), false);
await t('legacy phone removal by owner', (async () => {
  await env.withSecurityRulesDisabled(async c => updateDoc(doc(c.firestore(), 'profiles/cust2'), { phone: '+7 1' }));
  return updateDoc(doc(db('cust2'), 'profiles/cust2'), { phone: deleteField() });
})());

// --- manager powers
await t('manager assigns executor directly', updateDoc(doc(db('mgr'), 'tasks/t2'), { status: 'booked', executorId: 'ex1', finalPrice: 6000, bookedAt: now, assignedByMgr: true }));
await t('manager backfills review', setDoc(doc(db('mgr'), 'reviews/old'), { executorId: 'ex3', customerId: 'cust2', rating: 0, text: '', at: now }));
await t('manager writes config', setDoc(doc(db('mgr'), 'config/money'), { mode: 'percent', share: 30, percent: 10 }));
await t('customer cannot write config', setDoc(doc(db('cust'), 'config/money'), { mode: 'percent' }), false);

// --- support
await t('support message', addDoc(collection(db('cust'), 'support/cust/messages'), { authorId: 'cust', text: 'Вопрос', taskId: null, createdAt: now }));
await t('support thread', setDoc(doc(db('cust'), 'support/cust'), { lastAt: now, lastText: 'Вопрос', lastFrom: 'cust' }, { merge: true }));
await t('blocked user can still write support', addDoc(collection(db('blk'), 'support/blk/messages'), { authorId: 'blk', text: 'Разблокируйте', createdAt: now }));
await t('cannot read foreign support', getDocs(collection(db('ex1'), 'support/cust/messages')), false);

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
