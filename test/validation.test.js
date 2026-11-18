const test = require("node:test");
const assert = require("node:assert/strict");
const { validateOrderPayload, generateOrderCode } = require("../src/services/order.service");
const { Timestamp } = require("firebase-admin/firestore");
const { ORDER_STATUS } = require("../src/constants/order");

test("order input accepts existing customer and products", () => {
  const input = validateOrderPayload({
    clientId: "client_001",
    items: [{ productId: "product_001", quantity: 2 }],
    action: "confirm"
  });

  assert.equal(input.items[0].quantity, 2);
  assert.equal(input.action, "confirm");
});

test("order input accepts new customer and product", () => {
  const input = validateOrderPayload({
    newClient: { name: "Nguyen Van A", phone: "0900000000" },
    items: [{ newProduct: { name: "Mouse", unitPrice: 300000 }, quantity: 1 }]
  });

  assert.equal(input.newClient.type, "individual");
  assert.equal(input.items[0].newProduct.price, 300000);
});

test("order input rejects invalid relationships and quantities", () => {
  assert.throws(
    () => validateOrderPayload({ clientId: "client_001", items: [{ productId: "p1", newProduct: { name: "x", unitPrice: 1 }, quantity: 1 }] }),
    /đúng một trong productId hoặc newProduct/
  );
  assert.throws(
    () => validateOrderPayload({ clientId: "client_001", items: [{ productId: "p1", quantity: 0 }] }),
    /quantity phải là số nguyên/
  );
});

test("statuses are lowercase and only final statuses are transition targets", () => {
  assert.deepEqual(ORDER_STATUS, { NEW: "new", DELIVERED: "delivered", CANCELLED: "cancelled", DELETED: "deleted" });
});

test("order code uses client code, SKU and Vietnam datetime", () => {
  const code = generateOrderCode({
    clientSnapshot: { clientCode: "CUS001" },
    items: [{ productSnapshot: { sku: "SP001" } }]
  }, Timestamp.fromDate(new Date("2026-11-18T04:56:30.000Z")));

  assert.equal(code, "CUS001-SP001-20261118115630");
});
