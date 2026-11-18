const crypto = require("crypto");
const { Timestamp } = require("firebase-admin/firestore");

function serializeValue(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeValue(item)]));
  }

  return value;
}

function serializeDocument(snapshot) {
  return { id: snapshot.id, ...serializeValue(snapshot.data()) };
}

function withoutUndefined(value) {
  if (value instanceof Timestamp || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)]));
}

function normalizeIdentifier(value) {
  return String(value).trim().toLowerCase();
}

function identifierKey(value) {
  return crypto.createHash("sha256").update(normalizeIdentifier(value)).digest("hex");
}

function requestKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function now() {
  return Timestamp.now();
}

function tenantDocument(db, tenantId) {
  return db.collection("tenants").doc(tenantId);
}

function rootCollection(db, collectionName) {
  // Business entities are stored in root collections and are scoped by tenantId.
  return db.collection(collectionName);
}

function reservationDocument(db, tenantId, type, value) {
  return db.collection("counters").doc(`${identifierKey(`${tenantId}:${type}:${value}`)}`);
}

function idempotencyDocument(db, tenantId, key) {
  return db.collection("idempotency").doc(requestKey(`${tenantId}:${key}`));
}

function dateKeyInTimeZone(date, timeZone = "Asia/Ho_Chi_Minh") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function dateTimeKeyInTimeZone(date, timeZone = "Asia/Ho_Chi_Minh") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});

  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function dateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "UTC" }).format(date);
  return weekday.replace(".", "");
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function recentDateKeys(days, timeZone = "Asia/Ho_Chi_Minh") {
  const todayKey = dateKeyInTimeZone(new Date(), timeZone);
  const [year, month, day] = todayKey.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day, 12));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(today, index - days + 1);
    const key = date.toISOString().slice(0, 10);
    return { date: key, label: dateLabel(key) };
  });
}

module.exports = {
  serializeValue,
  serializeDocument,
  withoutUndefined,
  normalizeIdentifier,
  identifierKey,
  requestKey,
  now,
  tenantDocument,
  rootCollection,
  reservationDocument,
  idempotencyDocument,
  dateKeyInTimeZone,
  dateTimeKeyInTimeZone,
  recentDateKeys
};
