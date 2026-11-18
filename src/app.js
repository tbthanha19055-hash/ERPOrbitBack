
const express = require("express");
const cors = require("cors");
const { isFirebaseConfigured } = require("./config/firebase");
const authRoutes = require("./routes/auth.routes");
const clientRoutes = require("./routes/client.routes");
const productRoutes = require("./routes/product.routes");
const orderRoutes = require("./routes/order.routes");
const reportRoutes = require("./routes/report.routes");
const HttpError = require("./utils/http-error");
const csrfProtection = require("./middleware/csrf");
const { isAuthRequired } = require("./config/security");

const app = express();

const allowedOrigins = String(process.env.CORS_ORIGINS || "http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllOrigins = allowedOrigins.includes("*");

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowAllOrigins || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new HttpError(403, "Origin không được phép."));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-CSRF-Token"]
}));
app.use(express.json({ limit: "1mb" }));
app.use(csrfProtection);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "order-management-api",
    firebaseConfigured: isFirebaseConfigured(),
    authRequired: isAuthRequired()
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/customers", clientRoutes);
app.use("/api/products", productRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reports", reportRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Không tìm thấy endpoint." });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || (error.type === "entity.parse.failed" ? 400 : 500);
  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    message: error.type === "entity.parse.failed" ? "JSON request không hợp lệ." : error.message || "Đã xảy ra lỗi máy chủ.",
    ...(error.details ? { detail: error.details } : {})
  });
});

module.exports = app;
