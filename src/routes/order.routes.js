const express = require("express");
const controller = require("../controllers/order.controller");
const { requirePermission } = require("../middleware/auth");

const router = express.Router();
router.get("/", requirePermission("order.view"), controller.list);
router.get("/:id", requirePermission("order.view"), controller.get);
router.post("/", requirePermission("order.create"), controller.create);
router.put("/:id", requirePermission("order.update"), controller.update);
router.patch("/:id/status", requirePermission("order.update"), controller.updateStatus);
router.delete("/:id", requirePermission("order.delete"), controller.remove);

module.exports = router;
