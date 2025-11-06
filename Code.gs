// ============================================
// HVAC INVENTORY - COMPLETE FIXED VERSION
// ============================================

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === 'readInventory') return readInventory();
    if (action === 'readUsers') return readUsers();
    if (action === 'readCategories') return readCategories();
    if (action === 'readTrucks') return readTrucks();
    if (action === 'readHistory') return readHistory();
    if (action === 'getLowStockItems') return getLowStockItems();

    return jsonResponse(false, 'Invalid action');
  } catch (error) {
    return jsonResponse(false, error.toString());
  }
}

function doPost(e) {
  try {
    const action = e.parameter.action;
    const data = JSON.parse(e.postData.contents);

    if (action === 'writeInventory') return writeInventory(data);
    if (action === 'addTransaction') return addTransaction(data);
    if (action === 'deleteTransaction') return deleteTransaction(data);
    if (action === 'saveUser') return saveUser(data);
    if (action === 'deleteUser') return deleteUser(data);
    if (action === 'saveCategory') return saveCategory(data);
    if (action === 'deleteCategory') return deleteCategory(data);
    if (action === 'saveTruck') return saveTruck(data);
    if (action === 'deleteTruck') return deleteTruck(data);

    return jsonResponse(false, 'Invalid action');
  } catch (error) {
    return jsonResponse(false, error.toString());
  }
}

function jsonResponse(success, data) {
  return ContentService
    .createTextOutput(JSON.stringify(success ? {success: true, data: data} : {success: false, error: data}))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// INVENTORY
// ============================================
function readInventory() {
  const sheet = getSheet('Inventory');
  if (!sheet) return jsonResponse(false, 'Inventory sheet not found');

  const data = sheet.getDataRange().getValues();
  return jsonResponse(true, data);
}

function writeInventory(inventory) {
  const sheet = getSheet('Inventory');
  if (!sheet) return jsonResponse(false, 'Inventory sheet not found');

  const trucks = getTrucksArray();
  sheet.clear();

  // Build headers
  const headers = ['part_id', 'part_name', 'category', 'part_number', 'barcode', 'shop_qty'];
  trucks.forEach(t => headers.push(t.id + '_qty'));
  headers.push('min_shop_stock');
  trucks.forEach(t => headers.push('min_' + t.id + '_stock'));
  headers.push('price', 'purchase_link', 'season');

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Build rows
  const rows = [];
  Object.keys(inventory).forEach(id => {
    const p = inventory[id];
    const row = [id, p.name, p.category || 'other', p.partNumber || '', p.barcode || '', p.shop || 0];

    trucks.forEach(t => row.push(p[t.id] || 0));
    row.push(p.minStock || 0);
    trucks.forEach(t => row.push(p['min_' + t.id] || 0));
    row.push(p.price || 0, p.purchaseLink || '', p.season || 'year-round');

    rows.push(row);
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return jsonResponse(true, 'Inventory saved');
}

function getLowStockItems() {
  const sheet = getSheet('Inventory');
  if (!sheet) return jsonResponse(false, 'Inventory sheet not found');

  const data = sheet.getDataRange().getValues();
  const trucks = getTrucksArray();
  const lowStock = {};

  trucks.forEach(t => lowStock[t.id] = []);

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;

    const partId = data[i][0];
    const partName = data[i][1];
    const shopQty = data[i][5] || 0;

    let colIndex = 6;
    const truckQtys = {};
    trucks.forEach(t => {
      truckQtys[t.id] = data[i][colIndex] || 0;
      colIndex++;
    });

    colIndex++; // Skip min_shop_stock

    const truckMins = {};
    trucks.forEach(t => {
      truckMins[t.id] = data[i][colIndex] || 0;
      colIndex++;
    });

    trucks.forEach(t => {
      const needed = truckMins[t.id] - truckQtys[t.id];
      if (needed > 0 && shopQty > 0) {
        lowStock[t.id].push({
          id: partId,
          name: partName,
          shopQty: shopQty,
          currentQty: truckQtys[t.id],
          minStock: truckMins[t.id],
          needed: Math.min(needed, shopQty)
        });
      }
    });
  }

  return jsonResponse(true, lowStock);
}

// ============================================
// HISTORY/TRANSACTIONS
// ============================================
function readHistory() {
  const sheet = getSheet('Transactions');
  if (!sheet) return jsonResponse(false, 'Transactions sheet not found');

  const data = sheet.getDataRange().getValues();
  return jsonResponse(true, data);
}

function addTransaction(transaction) {
  const sheet = getSheet('Transactions');
  if (!sheet) return jsonResponse(false, 'Transactions sheet not found');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'tech_name', 'action_type', 'details', 'quantity', 'from_location', 'to_location', 'job_name', 'address', 'latitude', 'longitude']);
  }

  sheet.appendRow([
    transaction.timestamp,
    transaction.tech,
    transaction.action,
    transaction.details,
    transaction.quantity || '',
    transaction.from || '',
    transaction.to || '',
    transaction.jobName || '',
    transaction.address || '',
    transaction.lat || '',
    transaction.lon || ''
  ]);

  return jsonResponse(true, 'Transaction added');
}

function deleteTransaction(data) {
  const sheet = getSheet('Transactions');
  if (!sheet) return jsonResponse(false, 'Transactions sheet not found');

  // Delete all rows (except header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  return jsonResponse(true, 'History cleared');
}

// ============================================
// USERS
// ============================================
function readUsers() {
  const sheet = getSheet('Users');
  if (!sheet) return jsonResponse(false, 'Users sheet not found');

  const data = sheet.getDataRange().getValues();
  return jsonResponse(true, data);
}

function saveUser(user) {
  const sheet = getSheet('Users');
  if (!sheet) return jsonResponse(false, 'Users sheet not found');

  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === user.pin) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowData = [
    user.pin, user.name, user.truck, user.isOwner ? 'TRUE' : 'FALSE',
    user.permissions.addParts ? 'TRUE' : 'FALSE',
    user.permissions.editParts ? 'TRUE' : 'FALSE',
    user.permissions.deleteParts ? 'TRUE' : 'FALSE',
    user.permissions.loadTruck ? 'TRUE' : 'FALSE',
    user.permissions.useParts ? 'TRUE' : 'FALSE',
    user.permissions.viewHistory ? 'TRUE' : 'FALSE',
    user.permissions.editHistory ? 'TRUE' : 'FALSE',
    user.permissions.manageUsers ? 'TRUE' : 'FALSE',
    user.permissions.manageCategories ? 'TRUE' : 'FALSE',
    user.permissions.manageTrucks ? 'TRUE' : 'FALSE'
  ];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return jsonResponse(true, 'User saved');
}

function deleteUser(data) {
  const sheet = getSheet('Users');
  if (!sheet) return jsonResponse(false, 'Users sheet not found');

  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === data.pin) {
      sheet.deleteRow(i + 1);
      break;
    }
  }

  return jsonResponse(true, 'User deleted');
}

// ============================================
// CATEGORIES
// ============================================
function readCategories() {
  const sheet = getSheet('Categories');
  if (!sheet) return jsonResponse(false, 'Categories sheet not found');

  const data = sheet.getDataRange().getValues();
  return jsonResponse(true, data);
}

function saveCategory(category) {
  const sheet = getSheet('Categories');
  if (!sheet) return jsonResponse(false, 'Categories sheet not found');

  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === category.id) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowData = [category.id, category.name, category.parent || '', category.order || 0];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, 4).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return jsonResponse(true, 'Category saved');
}

function deleteCategory(data) {
  const sheet = getSheet('Categories');
  if (!sheet) return jsonResponse(false, 'Categories sheet not found');

  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === data.id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }

  return jsonResponse(true, 'Category deleted');
}

// ============================================
// TRUCKS
// ============================================
function readTrucks() {
  const sheet = getSheet('Trucks');
  if (!sheet) return jsonResponse(false, 'Trucks sheet not found');

  const data = sheet.getDataRange().getValues();
  return jsonResponse(true, data);
}

function getTrucksArray() {
  const sheet = getSheet('Trucks');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const trucks = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === 'TRUE' || data[i][2] === true) {
      trucks.push({id: data[i][0], name: data[i][1]});
    }
  }

  return trucks;
}

function saveTruck(truck) {
  const sheet = getSheet('Trucks');
  if (!sheet) return jsonResponse(false, 'Trucks sheet not found');

  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === truck.id) {
      rowIndex = i + 1;
      break;
    }
  }

  const rowData = [truck.id, truck.name, truck.active ? 'TRUE' : 'FALSE'];

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, 3).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return jsonResponse(true, 'Truck saved');
}

function deleteTruck(data) {
  const sheet = getSheet('Trucks');
  if (!sheet) return jsonResponse(false, 'Trucks sheet not found');

  const allData = sheet.getDataRange().getValues();
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] === data.id) {
      sheet.deleteRow(i + 1);
      break;
    }
  }

  return jsonResponse(true, 'Truck deleted');
}

// ============================================
// HELPERS
// ============================================
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}
