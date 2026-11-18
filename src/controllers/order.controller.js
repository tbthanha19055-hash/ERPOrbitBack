const orderService = require("../services/order.service");

function idempotencyKey(req) {
  return req.get("Idempotency-Key") || null;
}

async function list(req, res) {
  res.json({ data: await orderService.listOrders(req.userContext) });
}

async function get(req, res) {
  res.json({ data: await orderService.getOrderById(req.userContext, req.params.id) });
}

async function create(req, res) {
  res.status(201).json({ data: await orderService.createOrder(req.userContext, req.body, idempotencyKey(req)) });
}

async function update(req, res) {
  res.json({ data: await orderService.updateOrder(req.userContext, req.params.id, req.body, idempotencyKey(req)) });
}

async function updateStatus(req, res) {
  res.json({ data: await orderService.updateStatus(req.userContext, req.params.id, req.body?.status) });
}

async function remove(req, res) {
  res.json({ data: await orderService.deleteOrder(req.userContext, req.params.id) });
}

async function dailyRevenue(req, res) {
  res.json({ data: await orderService.dailyRevenue(req.userContext, req.query.days) });
}

module.exports = { list, get, create, update, updateStatus, remove, dailyRevenue };
