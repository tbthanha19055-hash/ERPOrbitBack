const express = require("express");
const controller = require("../controllers/order.controller");
const { requirePermission } = require("../middleware/auth");

const router = express.Router();
router.get("/daily", requirePermission("report.view"), controller.dailyRevenue);
router.get("/revenue-by-day", requirePermission("report.view"), controller.dailyRevenue);

module.exports = router;
