const express = require("express");
const controller = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/session", controller.createSession);
router.post("/logout", controller.clearSession);
router.get("/me", requireAuth(), controller.currentUser);

module.exports = router;
