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
const staleStart = source.indexOf('function markPartDetailStale()');
const staleEnd = source.indexOf('function closePartDetailModal()', staleStart);
assert.ok(staleStart >= 0 && staleEnd > staleStart);
const staleSource = source.slice(staleStart, staleEnd);
const detailStart = source.indexOf('function openPartDetail(partId)');
assert.ok(detailStart >= 0 && staleStart > detailStart);
const detailSource = source.slice(detailStart, staleStart);
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
        ctx, resolveRead: (shop, truck = 1) => resolveRead({ data: [headers, ['P', '', '', '', '', shop, truck, 2, 2]] }),
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

test('a background stock change marks an open part detail stale', async () => {
    const { ctx, resolveRead } = setup();
    let marks = 0;
    ctx.document = {
        querySelector: () => ({ id: 'all-parts' }),
        getElementById: () => ({ classList: { contains: () => true } })
    };
    ctx.visibleLocationIds = () => ['maverick'];
    ctx.markPartDetailStale = () => { marks++; };
    ctx.updatePartsGridQuantitiesOnly = () => {};
    vm.runInContext("activePartDetailId = 'P'", ctx);
    const pending = ctx.refreshQuantitiesOnly();
    resolveRead(7);
    await pending;
    assert.equal(marks, 1);
});

test('unchanged stock leaves an open part detail usable', async () => {
    const { ctx, resolveRead } = setup();
    let marks = 0;
    ctx.document = {
        querySelector: () => ({ id: 'all-parts' }),
        getElementById: () => ({ classList: { contains: () => true } })
    };
    ctx.visibleLocationIds = () => ['maverick'];
    ctx.markPartDetailStale = () => { marks++; };
    ctx.updatePartsGridQuantitiesOnly = () => {};
    vm.runInContext("activePartDetailId = 'P'", ctx);
    const pending = ctx.refreshQuantitiesOnly();
    resolveRead(5);
    await pending;
    assert.equal(marks, 0);
});

test('a truck-only stock change also marks an open part detail stale', async () => {
    const { ctx, resolveRead } = setup();
    let marks = 0;
    ctx.document = {
        querySelector: () => ({ id: 'all-parts' }),
        getElementById: () => ({ classList: { contains: () => true } })
    };
    ctx.visibleLocationIds = () => ['maverick'];
    ctx.markPartDetailStale = () => { marks++; };
    ctx.updatePartsGridQuantitiesOnly = () => {};
    vm.runInContext("activePartDetailId = 'P'", ctx);
    const pending = ctx.refreshQuantitiesOnly();
    resolveRead(5, 3);
    await pending;
    assert.equal(marks, 1);
});

test('the stale part notice disables actions and refreshes without losing job text', () => {
    const actions = [{ disabled: false }, { disabled: false }];
    let notice;
    let refreshedPart;
    let current = {
        useJobTruck: { value: 'maverick' },
        useJobQty: { value: '2' },
        useJobName: { value: 'Invented test job' }
    };
    const body = {
        querySelector: () => null,
        querySelectorAll: () => actions,
        prepend: element => { notice = element; }
    };
    const ctx = vm.createContext({
        document: {
            getElementById: id => id === 'partDetailBody' ? body : current[id],
            createElement: tag => ({
                tag, style: {}, children: [], append(...items) { this.children.push(...items); },
                addEventListener(event, callback) { this[event] = callback; }
            })
        },
        openPartDetail: partId => {
            refreshedPart = partId;
            current = {
                useJobTruck: { value: 'other', options: [{ value: 'maverick' }, { value: 'other' }] },
                useJobQty: { value: '1' },
                useJobName: { value: '' }
            };
        }
    });
    vm.runInContext("let activePartDetailId = 'P';" + staleSource, ctx);
    ctx.markPartDetailStale();
    assert.ok(actions.every(button => button.disabled));
    assert.equal(notice.id, 'partDetailStaleNotice');
    const refreshButton = notice.children[1];
    refreshButton.click();
    assert.equal(refreshedPart, 'P');
    assert.equal(current.useJobTruck.value, 'maverick');
    assert.equal(current.useJobQty.value, '2');
    assert.equal(current.useJobName.value, 'Invented test job');
});

test('part detail retains job fields when the last truck goes out of stock', () => {
    const body = { innerHTML: '' };
    const modal = { classList: { add() {} } };
    const title = { textContent: '' };
    const ctx = vm.createContext({
        inventory: { P: { id: 'P', name: 'Invented part', category: 'parts', barcode: '',
            imageUrl: '', shop: 2, minStock: 0, maverick: 0, minTruck_maverick: 1,
            season: 'heating', price: 0, pretaxPrice: 0, purchaseLink: '' } },
        trucks: { maverick: { name: 'Maverick' } },
        categories: { parts: { name: 'Parts' } },
        userTruck: 'maverick',
        visibleLocationIds: () => ['maverick'],
        visibleVehicleIds: () => ['maverick'],
        historyLoaded: false,
        document: { getElementById: id => ({ partDetailBody: body, partDetailModal: modal,
            partDetailTitle: title })[id] }
    });
    vm.runInContext('let activePartDetailId = null;' + detailSource, ctx);
    ctx.openPartDetail('P');
    assert.match(body.innerHTML, /id="useJobName"/);
    assert.match(body.innerHTML, /No trucks have this part in stock/);
    assert.doesNotMatch(body.innerHTML, /onclick="quickUseOnJob/);
});
