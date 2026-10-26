import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId: 'demo-barnabas', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
await env.clearFirestore();
await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'managerKeys/secret'), {}); });
await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-barnabas/accounts', { method: 'DELETE' });
console.log('seeded'); await env.cleanup(); process.exit(0);
