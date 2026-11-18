const { getDb } = require("../config/firebase");
const { ACTIVE_STATUS, DELETED_STATUS } = require("../constants/status");
const HttpError = require("../utils/http-error");
const { serializeDocument, serializeValue, rootCollection, reservationDocument, normalizeIdentifier, now } = require("../utils/firestore");
const { addAuditLog } = require("../utils/audit");
const { text, money, integer } = require("../utils/validation");

function products(context) {
  return rootCollection(getDb(), "products");
}

function validateProductInput(payload, { partial = false, allowStock = true, requireSku = true } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new HttpError(400, "Dữ liệu sản phẩm không hợp lệ.");
  const result = {};
  if ((!partial && requireSku) || payload.sku !== undefined) result.sku = text(payload.sku, "sku", { required: !partial && requireSku });
  if (!partial || payload.name !== undefined) result.name = text(payload.name, "name", { required: !partial });
  if (payload.description !== undefined) result.description = text(payload.description, "description", { required: false });
  if (!partial || payload.price !== undefined || payload.unitPrice !== undefined) {
    result.price = money(payload.price ?? payload.unitPrice, "price");
  }
  if (allowStock && (payload.stockQuantity !== undefined || !partial)) result.stockQuantity = integer(payload.stockQuantity, "stockQuantity", { min: 0, required: !partial });
  return result;
}

function generatedSku() {
  return `SKU-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function ensureUniqueSku(transaction, context, sku, excludeId) {
  const db = getDb();
  const reservationRef = reservationDocument(db, context.tenantId, "skus", sku);
  const existingReservation = await transaction.get(reservationRef);
  if (existingReservation.exists && existingReservation.data().productId !== excludeId) throw new HttpError(409, "SKU đã tồn tại trong tenant.");
  const querySnapshot = await transaction.get(products(context));
  const duplicate = querySnapshot.docs.find((doc) => doc.id !== excludeId && doc.data().tenantId === context.tenantId && doc.data().sku === sku && doc.data().status !== DELETED_STATUS);
  if (duplicate) throw new HttpError(409, "SKU đã tồn tại trong tenant.");
  return reservationRef;
}

async function createProduct(context, payload, transaction = null) {
  const db = getDb();
  const input = validateProductInput(payload, { requireSku: false });
  const productRef = products(context).doc();
  const sku = input.sku || generatedSku();
  const createdAt = now();
  const run = async (tx) => {
    const reservationRef = await ensureUniqueSku(tx, context, sku);
    const data = { ...input, tenantId: context.tenantId, sku, description: input.description || "", currency: "VND", status: ACTIVE_STATUS, stockQuantity: input.stockQuantity ?? 0, version: 0, createdAt, updatedAt: createdAt };
    tx.create(productRef, data);
    tx.create(reservationRef, { tenantId: context.tenantId, value: sku, productId: productRef.id, type: "sku", createdAt });
    return { ref: productRef, data };
  };
  if (transaction) return run(transaction);
  let result;
  await db.runTransaction(async (tx) => { result = await run(tx); });
  return serializeValue({ id: result.ref.id, ...result.data });
}

async function listProducts(context) {
  const snapshot = await products(context).get();
  return snapshot.docs.filter((doc) => doc.data().tenantId === context.tenantId && doc.data().status !== DELETED_STATUS).map(serializeDocument);
}

async function getProductSnapshot(context, id, { allowDeleted = false, transaction } = {}) {
  const ref = products(context).doc(id);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || (!allowDeleted && snapshot.data().status === DELETED_STATUS)) throw new HttpError(404, "Không tìm thấy sản phẩm.");
  return { ref, snapshot, data: serializeDocument(snapshot) };
}

async function updateProduct(context, id, payload) {
  const db = getDb();
  const input = validateProductInput(payload, { partial: true });
  const ref = products(context).doc(id);
  let result;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy sản phẩm.");
    const current = snapshot.data();
    const skuChanged = input.sku && normalizeIdentifier(input.sku) !== normalizeIdentifier(current.sku);
    const reservationRef = skuChanged ? await ensureUniqueSku(tx, context, input.sku, id) : null;
    const updatedAt = now();
    const stockChanged = input.stockQuantity !== undefined && Number(input.stockQuantity) !== Number(current.stockQuantity);
    const currentVersion = Number.isInteger(current.version) ? current.version : 0;
    tx.update(ref, { ...input, ...(stockChanged ? { version: currentVersion + 1 } : {}), updatedAt });
    if (reservationRef) tx.create(reservationRef, { tenantId: context.tenantId, value: input.sku, productId: id, type: "sku", createdAt: updatedAt });
    result = { id, ...current, ...input, updatedAt };
  });
  return (await getProductSnapshot(context, id)).data;
}

async function deleteProduct(context, id) {
  const db = getDb();
  const ref = products(context).doc(id);
  let result;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy sản phẩm.");
    const updatedAt = now();
    tx.update(ref, { status: DELETED_STATUS, deletedAt: updatedAt, updatedAt });
    addAuditLog(tx, db, context.tenantId, { action: "product.delete", entity: "product", entityId: id, createdByUid: context.uid, previousStatus: snapshot.data().status });
    result = { id, status: DELETED_STATUS, updatedAt };
  });
  return serializeValue(result);
}

module.exports = { createProduct, listProducts, getProductSnapshot, updateProduct, deleteProduct, validateProductInput };
