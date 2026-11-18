const express = require("express");
const controller = require("../controllers/client.controller");
const { requirePermission } = require("../middleware/auth");

const router = express.Router();
router.get("/", requirePermission("client.view"), controller.list);
router.post("/", requirePermission("client.create"), controller.create);
router.put("/:id", requirePermission("client.update"), controller.update);
router.delete("/:id", requirePermission("client.delete"), controller.remove);

module.exports = router;
