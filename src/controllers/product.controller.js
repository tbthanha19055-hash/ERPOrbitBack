const service = require("../services/product.service");

async function list(req, res) { res.json({ data: await service.listProducts(req.userContext) }); }
async function create(req, res) { res.status(201).json({ data: await service.createProduct(req.userContext, req.body) }); }
async function update(req, res) { res.json({ data: await service.updateProduct(req.userContext, req.params.id, req.body) }); }
async function remove(req, res) { res.json({ data: await service.deleteProduct(req.userContext, req.params.id) }); }

module.exports = { list, create, update, remove };
