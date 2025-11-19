// ============================================
// HVAC INVENTORY - COMPLETE v2
// All Features Restored + Improvements
// ============================================

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwQ16GPuzCPNXs9sSs16Bi4Ys3-JsMNyyHoXibRJ9uGirPE5J15b_DvSZ-RDGM_j1k/exec';

// Global State
let inventory = {};
let users = {};
let categories = {};
let trucks = {};
let history = [];
let settings = {};
let currentUser = null;
let currentUserPin = null;
let isOwner = false;
let userTruck = null;
let canEditPIN = false;

// Selected parts
let selectedParts = {
    load: null,
    use: null,
    return: null,
    receive: null,
    transfer: null
};

// PIN Lockout
let loginAttempts = parseInt(localStorage.getItem('loginAttempts') || '0');
let lockoutUntil = parseInt(localStorage.getItem('lockoutUntil') || '0');
const LOCKOUT_TIMES = [0, 0, 0, 0, 0, 60000, 300000, 900000, 1800000, 3600000];

// Barcode Scanner
let codeReader = null;
let currentBarcodeTarget = null;
let scanModeActive = false;
let lastScannedCode = '';
let lastScanTime = 0;

// Image Upload
let uploadedImageUrl = '';

// Current filter state
let currentCategoryFilter = '';
let currentViewMode = 'all';

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    // Initialize ZXing
    if (typeof ZXing !== 'undefined') {
        codeReader = new ZXing.BrowserMultiFormatReader();
    }
    
    // Auto-focus PIN input on desktop
    const pinInput = document.getElementById('pinInput');
    if (pinInput) {
        // Focus immediately
        setTimeout(() => {
            pinInput.focus();
        }, 100);
        
        // Keep focus on PIN input
        pinInput.addEventListener('blur', function() {
            if (document.getElementById('loginScreen').style.display !== 'none') {
                setTimeout(() => this.focus(), 100);
            }
        });
    }
    
    // Login handlers
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('refreshBtn').addEventListener('click', refreshData);
    
    pinInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') login();
    });
    
    pinInput.addEventListener('input', function(e) {
        // Only allow numbers
        this.value = this.value.replace(/[^0-9]/g, '');
        if (this.value.length === 4) {
            setTimeout(() => login(), 100);
        }
    });
    
    // Listen for physical barcode scanner input
    let barcodeBuffer = '';
    let barcodeTimeout = null;
    
    document.addEventListener('keypress', function(e) {
        // Ignore if user is typing in an input field (except during scan mode)
        if (!scanModeActive && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
            return;
        }
        
        // Clear timeout
        clearTimeout(barcodeTimeout);
        
        // Add character to buffer
        if (e.key === 'Enter') {
            // Barcode complete
            if (barcodeBuffer.length > 3) {
                handlePhysicalScannerInput(barcodeBuffer);
            }
            barcodeBuffer = '';
        } else {
            barcodeBuffer += e.key;
            
            // Reset buffer after 100ms of no input
            barcodeTimeout = setTimeout(() => {
                barcodeBuffer = '';
            }, 100);
        }
    });
});

// ============================================
// AUTHENTICATION
// ============================================

async function login() {
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
    
    if (lockoutUntil && Date.now() >= lockoutUntil) {
        lockoutUntil = 0;
        loginAttempts = 0;
        localStorage.setItem('lockoutUntil', '0');
        localStorage.setItem('loginAttempts', '0');
    }
    
    showProcessing(true);
    
    try {
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
                        canEditPIN: (row[4] === 'TRUE' || row[4] === true)
                    };
                }
            }
            
            const user = users[pin];
            
            if (user) {
                loginAttempts = 0;
                lockoutUntil = 0;
                localStorage.setItem('loginAttempts', '0');
                localStorage.setItem('lockoutUntil', '0');
                
                currentUser = user.name;
                currentUserPin = pin;
                isOwner = user.isOwner;
                userTruck = user.truck;
                canEditPIN = user.canEditPIN;
                
                // Log login
                await logLoginHistory(user.name, pin, 'Login', 'User logged in');
                
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('appContainer').style.display = 'block';
                document.getElementById('userBadge').textContent = user.name + (user.isOwner ? ' 👑' : '');
                
                await init();
            } else {
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
                setTimeout(() => {
                    document.getElementById('pinInput').focus();
                }, 100);
            }
        }
    } catch (error) {
        showProcessing(false);
        console.error('Login error:', error);
        showToast('Connection error. Please try again.', 'error');
    }
}

function logout() {
    if (confirm('Logout?')) {
        currentUser = null;
        currentUserPin = null;
        isOwner = false;
        userTruck = null;
        canEditPIN = false;
        document.getElementById('pinInput').value = '';
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('appContainer').style.display = 'none';
        
        // Re-focus PIN input
        setTimeout(() => {
            document.getElementById('pinInput').focus();
        }, 100);
    }
}

async function init() {
    showProcessing(true);
    
    try {
        await loadSettings();
        await new Promise(resolve => setTimeout(resolve, 200));
        
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
        const timestamp = Date.now();
        
        await loadSettings();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadCategories();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadTrucks();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadInventory();
        await new Promise(resolve => setTimeout(resolve, 200));
        
        await loadHistory();
        
        populateDropdowns();
        updateDashboard();
        
        const activeTab = document.querySelector('.content.active');
        if (activeTab) {
            const tabId = activeTab.id;
            if (tabId === 'all-parts') renderAllParts();
            if (tabId === 'quick-load') updateQuickLoadList();
            if (tabId === 'history') updateHistory();
            if (tabId === 'settings') updateSettings();
            if (tabId === 'categories') renderCategoryTree();
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
// DATA LOADING
// ============================================

async function loadSettings() {
    try {
        const response = await fetch(SCRIPT_URL + '?action=readSettings');
        const result = await response.json();
        
        if (result.success && result.data) {
            settings = {};
            for (let i = 1; i < result.data.length; i++) {
                const row = result.data[i];
                if (row[0]) {
                    settings[row[0]] = row[1];
                }
            }
            
            // Set default if not exists
            if (!settings.ActiveSeasons) {
                settings.ActiveSeasons = 'heating,cooling,year-round';
            }
        }
    } catch (error) {
        console.error('Load settings error:', error);
        settings.ActiveSeasons = 'heating,cooling,year-round';
    }
}

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
    const response = await fetch(SCRIPT_URL + '?action=readTrucks');
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
                    id: row[0],
                    name: row[1] || '',
                    category: row[2] || 'other',
                    barcode: row[3] || '',
                    imageUrl: row[4] || '',
                    shop: parseInt(row[5]) || 0
                };
                
                // Add truck quantities
                Object.keys(trucks).forEach(truckId => {
                    const truckColIndex = headers.indexOf(truckId);
                    if (truckColIndex !== -1) {
                        item[truckId] = parseInt(row[truckColIndex]) || 0;
                    } else {
                        item[truckId] = 0;
                    }
                });
                
                // Find MinStock column
                const minStockIndex = headers.indexOf('MinStock');
                if (minStockIndex !== -1) {
                    item.minStock = parseInt(row[minStockIndex]) || 0;
                    
                    // Get per-truck minimums
                    Object.keys(trucks).forEach(truckId => {
                        const minTruckCol = headers.indexOf('MinTruck-' + truckId);
                        if (minTruckCol !== -1) {
                            item['minTruck_' + truckId] = parseInt(row[minTruckCol]) || 0;
                        } else {
                            item['minTruck_' + truckId] = 0;
                        }
                    });
                    
                    item.price = parseFloat(row[minStockIndex + Object.keys(trucks).length + 1]) || 0;
                    item.purchaseLink = row[minStockIndex + Object.keys(trucks).length + 2] || '';
                    item.season = row[minStockIndex + Object.keys(trucks).length + 3] || 'year-round';
                }
                
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
                timestamp: row[0],
                tech: row[1],
                action: row[2],
                details: row[3],
                quantity: row[4],
                from: row[5],
                to: row[6],
                jobName: row[7]
            });
        }
        history.reverse();
    }
}

async function logLoginHistory(userName, pin, action, details) {
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'logLogin',
                userName: userName,
                pin: pin,
                loginAction: action,
                details: details
            })
        });
    } catch (error) {
        console.error('Login history error:', error);
    }
}

// ============================================
// UI BUILDERS
// ============================================

function buildTabs() {
    const tabContainer = document.getElementById('tabContainer');
    tabContainer.innerHTML = '';
    
    const tabs = [
        { id: 'dashboard', label: '⚠️ Low Stock', show: true },
        { id: 'all-parts', label: '📦 Parts', show: true },
        { id: 'quick-actions', label: '⚡ Actions', show: true },
        { id: 'quick-load', label: '🚛 Quick Load', show: true },
        { id: 'receive-stock', label: '📥 Receive', show: true },
        { id: 'add-part', label: '➕ Add Part', show: isOwner },
        { id: 'categories', label: '📁 Categories', show: isOwner },
        { id: 'history', label: '📋 History', show: true },
        { id: 'settings', label: '⚙️ Settings', show: true }
    ];
    
    tabs.forEach((tab, i) => {
        if (tab.show) {
            const btn = document.createElement('button');
            btn.className = 'tab' + (i === 0 ? ' active' : '');
            btn.textContent = tab.label;
            btn.onclick = () => switchTab(tab.id);
            tabContainer.appendChild(btn);
        }
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
    
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        if (tab.textContent.includes(getTabLabel(tabName))) {
            tab.classList.add('active');
        }
    });
    
    const content = document.getElementById(tabName);
    if (content) {
        content.classList.add('active');
        
        // Load tab-specific data
        if (tabName === 'dashboard') updateDashboard();
        if (tabName === 'all-parts') renderAllParts();
        if (tabName === 'quick-load') updateQuickLoadList();
        if (tabName === 'history') updateHistory();
        if (tabName === 'settings') updateSettings();
        if (tabName === 'categories') renderCategoryTree();
    }
}

function getTabLabel(tabId) {
    const labels = {
        'dashboard': 'Low Stock',
        'all-parts': 'Parts',
        'quick-actions': 'Actions',
        'quick-load': 'Quick Load',
        'receive-stock': 'Receive',
        'add-part': 'Add Part',
        'categories': 'Categories',
        'history': 'History',
        'settings': 'Settings'
    };
    return labels[tabId] || tabId;
}

function setupEventListeners() {
    // Search
    document.getElementById('searchAllParts')?.addEventListener('input', function(e) {
        renderAllParts(e.target.value);
    });
    
    document.getElementById('partModalSearch')?.addEventListener('input', function(e) {
        filterPartModal(e.target.value);
    });
    
// Filter buttons
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        const filter = this.getAttribute('data-filter');
        currentViewMode = filter;
        currentBrowsingCategory = null; // Reset when switching modes
        
        // Clear search when switching to browse
        if (filter === 'browse') {
            document.getElementById('searchAllParts').value = '';
        }
        
        renderAllParts();
    });
});
    
    document.getElementById('categoryFilter')?.addEventListener('change', function(e) {
        currentCategoryFilter = e.target.value;
        renderAllParts();
    });
    
    // Quick Actions
    document.getElementById('loadTruckBtn')?.addEventListener('click', loadTruck);
    document.getElementById('usePartsBtn')?.addEventListener('click', useParts);
    document.getElementById('returnBtn')?.addEventListener('click', returnToShop);
    document.getElementById('transferBtn')?.addEventListener('click', transferParts);
    
    // Receive Stock
    document.getElementById('receiveStockBtn')?.addEventListener('click', receiveStock);
    
    // Add Part
    document.getElementById('addPartBtn')?.addEventListener('click', addPart);
    document.getElementById('uploadImageBtn')?.addEventListener('click', () => {
        document.getElementById('partImageFile').click();
    });
    document.getElementById('partImageFile')?.addEventListener('change', handleImageUpload);
    
    // Quick Load
    document.getElementById('quickLoadBtn')?.addEventListener('click', processQuickLoad);
    document.getElementById('quickLoadLocation')?.addEventListener('change', updateQuickLoadList);
    
    // Settings
    document.getElementById('saveSeasonsBtn')?.addEventListener('click', saveActiveSeasons);
    document.getElementById('changePinBtn')?.addEventListener('click', changePIN);
    document.getElementById('addCategoryBtn')?.addEventListener('click', addCategory);
    document.getElementById('addTruckBtn')?.addEventListener('click', addTruck);
    document.getElementById('addUserBtn')?.addEventListener('click', addUser);
    
    // Part selection buttons
    document.querySelectorAll('.part-select-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const context = this.getAttribute('data-context');
            openPartModal(context);
        });
    });
    
    // Barcode scan buttons
    document.querySelectorAll('.barcode-scan-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const target = this.getAttribute('data-target');
            startCameraBarcodeScanner(target);
        });
    });
    
    // Modal close buttons
    document.getElementById('closePartModal')?.addEventListener('click', closePartModal);
    document.getElementById('closePartDetailModal')?.addEventListener('click', closePartDetailModal);
    document.getElementById('closeBarcodeScannerModal')?.addEventListener('click', stopCameraBarcodeScanner);
}

function populateDropdowns() {
    // Categories
    const categorySelect = document.getElementById('partCategory');
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="">-- Select --</option>';
        Object.keys(categories).sort((a, b) => {
            return categories[a].name.localeCompare(categories[b].name);
        }).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = categories[id].name;
            categorySelect.appendChild(opt);
        });
    }
    
    // Category filter
    const categoryFilter = document.getElementById('categoryFilter');
    if (categoryFilter) {
        categoryFilter.innerHTML = '<option value="">All Categories</option>';
        
        // Get root categories
        Object.keys(categories).filter(id => !categories[id].parent).sort((a, b) => {
            return categories[a].name.localeCompare(categories[b].name);
        }).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = categories[id].name;
            categoryFilter.appendChild(opt);
            
            // Add children
            Object.keys(categories).filter(childId => categories[childId].parent === id).forEach(childId => {
                const childOpt = document.createElement('option');
                childOpt.value = childId;
                childOpt.textContent = '  ↳ ' + categories[childId].name;
                categoryFilter.appendChild(childOpt);
            });
        });
    }
    
    // Parent category for adding
    const newCategoryParent = document.getElementById('newCategoryParent');
    if (newCategoryParent) {
        newCategoryParent.innerHTML = '<option value="">Top Level</option>';
        Object.keys(categories).filter(id => !categories[id].parent).sort((a, b) => {
            return categories[a].name.localeCompare(categories[b].name);
        }).forEach(id => {
            const opt = document.createElement('option');
            opt.value = categories[id].name;
            opt.textContent = categories[id].name;
            newCategoryParent.appendChild(opt);
        });
    }
    
    // Trucks
    const truckSelects = ['loadTruck', 'useTruck', 'returnTruck', 'newUserTruck', 'scanTruck', 'transferFromTruck', 'transferToTruck'];
    truckSelects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '';
            Object.keys(trucks).filter(id => trucks[id].active).forEach(id => {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = trucks[id].name;
                select.appendChild(opt);
            });
            if (userTruck && trucks[userTruck]) {
                select.value = userTruck;
            }
        }
    });
    
    // Quick Load location
    const quickLoadLocation = document.getElementById('quickLoadLocation');
    if (quickLoadLocation) {
        while (quickLoadLocation.options.length > 2) {
            quickLoadLocation.remove(2);
        }
        Object.keys(trucks).filter(id => trucks[id].active).forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = `🚚 ${trucks[id].name}`;
            quickLoadLocation.appendChild(opt);
        });
    }
    
    // Truck minimums in Add Part
    renderTruckMinimumsInputs();
}

function renderTruckMinimumsInputs() {
    const container = document.getElementById('truckMinimumsContainer');
    if (!container) return;
    
    container.innerHTML = '';
    Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
        const div = document.createElement('div');
        div.className = 'form-group';
        div.innerHTML = `
            <label>${trucks[truckId].name} Min Stock</label>
            <input type="number" id="minTruck_${truckId}" value="1" min="0" inputmode="numeric">
        `;
        container.appendChild(div);
    });
}

// ============================================
// DASHBOARD - LOW STOCK (USER'S TRUCK FIRST)
// ============================================

function updateDashboard() {
    const container = document.getElementById('lowStockContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Get active seasons
    const activeSeasons = settings.ActiveSeasons ? settings.ActiveSeasons.split(',') : ['heating', 'cooling', 'year-round'];
    
    // User's truck FIRST (if applicable)
    if (userTruck && trucks[userTruck]) {
        const truckLow = Object.keys(inventory).filter(id => {
            const part = inventory[id];
            const minForTruck = part['minTruck_' + userTruck] || 0;
            return part[userTruck] < minForTruck && activeSeasons.includes(part.season);
        });
        
        if (truckLow.length > 0) {
            const section = document.createElement('div');
            section.className = 'low-stock-section';
            section.innerHTML = `<h3>🚚 ${trucks[userTruck].name} (Your Truck) - Low Stock</h3>`;
            
            const grid = document.createElement('div');
            grid.className = 'low-stock-grid';
            
            truckLow.forEach(id => {
                const part = inventory[id];
                const minForTruck = part['minTruck_' + userTruck] || 0;
                const item = document.createElement('div');
                item.className = 'low-stock-item' + (part[userTruck] === 0 ? ' critical' : '');
                
                let imageHTML = '';
                if (part.imageUrl) {
                    imageHTML = `<img src="${part.imageUrl}" alt="${part.name}">`;
                }
                
                item.innerHTML = `
                    ${imageHTML}
                    <strong>${part.name}</strong><br>
                    <small>Part #: ${part.id}</small><br>
                    Current: ${part[userTruck]} | Min: ${minForTruck} | Need: ${minForTruck - part[userTruck]}
                `;
                item.onclick = () => openPartDetail(id);
                grid.appendChild(item);
            });
            
            section.appendChild(grid);
            container.appendChild(section);
        }
    }
    
    // Other trucks
    Object.keys(trucks).filter(id => trucks[id].active && id !== userTruck).forEach(truckId => {
        const truckLow = Object.keys(inventory).filter(id => {
            const part = inventory[id];
            const minForTruck = part['minTruck_' + truckId] || 0;
            return part[truckId] < minForTruck && activeSeasons.includes(part.season);
        });
        
        if (truckLow.length > 0) {
            const section = document.createElement('div');
            section.className = 'low-stock-section';
            section.innerHTML = `<h3>🚚 ${trucks[truckId].name} - Low Stock</h3>`;
            
            const grid = document.createElement('div');
            grid.className = 'low-stock-grid';
            
            truckLow.forEach(id => {
                const part = inventory[id];
                const minForTruck = part['minTruck_' + truckId] || 0;
                const item = document.createElement('div');
                item.className = 'low-stock-item' + (part[truckId] === 0 ? ' critical' : '');
                
                let imageHTML = '';
                if (part.imageUrl) {
                    imageHTML = `<img src="${part.imageUrl}" alt="${part.name}">`;
                }
                
                item.innerHTML = `
                    ${imageHTML}
                    <strong>${part.name}</strong><br>
                    <small>Part #: ${part.id}</small><br>
                    Current: ${part[truckId]} | Min: ${minForTruck} | Need: ${minForTruck - part[truckId]}
                `;
                item.onclick = () => openPartDetail(id);
                grid.appendChild(item);
            });
            
            section.appendChild(grid);
            container.appendChild(section);
        }
    });
    
    // Shop low stock
    const shopLow = Object.keys(inventory).filter(id => {
        const part = inventory[id];
        return part.shop < part.minStock && activeSeasons.includes(part.season);
    });
    
    if (shopLow.length > 0) {
        const section = document.createElement('div');
        section.className = 'low-stock-section';
        section.innerHTML = '<h3>🏪 Shop - Low Stock</h3>';
        
        const grid = document.createElement('div');
        grid.className = 'low-stock-grid';
        
        shopLow.forEach(id => {
            const part = inventory[id];
            const item = document.createElement('div');
            item.className = 'low-stock-item' + (part.shop === 0 ? ' critical' : '');
            
            let imageHTML = '';
            if (part.imageUrl) {
                imageHTML = `<img src="${part.imageUrl}" alt="${part.name}">`;
            }
            
            item.innerHTML = `
                ${imageHTML}
                <strong>${part.name}</strong><br>
                <small>Part #: ${part.id}</small><br>
                Current: ${part.shop} | Min: ${part.minStock} | Need: ${part.minStock - part.shop}
            `;
            item.onclick = () => openPartDetail(id);
            grid.appendChild(item);
        });
        
        section.appendChild(grid);
        container.appendChild(section);
    }
    
    if (container.children.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #28a745; font-size: 1.2em; padding: 40px;">✅ All stock levels are good!</p>';
    }
}

// ============================================
// ALL PARTS VIEW WITH CATEGORIES
// ============================================

// Current category browsing state
let currentBrowsingCategory = null;

function renderAllParts(searchTerm = '') {
    const grid = document.getElementById('allPartsGrid');
    const browser = document.getElementById('categoryBrowser');
    const navGrid = document.getElementById('categoryNavGrid');
    
    if (!grid) return;
    
    grid.innerHTML = '';
    
    // If in browse mode and not searching
    if (currentViewMode === 'browse' && !searchTerm) {
        browser.style.display = 'block';
        
        // Show breadcrumb
        updateBreadcrumb();
        
        // If no category selected, show root categories
        if (!currentBrowsingCategory) {
            navGrid.innerHTML = '';
            
            // Get root categories
            const rootCategories = Object.keys(categories)
                .filter(id => !categories[id].parent)
                .sort((a, b) => categories[a].name.localeCompare(categories[b].name));
            
            rootCategories.forEach(catId => {
                const card = createCategoryCard(catId);
                navGrid.appendChild(card);
            });
            
            // Don't show parts grid when browsing categories
            grid.style.display = 'none';
            return;
        } else {
            // Show subcategories + parts for selected category
            navGrid.innerHTML = '';
            
            // Get subcategories
            const subcategories = Object.keys(categories)
                .filter(id => {
                    const parent = categories[id].parent;
                    if (!parent) return false;
                    // Find parent ID by name
                    const parentId = Object.keys(categories).find(pid => categories[pid].name === parent);
                    return parentId === currentBrowsingCategory;
                })
                .sort((a, b) => categories[a].name.localeCompare(categories[b].name));
            
            subcategories.forEach(catId => {
                const card = createCategoryCard(catId);
                navGrid.appendChild(card);
            });
            
            // Show parts in this category and subcategories
            grid.style.display = 'grid';
            let parts = getPartsInCategory(currentBrowsingCategory);
            
            if (parts.length === 0) {
                grid.innerHTML = '<p style="text-align: center; color: #666; padding: 40px; grid-column: 1 / -1;">No parts in this category</p>';
            } else {
                parts.sort((a, b) => inventory[a].name.localeCompare(inventory[b].name));
                parts.forEach(id => grid.appendChild(createPartCard(id)));
            }
            return;
        }
    } else {
        // Hide category browser when showing all or searching
        browser.style.display = 'none';
        grid.style.display = 'grid';
    }
    
    // Show all parts (with optional search)
    let parts = Object.keys(inventory);
    
    // Filter by search
    if (searchTerm && searchTerm.trim() !== '') {
        const search = searchTerm.toLowerCase().trim();
        parts = parts.filter(id => {
            const part = inventory[id];
            return part.name.toLowerCase().includes(search) ||
                   String(part.id).toLowerCase().includes(search) ||
                   (part.barcode && String(part.barcode).toLowerCase().includes(search));
        });
    }
    
    // Show all alphabetically
    parts.sort((a, b) => {
        return inventory[a].name.localeCompare(inventory[b].name);
    });
    
    parts.forEach(id => {
        grid.appendChild(createPartCard(id));
    });
    
    if (parts.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No parts found</p>';
    }
}

function createCategoryCard(catId) {
    const cat = categories[catId];
    const card = document.createElement('div');
    card.className = 'category-nav-card';
    
    // Count parts in this category (including subcategories)
    const partCount = getPartsInCategory(catId).length;
    
    // Count subcategories
    const subcatCount = Object.keys(categories).filter(id => {
        const parent = categories[id].parent;
        if (!parent) return false;
        const parentId = Object.keys(categories).find(pid => categories[pid].name === parent);
        return parentId === catId;
    }).length;
    
    const icon = subcatCount > 0 ? '📁' : '📦';
    
    card.innerHTML = `
        <div class="category-icon">${icon}</div>
        <div class="category-name">${cat.name}</div>
        <div class="category-count">${partCount} parts${subcatCount > 0 ? ` • ${subcatCount} subcategories` : ''}</div>
    `;
    
    card.onclick = () => {
        currentBrowsingCategory = catId;
        renderAllParts();
    };
    
    return card;
}

function getPartsInCategory(categoryId) {
    // Get all parts in this category and its subcategories
    const categoryIds = [categoryId];
    
    // Add all subcategories recursively
    const addSubcategories = (parentId) => {
        Object.keys(categories).forEach(id => {
            const parent = categories[id].parent;
            if (parent) {
                const parentCatId = Object.keys(categories).find(pid => categories[pid].name === parent);
                if (parentCatId === parentId && !categoryIds.includes(id)) {
                    categoryIds.push(id);
                    addSubcategories(id);
                }
            }
        });
    };
    
    addSubcategories(categoryId);
    
    // Get all parts in these categories
    return Object.keys(inventory).filter(partId => {
        return categoryIds.includes(inventory[partId].category);
    });
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('categoryBreadcrumb');
    if (!breadcrumb) return;
    
    if (!currentBrowsingCategory) {
        breadcrumb.innerHTML = '<span>📁 All Categories</span>';
        return;
    }
    
    // Build breadcrumb trail
    const trail = [];
    let currentId = currentBrowsingCategory;
    
    while (currentId) {
        trail.unshift({ id: currentId, name: categories[currentId].name });
        
        const parent = categories[currentId].parent;
        if (parent) {
            currentId = Object.keys(categories).find(id => categories[id].name === parent);
        } else {
            currentId = null;
        }
    }
    
    breadcrumb.innerHTML = `
        <a class="breadcrumb-link" onclick="currentBrowsingCategory = null; renderAllParts();">📁 All Categories</a>
        ${trail.map(item => ` > <a class="breadcrumb-link" onclick="currentBrowsingCategory = '${item.id}'; renderAllParts();">${item.name}</a>`).join('')}
    `;
}
    
    // Filter by category
    if (currentViewMode === 'category') {
        if (currentCategoryFilter) {
            parts = parts.filter(id => {
                const part = inventory[id];
                // Check if part is in selected category or child category
                if (part.category === currentCategoryFilter) return true;
                if (categories[part.category] && categories[part.category].parent) {
                    const parentId = Object.keys(categories).find(catId => 
                        categories[catId].name === categories[part.category].parent
                    );
                    return parentId === currentCategoryFilter;
                }
                return false;
            });
        }
        
        // Group by category
        const grouped = {};
        parts.forEach(id => {
            const part = inventory[id];
            const catId = part.category || 'other';
            if (!grouped[catId]) grouped[catId] = [];
            grouped[catId].push(id);
        });
        
        // Render by category
        Object.keys(grouped).sort((a, b) => {
            const nameA = categories[a]?.name || 'Other';
            const nameB = categories[b]?.name || 'Other';
            return nameA.localeCompare(nameB);
        }).forEach(catId => {
            const catName = categories[catId]?.name || 'Other';
            const h3 = document.createElement('h3');
            h3.textContent = catName;
            h3.style.gridColumn = '1 / -1';
            h3.style.marginTop = '20px';
            h3.style.marginBottom = '10px';
            grid.appendChild(h3);
            
            grouped[catId].sort((a, b) => {
                return inventory[a].name.localeCompare(inventory[b].name);
            }).forEach(id => {
                grid.appendChild(createPartCard(id));
            });
        });
    } else {
        // Show all alphabetically
        parts.sort((a, b) => {
            return inventory[a].name.localeCompare(inventory[b].name);
        }).forEach(id => {
            grid.appendChild(createPartCard(id));
        });
    }
    
    if (parts.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No parts found</p>';
    }
}

function createPartCard(partId) {
    const part = inventory[partId];
    const card = document.createElement('div');
    card.className = 'part-card';
    
    let imageHTML = '';
    if (part.imageUrl) {
        imageHTML = `<img src="${part.imageUrl}" class="part-card-image" alt="${part.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                     <div class="part-card-placeholder" style="display: none;">📦</div>`;
    } else {
        imageHTML = '<div class="part-card-placeholder">📦</div>';
    }
    
    let shopStatus = 'stock-ok';
    if (part.shop < part.minStock) shopStatus = 'stock-low';
    if (part.shop === 0) shopStatus = 'stock-out';
    
    const categoryName = categories[part.category]?.name || 'Other';
    
    card.innerHTML = `
        ${imageHTML}
        <div class="part-card-name">${part.name}</div>
        <div class="part-card-number">Part #: ${part.id}</div>
        <div class="part-card-category">${categoryName}</div>
        <div class="part-card-stock">
            <span class="stock-badge ${shopStatus}">Shop: ${part.shop}</span>
        </div>
    `;
    
    card.onclick = () => openPartDetail(partId);
    return card;
}

// ============================================
// PART SELECTION MODAL
// ============================================

let currentPartModalContext = null;

function openPartModal(context) {
    currentPartModalContext = context;
    const modal = document.getElementById('partModal');
    modal.classList.add('show');
    
    document.getElementById('partModalSearch').value = '';
    renderPartModalList();
}

function closePartModal() {
    document.getElementById('partModal').classList.remove('show');
    currentPartModalContext = null;
}

function renderPartModalList(filter = '') {
    const body = document.getElementById('partModalBody');
    body.innerHTML = '';
    
    let parts = Object.keys(inventory);
    
    // Filter based on context
    if (currentPartModalContext === 'use' || currentPartModalContext === 'return') {
        const truckSelect = currentPartModalContext === 'use' ? 'useTruck' : 'returnTruck';
        const truck = document.getElementById(truckSelect).value;
        if (truck) {
            parts = parts.filter(id => inventory[id][truck] > 0);
        }
    } else if (currentPartModalContext === 'transfer') {
        const truck = document.getElementById('transferFromTruck').value;
        if (truck) {
            parts = parts.filter(id => inventory[id][truck] > 0);
        }
    }
    
   // Apply search filter
if (filter) {
    parts = parts.filter(id => {
        const part = inventory[id];
        return part.name.toLowerCase().includes(filter.toLowerCase()) ||
               String(part.id).toLowerCase().includes(filter.toLowerCase()) ||
               (part.barcode && String(part.barcode).toLowerCase().includes(filter.toLowerCase()));
    });
}
    
    const grid = document.createElement('div');
    grid.className = 'parts-grid';
    
    parts.sort((a, b) => inventory[a].name.localeCompare(inventory[b].name)).forEach(id => {
        const part = inventory[id];
        const card = document.createElement('div');
        card.className = 'part-card';
        
        let imageHTML = '';
        if (part.imageUrl) {
            imageHTML = `<img src="${part.imageUrl}" class="part-card-image" alt="${part.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                         <div class="part-card-placeholder" style="display: none;">📦</div>`;
        } else {
            imageHTML = '<div class="part-card-placeholder">📦</div>';
        }
        
        card.innerHTML = `
            ${imageHTML}
            <div class="part-card-name">${part.name}</div>
            <div class="part-card-number">Part #: ${part.id}</div>
        `;
        
        card.onclick = () => selectPart(id);
        grid.appendChild(card);
    });
    
    body.appendChild(grid);
    
    if (parts.length === 0) {
        body.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">No parts available</p>';
    }
}

function filterPartModal(searchTerm) {
    renderPartModalList(searchTerm);
}

function selectPart(partId) {
    const part = inventory[partId];
    selectedParts[currentPartModalContext] = partId;
    
    const displayId = currentPartModalContext + 'PartDisplay';
    const display = document.getElementById(displayId);
    
    if (display) {
        let imageHTML = '';
        if (part.imageUrl) {
            imageHTML = `<img src="${part.imageUrl}" class="selected-part-image" alt="${part.name}" onerror="this.style.display='none';">`;
        }
        
        display.innerHTML = `
            ${imageHTML}
            <div class="selected-part-info">${part.name}</div>
            <div class="selected-part-info" style="font-weight: normal; font-size: 0.9em;">Part #: ${part.id}</div>
            <button class="selected-part-remove" onclick="clearSelectedPart('${currentPartModalContext}')">✕ Remove</button>
        `;
        display.classList.add('show');
    }
    
    closePartModal();
}

function clearSelectedPart(context) {
    selectedParts[context] = null;
    const display = document.getElementById(context + 'PartDisplay');
    if (display) {
        display.innerHTML = '';
        display.classList.remove('show');
    }
}

// ============================================
// PART DETAIL MODAL WITH HISTORY
// ============================================

function openPartDetail(partId) {
    const part = inventory[partId];
    const modal = document.getElementById('partDetailModal');
    const body = document.getElementById('partDetailBody');
    
    document.getElementById('partDetailTitle').textContent = part.name;
    
    let imageHTML = '';
    if (part.imageUrl) {
        imageHTML = `<img src="${part.imageUrl}" style="max-width: 200px; max-height: 200px; border-radius: 12px; margin-bottom: 20px;" onerror="this.style.display='none';">`;
    }
    
    let stockHTML = '<h3>Current Stock</h3><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 20px;">';
    stockHTML += `<div class="stock-badge ${part.shop < part.minStock ? 'stock-low' : 'stock-ok'}">Shop: ${part.shop} (Min: ${part.minStock})</div>`;
    Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
        const minForTruck = part['minTruck_' + truckId] || 0;
        const isLow = part[truckId] < minForTruck;
        stockHTML += `<div class="stock-badge ${isLow ? 'stock-low' : 'stock-ok'}">${trucks[truckId].name}: ${part[truckId]} (Min: ${minForTruck})</div>`;
    });
    stockHTML += '</div>';
    
    let actionsHTML = '<h3>Quick Actions</h3><div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px;">';
    actionsHTML += `<button class="btn btn-primary" onclick="quickReceive('${partId}')">📥 Receive to Shop</button>`;
    Object.keys(trucks).filter(id => trucks[id].active).forEach(truckId => {
        actionsHTML += `<button class="btn btn-secondary" onclick="quickLoadToTruck('${partId}', '${truckId}')">📦 To ${trucks[truckId].name}</button>`;
    });
    actionsHTML += '</div>';
    
    let infoHTML = '<h3>Details</h3>';
    infoHTML += `<p><strong>Part Number:</strong> ${part.id}</p>`;
    infoHTML += `<p><strong>Category:</strong> ${categories[part.category]?.name || 'N/A'}</p>`;
    infoHTML += `<p><strong>Barcode:</strong> ${part.barcode || 'N/A'}</p>`;
    infoHTML += `<p><strong>Season:</strong> ${part.season}</p>`;
    if (part.price > 0) infoHTML += `<p><strong>Price:</strong> $${part.price.toFixed(2)}</p>`;
    if (part.purchaseLink) infoHTML += `<p><strong>Purchase:</strong> <a href="${part.purchaseLink}" target="_blank">Link</a></p>`;
    
    // Add history for this part
    const partHistory = history.filter(h => h.details && h.details.includes(part.name)).slice(0, 10);
    if (partHistory.length > 0) {
        infoHTML += '<h3 style="margin-top: 20px;">Recent History</h3>';
        partHistory.forEach(h => {
            infoHTML += `
                <div class="history-item" style="margin-bottom: 8px;">
                    <strong>${h.action}</strong> - ${h.details}
                    <span class="tech-badge">${h.tech}</span><br>
                    <small style="color: #666;">📅 ${h.timestamp}</small>
                </div>
            `;
        });
    }
    
    body.innerHTML = imageHTML + stockHTML + actionsHTML + infoHTML;
    
    modal.classList.add('show');
}

function closePartDetailModal() {
    document.getElementById('partDetailModal').classList.remove('show');
}

async function quickReceive(partId) {
    const qty = prompt('Enter quantity to receive:');
    if (!qty || isNaN(qty) || parseInt(qty) <= 0) return;
    
    showProcessing(true);
    await loadInventory();
    const part = inventory[partId];
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    shop: part.shop + parseInt(qty)
                }
            })
        });
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Received Stock',
            details: `${part.name}: ${qty} added to shop`,
            quantity: parseInt(qty),
            from: 'Supplier',
            to: 'Shop'
        });
        
        await loadInventory();
        updateDashboard();
        closePartDetailModal();
        showProcessing(false);
        showToast('Stock received!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error receiving stock', 'error');
    }
}

async function quickLoadToTruck(partId, truckId) {
    const qty = prompt(`Enter quantity to load onto ${trucks[truckId].name}:`);
    if (!qty || isNaN(qty) || parseInt(qty) <= 0) return;
    
    showProcessing(true);
    await loadInventory();
    const part = inventory[partId];
    
    if (part.shop < parseInt(qty)) {
        showProcessing(false);
        showToast(`Only ${part.shop} available in shop`, 'error');
        return;
    }
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    shop: part.shop - parseInt(qty),
                    [truckId]: part[truckId] + parseInt(qty)
                }
            })
        });
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Loaded Truck',
            details: `${part.name}: ${qty} loaded onto ${trucks[truckId].name}`,
            quantity: parseInt(qty),
            from: 'Shop',
            to: trucks[truckId].name
        });
        
        await loadInventory();
        updateDashboard();
        closePartDetailModal();
        showProcessing(false);
        showToast('Truck loaded!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error loading truck', 'error');
    }
}

// ============================================
// QUICK ACTIONS
// ============================================

async function useParts() {
    const truck = document.getElementById('useTruck').value;
    const partId = selectedParts.use;
    const qty = parseInt(document.getElementById('useQty').value);
    const jobName = document.getElementById('jobName').value.trim() || 'Job';
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part[truck] < qty) {
        showProcessing(false);
        showToast(`Only ${part[truck]} available on truck`, 'error');
        return;
    }
    
    try {
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
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Used on Job',
            details: `${part.name}: ${qty} used from ${trucks[truck].name}`,
            quantity: qty,
            from: trucks[truck].name,
            to: 'Customer',
            jobName: jobName
        });
        
        await loadInventory();
        document.getElementById('useQty').value = '1';
        document.getElementById('jobName').value = '';
        clearSelectedPart('use');
        updateDashboard();
        showProcessing(false);
        showToast('Usage recorded!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error recording usage', 'error');
    }
}

async function loadTruck() {
    const partId = selectedParts.load;
    const qty = parseInt(document.getElementById('loadQty').value);
    const truck = document.getElementById('loadTruck').value;
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part.shop < qty) {
        showProcessing(false);
        showToast(`Only ${part.shop} available in shop`, 'error');
        return;
    }
    
    try {
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
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Loaded Truck',
            details: `${part.name}: ${qty} loaded onto ${trucks[truck].name}`,
            quantity: qty,
            from: 'Shop',
            to: trucks[truck].name
        });
        
        await loadInventory();
        document.getElementById('loadQty').value = '1';
        clearSelectedPart('load');
        updateDashboard();
        showProcessing(false);
        showToast('Truck loaded!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error loading truck', 'error');
    }
}

async function returnToShop() {
    const truck = document.getElementById('returnTruck').value;
    const partId = selectedParts.return;
    const qty = parseInt(document.getElementById('returnQty').value);
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part[truck] < qty) {
        showProcessing(false);
        showToast(`Only ${part[truck]} available on truck`, 'error');
        return;
    }
    
    try {
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
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Returned to Shop',
            details: `${part.name}: ${qty} returned from ${trucks[truck].name}`,
            quantity: qty,
            from: trucks[truck].name,
            to: 'Shop'
        });
        
        await loadInventory();
        document.getElementById('returnQty').value = '1';
        clearSelectedPart('return');
        updateDashboard();
        showProcessing(false);
        showToast('Returned to shop!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error returning to shop', 'error');
    }
}

async function transferParts() {
    const fromTruck = document.getElementById('transferFromTruck').value;
    const toTruck = document.getElementById('transferToTruck').value;
    const partId = selectedParts.transfer;
    const qty = parseInt(document.getElementById('transferQty').value);
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    if (fromTruck === toTruck) {
        showToast('Cannot transfer to same truck', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    if (part[fromTruck] < qty) {
        showProcessing(false);
        showToast(`Only ${part[fromTruck]} available on ${trucks[fromTruck].name}`, 'error');
        return;
    }
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    [fromTruck]: part[fromTruck] - qty,
                    [toTruck]: part[toTruck] + qty
                }
            })
        });
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Transferred',
            details: `${part.name}: ${qty} from ${trucks[fromTruck].name} to ${trucks[toTruck].name}`,
            quantity: qty,
            from: trucks[fromTruck].name,
            to: trucks[toTruck].name
        });
        
        await loadInventory();
        document.getElementById('transferQty').value = '1';
        clearSelectedPart('transfer');
        updateDashboard();
        showProcessing(false);
        showToast('Transfer complete!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error transferring', 'error');
    }
}

async function receiveStock() {
    const partId = selectedParts.receive;
    const qty = parseInt(document.getElementById('receiveQty').value);
    
    if (!partId) {
        showToast('Select a part', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    
    const part = inventory[partId];
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'updatePartQuantity',
                partId: partId,
                updates: {
                    shop: part.shop + qty
                }
            })
        });
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Received Stock',
            details: `${part.name}: ${qty} received to shop`,
            quantity: qty,
            from: 'Supplier',
            to: 'Shop'
        });
        
        await loadInventory();
        document.getElementById('receiveQty').value = '1';
        clearSelectedPart('receive');
        updateDashboard();
        showProcessing(false);
        showToast('Stock received!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error receiving stock', 'error');
    }
}

// ============================================
// BARCODE SCANNER - CAMERA
// ============================================

function startCameraBarcodeScanner(targetInputId) {
    currentBarcodeTarget = targetInputId;
    const modal = document.getElementById('barcodeScannerModal');
    modal.classList.add('show');
    
    const video = document.getElementById('barcodeScannerVideo');
    
    if (!codeReader) {
        showToast('Barcode scanner not available', 'error');
        return;
    }
    
    codeReader.decodeFromVideoDevice(null, video, (result, err) => {
        if (result) {
            const code = result.text;
            
            // Prevent duplicate scans
            const now = Date.now();
            if (code === lastScannedCode && now - lastScanTime < 2000) {
                return;
            }
            
            lastScannedCode = code;
            lastScanTime = now;
            
            // Set the input value
            const input = document.getElementById(targetInputId);
            if (input) {
                input.value = code;
            }
            
            showToast('Barcode scanned!');
            stopCameraBarcodeScanner();
        }
    });
}

function stopCameraBarcodeScanner() {
    if (codeReader) {
        codeReader.reset();
    }
    document.getElementById('barcodeScannerModal').classList.remove('show');
    currentBarcodeTarget = null;
}

// ============================================
// BARCODE SCANNER - PHYSICAL SCANNER
// ============================================

async function handlePhysicalScannerInput(barcode) {
    console.log('Physical scanner input:', barcode);
    
    // Try to find part by barcode
    const partId = Object.keys(inventory).find(id => inventory[id].barcode === barcode);
    
    if (!partId) {
        showToast('Part not found for barcode: ' + barcode, 'error');
        return;
    }
    
    const part = inventory[partId];
    
    if (!scanModeActive) {
        // Not in scan mode - just show the part
        openPartDetail(partId);
        return;
    }
    
    // In scan mode - perform the action
    const action = document.getElementById('scanAction').value;
    const truck = document.getElementById('scanTruck').value;
    const jobName = document.getElementById('scanJobName').value.trim() || 'Job';
    
    if (!action || !truck) {
        showToast('Select action and truck first', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    const updatedPart = inventory[partId];
    
    try {
        if (action === 'use') {
            if (updatedPart[truck] < 1) {
                showProcessing(false);
                showToast(`No ${part.name} on ${trucks[truck].name}`, 'error');
                return;
            }
            
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'updatePartQuantity',
                    partId: partId,
                    updates: {
                        [truck]: updatedPart[truck] - 1
                    }
                })
            });
            
            await addTransaction({
                timestamp: new Date().toLocaleString(),
                tech: currentUser,
                action: 'Used on Job (Scan)',
                details: `${part.name}: 1 used from ${trucks[truck].name}`,
                quantity: 1,
                from: trucks[truck].name,
                to: 'Customer',
                jobName: jobName
            });
            
            showToast(`✅ ${part.name} used (${updatedPart[truck] - 1} left)`);
            
        } else if (action === 'load') {
            if (updatedPart.shop < 1) {
                showProcessing(false);
                showToast(`No ${part.name} in shop`, 'error');
                return;
            }
            
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'updatePartQuantity',
                    partId: partId,
                    updates: {
                        shop: updatedPart.shop - 1,
                        [truck]: updatedPart[truck] + 1
                    }
                })
            });
            
            await addTransaction({
                timestamp: new Date().toLocaleString(),
                tech: currentUser,
                action: 'Loaded Truck (Scan)',
                details: `${part.name}: 1 loaded onto ${trucks[truck].name}`,
                quantity: 1,
                from: 'Shop',
                to: trucks[truck].name
            });
            
            showToast(`✅ ${part.name} loaded (${updatedPart[truck] + 1} on truck)`);
            
        } else if (action === 'return') {
            if (updatedPart[truck] < 1) {
                showProcessing(false);
                showToast(`No ${part.name} on ${trucks[truck].name}`, 'error');
                return;
            }
            
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'updatePartQuantity',
                    partId: partId,
                    updates: {
                        [truck]: updatedPart[truck] - 1,
                        shop: updatedPart.shop + 1
                    }
                })
            });
            
            await addTransaction({
                timestamp: new Date().toLocaleString(),
                tech: currentUser,
                action: 'Returned to Shop (Scan)',
                details: `${part.name}: 1 returned from ${trucks[truck].name}`,
                quantity: 1,
                from: trucks[truck].name,
                to: 'Shop'
            });
            
            showToast(`✅ ${part.name} returned (${updatedPart.shop + 1} in shop)`);
            
        } else if (action === 'receive') {
            await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'updatePartQuantity',
                    partId: partId,
                    updates: {
                        shop: updatedPart.shop + 1
                    }
                })
            });
            
            await addTransaction({
                timestamp: new Date().toLocaleString(),
                tech: currentUser,
                action: 'Received Stock (Scan)',
                details: `${part.name}: 1 received to shop`,
                quantity: 1,
                from: 'Supplier',
                to: 'Shop'
            });
            
            showToast(`✅ ${part.name} received (${updatedPart.shop + 1} in shop)`);
        }
        
        await loadInventory();
        updateDashboard();
        showProcessing(false);
        
    } catch (error) {
        showProcessing(false);
        console.error('Scan action error:', error);
        showToast('Error processing scan', 'error');
    }
}

// ============================================
// QUICK LOAD / RESTOCK
// ============================================

async function updateQuickLoadList() {
    const container = document.getElementById('quickLoadList');
    const btn = document.getElementById('quickLoadBtn');
    const location = document.getElementById('quickLoadLocation').value;
    
    if (!location) {
        container.innerHTML = '<p style="color: #666;">Select a location</p>';
        btn.style.display = 'none';
        return;
    }
    
    // Get active seasons
    const activeSeasons = settings.ActiveSeasons ? settings.ActiveSeasons.split(',') : ['heating', 'cooling', 'year-round'];
    
    showProcessing(true);
    
    try {
        const response = await fetch(SCRIPT_URL + '?action=getLowStockItems');
        const result = await response.json();
        
        if (!result.success || !result.data) {
            container.innerHTML = '<p style="color: #e74c3c;">Error loading data</p>';
            btn.style.display = 'none';
            showProcessing(false);
            return;
        }
        
        let items = location === 'shop' ? result.data.shop : (result.data.trucks[location] || []);
        
        // Filter by active seasons
        items = items.filter(item => {
            const part = inventory[item.id];
            return part && activeSeasons.includes(part.season);
        });
        
        if (items.length === 0) {
            container.innerHTML = '<p style="color: #28a745;">✅ All items fully stocked!</p>';
            btn.style.display = 'none';
            showProcessing(false);
            return;
        }
        
        container.innerHTML = '';
        items.forEach(item => {
            const part = inventory[item.id];
            const div = document.createElement('div');
            div.className = 'quick-load-item';
            
            let imageHTML = '';
            if (part.imageUrl) {
                imageHTML = `<img src="${part.imageUrl}" class="quick-load-image" onerror="this.style.display='none';">`;
            } else {
                imageHTML = '<div style="width: 60px; height: 60px; background: #f0f0f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 2em;">📦</div>';
            }
            
            div.innerHTML = `
                <input type="checkbox" class="quick-load-checkbox" data-part-id="${item.id}">
                ${imageHTML}
                <div>
                    <strong>${part.name}</strong><br>
                    <small>Part #: ${part.id} | Current: ${item.current} | Min: ${item.minimum} | Need: ${item.needed}</small>
                </div>
                <input type="number" class="quick-load-qty" data-part-id="${item.id}" value="${item.needed}" min="1" max="${location === 'shop' ? 9999 : item.shopQty}" style="width: 80px; padding: 8px; border: 2px solid #e0e0e0; border-radius: 8px;">
            `;
            
            container.appendChild(div);
        });
        
        btn.style.display = 'block';
        showProcessing(false);
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        container.innerHTML = '<p style="color: #e74c3c;">Error loading data</p>';
        btn.style.display = 'none';
    }
}

async function processQuickLoad() {
    const checkboxes = document.querySelectorAll('.quick-load-checkbox:checked');
    const location = document.getElementById('quickLoadLocation').value;
    
    if (checkboxes.length === 0) {
        showToast('Select at least one item', 'error');
        return;
    }
    
    showProcessing(true);
    await loadInventory();
    
    try {
        for (const checkbox of checkboxes) {
            const partId = checkbox.getAttribute('data-part-id');
            const qtyInput = document.querySelector(`.quick-load-qty[data-part-id="${partId}"]`);
            const qty = parseInt(qtyInput.value) || 0;
            
            if (qty <= 0) continue;
            
            const part = inventory[partId];
            
            if (location === 'shop') {
                await fetch(SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'updatePartQuantity',
                        partId: partId,
                        updates: { shop: part.shop + qty }
                    })
                });
                
                await addTransaction({
                    timestamp: new Date().toLocaleString(),
                    tech: currentUser,
                    action: 'Restocked Shop',
                    details: `${part.name}: ${qty} added to shop`,
                    quantity: qty,
                    from: 'Supplier',
                    to: 'Shop'
                });
            } else {
                if (part.shop < qty) continue;
                
                await fetch(SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify({
                        action: 'updatePartQuantity',
                        partId: partId,
                        updates: {
                            shop: part.shop - qty,
                            [location]: part[location] + qty
                        }
                    })
                });
                
                await addTransaction({
                    timestamp: new Date().toLocaleString(),
                    tech: currentUser,
                    action: 'Quick Load',
                    details: `${part.name}: ${qty} loaded onto ${trucks[location].name}`,
                    quantity: qty,
                    from: 'Shop',
                    to: trucks[location].name
                });
            }
        }
        
        await loadInventory();
        updateDashboard();
        await updateQuickLoadList();
        showProcessing(false);
        showToast('Quick Load complete!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error processing quick load', 'error');
    }
}

// ============================================
// ADD PART
// ============================================

async function addPart() {
    const partNumber = document.getElementById('partNumber').value.trim();
    const name = document.getElementById('partName').value.trim();
    const categoryId = document.getElementById('partCategory').value;
    const barcode = document.getElementById('partBarcode').value.trim();
    const imageUrl = document.getElementById('partImageUrl').value.trim() || uploadedImageUrl;
    const season = document.getElementById('partSeason').value;
    const shopQty = parseInt(document.getElementById('shopQty').value);
    const minStock = parseInt(document.getElementById('minStock').value);
    const price = parseFloat(document.getElementById('partPrice').value) || 0;
    const link = document.getElementById('partLink').value.trim();
    
    if (!partNumber || !name || !categoryId) {
        showToast('Fill required fields', 'error');
        return;
    }
    
    if (inventory[partNumber]) {
        showToast('Part number already exists', 'error');
        return;
    }
    
    showProcessing(true);
    
    const newPart = {
        partNumber: partNumber,
        name: name,
        category: categoryId,
        barcode: barcode,
        imageUrl: imageUrl,
        season: season,
        shop: shopQty,
        minStock: minStock,
        price: price,
        purchaseLink: link
    };
    
    // Add truck quantities (all 0 initially)
    Object.keys(trucks).forEach(truckId => {
        newPart[truckId] = 0;
    });
    
    // Add per-truck minimums
    Object.keys(trucks).forEach(truckId => {
        const minInput = document.getElementById('minTruck_' + truckId);
        newPart['minTruck_' + truckId] = minInput ? parseInt(minInput.value) || 0 : 0;
    });
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'addPart',
                part: newPart
            })
        });
        
        await addTransaction({
            timestamp: new Date().toLocaleString(),
            tech: currentUser,
            action: 'Added Part',
            details: `${name} (${categories[categoryId].name})`,
            quantity: shopQty,
            from: '',
            to: 'Shop'
        });
        
        await loadInventory();
        
        // Clear form
        document.getElementById('partNumber').value = '';
        document.getElementById('partName').value = '';
        document.getElementById('partBarcode').value = '';
        document.getElementById('partImageUrl').value = '';
        document.getElementById('shopQty').value = '0';
        clearImageUpload();
        
        populateDropdowns();
        updateDashboard();
        showProcessing(false);
        showToast('Part added!');
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error adding part', 'error');
    }
}

// ============================================
// IMAGE UPLOAD
// ============================================

async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image too large. Max 5MB.', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        const reader = new FileReader();
        reader.onload = async function(event) {
            const base64Data = event.target.result;
            
            document.getElementById('imagePreviewImg').src = base64Data;
            document.getElementById('imagePreview').style.display = 'block';
            
            const timestamp = Date.now();
            const fileName = `part_${timestamp}.jpg`;
            
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action: 'uploadImage',
                    imageData: base64Data,
                    fileName: fileName
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                uploadedImageUrl = result.imageUrl;
                document.getElementById('partImageUrl').value = result.imageUrl;
                showProcessing(false);
                showToast('Image uploaded!');
            } else {
                showProcessing(false);
                showToast('Error uploading: ' + result.error, 'error');
            }
        };
        
        reader.readAsDataURL(file);
    } catch (error) {
        showProcessing(false);
        console.error('Error:', error);
        showToast('Error uploading image', 'error');
    }
}

function clearImageUpload() {
    document.getElementById('partImageFile').value = '';
    document.getElementById('partImageUrl').value = '';
    document.getElementById('imagePreview').style.display = 'none';
    uploadedImageUrl = '';
}

// ============================================
// CATEGORIES
// ============================================

function renderCategoryTree() {
    const container = document.getElementById('categoryTree');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Get root categories
    const rootCategories = Object.keys(categories).filter(id => !categories[id].parent);
    
    rootCategories.sort((a, b) => {
        return categories[a].name.localeCompare(categories[b].name);
    }).forEach(rootId => {
        const rootDiv = document.createElement('div');
        rootDiv.className = 'category-tree-item';
        rootDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong>${categories[rootId].name}</strong>
                <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteCategory('${rootId}')">Delete</button>
            </div>
        `;
        
        // Add children
        const children = Object.keys(categories).filter(id => {
            return categories[id].parent && 
                   Object.keys(categories).find(parentId => 
                       categories[parentId].name === categories[id].parent
                   ) === rootId;
        });
        
        children.sort((a, b) => {
            return categories[a].name.localeCompare(categories[b].name);
        }).forEach(childId => {
            const childDiv = document.createElement('div');
            childDiv.className = 'category-tree-child';
            childDiv.innerHTML = `
                <div class="category-tree-item">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>↳ ${categories[childId].name}</span>
                        <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteCategory('${childId}')">Delete</button>
                    </div>
                </div>
            `;
            rootDiv.appendChild(childDiv);
        });
        
        container.appendChild(rootDiv);
    });
}

async function addCategory() {
    const name = document.getElementById('newCategoryName').value.trim();
    const parent = document.getElementById('newCategoryParent').value;
    
    if (!name) {
        showToast('Enter category name', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveCategory',
                name: name,
                parentName: parent,
                order: Object.keys(categories).length
            })
        });
        
        await loadCategories();
        document.getElementById('newCategoryName').value = '';
        document.getElementById('newCategoryParent').value = '';
        renderCategoryTree();
        populateDropdowns();
        showProcessing(false);
        showToast('Category added!');
    } catch (error) {
        showProcessing(false);
        showToast('Error adding category', 'error');
    }
}

async function deleteCategory(id) {
    if (!confirm('Delete this category? Parts in this category will be set to "Other".')) return;
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'deleteCategory',
                name: categories[id].name
            })
        });
        
        await loadCategories();
        renderCategoryTree();
        populateDropdowns();
        showProcessing(false);
        showToast('Category deleted!');
    } catch (error) {
        showProcessing(false);
        showToast('Error deleting category', 'error');
    }
}

// ============================================
// HISTORY
// ============================================

function updateHistory() {
    const list = document.getElementById('historyList');
    if (!list) return;
    
    if (history.length === 0) {
        list.innerHTML = '<p style="color: #666;">No activity yet</p>';
        return;
    }
    
    const displayHistory = isOwner ? history : history.filter(e => e.tech === currentUser);
    
    list.innerHTML = displayHistory.slice(0, 100).map(e => `
        <div class="history-item">
            <strong>${e.action}</strong> - ${e.details}
            <span class="tech-badge">${e.tech}</span><br>
            <small style="color: #666;">📅 ${e.timestamp}${e.jobName ? ` | 👤 ${e.jobName}` : ''}</small>
        </div>
    `).join('');
}

// ============================================
// SETTINGS
// ============================================

function updateSettings() {
    populateDropdowns();
    updateTruckList();
    updateUserList();
    
    // Load active seasons
    const activeSeasons = settings.ActiveSeasons ? settings.ActiveSeasons.split(',') : ['heating', 'cooling', 'year-round'];
    document.querySelectorAll('.active-season-cb').forEach(cb => {
        cb.checked = activeSeasons.includes(cb.value);
    });
    
    // Show/hide PIN change based on permission
    const changePinBtn = document.getElementById('changePinBtn');
    if (changePinBtn) {
        changePinBtn.style.display = (isOwner || canEditPIN) ? 'block' : 'none';
    }
}

async function saveActiveSeasons() {
    const selected = Array.from(document.querySelectorAll('.active-season-cb:checked')).map(cb => cb.value);
    
    if (selected.length === 0) {
        showToast('Select at least one season', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveSetting',
                setting: 'ActiveSeasons',
                value: selected.join(',')
            })
        });
        
        await loadSettings();
        updateDashboard();
        showProcessing(false);
        showToast('Seasons updated!');
    } catch (error) {
        showProcessing(false);
        showToast('Error saving seasons', 'error');
    }
}

async function changePIN() {
    if (!isOwner && !canEditPIN) {
        showToast('You do not have permission to change PIN', 'error');
        return;
    }
    
    const oldPIN = prompt('Enter your current PIN:');
    if (oldPIN !== currentUserPin) {
        showToast('Incorrect current PIN', 'error');
        return;
    }
    
    const newPIN = prompt('Enter new 4-digit PIN:');
    if (!newPIN || newPIN.length !== 4 || !/^\d+$/.test(newPIN)) {
        showToast('PIN must be 4 digits', 'error');
        return;
    }
    
    const confirmPIN = prompt('Confirm new PIN:');
    if (newPIN !== confirmPIN) {
        showToast('PINs do not match', 'error');
        return;
    }
    
    showProcessing(true);
    
    try {
        // Check if new PIN already exists
        await fetch(SCRIPT_URL + '?action=readUsers').then(r => r.json()).then(result => {
            if (result.success && result.data) {
                for (let i = 1; i < result.data.length; i++) {
                    if (result.data[i][0] === newPIN) {
                        throw new Error('PIN already in use');
                    }
                }
            }
        });
        
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'changePIN',
                oldPIN: currentUserPin,
                newPIN: newPIN
            })
        });
        
        currentUserPin = newPIN;
        showProcessing(false);
        showToast('PIN changed successfully!');
    } catch (error) {
        showProcessing(false);
        showToast(error.message || 'Error changing PIN', 'error');
    }
}

function updateTruckList() {
    const list = document.getElementById('truckList');
    if (!list) return;
    
    list.innerHTML = '';
    Object.keys(trucks).forEach(id => {
        const truck = trucks[id];
        const div = document.createElement('div');
        div.style.cssText = 'padding: 10px; background: #f8f9fa; border-radius: 8px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;';
        div.innerHTML = `
            <span>${truck.name} ${truck.active ? '✅' : '❌'}</span>
            <div>
                <button class="btn btn-secondary" style="padding: 5px 10px; margin-right: 5px;" onclick="toggleTruck('${id}')">${truck.active ? 'Deactivate' : 'Activate'}</button>
                <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteTruck('${id}')">Delete</button>
            </div>
        `;
        list.appendChild(div);
    });
}

function updateUserList() {
    const list = document.getElementById('userList');
    if (!list) return;
    
    list.innerHTML = '';
    Object.keys(users).forEach(pin => {
        const user = users[pin];
        const div = document.createElement('div');
        div.style.cssText = 'padding: 10px; background: #f8f9fa; border-radius: 8px; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center;';
        div.innerHTML = `
            <span>${user.name}${user.isOwner ? ' 👑' : ''} - Truck: ${trucks[user.truck]?.name || 'N/A'}${user.canEditPIN ? ' 🔑' : ''}</span>
            ${!user.isOwner ? `<button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteUser('${pin}')">Delete</button>` : ''}
        `;
        list.appendChild(div);
    });
}

async function addTruck() {
    const name = document.getElementById('newTruckName').value.trim();
    if (!name) return;
    
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
        document.getElementById('newTruckName').value = '';
        populateDropdowns();
        updateSettings();
        showProcessing(false);
        showToast('Truck added!');
    } catch (error) {
        showProcessing(false);
        showToast('Error adding truck', 'error');
    }
}

async function toggleTruck(id) {
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'saveTruck',
                id: id,
                name: trucks[id].name,
                active: !trucks[id].active
            })
        });
        
        await loadTrucks();
        populateDropdowns();
        updateSettings();
        showProcessing(false);
        showToast('Truck updated!');
    } catch (error) {
        showProcessing(false);
        showToast('Error updating truck', 'error');
    }
}

async function deleteTruck(id) {
    if (!confirm('Delete this truck? All parts on it will be returned to shop.')) return;
    
    showProcessing(true);
    
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'deleteTruck',
                id: id
            })
        });
        
        await loadTrucks();
        await loadInventory();
        populateDropdowns();
        updateSettings();
        showProcessing(false);
        showToast('Truck deleted!');
    } catch (error) {
        showProcessing(false);
        showToast('Error deleting truck', 'error');
    }
}

async function addUser() {
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
                canEditPIN: false
            })
        });
        
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
                        canEditPIN: (row[4] === 'TRUE' || row[4] === true)
                    };
                }
            }
        }
        
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserPin').value = '';
        updateSettings();
        showProcessing(false);
        showToast('User added!');
    } catch (error) {
        showProcessing(false);
        showToast('Error adding user', 'error');
    }
}

async function deleteUser(pin) {
    if (!confirm('Delete this user?')) return;
    
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
        updateSettings();
        showProcessing(false);
        showToast('User deleted!');
    } catch (error) {
        showProcessing(false);
        showToast('Error deleting user', 'error');
    }
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
