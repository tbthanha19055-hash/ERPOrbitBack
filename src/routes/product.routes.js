const express = require("express");
const controller = require("../controllers/product.controller");
const { requirePermission } = require("../middleware/auth");

const router = express.Router();
router.get("/", requirePermission("product.view"), controller.list);
router.post("/", requirePermission("product.create"), controller.create);
router.put("/:id", requirePermission("product.update"), controller.update);
router.delete("/:id", requirePermission("product.delete"), controller.remove);

module.exports = router;
