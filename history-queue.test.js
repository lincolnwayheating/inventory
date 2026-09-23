const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/script.js', 'utf8');
const queue = source.slice(source.indexOf('const TRANSACTION_QUEUE_KEY'), source.indexOf('// LOCATION TRACKING'));
const immediate = source.slice(source.indexOf('function queueTransaction('), source.indexOf('// Keep old function name for compatibility'));
assert(queue.includes('async function processTransactionQueue'));
assert(immediate.includes('function queueTransaction'));

async function run(serverSuccess, initial, immediateSend = false) {
  const data = new Map();
  const sent = [];
  data.set('hvac_transaction_queue', JSON.stringify(initial));
  const context = {
    localStorage: {getItem: k => data.get(k), setItem: (k, v) => data.set(k, v)},
    crypto: {getRandomValues: bytes => bytes.fill(7)},
    fetch: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return {ok: true, json: async () => ({success: serverSuccess})};
    },
    SCRIPT_URL: 'https://invented.invalid/endpoint',
    console: {log() {}, warn() {}, error() {}},
  };
  vm.createContext(context);
  vm.runInContext(queue + immediate, context);
  if (immediateSend) {
    context.queueTransaction({action: 'Added Part'});
    await new Promise(resolve => setImmediate(resolve));
  } else {
    await context.processTransactionQueue();
  }
  return {items: JSON.parse(data.get('hvac_transaction_queue')), sent};
}

(async () => {
  const old = [{transaction: {action: 'Added Part'}, attempts: 50, addedAt: 1}];
  const legacy = await run(true, old);
  assert.equal(legacy.items.length, 1, 'old uncertain History must remain');
  assert.equal(legacy.items[0].requiresReconciliation, true);
  assert.equal(legacy.sent.length, 0, 'old uncertain History must not replay automatically');
  const identified = [{...old[0], operationId: 'history-1234567890abcdef1234567890abcdef'}];
  const rejected = await run(false, identified);
  assert.equal(rejected.items.length, 1, 'server rejection must retain identified History');
  assert.equal(rejected.items[0].operationId, rejected.sent[0].operationId, 'retry must retain the same ID');
  assert.equal((await run(true, identified)).items.length, 0, 'accepted identified History clears queue');
  const immediateRejected = await run(false, [], true);
  assert.equal(immediateRejected.items.length, 1, 'immediate HTTP 200 rejection queues History');
  assert.equal(immediateRejected.items[0].operationId, immediateRejected.sent[0].operationId);
  assert.equal((await run(true, [], true)).items.length, 0, 'accepted immediate History stays out of queue');
  console.log('PASS: rejected History retained; accepted History cleared; immediate rejection queued');
})().catch(error => { console.error(error); process.exitCode = 1; });
