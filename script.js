// ============================================
// HVAC INVENTORY MANAGEMENT SYSTEM
// Complete Rewrite - Google Sheets as Single Source of Truth
// ============================================

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyl8H2urrCb2KWrHuWlwcqvuSeAT5Q93q4fztX3xg7o0dsCI0MHe9pIAKoo_CnM-Bg/exec';

// Global State (loaded from Google Sheets)
let inventory = {};
let users = {};
let categories = {};
let trucks = {};
let history = [];
let currentUser = null;
let currentUserPin = null;
let isOwner = false;
let userTruck = null;

// PIN Lockout System (only thing stored locally)
let loginAttempts = parseInt(localStorage.getItem('loginAttempts') || '0');
let lockoutUntil = parseInt(localStorage.getItem('lockoutUntil') || '0');
const LOCKOUT_TIMES = [0, 0, 0, 0, 0, 60000, 300000, 900000, 1800000, 3600000, 7200000];

// ZXing Barcode Scanner
let codeReader = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Initialize ZXing
    if (typeof ZXing !== 'undefined') {
        codeReader = new ZXing.BrowserMultiFormatReader();
    }
    
    // Login handlers
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    
    const pinInput = document.getElementById('pinInput');
    pinInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
    
    // Auto-login when 4 digits entered
    pinInput.addEventListener('input', function(e) {
        if (this.value.length === 4) {
            setTimeout(() => login(), 100);
        }
    });
    
    // Search inventory
    document.getElementById('searchInventory').addEventListener('input', function(e) {
        filterInventory(e.target.value);
    });
});

// ============================================
// AUTHENTICATION
// ============================================
function login() {
    const pin = document.getElementById('pinInput').value;
    
    // Check lockout
    if (lockoutUntil && Date.now() < lockoutUntil) {
        const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000);
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        showToast(`Locked out. Try again in ${minutes}:${seconds.toString().padStart(2, '0')}`, 'error');
        document.getElementById('pinInput').value = '';
        return;
    }
    
    // Reset lockout if time passed
    if (lockoutUntil && Date.now() >= lockoutUntil) {
        lockoutUntil = 0;
        loginAttempts = 0;
        localStorage.setItem('lockoutUntil', '0');
        localStorage.setItem('loginAttempts', '0');
    }
    
    showProcessing(true);
    
    // Load users from Google Sheets
    fetch(SCRIPT_URL + '?action=readUsers')
        .then(response => response.json())
        .then(result => {
            if (result.success && result.data) {
                // Parse users from sheet
                users = {};
                for (let i = 1; i < result.data.length; i++) {
                    const row = result.data[i];
                    if (row[0]) {
                        users[row[0]] = {
                            name: row[1],
                            truck: row[2],
                            isOwner: (row[3] === 'TRUE' || row[3] === true),
                            permissions: {
                                addParts: (row[4] === 'TRUE' || row[4] === true),
                                editParts: (row[5] === 'TRUE' || row[5] === true),
                                deleteParts: (row[6] === 'TRUE' || row[6] === true),
                                loadTruck: (row[7] === 'TRUE' || row[7] === true),
                                useParts: (row[8] === 'TRUE' || row[8] === true),
                                viewHistory: (row[9] === 'TRUE' || row[9] === true),
                                editHistory: (row[10] === 'TRUE' || row[10] === true),
                                manageUsers: (row[11] === 'TRUE' || row[11] === true),
                                manageCategories: (row[12] === 'TRUE' || row[12] === true),
                                manageTrucks: (row[13] === 'TRUE' || row[13] === true)
                            }
                        };
                    }
                }
                
                const user = users[pin];
                
                if (user) {
                    // Successful login
                    loginAttempts = 0;
                    lockoutUntil = 0;
                    localStorage.setItem('loginAttempts', '0');
                    localStorage.setItem('lockoutUntil', '0');
                    
                    currentUser = user.name;
                    currentUserPin = pin;
                    isOwner = user.isOwner;
                    userTruck = user.truck;
                    
                    document.getElementById('loginScreen').style.display = 'none';
                    document.getElementById('appContainer').style.display = 'block';
                    document.getElementById('userBadge').textContent = user.name + (user.isOwner ? ' (Owner)' : '');
                    
                    init();
                } else {
                    // Failed login
                    showProcessing(false);
                    loginAttempts++;
                    localStorage.setItem('loginAttempts', loginAttempts.toString());
                    
                    if (loginAttempts >= LOCKOUT_TIMES.length) {
                        loginAttempts = LOCKOUT_TIMES.length - 1;
                    }
                    
                    const lockoutTime = LOCKOUT_TIMES[loginAttempts];
                    
                    if (lockoutTime > 0) {
                        lockoutUntil = Date.now() + lockoutTime;
                        localStorage.setItem('lockoutUntil', lockoutUntil.toString());
                        const minutes = Math.floor(lockoutTime / 60000);
                        showToast(`Too many attempts. Locked out for ${minutes} minute${minutes !== 1 ? 's' : ''}.`, 'error');
                    } else {
                        const attemptsLeft = 5 - loginAttempts;
                        showToast(`Invalid PIN. ${attemptsLeft} attempt${attemptsLeft !== 1 ? 's' : ''} remaining.`, 'error');
                    }
                    
                    document.getElementById('pinInput').value = '';
                }
            }
        })
        .catch(error => {
            showProcessing(false);
            console.error('Login error:', error);
            showToast('Connection error. Please try again.', 'error');
        });
}

function logout() {
    if (confirm('Logout?')) {
        currentUser = null;
        currentUserPin = null;
        isOwner = false;
        userTruck = null;
        document.getElementById('pinInput').value = '';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
    }
}

async function init() {
    showProcessing(true);
    
    try {
        // Load data sequentially with small delays to avoid rate limiting
        await loadCategories();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadTrucks();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadInventory();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadHistory();
        
        buildTabs();
        setupEventListeners();
        populateDropdowns();
        updateDashboard();
        
        showProcessing(false);
    } catch (error) {
        showProcessing(false);
        console.error('Init error:', error);
        showToast('Error loading data. Please refresh.', 'error');
    }
}

async function refreshData() {
    showProcessing(true);
    
    try {
        // Load data sequentially with delays
        await loadCategories();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadTrucks();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadInventory();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadHistory();
        
        populateDropdowns();
        updateDashboard();
        
        // Refresh current tab
        const activeTab = document.querySelector('.content.active');
        if (activeTab) {
            const tabId = activeTab.id;
            if (tabId === 'history') updateHistory();
            if (tabId === 'categories') updateCategoryManager();
            if (tabId === 'trucks') updateTruckManager();
            if (tabId === 'settings') updateUserList();
            if (tabId === 'quick-load') updateQuickLoadList();
        }
        
        showProcessing(false);
        showToast('Data refreshed!');
    } catch (error) {
        showProcessing(false);
        console.error('Refresh error:', error);
        showToast('Error refreshing data', 'error');
    }
}

// ============================================
// DATA LOADING FROM GOOGLE SHEETS
// ============================================
async function loadCategories() {
    const response = await fetch(SCRIPT_URL + '?action=readCategories');
    const result = await response.json();
    
    if (result.success && result.data) {
        categories = {};
        for (let i = 1; i < result.data.length; i++) {
            const row = result.data[i];
            if (row[0]) {
                categories[row[0]] = {
                    name: row[1],
                    parent: row[2] || null,
                    order: parseInt(row[3]) || 0
                };
            }
        }
    }
}

async function loadTrucks() {
    try {
        const response = await fetch(SCRIPT_URL + '?action=readTrucks');
        
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Too many requests. Please wait a moment and try again.');
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.data) {
            trucks = {};
            for (let i = 1; i < result.data.length; i++) {
                const row = result.data[i];
                if (row[0]) {
                    trucks[row[0]] = {
                        name: row[1],
                        active: (row[2] === 'TRUE' || row[2] === true)
                    };
                }
            }
        }
    } catch (error) {
        console.error('Load trucks error:', error);
        throw error;
    }
}

async function loadInventory() {
    const response = await fetch(SCRIPT_URL + '?action=readInventory');
    const result = await response.json();
    
    if (result.success && result.data && result.data.length > 1) {
        inventory = {};
        const headers = result.data[0];
        
        for (let i = 1; i < result.data.length; i++) {
            const row = result.data[i];
            if (row[0]) {
                const item = {
                    name: row[1] || '',
                    category: row[2] || 'other',
                    partNumber: row[3] || '',
                    barcode: row[4] || '',
                    shop: parseInt(row[5]) || 0
                };
                
                // Dynamic truck columns
                let colIndex = 6;
                Object.keys(trucks).forEach(truckId => {
                    item[truckId] = parseInt(row[colIndex]) || 0;
                    colIndex++;
                });
                
                item.minStock = parseInt(row[colIndex]) || 0;
                item.minTruckStock = parseInt(row[colIndex + 1]) || 0;
                item.price = parseFloat(row[colIndex + 2]) || 0;
                item.purchaseLink = row[colIndex + 3] || '';
                item.season = row[colIndex + 4] || 'year-round';
                
                inventory[row[0]] = item;
            }
        }
    }
}

async function loadHistory() {
    const response = await fetch(SCRIPT_URL + '?action=readHistory');
    const result = await response.json();
    
    if (result.success && result.data && result.data.length > 1) {
        history = [];
        for (let i = 1; i < result.data.length; i++) {
            const row = result.data[i];
            history.push({
                id: i,
                timestamp: row[0],
                tech: row[1],
                action: row[2],
                details: row[3],
                quantity: row[4],
                from: row[5],
                to: row[6],
                jobName: row[7],
                address: row[8],
                lat: row[9],
                lon: row[10]
            });
        }
        // Reverse so newest first
        history.reverse();
    }
}

// ============================================
// PERMISSIONS
// ============================================
function hasPermission(permission) {
    if (isOwner) return true;
    const user = users[currentUserPin];
    if (!user) return false;
    return user.permissions[permission] === true;
}

// ============================================
// UI BUILDERS
// ============================================
function buildTabs() {
    const tabContainer = document.getElementById('tabContainer');
    if (!tabContainer) {
        console.error('Tab container not found!');
        return;
    }
    
    tabContainer.innerHTML = '';
    
    const tabs = [
        { id: 'dashboard', label: '📊 Dashboard', permission: null },
        { id: 'load-truck', label: '📦 Load Truck', permission: 'loadTruck' },
        { id: 'use-parts', label: '🔧 Use Parts', permission: 'useParts' },
        { id: 'return-to-shop', label: '↩️ Return to Shop', permission: 'loadTruck' },
        { id: 'history', label: '📋 History', permission: 'viewHistory' },
        { id: 'quick-load', label: '🚛 Quick Load', permission: 'loadTruck' },
        { id: 'add-part', label: '➕ New Part', permission: 'addParts' },
        { id: 'categories', label: '📁 Categories', permission: 'manageCategories' },
        { id: 'trucks', label: '🚚 Trucks', permission: 'manageTrucks' },
        { id: 'settings', label: '⚙️ Settings', permission: 'manageUsers' }
    ];
    
    tabs.forEach((tab, i) => {
        // Dashboard has no permission requirement
        if (!tab.permission) {
            const btn = document.createElement('button');
            btn.className = 'tab' + (i === 0 ? ' active' : '');
            btn.textContent = tab.label;
            btn.setAttribute('data-tab-id', tab.id);
            btn.onclick = () => switchTab(tab.id);
            tabContainer.appendChild(btn);
            return;
        }
        
        // Check permission
        if (hasPermission(tab.permission)) {
            const btn = document.createElement('button');
            btn.className = 'tab';
            btn.textContent = tab.label;
            btn.setAttribute('data-tab-id', tab.id);
            btn.onclick = () => switchTab(tab.id);
            tabContainer.appendChild(btn);
        }
    });
}

function switchTab(tabName) {
    // Remove active from all tabs and content
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    
    // Find and activate the correct tab
    const clickedTab = document.querySelector(`.tab[data-tab-id="${tabName}"]`);
    if (clickedTab) {
        clickedTab.classList.add('active');
    }
    
    // Show content
    const content = document.getElementById(tabName);
    if (content) {
        content.classList.add('active');
        content.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    // Load tab-specific data
    if (tabName === 'dashboard') updateDashboard();
    if (tabName === 'history') updateHistory();
    if (tabName === 'categories') updateCategoryManager();
    if (tabName === 'trucks') updateTruckManager();
    if (tabName === 'settings') updateUserList();
    if (tabName === 'quick-load') updateQuickLoadList();
    if (tabName === 'load-truck' || tabName === 'return-to-shop' || tabName === 'use-parts') {
        populateDropdowns();
    }
}

function setupEventListeners() {
    document.getElementById('addPartBtn')?.addEventListener('click', addPart);
    document.getElementById('loadTruckBtn')?.addEventListener('click', loadTruck);
    document.getElementById('returnToShopBtn')?.addEventListener('click', returnToShop);
    document.getElementById('usePartsBtn')?.addEventListener('click', useParts);
    document.getElementById('usePartsTruck')?.addEventListener('change', updateUsePartsList);
    document.getElementById('returnTruck')?.addEventListener('change', updateReturnPartsList);
    document.getElementById('addUserBtn')?.addEventListener('click', addUser);
    document.getElementById('addCategoryBtn')?.addEventListener('click', addCategory);
    document.getElementById('addTruckBtn')?.addEventListener('click', addTruck);
    document.getElementById('quickLoadBtn')?.addEventListener('click', processQuickLoad);
    
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', clearHistory);
    }
    
    // Barcode buttons
    document.querySelectorAll('.barcode-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const inputId = this.getAttribute('data-barcode');
            startBarcodeScanner(inputId);
        });
    });
}

// ============================================
// BARCODE SCANNING (ZXing)
// ============================================
function startBarcodeScanner(targetInputId) {
    if (!codeReader) {
        showToast('Barcode scanner not available. Enter manually.', 'error');
        return;
    }
    
    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:10000;';
    document.body.appendChild(video);
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10001;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:white;padding:20px;border-radius:10px;text-align:center;max-width:90%;"><h2>Scanning...</h2><p>Point camera at barcode</p><button id="cancelScan" style="margin-top:20px;padding:10px 20px;background:#e74c3c;color:white;border:none;border-radius:5px;cursor:pointer;">Cancel</button></div>';
    document.body.appendChild(overlay);
    
    codeReader.decodeFromVideoDevice(null, video, (result, err) => {
        if (result) {
            document.getElementById(targetInputId).value = result.text;
            codeReader.reset();
            document.body.removeChild(video);
            document.body.removeChild(overlay);
            
            // Lookup barcode
            if (targetInputId === 'loadBarcode') lookupBarcode('load', result.text);
            if (targetInputId === 'returnBarcode') lookupBarcode('return', result.text);
            if (targetInputId === 'usePartsBarcode') lookupBarcode('use', result.text);
        }
    });
    
    document.getElementById('cancelScan').onclick = () => {
        codeReader.reset();
        document.body.removeChild(video);
        document.body.removeChild(overlay);
    };
}

function lookupBarcode(context, code) {
    const partId = Object.keys(inventory).find(id => inventory[id].barcode === code);
    
    if (partId) {
        if (context === 'load') document.getElementById('loadPart').value = partId;
        if (context === 'return') document.getElementById('returnPart').value = partId;
        if (context === 'use') document.getElementById('usePartsPart').value = partId;
        showToast(`Found: ${inventory[partId].name}`);
    } else {
        showToast('Barcode not found', 'error');
    }
}

// ============================================
// INVENTORY OPERATIONS
// ============================================
async function addPart() {
    if (!hasPermission('addParts')) {
        showToast('No permission to add parts', 'error');
        return;
    }
    
    const name = document.getElementById('partName').value.trim();
    const categoryId = document.getElementById('partCategory').value;
    const partNumber = document.getElementById('partNumber').value.trim();
    const barcode = document.getElementById('partBarcode').value.trim();
    const price = parseFloat(document.getElementById('partPrice').value) || 0;
    const link = document.getElementById('partLink').value.trim();
    const season = document.getElementById('partSeason').value;
    const shopQty = parseInt(document.getElementById('shopQty').value);
    const minStock = parseInt(document.getElementById('minStock').value);
    const minTruckStock = parseInt(document.getElementById('minTruckStock').value);
    
    if (!name) {
        showToast('Enter part name', 'error');
        return;
    }
    
    showProcessing(true);
    
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '') + Date.now();
    
    const newPart = {
        id: id,
        name: name, 
        category: categoryId, 
        partNumber: partNumber, 
        barcode: barcode, 
        price: price, 
        purchaseLink: link, 
        season: season,
        shop: shopQty,
        minStock: minStock, 
        minTruckStock: minTruckStock
    };
    
    // Initialize all truck quantities to 0
    Object.keys(trucks).forEach(truckId => {
        newPart[truckId] = 0;
    });
    
    try {
        // ✅ Add part to Google Sheets (doesn't overwrite)
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'addPart',
                part: newPart
            })
        });
        
        // Log transaction
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Added Part',
            details: `${name} (${getCategoryPath(categoryId)})`,
            quantity: shopQty,
            from: '',
            to: 'Shop',
            jobName: '',
            address: '',
            lat: '',
            lon: ''
        });
        
        // ✅ Reload from Google Sheets
        await loadInventory();
        
        // Clear form
        document.getElementById('partName').value = '';
        document.getElementById('partNumber').value = '';
        document.getElementById('partBarcode').value = '';
        document.getElementById('partPrice').value = '';
        document.getElementById('partLink').value = '';
        document.getElementById('shopQty').value = '0';
        
        populateDropdowns();
        updateDashboard();
        showProcessing(false);
        showToast('Part added and synced!');
    } catch (error) {
        showProcessing(false);
        console.error('Add part error:', error);
        showToast('Error adding part', 'error');
    }
}

async function loadTruck() {
    if (!hasPermission('loadTruck')) {
        showToast('No permission', 'error');
        return;
    }
    
    const partId = document.getElementById('loadPart').value;
    const qty = parseInt(document.getElementById('loadQty').value);
    const truck = document.getElementById('loadTruck').value;
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    // ✅ Reload inventory first
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part.shop < qty) {
        showProcessing(false);
        showToast(`Only ${part.shop} available in shop`, 'error');
        return;
    }
    
    try {
        // ✅ Update only the specific quantities
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    shop: part.shop - qty,
                    [truck]: part[truck] + qty
                }
            })
        });
        
        const location = await getLocation();
        const truckName = trucks[truck]?.name || truck;
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Loaded Truck',
            details: `${part.name}: ${qty} loaded onto ${truckName}`,
            quantity: qty,
            from: 'Shop',
            to: truckName,
            jobName: '',
            address: location ? location.address : '',
            lat: location ? location.lat : '',
            lon: location ? location.lon : ''
        });
        
        // ✅ Reload from Google Sheets
        await loadInventory();
        
        // Clear form
        document.getElementById('loadBarcode').value = '';
        document.getElementById('loadQty').value = '1';
        document.getElementById('loadPart').value = '';
        
        updateDashboard();
        showProcessing(false);
        showToast(`${qty} loaded onto ${truckName}!`);
    } catch (error) {
        showProcessing(false);
        console.error('Load truck error:', error);
        showToast('Error loading truck', 'error');
    }
}

async function returnToShop() {
    if (!hasPermission('loadTruck')) {
        showToast('No permission', 'error');
        return;
    }
    
    const truck = document.getElementById('returnTruck').value;
    const partId = document.getElementById('returnPart').value;
    const qty = parseInt(document.getElementById('returnQty').value);
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    // ✅ Reload inventory first
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part[truck] < qty) {
        showProcessing(false);
        showToast(`Only ${part[truck]} available on truck`, 'error');
        return;
    }
    
    try {
        // ✅ Update only the specific quantities
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    [truck]: part[truck] - qty,
                    shop: part.shop + qty
                }
            })
        });
        
        const location = await getLocation();
        const truckName = trucks[truck]?.name || truck;
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Returned to Shop',
            details: `${part.name}: ${qty} returned from ${truckName}`,
            quantity: qty,
            from: truckName,
            to: 'Shop',
            jobName: '',
            address: location ? location.address : '',
            lat: location ? location.lat : '',
            lon: location ? location.lon : ''
        });
        
        // ✅ Reload from Google Sheets
        await loadInventory();
        
        // Clear form
        document.getElementById('returnBarcode').value = '';
        document.getElementById('returnQty').value = '1';
        document.getElementById('returnPart').value = '';
        updateReturnPartsList();
        
        updateDashboard();
        showProcessing(false);
        showToast(`${qty} returned to shop!`);
    } catch (error) {
        showProcessing(false);
        console.error('Return error:', error);
        showToast('Error returning to shop', 'error');
    }
}

async function useParts() {
    if (!hasPermission('useParts')) {
        showToast('No permission', 'error');
        return;
    }
    
    const truck = document.getElementById('usePartsTruck').value;
    const partId = document.getElementById('usePartsPart').value;
    const qty = parseInt(document.getElementById('usePartsQty').value);
    const jobName = document.getElementById('jobName').value.trim() || 'Job';
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    // ✅ Reload inventory first
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part[truck] < qty) {
        showProcessing(false);
        showToast(`Only ${part[truck]} available on truck`, 'error');
        return;
    }
    
    try {
        // ✅ Update only the specific quantity
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    [truck]: part[truck] - qty
                }
            })
        });
        
        const location = await getLocation();
        const truckName = trucks[truck]?.name || truck;
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Used on Job',
            details: `${part.name}: ${qty} used from ${truckName}`,
            quantity: qty,
            from: truckName,
            to: 'Customer',
            jobName: jobName,
            address: location ? location.address : '',
            lat: location ? location.lat : '',
            lon: location ? location.lon : ''
        });
        
        // ✅ Reload from Google Sheets
        await loadInventory();
        
        // Clear form
        document.getElementById('usePartsBarcode').value = '';
        document.getElementById('jobName').value = '';
        document.getElementById('usePartsQty').value = '1';
        document.getElementById('usePartsPart').value = '';
        updateUsePartsList();
        
        updateDashboard();
        showProcessing(false);
        showToast('Parts used and logged!');
    } catch (error) {
        showProcessing(false);
        console.error('Use parts error:', error);
        showToast('Error recording usage', 'error');
    }
}

// ============================================
// QUICK LOAD FEATURE
// ============================================
async function updateQuickLoadList() {
    const container = document.getElementById('quickLoadList');
    const btn = document.getElementById('quickLoadBtn');
    
    if (!container) return;
    
    showProcessing(true);
    
    try {
        const response = await fetch(SCRIPT_URL + '?action=getLowStockItems');
        const result = await response.json();
        
        if (result.success && result.items && result.items.length > 0) {
            container.innerHTML = '';
            
            result.items.forEach((item, index) => {
                const div = document.createElement('div');
                div.className = 'quick-load-item';
                
                let needsText = '';
                Object.keys(item.needed).forEach(truckId => {
                    const truckName = trucks[truckId]?.name || truckId;
                    needsText += `${truckName} needs: ${item.needed[truckId]} | `;
                });
                needsText += `Shop has: ${item.shopQty}`;
                
                div.innerHTML = `
                    <input type="checkbox" class="quick-load-checkbox" data-part-id="${item.id}" data-index="${index}">
                    <div style="flex: 1;">
                        <strong>${item.name}</strong>
                        <br><small style="color: #666;">${needsText}</small>
                    </div>
                `;
                
                // Store the needed quantities
                div.dataset.needed = JSON.stringify(item.needed);
                
                container.appendChild(div);
            });
            
            btn.style.display = 'block';
        } else {
            container.innerHTML = '<p style="color: #28a745;">✅ All trucks are fully stocked!</p>';
            btn.style.display = 'none';
        }
        
        showProcessing(false);
    } catch (error) {
        showProcessing(false);
        console.error('Quick load error:', error);
        container.innerHTML = '<p style="color: #e74c3c;">Error loading data</p>';
    }
}

async function processQuickLoad() {
    const checkboxes = document.querySelectorAll('.quick-load-checkbox:checked');
    
    if (checkboxes.length === 0) {
        showToast('Select at least one item', 'error');
        return;
    }
    
    showProcessing(true);
    
    // ✅ Reload inventory first
    await loadInventory();
    
    try {
        const updates = [];
        
        for (const checkbox of checkboxes) {
            const partId = checkbox.getAttribute('data-part-id');
            const item = checkbox.closest('.quick-load-item');
            const needed = JSON.parse(item.dataset.needed);
            
            const part = inventory[partId];
            
            // Build updates object for all trucks
            const partUpdates = { shop: part.shop };
            
            Object.keys(needed).forEach(truckId => {
                const qty = needed[truckId];
                if (part.shop >= qty) {
                    partUpdates.shop -= qty;
                    partUpdates[truckId] = part[truckId] + qty;
                    
                    updates.push({
                        partName: part.name,
                        truck: truckId,
                        qty: qty
                    });
                }
            });
            
            // ✅ Update this part's quantities
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'updatePartQuantity',
                    partId: partId,
                    updates: partUpdates
                })
            });
        }
        
        // Log transactions
        const location = await getLocation();
        for (const update of updates) {
            const truckName = trucks[update.truck]?.name || update.truck;
            await addTransaction({
                timestamp: new Date().toLocaleString(),
                tech: currentUser,
                action: 'Quick Load',
                details: `${update.partName}: ${update.qty} loaded onto ${truckName}`,
                quantity: update.qty,
                from: 'Shop',
                to: truckName,
                jobName: '',
                address: location ? location.address : '',
                lat: location ? location.lat : '',
                lon: location ? location.lon : ''
            });
        }
        
        // ✅ Reload from Google Sheets
        await loadInventory();
        updateDashboard();
        await updateQuickLoadList();
        
        showProcessing(false);
        showToast(`${updates.length} item${updates.length !== 1 ? 's' : ''} loaded!`);
    } catch (error) {
        showProcessing(false);
        console.error('Quick load error:', error);
        showToast('Error processing quick load', 'error');
    }
}

// ============================================
// DROPDOWNS & LISTS
// ============================================
function populateCategoryDropdown(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select Category --</option>';
    
    function addCategoryOptions(parentId = null, prefix = '') {
        const sorted = Object.keys(categories)
            .filter(id => categories[id].parent === parentId)
            .sort((a, b) => (categories[a].order || 0) - (categories[b].order || 0));
        
        sorted.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = prefix + categories[id].name;
            select.appendChild(opt);
            
            addCategoryOptions(id, prefix + '  ');
        });
    }
    
    addCategoryOptions();
}

function populateDropdowns() {
    populateCategoryDropdown('partCategory');
    
    // Load Truck screen
    const loadPart = document.getElementById('loadPart');
    if (loadPart) {
        loadPart.innerHTML = '<option value="">-- Select Part --</option>';
        
        const byCategory = {};
        Object.keys(inventory).forEach(id => {
            const catId = inventory[id].category || 'other';
            const catPath = getCategoryPath(catId);
            if (!byCategory[catPath]) byCategory[catPath] = [];
            byCategory[catPath].push({id, name: inventory[id].name});
        });
        
        Object.keys(byCategory).sort().forEach(catPath => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = catPath;
            
            // Sort parts alphabetically within category
            byCategory[catPath].sort((a, b) => a.name.localeCompare(b.name));
            
            byCategory[catPath].forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.name;
                optgroup.appendChild(opt);
            });
            loadPart.appendChild(optgroup);
        });
    }
    
    const loadTruck = document.getElementById('loadTruck');
    if (loadTruck) {
        loadTruck.innerHTML = '';
        Object.keys(trucks).filter(id => trucks[id].active).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = trucks[id].name;
            loadTruck.appendChild(opt);
        });
        if (userTruck && trucks[userTruck]) {
            loadTruck.value = userTruck;
        }
    }
    
    // Return to Shop screen
    const returnTruck = document.getElementById('returnTruck');
    if (returnTruck) {
        returnTruck.innerHTML = '';
        Object.keys(trucks).filter(id => trucks[id].active).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = trucks[id].name;
            returnTruck.appendChild(opt);
        });
        if (userTruck && trucks[userTruck]) {
            returnTruck.value = userTruck;
        }
        updateReturnPartsList();
    }
    
    // Use Parts screen
    const usePartsTruck = document.getElementById('usePartsTruck');
    if (usePartsTruck) {
        usePartsTruck.innerHTML = '';
        Object.keys(trucks).filter(id => trucks[id].active).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = trucks[id].name;
            usePartsTruck.appendChild(opt);
        });
        if (userTruck && trucks[userTruck]) {
            usePartsTruck.value = userTruck;
        }
        updateUsePartsList();
    }
}

function updateReturnPartsList() {
    const truck = document.getElementById('returnTruck')?.value;
    const select = document.getElementById('returnPart');
    if (!select || !truck) return;
    
    select.innerHTML = '<option value="">-- Select Part --</option>';
    
    const byCategory = {};
    Object.keys(inventory).forEach(id => {
        const part = inventory[id];
        if (part[truck] > 0) {
            const catPath = getCategoryPath(part.category);
            if (!byCategory[catPath]) byCategory[catPath] = [];
            byCategory[catPath].push({id, name: part.name, qty: part[truck]});
        }
    });
    
    Object.keys(byCategory).sort().forEach(catPath => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = catPath;
        
        // Sort alphabetically
        byCategory[catPath].sort((a, b) => a.name.localeCompare(b.name));
        
        byCategory[catPath].forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name} (${item.qty})`;
            optgroup.appendChild(opt);
        });
        select.appendChild(optgroup);
    });
}

function updateUsePartsList() {
    const truck = document.getElementById('usePartsTruck')?.value;
    const select = document.getElementById('usePartsPart');
    if (!select || !truck) return;
    
    select.innerHTML = '<option value="">-- Select Part --</option>';
    
    const byCategory = {};
    Object.keys(inventory).forEach(id => {
        const part = inventory[id];
        if (part[truck] > 0) {
            const catPath = getCategoryPath(part.category);
            if (!byCategory[catPath]) byCategory[catPath] = [];
            byCategory[catPath].push({id, name: part.name, qty: part[truck]});
        }
    });
    
    Object.keys(byCategory).sort().forEach(catPath => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = catPath;
        
        // Sort alphabetically
        byCategory[catPath].sort((a, b) => a.name.localeCompare(b.name));
        
        byCategory[catPath].forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = `${item.name} (${item.qty})`;
            optgroup.appendChild(opt);
        });
        select.appendChild(optgroup);
    });
}

// ============================================
// DASHBOARD & SEARCH
// ============================================
function updateDashboard() {
    const statsContainer = document.getElementById('statsContainer');
    if (!statsContainer) return;
    
    const shopTotal = Object.values(inventory).reduce((sum, p) => sum + p.shop, 0);
    
    let statsHTML = `
        <div class="stat-card"><h3>${Object.keys(inventory).length}</h3><p>Total Parts</p></div>
        <div class="stat-card"><h3>${shopTotal}</h3><p>Shop</p></div>
    `;
    
    Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
        const total = Object.values(inventory).reduce((sum, p) => sum + (p[truckId] || 0), 0);
        statsHTML += `<div class="stat-card"><h3>${total}</h3><p>${trucks[truckId].name}</p></div>`;
    });
    
    statsContainer.innerHTML = statsHTML;
    
    renderInventoryTable();
}

function renderInventoryTable(filteredInventory = null) {
    const tbody = document.getElementById('inventoryBody');
    const header = document.getElementById('inventoryHeader');
    if (!tbody || !header) return;
    
    let headerHTML = '<th>Part</th><th>Category</th><th>Part #</th><th>Shop</th>';
    Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
        headerHTML += `<th>${trucks[truckId].name}</th>`;
    });
    headerHTML += '<th>Min</th><th>Status</th>';
    header.innerHTML = headerHTML;
    
    tbody.innerHTML = '';
    
    const displayInventory = filteredInventory || inventory;
    
    const byCategory = {};
    Object.keys(displayInventory).forEach(id => {
        const catPath = getCategoryPath(displayInventory[id].category);
        if (!byCategory[catPath]) byCategory[catPath] = [];
        byCategory[catPath].push({id, ...displayInventory[id]});
    });
    
    Object.keys(byCategory).sort().forEach(catPath => {
        // Sort parts alphabetically within category
        byCategory[catPath].sort((a, b) => a.name.localeCompare(b.name));
        
        byCategory[catPath].forEach(p => {
            const row = tbody.insertRow();
            if (p.shop < p.minStock) row.classList.add('low-stock');
            
            let rowHTML = `
                <td><strong>${p.name}</strong></td>
                <td>${catPath}</td>
                <td>${p.partNumber}</td>
                <td>${p.shop}</td>
            `;
            
            Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
                rowHTML += `<td>${p[truckId] || 0}</td>`;
            });
            
            rowHTML += `
                <td>${p.minStock}</td>
                <td>${p.shop < p.minStock ? '⚠️ LOW' : '✅ OK'}</td>
            `;
            
            row.innerHTML = rowHTML;
        });
    });
}

function filterInventory(searchTerm) {
    if (!searchTerm) {
        renderInventoryTable();
        return;
    }
    
    const term = searchTerm.toLowerCase();
    const filtered = {};
    
    Object.keys(inventory).forEach(id => {
        const part = inventory[id];
        if (part.name.toLowerCase().includes(term) || 
            part.partNumber.toLowerCase().includes(term) ||
            getCategoryPath(part.category).toLowerCase().includes(term)) {
            filtered[id] = part;
        }
    });
    
    renderInventoryTable(filtered);
}

// ============================================
// HISTORY
// ============================================
function updateHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    
    const canEdit = hasPermission('editHistory');
    
    // Show/hide clear history button
    const clearBtn = document.getElementById('clearHistoryBtn');
    if (clearBtn) {
        clearBtn.style.display = canEdit ? 'block' : 'none';
    }
    
    if (history.length === 0) {
        list.innerHTML = '<p>No activity yet</p>';
        return;
    }
    
    // Filter history based on permissions
    const displayHistory = isOwner ? history : history.filter(e => e.tech === currentUser);
    
    list.innerHTML = displayHistory.map(e => `
        <div class="history-item">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <strong>${e.action}</strong> - ${e.details}
                    <span class="tech-badge">${e.tech}</span>
                    <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                        📅 ${e.timestamp}
                        ${e.address ? `<br>📍 ${e.address}` : ''}
                        ${e.jobName && e.jobName !== 'Job' ? `<br>👤 ${e.jobName}` : ''}
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function clearHistory() {
    if (!hasPermission('editHistory')) {
        showToast('No permission', 'error');
        return;
    }
    if (!confirm('This will clear the transaction log in the app only. Google Sheets history will remain. Continue?')) return;
    
    history = [];
    updateHistory();
    showToast('Local history cleared');
}

// ============================================
// CATEGORIES
// ============================================
function getCategoryPath(categoryId) {
    if (!categoryId || !categories[categoryId]) return 'Uncategorized';
    
    const path = [];
    let current = categoryId;
    let depth = 0;
    
    while (current && depth < 10) {
        if (!categories[current]) break;
        path.unshift(categories[current].name);
        current = categories[current].parent;
        depth++;
    }
    
    return path.join(' > ');
}

function updateCategoryManager() {
    if (!hasPermission('manageCategories')) return;
    
    const container = document.getElementById('categoryList');
    if (!container) return;
    
    populateCategoryParentDropdown();
    
    container.innerHTML = '';
    
    function renderCategory(id, level = 0) {
        const cat = categories[id];
        const div = document.createElement('div');
        div.style.cssText = `
            padding: 15px;
            background: white;
            border-radius: 8px;
            margin-bottom: 10px;
            margin-left: ${level * 30}px;
            border-left: ${level > 0 ? '3px solid #667eea' : 'none'};
        `;
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${cat.name}</strong>
                    ${cat.parent ? `<small style="color: #666;"> → under ${categories[cat.parent]?.name}</small>` : ''}
                </div>
                <div>
                    <button class="btn btn-secondary" style="padding: 6px 12px; margin-right: 5px;" onclick="editCategory('${id}')">Edit</button>
                    <button class="btn btn-danger" style="padding: 6px 12px;" onclick="deleteCategory('${id}')">Delete</button>
                </div>
            </div>
        `;
        
        container.appendChild(div);
        
        Object.keys(categories)
            .filter(childId => categories[childId].parent === id)
            .sort((a, b) => (categories[a].order || 0) - (categories[b].order || 0))
            .forEach(childId => renderCategory(childId, level + 1));
    }
    
    Object.keys(categories)
        .filter(id => !categories[id].parent)
        .sort((a, b) => (categories[a].order || 0) - (categories[b].order || 0))
        .forEach(id => renderCategory(id));
}

async function addCategory() {
    if (!hasPermission('manageCategories')) {
        showToast('No permission', 'error');
        return;
    }
    
    const name = document.getElementById('newCategoryName').value.trim();
    const parent = document.getElementById('newCategoryParent').value || null;
    
    if (!name) {
        showToast('Enter category name', 'error');
        return;
    }
    
    showProcessing(true);
    
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
    const maxOrder = Math.max(0, ...Object.values(categories).map(c => c.order || 0));
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveCategory',
                id: id,
                name: name,
                parent: parent,
                order: maxOrder + 1
            })
        });
        
        await loadCategories();
        populateDropdowns();
        updateCategoryManager();
        
        document.getElementById('newCategoryName').value = '';
        document.getElementById('newCategoryParent').value = '';
        
        showProcessing(false);
        showToast('Category added!');
    } catch (error) {
        showProcessing(false);
        console.error('Add category error:', error);
        showToast('Error adding category', 'error');
    }
}

async function editCategory(id) {
    if (!hasPermission('manageCategories')) {
        showToast('No permission', 'error');
        return;
    }
    
    const cat = categories[id];
    const newName = prompt('Edit category name:', cat.name);
    if (!newName || newName === cat.name) return;
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveCategory',
                id: id,
                name: newName,
                parent: cat.parent,
                order: cat.order
            })
        });
        
        await loadCategories();
        populateDropdowns();
        updateCategoryManager();
        
        showProcessing(false);
        showToast('Category updated!');
    } catch (error) {
        showProcessing(false);
        console.error('Edit category error:', error);
        showToast('Error updating category', 'error');
    }
}

async function deleteCategory(id) {
    if (!hasPermission('manageCategories')) {
        showToast('No permission', 'error');
        return;
    }
    
    const hasChildren = Object.values(categories).some(c => c.parent === id);
    if (hasChildren) {
        showToast('Cannot delete category with subcategories', 'error');
        return;
    }
    
    const partsInCategory = Object.values(inventory).filter(p => p.category === id).length;
    if (partsInCategory > 0) {
        if (!confirm(`${partsInCategory} parts use this category. They will be moved to "Other". Continue?`)) return;
    }
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ 
                action: 'deleteCategory',
                id: id 
            })
        });
        
        await loadCategories();
        await loadInventory();
        populateDropdowns();
        updateCategoryManager();
        
        showProcessing(false);
        showToast('Category deleted!');
    } catch (error) {
        showProcessing(false);
        console.error('Delete category error:', error);
        showToast('Error deleting category', 'error');
    }
}

function populateCategoryParentDropdown() {
    const select = document.getElementById('newCategoryParent');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Top Level --</option>';
    
    function addOptions(parentId = null, prefix = '') {
        const sorted = Object.keys(categories)
            .filter(id => categories[id].parent === parentId)
            .sort((a, b) => (categories[a].order || 0) - (categories[b].order || 0));
        
        sorted.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = prefix + categories[id].name;
            select.appendChild(opt);
            
            addOptions(id, prefix + '  ');
        });
    }
    
    addOptions();
}

// ============================================
// TRUCKS
// ============================================
function updateTruckManager() {
    if (!hasPermission('manageTrucks')) return;
    
    const container = document.getElementById('truckList');
    if (!container) return;
    
    container.innerHTML = '';
    
    Object.keys(trucks).forEach(truckId => {
        const truck = trucks[truckId];
        const div = document.createElement('div');
        div.style.cssText = 'padding: 15px; background: white; border-radius: 8px; margin-bottom: 10px;';
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>${truck.name}</strong>
                    <span style="margin-left: 10px; padding: 4px 8px; background: ${truck.active ? '#d4edda' : '#f8d7da'}; color: ${truck.active ? '#155724' : '#721c24'}; border-radius: 5px; font-size: 0.85em;">
                        ${truck.active ? 'Active' : 'Inactive'}
                    </span>
                </div>
                <div>
                    <button class="btn btn-secondary" style="padding: 6px 12px; margin-right: 5px;" onclick="editTruck('${truckId}')">Edit</button>
                    <button class="btn ${truck.active ? 'btn-warning' : 'btn-success'}" style="padding: 6px 12px; margin-right: 5px;" onclick="toggleTruckActive('${truckId}')">
                        ${truck.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="btn btn-danger" style="padding: 6px 12px;" onclick="deleteTruck('${truckId}')">Delete</button>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

async function addTruck() {
    if (!hasPermission('manageTrucks')) {
        showToast('No permission', 'error');
        return;
    }
    
    const name = document.getElementById('newTruckName').value.trim();
    
    if (!name) {
        showToast('Enter truck name', 'error');
        return;
    }
    
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    
    if (trucks[id]) {
        showToast('Truck already exists', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveTruck',
                id: id,
                name: name,
                active: true
            })
        });
        
        await loadTrucks();
        await loadInventory();
        populateDropdowns();
        updateTruckManager();
        updateDashboard();
        
        document.getElementById('newTruckName').value = '';
        showProcessing(false);
        showToast('Truck added!');
    } catch (error) {
        showProcessing(false);
        console.error('Add truck error:', error);
        showToast('Error adding truck', 'error');
    }
}

async function editTruck(truckId) {
    if (!hasPermission('manageTrucks')) {
        showToast('No permission', 'error');
        return;
    }
    
    const truck = trucks[truckId];
    const newName = prompt('Edit truck name:', truck.name);
    if (!newName || newName === truck.name) return;
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveTruck',
                id: truckId,
                name: newName,
                active: truck.active
            })
        });
        
        await loadTrucks();
        updateTruckManager();
        updateDashboard();
        populateDropdowns();
        
        showProcessing(false);
        showToast('Truck updated!');
    } catch (error) {
        showProcessing(false);
        console.error('Edit truck error:', error);
        showToast('Error updating truck', 'error');
    }
}

async function toggleTruckActive(truckId) {
    if (!hasPermission('manageTrucks')) {
        showToast('No permission', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        const truck = trucks[truckId];
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveTruck',
                id: truckId,
                name: truck.name,
                active: !truck.active
            })
        });
        
        await loadTrucks();
        updateTruckManager();
        updateDashboard();
        populateDropdowns();
        
        showProcessing(false);
        showToast(`Truck ${!truck.active ? 'activated' : 'deactivated'}!`);
    } catch (error) {
        showProcessing(false);
        console.error('Toggle truck error:', error);
        showToast('Error updating truck', 'error');
    }
}

async function deleteTruck(truckId) {
    if (!hasPermission('manageTrucks')) {
        showToast('No permission', 'error');
        return;
    }
    
    const truck = trucks[truckId];
    
    // Check if any user assigned
    const usersOnTruck = Object.values(users).filter(u => u.truck === truckId);
    if (usersOnTruck.length > 0) {
        showToast('Cannot delete truck with assigned users', 'error');
        return;
    }
    
    // Check if has inventory
    const hasInventory = Object.values(inventory).some(p => (p[truckId] || 0) > 0);
    if (hasInventory) {
        if (!confirm(`${truck.name} has parts on it. They will be lost. Continue?`)) return;
    }
    
    if (!confirm(`Delete ${truck.name}?`)) return;
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ 
                action: 'deleteTruck',
                id: truckId 
            })
        });
        
        await loadTrucks();
        await loadInventory();
        updateTruckManager();
        updateDashboard();
        populateDropdowns();
        
        showProcessing(false);
        showToast('Truck deleted!');
    } catch (error) {
        showProcessing(false);
        console.error('Delete truck error:', error);
        showToast('Error deleting truck', 'error');
    }
}

// ============================================
// USER MANAGEMENT
// ============================================
function updateUserList() {
    const list = document.getElementById('userList');
    if (!list) return;
    
    // Populate truck dropdown
    const truckSelect = document.getElementById('newUserTruck');
    if (truckSelect) {
        truckSelect.innerHTML = '';
        Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
            const opt = document.createElement('option');
            opt.value = truckId;
            opt.textContent = trucks[truckId].name;
            truckSelect.appendChild(opt);
        });
    }
    
    list.innerHTML = '';
    Object.keys(users).forEach(pin => {
        const user = users[pin];
        const div = document.createElement('div');
        div.style.cssText = 'padding: 15px; background: white; border-radius: 8px; margin-bottom: 15px;';
        
        const truckName = trucks[user.truck]?.name || user.truck;
        const showPin = (pin === currentUserPin || isOwner);
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                <div style="flex: 1;">
                    <strong style="font-size: 1.1em;">${user.name}</strong> ${user.isOwner ? '<span style="background: #ffc107; padding: 2px 8px; border-radius: 5px; font-size: 0.85em;">Owner</span>' : ''}
                    <br><small style="color: #666;">PIN: ${showPin ? pin : '••••'} | Truck: ${truckName}</small>
                    ${showPin ? `<br><button class="btn btn-secondary" style="padding: 4px 10px; margin-top: 5px; font-size: 0.85em;" onclick="editUserPin('${pin}')">Change PIN</button>` : ''}
                    ${isOwner ? `<button class="btn btn-secondary" style="padding: 4px 10px; margin-left: 5px; font-size: 0.85em;" onclick="editUserTruck('${pin}')">Change Truck</button>` : ''}
                </div>
                ${!user.isOwner && isOwner ? `
                    <div>
                        <button class="btn btn-success" style="padding: 6px 12px; margin-right: 5px;" onclick="makeManager('${pin}')">Make Manager</button>
                        <button class="btn btn-danger" style="padding: 6px 12px;" onclick="deleteUser('${pin}')">Delete</button>
                    </div>
                ` : ''}
            </div>
            ${!user.isOwner && isOwner ? `
                <div style="background: #f8f9fa; padding: 12px; border-radius: 5px; margin-top: 10px;">
                    <strong>Permissions:</strong><br>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; margin-top: 8px;">
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.addParts ? 'checked' : ''} onchange="togglePermission('${pin}', 'addParts', this.checked)" style="margin-right: 8px;">
                            <span>Add Parts</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.editParts ? 'checked' : ''} onchange="togglePermission('${pin}', 'editParts', this.checked)" style="margin-right: 8px;">
                            <span>Edit Parts</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.deleteParts ? 'checked' : ''} onchange="togglePermission('${pin}', 'deleteParts', this.checked)" style="margin-right: 8px;">
                            <span>Delete Parts</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.loadTruck ? 'checked' : ''} onchange="togglePermission('${pin}', 'loadTruck', this.checked)" style="margin-right: 8px;">
                            <span>Load/Return Truck</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.useParts ? 'checked' : ''} onchange="togglePermission('${pin}', 'useParts', this.checked)" style="margin-right: 8px;">
                            <span>Use Parts on Jobs</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.viewHistory ? 'checked' : ''} onchange="togglePermission('${pin}', 'viewHistory', this.checked)" style="margin-right: 8px;">
                            <span>View History</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.editHistory ? 'checked' : ''} onchange="togglePermission('${pin}', 'editHistory', this.checked)" style="margin-right: 8px;">
                            <span>Edit/Delete History</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.manageUsers ? 'checked' : ''} onchange="togglePermission('${pin}', 'manageUsers', this.checked)" style="margin-right: 8px;">
                            <span>Manage Users</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.manageCategories ? 'checked' : ''} onchange="togglePermission('${pin}', 'manageCategories', this.checked)" style="margin-right: 8px;">
                            <span>Manage Categories</span>
                        </label>
                        <label style="display: flex; align-items: center;">
                            <input type="checkbox" ${user.permissions.manageTrucks ? 'checked' : ''} onchange="togglePermission('${pin}', 'manageTrucks', this.checked)" style="margin-right: 8px;">
                            <span>Manage Trucks</span>
                        </label>
                    </div>
                </div>
            ` : user.isOwner ? `
                <div style="background: #fff3cd; padding: 12px; border-radius: 5px; margin-top: 10px; border: 2px solid #ffc107;">
                    <strong>🔐 Owner Account</strong>
                    <br><small>Full access to all features. Cannot be deleted or have permissions modified.</small>
                </div>
            ` : ''}
        `;
        
        list.appendChild(div);
    });
}

async function addUser() {
    if (!hasPermission('manageUsers')) {
        showToast('No permission', 'error');
        return;
    }
    
    const name = document.getElementById('newUserName').value.trim();
    const pin = document.getElementById('newUserPin').value.trim();
    const truck = document.getElementById('newUserTruck').value;
    
    if (!name || !pin || !truck) {
        showToast('Fill all fields', 'error');
        return;
    }
    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
        showToast('PIN must be 4 digits', 'error');
        return;
    }
    if (users[pin]) {
        showToast('PIN already in use', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveUser',
                pin: pin,
                name: name,
                truck: truck,
                isOwner: false,
                permissions: {
                    addParts: false,
                    editParts: false,
                    deleteParts: false,
                    loadTruck: true,
                    useParts: true,
                    viewHistory: true,
                    editHistory: false,
                    manageUsers: false,
                    manageCategories: false,
                    manageTrucks: false
                }
            })
        });
        
        // Reload users
        const response = await fetch(SCRIPT_URL + '?action=readUsers');
        const result = await response.json();
        if (result.success && result.data) {
            users = {};
            for (let i = 1; i < result.data.length; i++) {
                const row = result.data[i];
                if (row[0]) {
                    users[row[0]] = {
                        name: row[1],
                        truck: row[2],
                        isOwner: (row[3] === 'TRUE' || row[3] === true),
                        permissions: {
                            addParts: (row[4] === 'TRUE' || row[4] === true),
                            editParts: (row[5] === 'TRUE' || row[5] === true),
                            deleteParts: (row[6] === 'TRUE' || row[6] === true),
                            loadTruck: (row[7] === 'TRUE' || row[7] === true),
                            useParts: (row[8] === 'TRUE' || row[8] === true),
                            viewHistory: (row[9] === 'TRUE' || row[9] === true),
                            editHistory: (row[10] === 'TRUE' || row[10] === true),
                            manageUsers: (row[11] === 'TRUE' || row[11] === true),
                            manageCategories: (row[12] === 'TRUE' || row[12] === true),
                            manageTrucks: (row[13] === 'TRUE' || row[13] === true)
                        }
                    };
                }
            }
        }
        
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserPin').value = '';
        updateUserList();
        
        showProcessing(false);
        showToast(`${name} added!`);
    } catch (error) {
        showProcessing(false);
        console.error('Add user error:', error);
        showToast('Error adding user', 'error');
    }
}

async function editUserPin(oldPin) {
    const user = users[oldPin];
    const canEdit = (oldPin === currentUserPin || isOwner);
    
    if (!canEdit) {
        showToast('No permission', 'error');
        return;
    }
    
    const newPin = prompt(`Enter new PIN for ${user.name} (4 digits):`, oldPin);
    
    if (!newPin) return;
    if (newPin === oldPin) return;
    if (newPin.length !== 4 || !/^\d+$/.test(newPin)) {
        showToast('PIN must be 4 digits', 'error');
        return;
    }
    if (users[newPin]) {
        showToast('PIN already in use', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        // Save user with new PIN
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveUser',
                pin: newPin,
                name: user.name,
                truck: user.truck,
                isOwner: user.isOwner,
                permissions: user.permissions
            })
        });
        
        // Delete old PIN
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ 
                action: 'deleteUser',
                pin: oldPin 
            })
        });
        
        // Update current user PIN if it was their own
        if (oldPin === currentUserPin) {
            currentUserPin = newPin;
        }
        
        // Reload users
        const response = await fetch(SCRIPT_URL + '?action=readUsers');
        const result = await response.json();
        if (result.success && result.data) {
            users = {};
            for (let i = 1; i < result.data.length; i++) {
                const row = result.data[i];
                if (row[0]) {
                    users[row[0]] = {
                        name: row[1],
                        truck: row[2],
                        isOwner: (row[3] === 'TRUE' || row[3] === true),
                        permissions: {
                            addParts: (row[4] === 'TRUE' || row[4] === true),
                            editParts: (row[5] === 'TRUE' || row[5] === true),
                            deleteParts: (row[6] === 'TRUE' || row[6] === true),
                            loadTruck: (row[7] === 'TRUE' || row[7] === true),
                            useParts: (row[8] === 'TRUE' || row[8] === true),
                            viewHistory: (row[9] === 'TRUE' || row[9] === true),
                            editHistory: (row[10] === 'TRUE' || row[10] === true),
                            manageUsers: (row[11] === 'TRUE' || row[11] === true),
                            manageCategories: (row[12] === 'TRUE' || row[12] === true),
                            manageTrucks: (row[13] === 'TRUE' || row[13] === true)
                        }
                    };
                }
            }
        }
        
        updateUserList();
        showProcessing(false);
        showToast('PIN updated!');
    } catch (error) {
        showProcessing(false);
        console.error('Edit PIN error:', error);
        showToast('Error updating PIN', 'error');
    }
}

async function editUserTruck(pin) {
    if (!hasPermission('manageUsers')) {
        showToast('No permission', 'error');
        return;
    }
    
    const user = users[pin];
    const truckOptions = Object.keys(trucks)
        .filter(id => trucks[id].active)
        .map((id, index) => `${index + 1}. ${trucks[id].name}`)
        .join('\n');
    
    const choice = prompt(`Select truck for ${user.name}:\n${truckOptions}\n\nEnter number:`, '1');
    if (!choice) return;
    
    const truckIndex = parseInt(choice) - 1;
    const truckId = Object.keys(trucks).filter(id => trucks[id].active)[truckIndex];
    
    if (!truckId) {
        showToast('Invalid selection', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveUser',
                pin: pin,
                name: user.name,
                truck: truckId,
                isOwner: user.isOwner,
                permissions: user.permissions
            })
        });
        
        users[pin].truck = truckId;
        
        // Update current user truck if it was their own
        if (pin === currentUserPin) {
            userTruck = truckId;
            populateDropdowns();
        }
        
        updateUserList();
        showProcessing(false);
        showToast('Truck updated!');
    } catch (error) {
        showProcessing(false);
        console.error('Edit truck error:', error);
        showToast('Error updating truck', 'error');
    }
}

async function makeManager(pin) {
    if (!hasPermission('manageUsers')) {
        showToast('No permission', 'error');
        return;
    }
    
    const user = users[pin];
    if (!confirm(`Give ${user.name} full management permissions?`)) return;
    
    showProcessing(true);
    
    try {
        const newPermissions = {
            addParts: true,
            editParts: true,
            deleteParts: true,
            loadTruck: true,
            useParts: true,
            viewHistory: true,
            editHistory: true,
            manageUsers: true,
            manageCategories: true,
            manageTrucks: true
        };
        
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveUser',
                pin: pin,
                name: user.name,
                truck: user.truck,
                isOwner: false,
                permissions: newPermissions
            })
        });
        
        users[pin].permissions = newPermissions;
        
        updateUserList();
        showProcessing(false);
        showToast(`${user.name} is now a manager!`);
    } catch (error) {
        showProcessing(false);
        console.error('Make manager error:', error);
        showToast('Error updating permissions', 'error');
    }
}

async function togglePermission(pin, permission, value) {
    if (!hasPermission('manageUsers')) {
        showToast('No permission', 'error');
        return;
    }
    
    const user = users[pin];
    user.permissions[permission] = value;
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveUser',
                pin: pin,
                name: user.name,
                truck: user.truck,
                isOwner: user.isOwner,
                permissions: user.permissions
            })
        });
    } catch (error) {
        console.error('Toggle permission error:', error);
        showToast('Error updating permission', 'error');
    }
}

async function deleteUser(pin) {
    if (!hasPermission('manageUsers')) {
        showToast('No permission', 'error');
        return;
    }
    
    if (pin === currentUserPin) {
        showToast('Cannot delete own account', 'error');
        return;
    }
    
    const user = users[pin];
    if (!confirm(`Delete ${user.name}?`)) return;
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ 
                action: 'deleteUser',
                pin: pin 
            })
        });
        
        delete users[pin];
        
        updateUserList();
        showProcessing(false);
        showToast('User deleted');
    } catch (error) {
        showProcessing(false);
        console.error('Delete user error:', error);
        showToast('Error deleting user', 'error');
    }
}

// ============================================
// LOCATION
// ============================================
async function getLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) {
            resolve(null);
            return;
        }
        
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1`, {
                        headers: {
                            'User-Agent': 'HVAC-Inventory-App'
                        }
                    });
                    const data = await response.json();
                    
                    let address = 'Location captured';
                    if (data && data.address) {
                        const parts = [];
                        
                        if (data.address.house_number) parts.push(data.address.house_number);
                        if (data.address.road) parts.push(data.address.road);
                        else if (data.address.street) parts.push(data.address.street);
                        
                        const locality = data.address.city || 
                                       data.address.town || 
                                       data.address.village || 
                                       data.address.hamlet || 
                                       data.address.municipality ||
                                       data.address.county;
                        if (locality) parts.push(locality);
                        
                        if (data.address.state) parts.push(data.address.state);
                        if (data.address.postcode) parts.push(data.address.postcode);
                        
                        address = parts.join(', ') || data.display_name || 'Location captured';
                    }
                    
                    resolve({ lat: lat.toFixed(6), lon: lon.toFixed(6), address });
                } catch (e) {
                    resolve({ lat: lat.toFixed(6), lon: lon.toFixed(6), address: 'Location captured' });
                }
            },
            () => resolve(null),
            { 
                timeout: 10000,
                enableHighAccuracy: true,
                maximumAge: 0
            }
        );
    });
}

// ============================================
// TRANSACTION LOGGING
// ============================================
async function addTransaction(transaction) {
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'addTransaction',
                transaction: transaction
            })
        });
    } catch (error) {
        console.error('Transaction log error:', error);
    }
}

// ============================================
// UI HELPERS
// ============================================
function showProcessing(show) {
    const overlay = document.getElementById('processingOverlay');
    if (show) {
        overlay.classList.add('show');
    } else {
        overlay.classList.remove('show');
    }
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}
