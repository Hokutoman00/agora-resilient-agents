import { TaskLedger } from './ledger.js';
import { injectFailureAndRecover } from './watchdog.js';

const ledger = new TaskLedger();
const receipt = injectFailureAndRecover(ledger);

console.log(JSON.stringify({ ok: true, receipt, state: ledger.snapshot() }, null, 2));
