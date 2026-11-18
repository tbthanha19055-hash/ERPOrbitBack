const { ORDER_STATUS } = require("../constants/order");
const HttpError = require("./http-error");

function requiredText(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${fieldName} là bắt buộc và phải là chuỗi không rỗng.`);
  }

  return value.trim();
}

function positiveNumber(value, fieldName) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === ""
  ) {
    throw new HttpError(400, `${fieldName} phải là số lớn hơn 0.`);
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new HttpError(400, `${fieldName} phải là số lớn hơn 0.`);
  }

  return parsedValue;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateOrderInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Dữ liệu đơn hàng không hợp lệ.");
  }

  const quantity = positiveNumber(payload.quantity, "quantity");
  const unitPrice = positiveNumber(payload.unitPrice, "unitPrice");

  return {
    customerName: requiredText(payload.customerName, "customerName"),
    itemName: requiredText(payload.itemName, "itemName"),
    quantity,
    unitPrice,
    totalAmount: roundMoney(quantity * unitPrice)
  };
}

function validateStatus(status) {
  if (status !== ORDER_STATUS.DELIVERED && status !== ORDER_STATUS.CANCELLED) {
    throw new HttpError(400, `status chỉ có thể là "${ORDER_STATUS.DELIVERED}" hoặc "${ORDER_STATUS.CANCELLED}".`);
  }

  return status;
}

function serializeOrder(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString() || data.createdAt || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() || data.updatedAt || null
  };
}

module.exports = {
  validateOrderInput,
  validateStatus,
  serializeOrder,
  roundMoney
};
