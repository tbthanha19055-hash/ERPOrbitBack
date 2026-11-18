const HttpError = require("./http-error");

function text(value, field, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return undefined;
    throw new HttpError(400, `${field} là bắt buộc.`);
  }

  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field} phải là chuỗi không rỗng.`);
  }

  return value.trim();
}

function email(value, field = "email", { required = false } = {}) {
  const normalized = text(value, field, { required });
  if (normalized === undefined) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new HttpError(400, `${field} không hợp lệ.`);
  }

  return normalized.toLowerCase();
}

function integer(value, field, { min = 0, required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return undefined;
    throw new HttpError(400, `${field} là bắt buộc.`);
  }

  const result = Number(value);
  if (!Number.isInteger(result) || result < min) {
    throw new HttpError(400, `${field} phải là số nguyên từ ${min}.`);
  }

  return result;
}

function money(value, field = "price", { required = true } = {}) {
  return integer(value, field, { min: 0, required });
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} không hợp lệ. Giá trị cho phép: ${allowed.join(", ")}.`);
  }

  return value;
}

function optionalObject(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${field} phải là object.`);
  }

  return value;
}

module.exports = { text, email, integer, money, oneOf, optionalObject };
