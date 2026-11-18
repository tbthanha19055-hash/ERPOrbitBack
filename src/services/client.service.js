const { getDb } = require("../config/firebase");
const { ACTIVE_STATUS, DELETED_STATUS } = require("../constants/status");
const HttpError = require("../utils/http-error");
const {
  serializeDocument,
  serializeValue,
  withoutUndefined,
  rootCollection,
  reservationDocument,
  normalizeIdentifier,
  now
} = require("../utils/firestore");
const { addAuditLog } = require("../utils/audit");
const { text, email, oneOf } = require("../utils/validation");

const TYPES = ["individual", "business"];

function clients(context) {
  return rootCollection(getDb(), "clients");
}

function validateClientInput(payload, { partial = false, requireCode = true } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Dữ liệu khách hàng không hợp lệ.");
  }

  const result = {};
  if ((!partial && requireCode) || payload.clientCode !== undefined) result.clientCode = text(payload.clientCode, "clientCode", { required: !partial && requireCode });
  if (!partial || payload.name !== undefined) result.name = text(payload.name, "name", { required: !partial });
  if (!partial || payload.email !== undefined) result.email = email(payload.email, "email");
  if (!partial || payload.phone !== undefined) result.phone = text(payload.phone, "phone", { required: !partial });
  if (payload.address !== undefined) result.address = text(payload.address, "address", { required: false });
  if (!partial || payload.type !== undefined) result.type = oneOf(payload.type, "type", TYPES);
  return result;
}

function generatedClientCode() {
  return `CUS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function ensureUniqueCode(transaction, context, clientCode, excludeId) {
  const db = getDb();
  const reservationRef = reservationDocument(db, context.tenantId, "clientCodes", clientCode);
  const existingReservation = await transaction.get(reservationRef);
  if (existingReservation.exists && existingReservation.data().clientId !== excludeId) {
    throw new HttpError(409, "clientCode đã tồn tại trong tenant.");
  }

  const querySnapshot = await transaction.get(clients(context));
  const duplicate = querySnapshot.docs.find((doc) => doc.id !== excludeId && doc.data().tenantId === context.tenantId && doc.data().clientCode === clientCode && doc.data().status !== DELETED_STATUS);
  if (duplicate) throw new HttpError(409, "clientCode đã tồn tại trong tenant.");
  return reservationRef;
}

async function createClient(context, payload, transaction = null) {
  const db = getDb();
  const input = validateClientInput(payload, { requireCode: false });
  const clientRef = clients(context).doc();
  const clientCode = input.clientCode || generatedClientCode();
  const createdAt = now();

  const run = async (tx) => {
    const reservationRef = await ensureUniqueCode(tx, context, clientCode);
    const data = withoutUndefined({
      ...input,
      tenantId: context.tenantId,
      clientCode,
      status: ACTIVE_STATUS,
      createdAt,
      updatedAt: createdAt
    });
    tx.create(clientRef, data);
    tx.create(reservationRef, { tenantId: context.tenantId, value: clientCode, clientId: clientRef.id, type: "clientCode", createdAt });
    return { ref: clientRef, data };
  };

  if (transaction) return run(transaction);
  let result;
  await db.runTransaction(async (tx) => { result = await run(tx); });
  return serializeValue({ id: result.ref.id, ...result.data });
}

async function listClients(context) {
  const snapshot = await clients(context).get();
  return snapshot.docs.filter((doc) => doc.data().tenantId === context.tenantId && doc.data().status !== DELETED_STATUS).map(serializeDocument);
}

async function getClientSnapshot(context, id, { allowDeleted = false, transaction } = {}) {
  const ref = clients(context).doc(id);
  const snapshot = transaction ? await transaction.get(ref) : await ref.get();
  if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || (!allowDeleted && snapshot.data().status === DELETED_STATUS)) {
    throw new HttpError(404, "Không tìm thấy khách hàng.");
  }
  return { ref, snapshot, data: serializeDocument(snapshot) };
}

async function updateClient(context, id, payload) {
  const db = getDb();
  const input = validateClientInput(payload, { partial: true });
  const ref = clients(context).doc(id);
  let result;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy khách hàng.");
    const current = snapshot.data();
    const merged = { ...current, ...input };
    const reservationRef = input.clientCode && normalizeIdentifier(input.clientCode) !== normalizeIdentifier(current.clientCode)
      ? await ensureUniqueCode(tx, context, input.clientCode, id)
      : null;
    const updatedAt = now();
    tx.update(ref, { ...input, updatedAt });
    if (reservationRef) tx.create(reservationRef, { tenantId: context.tenantId, value: input.clientCode, clientId: id, type: "clientCode", createdAt: updatedAt });
    result = { id, ...merged, ...input, updatedAt };
  });
  return (await getClientSnapshot(context, id)).data;
}

async function deleteClient(context, id) {
  const db = getDb();
  const ref = clients(context).doc(id);
  let result;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || snapshot.data().tenantId !== context.tenantId || snapshot.data().status === DELETED_STATUS) throw new HttpError(404, "Không tìm thấy khách hàng.");
    const updatedAt = now();
    tx.update(ref, { status: DELETED_STATUS, deletedAt: updatedAt, updatedAt });
    addAuditLog(tx, db, context.tenantId, { action: "client.delete", entity: "client", entityId: id, createdByUid: context.uid, previousStatus: snapshot.data().status });
    result = { id, status: DELETED_STATUS, updatedAt };
  });
  return serializeValue(result);
}

module.exports = { createClient, listClients, getClientSnapshot, updateClient, deleteClient, validateClientInput };
