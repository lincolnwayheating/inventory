const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/script.js', 'utf8');
const start = source.indexOf('let quickLoadRequestId = 0;');
const end = source.indexOf('async function processQuickLoad()', start);
assert.ok(start >= 0 && end > start);
const quickLoadSource = source.slice(start, end);

function context(extra = {}) {
    return vm.createContext({
        SCRIPT_URL: 'https://invented.example/exec',
        AbortController, setTimeout, clearTimeout, console,
        ...extra
    });
}

test('Quick Load retries a bad first read with fresh URLs and accepts a valid empty list', async () => {
    const calls = [];
    const ctx = context({ fetch: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) throw Error('connection failed');
        return { ok: true, json: async () => ({ success: true, data: { shop: [], trucks: { maverick: [] } } }) };
    } });
    vm.runInContext(quickLoadSource, ctx);
    const result = await ctx.readLowStockItems('maverick');
    assert.equal(result.success, true);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].url, calls[1].url);
    assert.ok(calls.every(call => call.options.cache === 'no-store' && call.options.signal));
});

test('Quick Load rejects a missing selected-truck list instead of displaying all stocked', async () => {
    const ctx = context({ fetch: async () => ({ ok: true, json: async () =>
        ({ success: true, data: { shop: [], trucks: {} } }) }) });
    vm.runInContext(quickLoadSource, ctx);
    await assert.rejects(ctx.readLowStockItems('maverick'), /Quick Load data unavailable/);
});

test('an older truck response cannot overwrite a newer Quick Load error', async () => {
    let resolveFirst;
    const oldResult = new Promise(resolve => { resolveFirst = resolve; });
    const elements = {
        quickLoadList: { innerHTML: '' },
        quickLoadBtn: { style: { display: '' }, disabled: false },
        quickLoadLocation: { value: 'maverick' }
    };
    const ctx = context({
        document: { getElementById: id => elements[id] },
        settings: {}, inventory: {},
        showProcessing: () => {},
        console: { error: () => {} },
        fetch: async () => { throw Error('unused'); }
    });
    vm.runInContext(quickLoadSource, ctx);
    ctx.readLowStockItems = location => location === 'maverick' ? oldResult : Promise.reject(Error('new read failed'));
    const first = ctx.updateQuickLoadList();
    elements.quickLoadLocation.value = 'shop';
    await ctx.updateQuickLoadList();
    resolveFirst({ success: true, data: { shop: [], trucks: { maverick: [] } } });
    await first;
    assert.match(elements.quickLoadList.innerHTML, /Could not load current stock/);
    assert.equal(elements.quickLoadBtn.disabled, true);
});

test('stock changing during a Quick Load read preserves selections but disables loading', async () => {
    let resolveRead;
    let processing = true;
    const elements = {
        quickLoadList: { innerHTML: 'Previously selected parts' },
        quickLoadBtn: { style: { display: 'block' }, disabled: false },
        quickLoadLocation: { value: 'maverick' },
        quickLoadStaleNotice: { style: { display: 'none' } }
    };
    const ctx = context({
        document: { getElementById: id => elements[id] },
        settings: {}, inventory: {},
        showProcessing: show => { processing = show; },
        fetch: async () => { throw Error('unused'); }
    });
    vm.runInContext(quickLoadSource, ctx);
    ctx.readLowStockItems = () => new Promise(resolve => { resolveRead = resolve; });
    const pending = ctx.updateQuickLoadList();
    ctx.markQuickLoadListStale();
    resolveRead({ success: true, data: { shop: [], trucks: { maverick: [] } } });
    await pending;
    assert.equal(elements.quickLoadList.innerHTML, 'Previously selected parts');
    assert.equal(elements.quickLoadStaleNotice.style.display, 'block');
    assert.equal(elements.quickLoadBtn.disabled, true);
    assert.equal(processing, false);
});

test('unknown low-stock part asks for a full refresh instead of claiming all stocked', async () => {
    const elements = {
        quickLoadList: { innerHTML: '' },
        quickLoadBtn: { style: { display: '' }, disabled: false },
        quickLoadLocation: { value: 'maverick' },
        quickLoadStaleNotice: { style: { display: 'none' } }
    };
    const ctx = context({
        document: { getElementById: id => elements[id] },
        settings: {}, inventory: {},
        showProcessing: () => {}, console: { error: () => {} },
        fetch: async () => { throw Error('unused'); }
    });
    vm.runInContext(quickLoadSource, ctx);
    ctx.readLowStockItems = async () => ({ success: true, data: { shop: [], trucks: {
        maverick: [{ id: 'new-part', current: 0, minimum: 1, needed: 1, shopQty: 1 }]
    } } });
    await ctx.updateQuickLoadList();
    assert.match(elements.quickLoadList.innerHTML, /refresh all inventory/);
    assert.doesNotMatch(elements.quickLoadList.innerHTML, /All items fully stocked/);
    assert.equal(elements.quickLoadBtn.disabled, true);
});
