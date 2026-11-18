const { getDb } = require("../config/firebase");
const { ORDER_STATUS, FINAL_STATUSES } = require("../constants/order");
const { ACTIVE_STATUS, DELETED_STATUS } = require("../constants/status");
const HttpError = require("../utils/http-error");
const {
  serializeDocument,
  withoutUndefined,
  rootCollection,
  reservationDocument,
  idempotencyDocument,
  now,
  dateKeyInTimeZone,
  dateTimeKeyInTimeZone,
  recentDateKeys
} = require("../utils/firestore");
const { addAuditLog } = require("../utils/audit");
const { text, email, integer, money, oneOf, optionalObject } = require("../utils/validation");

function orders(context) {
  return rootCollection(getDb(), "orders");
}

function inventoryEnabled() {
  return String(process.env.INVENTORY_DEDUCTION_ENABLED || "true").toLowerCase() === "true";
}

function generatedClientCode() {
  return `CUS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function generatedSku() {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function validateNewClient(payload) {
  const input = optionalObject(payload, "newClient");
  if (!input) throw new HttpError(400, "newClient là bắt buộc khi clientId không được cung cấp.");
  return {
    clientCode: input.clientCode ? text(input.clientCode, "newClient.clientCode") : undefined,
    name: text(input.name, "newClient.name"),
    email: email(input.email, "newClient.email"),
    phone: text(input.phone, "newClient.phone"),
    address: input.address ? text(input.address, "newClient.address") : undefined,
    type: input.type ? oneOf(input.type, "newClient.type", ["individual", "business"]) : "individual"
  };
}

function validateNewProduct(payload, index) {
  const input = optionalObject(payload, `items[${index}].newProduct`);
  if (!input) throw new HttpError(400, `items[${index}].newProduct là bắt buộc.`);
  return {
    sku: input.sku ? text(input.sku, `items[${index}].newProduct.sku`) : undefined,
    name: text(input.name, `items[${index}].newProduct.name`),
    description: input.description ? text(input.description, `items[${index}].newProduct.description`) : "",
    price: money(input.unitPrice ?? input.price, `items[${index}].newProduct.unitPrice`),
    stockQuantity: input.stockQuantity === undefined ? undefined : integer(input.stockQuantity, `items[${index}].newProduct.stockQuantity`, { min: 0 })
  };
}

function validateOrderPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new HttpError(400, "Dữ liệu đơn hàng không hợp lệ.");
  const action = payload.action || "confirm";
  if (action !== "confirm") throw new HttpError(400, "action chỉ hỗ trợ giá trị confirm.");

  const hasClientId = payload.clientId !== undefined && payload.clientId !== null && payload.clientId !== "";
  const hasNewClient = payload.newClient !== undefined && payload.newClient !== null;
  if (hasClientId && hasNewClient) throw new HttpError(400, "clientId và newClient không được dùng đồng thời.");
  if (!hasClientId && !hasNewClient) throw new HttpError(400, "Cần cung cấp clientId hoặc newClient.");
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new HttpError(400, "items phải có ít nhất một sản phẩm.");

  const existingProductIds = new Set();
  const newSkus = new Set();
  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== "object") throw new HttpError(400, `items[${index}] không hợp lệ.`);
    const quantity = integer(item.quantity, `items[${index}].quantity`, { min: 1 });
    const hasProductId = item.productId !== undefined && item.productId !== null && item.productId !== "";
    const hasNewProduct = item.newProduct !== undefined && item.newProduct !== null;
    if (hasProductId === hasNewProduct) throw new HttpError(400, `items[${index}] phải có đúng một trong productId hoặc newProduct.`);
    if (hasProductId) {
      const productId = text(item.productId, `items[${index}].productId`);
      if (existingProductIds.has(productId)) throw new HttpError(409, "Không được lặp productId trong cùng một đơn.");
      existingProductIds.add(productId);
      return { productId, quantity };
    }

    const newProduct = validateNewProduct(item.newProduct, index);
    if (newProduct.sku) {
      const key = newProduct.sku.toLowerCase();
      if (newSkus.has(key)) throw new HttpError(409, "Không được lặp SKU trong cùng một đơn.");
      newSkus.add(key);
    }
    return { newProduct, quantity };
  });

  return {
    clientId: hasClientId ? text(payload.clientId, "clientId") : null,
    newClient: hasNewClient ? validateNewClient(payload.newClient) : null,
    items,
    action
  };
}

async function ensureUnique(transaction, context, collection, field, value, type, excludeId) {
  const db = getDb();
  const reservationRef = reservationDocument(db, context.tenantId, type, value);
  const reservation = await transaction.get(reservationRef);
  const ownerField = field === "clientCode" ? "clientId" : "productId";
  if (reservation.exists && reservation.data()[ownerField] !== excludeId) throw new HttpError(409, `${field} đã tồn tại trong tenant.`);
  const querySnapshot = await transaction.get(collection);
  const duplicate = querySnapshot.docs.find((doc) => doc.id !== excludeId && doc.data().tenantId === context.tenantId && doc.data()[field] === value && doc.data().status !== DELETED_STATUS);
  if (duplicate) throw new HttpError(409, `${field} đã tồn tại trong tenant.`);
  return reservationRef;
}

function customerSnapshot(id, data) {
  return { id, clientCode: data.clientCode, name: data.name, email: data.email || null, phone: data.phone, address: data.address || null, type: data.type };
}

function productSnapshot(id, data) {
  return { id, sku: data.sku, name: data.name, description: data.description || "", price: data.price, currency: data.currency || "VND" };
}

function generateOrderCode(resolved, createdAt) {
  const clientCode = resolved.clientSnapshot.clientCode;
  const skuPart = resolved.items.map((item) => item.productSnapshot.sku).join("-");
  const dateTime = dateTimeKeyInTimeZone(createdAt.toDate(), process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh");
  return `${clientCode}-${skuPart}-${dateTime}`;
}

async function resolveOrderInTransaction(transaction, context, input) {
  const db = getDb();
  const clientCollection = rootCollection(db, "clients");
  const productCollection = rootCollection(db, "products");
  const newClientRef = input.clientId ? null : clientCollection.doc();
  const clientRef = input.clientId ? clientCollection.doc(input.clientId) : newClientRef;
  const clientSnapshot = input.clientId ? await transaction.get(clientRef) : null;
  const clientCode = input.clientId ? null : (input.newClient.clientCode || generatedClientCode());
  const clientReservation = input.clientId ? null : await ensureUnique(transaction, context, clientCollection, "clientCode", clientCode, "clientCodes");

  if (clientSnapshot && (!clientSnapshot.exists || clientSnapshot.data().tenantId !== context.tenantId || clientSnapshot.data().status !== ACTIVE_STATUS)) throw new HttpError(404, "Không tìm thấy khách hàng đang hoạt động.");

  const productResolutions = [];
  for (const item of input.items) {
    if (item.productId) {
      const ref = productCollection.doc(item.productId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status !== ACTIVE_STATUS) throw new HttpError(404, "Không tìm thấy sản phẩm đang hoạt động.");
      productResolutions.push({ item, ref, snapshot, data: snapshot.data(), isNew: false });
    } else {
      const ref = productCollection.doc();
      const sku = item.newProduct.sku || generatedSku();
      const reservationRef = await ensureUnique(transaction, context, productCollection, "sku", sku, "skus");
      const stockQuantity = item.newProduct.stockQuantity;
      if (inventoryEnabled() && stockQuantity === undefined) throw new HttpError(400, "newProduct.stockQuantity là bắt buộc khi bật trừ tồn kho.");
      const createdAt = now();
      const data = { tenantId: context.tenantId, sku, name: item.newProduct.name, description: item.newProduct.description, price: item.newProduct.price, currency: "VND", status: ACTIVE_STATUS, stockQuantity: stockQuantity ?? 0, version: 0, createdAt, updatedAt: createdAt };
      productResolutions.push({ item, ref, data, reservationRef, isNew: true });
    }
  }

  const clientData = input.clientId ? clientSnapshot.data() : withoutUndefined({ ...input.newClient, tenantId: context.tenantId, clientCode, status: ACTIVE_STATUS, createdAt: now(), updatedAt: now() });
  const items = productResolutions.map(({ item, ref, data }) => ({ productId: ref.id, name: data.name, quantity: item.quantity, unitPrice: data.price, totalAmount: data.price * item.quantity, productSnapshot: productSnapshot(ref.id, data) }));
  return {
    clientRef,
    clientSnapshot: customerSnapshot(clientRef.id, clientData),
    newClient: !input.clientId ? { ref: clientRef, reservationRef: clientReservation, data: clientData } : null,
    products: productResolutions,
    items,
    totalAmount: items.reduce((sum, item) => sum + item.totalAmount, 0)
  };
}

function quantitiesByProduct(items = []) {
  return items.reduce((result, item) => {
    result[item.productId] = (result[item.productId] || 0) + item.quantity;
    return result;
  }, {});
}

async function captureProductVersions(context, productIds) {
  const db = getDb();
  const versions = new Map();
  for (const productId of productIds) {
    const snapshot = await rootCollection(db, "products").doc(productId).get();
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status !== ACTIVE_STATUS) {
      throw new HttpError(404, "Không tìm thấy sản phẩm đang hoạt động.");
    }
    versions.set(productId, Number.isInteger(snapshot.data().version) ? snapshot.data().version : 0);
  }
  return versions;
}

function transactionConflictToStockError(error) {
  if (error?.code === 10 || error?.code === "10" || error?.code === "ABORTED" || error?.code === "aborted") {
    throw new HttpError(409, "Số lượng không phù hợp.");
  }
  throw error;
}

async function adjustInventory(transaction, context, resolved, oldOrder = null, expectedVersions = new Map()) {
  const db = getDb();
  const oldQuantities = quantitiesByProduct(oldOrder?.items || []);
  const newQuantities = quantitiesByProduct(resolved.items);
  const oldDeducted = Boolean(oldOrder?.inventoryDeducted) && !oldOrder?.inventoryRestored;
  const shouldAdjust = inventoryEnabled() || oldDeducted;
  if (!shouldAdjust) return false;

  const allIds = new Set([...Object.keys(oldQuantities), ...Object.keys(newQuantities)]);
  const currentSnapshots = new Map();
  for (const productId of allIds) {
    const resolution = resolved.products.find((product) => product.ref.id === productId);
    if (!resolution?.isNew) {
      const ref = rootCollection(db, "products").doc(productId);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId) throw new HttpError(409, "Sản phẩm trong lịch sử đơn không còn tồn tại.");
      currentSnapshots.set(productId, { ref, data: snapshot.data() });
    }
  }

  for (const resolution of resolved.products) {
    const productId = resolution.ref.id;
    const delta = (newQuantities[productId] || 0) - (oldDeducted ? (oldQuantities[productId] || 0) : 0);
    if (resolution.isNew) {
      const available = resolution.data.stockQuantity || 0;
      if (delta > available) throw new HttpError(409, "Số lượng không phù hợp.", { productId, available, requested: delta });
      resolution.data.stockQuantity = available - delta;
      if (delta !== 0) resolution.data.version = (Number.isInteger(resolution.data.version) ? resolution.data.version : 0) + 1;
      continue;
    }
    const current = currentSnapshots.get(productId);
    if (!current) continue;
    const currentVersion = Number.isInteger(current.data.version) ? current.data.version : 0;
    if (expectedVersions.has(productId) && currentVersion !== expectedVersions.get(productId)) {
      throw new HttpError(409, "Số lượng không phù hợp.", { productId, expectedVersion: expectedVersions.get(productId), actualVersion: currentVersion });
    }
    const available = current.data.stockQuantity || 0;
    if (delta > available) throw new HttpError(409, "Số lượng không phù hợp.", { productId, available, requested: delta });
    if (delta !== 0) transaction.update(current.ref, { stockQuantity: available - delta, version: currentVersion + 1, updatedAt: now() });
  }

  for (const productId of Object.keys(oldQuantities)) {
    if (newQuantities[productId]) continue;
    const current = currentSnapshots.get(productId);
    if (current && oldDeducted) {
      const currentVersion = Number.isInteger(current.data.version) ? current.data.version : 0;
      if (expectedVersions.has(productId) && currentVersion !== expectedVersions.get(productId)) {
        throw new HttpError(409, "Số lượng không phù hợp.", { productId, expectedVersion: expectedVersions.get(productId), actualVersion: currentVersion });
      }
      transaction.update(current.ref, { stockQuantity: (current.data.stockQuantity || 0) + oldQuantities[productId], version: currentVersion + 1, updatedAt: now() });
    }
  }
  return true;
}

function flattenOrder(snapshot) {
  const data = serializeDocument(snapshot);
  const items = data.items || [];
  const single = items.length === 1 ? items[0] : null;
  return {
    id: snapshot.id,
    ...data,
    orderCode: data.orderCode || data.code || null,
    code: data.orderCode || data.code || null,
    customer: data.customerSnapshot?.name || "",
    item: items.map((item) => item.name).join(", "),
    quantity: items.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: data.totalAmount ?? items.reduce((sum, item) => sum + item.totalAmount, 0),
    productId: single?.productId || null,
    unitPrice: single?.unitPrice || null
  };
}

async function createOrder(context, payload, idempotencyKey) {
  const input = validateOrderPayload(payload);
  const db = getDb();
  const orderRef = orders(context).doc();
  const idempotencyRef = idempotencyKey ? idempotencyDocument(db, context.tenantId, idempotencyKey) : null;
  const expectedVersions = await captureProductVersions(context, input.items.filter((item) => item.productId).map((item) => item.productId));
  let resultingOrderId = orderRef.id;

  try {
    await db.runTransaction(async (transaction) => {
    if (idempotencyRef) {
      const existingIdempotency = await transaction.get(idempotencyRef);
      if (existingIdempotency.exists) {
        resultingOrderId = existingIdempotency.data().orderId;
        return;
      }
    }
    const resolved = await resolveOrderInTransaction(transaction, context, input);
    const inventoryDeducted = await adjustInventory(transaction, context, resolved, null, expectedVersions);
    const createdAt = now();
    const orderCode = generateOrderCode(resolved, createdAt);
    for (const product of resolved.products) {
      if (product.isNew) {
        transaction.create(product.ref, product.data);
        transaction.create(product.reservationRef, { tenantId: context.tenantId, value: product.data.sku, productId: product.ref.id, type: "sku", createdAt });
      }
    }
    if (resolved.newClient) {
      transaction.create(resolved.newClient.ref, resolved.newClient.data);
      transaction.create(resolved.newClient.reservationRef, { tenantId: context.tenantId, value: resolved.newClient.data.clientCode, clientId: resolved.newClient.ref.id, type: "clientCode", createdAt });
    }
    transaction.create(orderRef, { tenantId: context.tenantId, orderCode, code: orderCode, clientId: resolved.clientRef.id, customerSnapshot: resolved.clientSnapshot, items: resolved.items, totalAmount: resolved.totalAmount, currency: "VND", status: ORDER_STATUS.NEW, createdByUid: context.uid, inventoryDeducted, inventoryRestored: false, createdAt, updatedAt: createdAt });
    if (idempotencyRef) transaction.create(idempotencyRef, { tenantId: context.tenantId, orderId: orderRef.id, createdByUid: context.uid, createdAt });
    addAuditLog(transaction, db, context.tenantId, { action: "order.create", entity: "order", entityId: orderRef.id, createdByUid: context.uid, status: ORDER_STATUS.NEW });
    });
  } catch (error) {
    transactionConflictToStockError(error);
  }
  return getOrderById(context, resultingOrderId);
}

async function listOrders(context) {
  const snapshot = await orders(context).get();
  return snapshot.docs.filter((doc) => doc.data().tenantId === context.tenantId && doc.data().status !== DELETED_STATUS).sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0)).map(flattenOrder);
}

async function getOrderById(context, id) {
  const snapshot = await orders(context).doc(id).get();
  if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  return flattenOrder(snapshot);
}

async function updateOrder(context, id, payload, idempotencyKey) {
  const db = getDb();
  const ref = orders(context).doc(id);
  const currentSnapshot = await ref.get();
  if (!currentSnapshot.exists || currentSnapshot.data().tenantId !== context.tenantId || currentSnapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy đơn hàng.");
  const preliminaryPayload = { ...payload };
  if (preliminaryPayload.clientId === undefined && preliminaryPayload.newClient === undefined) preliminaryPayload.clientId = currentSnapshot.data().clientId;
  const preliminaryInput = validateOrderPayload(preliminaryPayload);
  const expectedProductIds = new Set([
    ...(currentSnapshot.data().items || []).map((item) => item.productId),
    ...preliminaryInput.items.filter((item) => item.productId).map((item) => item.productId)
  ]);
  const expectedVersions = await captureProductVersions(context, [...expectedProductIds]);

  try {
    await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy đơn hàng.");
    const oldOrder = snapshot.data();
    if (oldOrder.status !== ORDER_STATUS.NEW) throw new HttpError(409, "Chỉ đơn ở trạng thái new mới được sửa.");
    const normalizedPayload = { ...payload };
    if (normalizedPayload.clientId === undefined && normalizedPayload.newClient === undefined) normalizedPayload.clientId = oldOrder.clientId;
    const input = validateOrderPayload(normalizedPayload);
    if (idempotencyKey) {
      const requestRef = idempotencyDocument(db, context.tenantId, `update:${id}:${idempotencyKey}`);
      const requestSnapshot = await transaction.get(requestRef);
      if (requestSnapshot.exists && requestSnapshot.data().orderId !== id) throw new HttpError(409, "Yêu cầu cập nhật đã được xử lý.");
    }
    const resolved = await resolveOrderInTransaction(transaction, context, input);
    const inventoryDeducted = await adjustInventory(transaction, context, resolved, oldOrder, expectedVersions);
    const updatedAt = now();
    const orderCode = oldOrder.orderCode || oldOrder.code || generateOrderCode(resolved, updatedAt);
    for (const product of resolved.products) {
      if (product.isNew) {
        transaction.create(product.ref, product.data);
        transaction.create(product.reservationRef, { tenantId: context.tenantId, value: product.data.sku, productId: product.ref.id, type: "sku", createdAt: updatedAt });
      }
    }
    if (resolved.newClient) {
      transaction.create(resolved.newClient.ref, resolved.newClient.data);
      transaction.create(resolved.newClient.reservationRef, { tenantId: context.tenantId, value: resolved.newClient.data.clientCode, clientId: resolved.newClient.ref.id, type: "clientCode", createdAt: updatedAt });
    }
    transaction.update(ref, { tenantId: context.tenantId, orderCode, code: orderCode, clientId: resolved.clientRef.id, customerSnapshot: resolved.clientSnapshot, items: resolved.items, totalAmount: resolved.totalAmount, inventoryDeducted, inventoryRestored: false, updatedAt });
    if (idempotencyKey) transaction.set(idempotencyDocument(db, context.tenantId, `update:${id}:${idempotencyKey}`), { tenantId: context.tenantId, orderId: id, createdByUid: context.uid, createdAt: updatedAt });
    addAuditLog(transaction, db, context.tenantId, { action: "order.update", entity: "order", entityId: id, createdByUid: context.uid, status: ORDER_STATUS.NEW });
    });
  } catch (error) {
    transactionConflictToStockError(error);
  }
  return getOrderById(context, id);
}

async function updateStatus(context, id, status) {
  if (![ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED].includes(status)) throw new HttpError(400, "status chỉ có thể là delivered hoặc cancelled.");
  const db = getDb();
  const ref = orders(context).doc(id);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy đơn hàng.");
    const order = snapshot.data();
    if (FINAL_STATUSES.has(order.status)) throw new HttpError(409, "Đơn đã ở trạng thái kết thúc.");
    const updatedAt = now();
    if (status === ORDER_STATUS.CANCELLED && order.inventoryDeducted && !order.inventoryRestored) {
      const productSnapshots = [];
      for (const [productId, quantity] of Object.entries(quantitiesByProduct(order.items))) {
        const productRef = rootCollection(db, "products").doc(productId);
        const productSnapshot = await transaction.get(productRef);
        productSnapshots.push({ productRef, productSnapshot, quantity });
      }
      for (const { productRef, productSnapshot, quantity } of productSnapshots) {
        if (productSnapshot.exists && productSnapshot.data().tenantId === context.tenantId) {
          const version = Number.isInteger(productSnapshot.data().version) ? productSnapshot.data().version : 0;
          transaction.update(productRef, { stockQuantity: (productSnapshot.data().stockQuantity || 0) + quantity, version: version + 1, updatedAt });
        }
      }
    }
    transaction.update(ref, { status, inventoryRestored: status === ORDER_STATUS.CANCELLED ? true : order.inventoryRestored || false, updatedAt });
    addAuditLog(transaction, db, context.tenantId, { action: `order.${status}`, entity: "order", entityId: id, createdByUid: context.uid, previousStatus: order.status, status });
  });
  return getOrderById(context, id);
}

async function deleteOrder(context, id) {
  const db = getDb();
  const ref = orders(context).doc(id);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy đơn hàng.");
    const order = snapshot.data();
    const updatedAt = now();
    if (order.status === ORDER_STATUS.NEW && order.inventoryDeducted && !order.inventoryRestored) {
      const productSnapshots = [];
      for (const [productId, quantity] of Object.entries(quantitiesByProduct(order.items))) {
        const productRef = rootCollection(db, "products").doc(productId);
        const productSnapshot = await transaction.get(productRef);
        productSnapshots.push({ productRef, productSnapshot, quantity });
      }
      for (const { productRef, productSnapshot, quantity } of productSnapshots) {
        if (productSnapshot.exists && productSnapshot.data().tenantId === context.tenantId) {
          const version = Number.isInteger(productSnapshot.data().version) ? productSnapshot.data().version : 0;
          transaction.update(productRef, { stockQuantity: (productSnapshot.data().stockQuantity || 0) + quantity, version: version + 1, updatedAt });
        }
      }
    }
    transaction.update(ref, { status: DELETED_STATUS, deletedAt: updatedAt, inventoryRestored: order.status === ORDER_STATUS.NEW ? true : order.inventoryRestored || false, updatedAt });
    addAuditLog(transaction, db, context.tenantId, { action: "order.delete", entity: "order", entityId: id, createdByUid: context.uid, previousStatus: order.status, status: DELETED_STATUS });
  });
  return { id, status: DELETED_STATUS };
}

async function dailyRevenue(context, requestedDays) {
  const days = Number(requestedDays || 7);
  if (![7, 14, 31].includes(days)) throw new HttpError(400, "days chỉ nhận 7, 14 hoặc 31.");
  const timeZone = process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh";
  const rows = recentDateKeys(days, timeZone).map((item) => ({ ...item, orders: 0, revenue: 0 }));
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const snapshot = await orders(context).get();
  snapshot.docs.filter((doc) => doc.data().tenantId === context.tenantId && doc.data().status === ORDER_STATUS.DELIVERED).forEach((doc) => {
    const data = doc.data();
    const date = data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
    const key = dateKeyInTimeZone(date, timeZone);
    const row = byDate.get(key);
    if (row) {
      row.orders += 1;
      row.revenue += Number(data.totalAmount || 0);
    }
  });
  return rows.map((row) => ({ ...row, revenue: Math.round((row.revenue + Number.EPSILON) * 100) / 100 }));
}

module.exports = { createOrder, listOrders, getOrderById, updateOrder, updateStatus, deleteOrder, dailyRevenue, validateOrderPayload, generateOrderCode };
