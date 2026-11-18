const ORDER_STATUS = Object.freeze({
  NEW: "new",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  DELETED: "deleted"
});

const FINAL_STATUSES = new Set([
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.CANCELLED,
  ORDER_STATUS.DELETED
]);

module.exports = { ORDER_STATUS, FINAL_STATUSES };
