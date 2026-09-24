const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/script.js', 'utf8');
const start = source.indexOf('let consecutiveRefreshErrors = 0;');
const end = source.indexOf('function updateDashboardQuantitiesOnly()', start);
assert.ok(start >= 0 && end > start);
const refreshSource = source.slice(start, end);
const saveStart = source.indexOf('async function requireStockSaveSuccess(');
const saveEnd = source.indexOf('function stockSaveErrorMessage(', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart);
const saveSource = source.slice(saveStart, saveEnd);
const movementStart = source.indexOf('function guardedStockRequest(');
const movementEnd = source.indexOf('async function saveStockMovement(', movementStart);
assert.ok(movementStart >= 0 && movementEnd > movementStart);
const movementSource = source.slice(movementStart, movementEnd);
const headers = ['PartNumber', 'Name', 'Category', 'Barcode', 'Image', 'shop', 'maverick', 'MinStock', 'MinTruck-maverick'];

function setup() {
    let resolveRead;
    let reads = 0;
    const pending = new Promise(resolve => { resolveRead = resolve; });
    const ctx = vm.createContext({
        readAppRows: () => { reads++; return pending; },
        validateInventoryRows: rows => rows[0],
        inventory: { P: { shop: 5, maverick: 1, minStock: 2, minTruck_maverick: 2 } },
        trucks: { maverick: {} },
        document: { querySelector: () => null },
        autoRefreshTimer: null,
        SCRIPT_URL: 'https://invented.example/exec',
        crypto: require('node:crypto').webcrypto,
        AbortController, setTimeout, clearTimeout,
        console
    });
    vm.runInContext(refreshSource, ctx);
    return {
        ctx, resolveRead: shop => resolveRead({ data: [headers, ['P', '', '', '', '', shop, 1, 2, 2]] }),
        readCount: () => reads
    };
}

test('a slow background read does not overlap the next scheduled refresh', async () => {
    const { ctx, resolveRead, readCount } = setup();
    const first = ctx.refreshQuantitiesOnly();
    await ctx.refreshQuantitiesOnly();
    assert.equal(readCount(), 1);
    resolveRead(7);
    await first;
    assert.equal(ctx.inventory.P.shop, 7);
    await ctx.refreshQuantitiesOnly();
    assert.equal(readCount(), 2);
});

test('a confirmed local stock change invalidates an older background response', async () => {
    const { ctx, resolveRead } = setup();
    vm.runInContext(saveSource, ctx);
    const pending = ctx.refreshQuantitiesOnly();
    await ctx.requireStockSaveSuccess({ ok: true, json: async () => ({ success: true }) });
    ctx.inventory.P.shop = 6;
    resolveRead(4);
    await pending;
    assert.equal(ctx.inventory.P.shop, 6);
});

test('beginning a stock move invalidates a read that returns during the move', async () => {
    const { ctx, resolveRead } = setup();
    vm.runInContext(movementSource, ctx);
    const pending = ctx.refreshQuantitiesOnly();
    const request = ctx.stockMovementRequest('P', ctx.inventory.P, { shop: 4 }, {});
    assert.equal(request.expected.shop, 5);
    resolveRead(4); // Server read sees the move before its POST reply arrives.
    await pending;
    assert.equal(ctx.inventory.P.shop, 5);
});

test('a scheduled background refresh skips a stock POST still in flight', async () => {
    const { ctx, readCount } = setup();
    vm.runInContext(movementSource, ctx);
    let resolvePost;
    ctx.fetch = () => new Promise(resolve => { resolvePost = resolve; });
    const pending = ctx.postStockMovement({ action: 'moveStockWithHistory', operationId: 'invented' });
    await ctx.refreshQuantitiesOnly();
    assert.equal(readCount(), 0);
    resolvePost({ ok: true, json: async () => ({ success: true }) });
    await pending;
});

test('a relevant truck stock change invalidates a held-open Quick Load list', async () => {
    const { ctx, resolveRead } = setup();
    let marks = 0;
    ctx.document = {
        querySelector: () => ({ id: 'quick-load' }),
        getElementById: () => ({ value: 'maverick' })
    };
    ctx.markQuickLoadListStale = () => { marks++; };
    const pending = ctx.refreshQuantitiesOnly();
    resolveRead(7);
    await pending;
    assert.equal(marks, 1);
});

test('unchanged stock keeps the held-open Quick Load list usable', async () => {
    const { ctx, resolveRead } = setup();
    let marks = 0;
    ctx.document = {
        querySelector: () => ({ id: 'quick-load' }),
        getElementById: () => ({ value: 'maverick' })
    };
    ctx.markQuickLoadListStale = () => { marks++; };
    const pending = ctx.refreshQuantitiesOnly();
    resolveRead(5);
    await pending;
    assert.equal(marks, 0);
});
