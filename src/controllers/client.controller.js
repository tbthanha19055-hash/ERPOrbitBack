const service = require("../services/client.service");

async function list(req, res) { res.json({ data: await service.listClients(req.userContext) }); }
async function create(req, res) { res.status(201).json({ data: await service.createClient(req.userContext, req.body) }); }
async function update(req, res) { res.json({ data: await service.updateClient(req.userContext, req.params.id, req.body) }); }
async function remove(req, res) { res.json({ data: await service.deleteClient(req.userContext, req.params.id) }); }

module.exports = { list, create, update, remove };
