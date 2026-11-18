const crypto = require("crypto");
const { getCookie } = require("./auth");
const HttpError = require("../utils/http-error");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const sessionCookieName = process.env.SESSION_COOKIE_NAME || "session";
  const sessionCookie = getCookie(req, sessionCookieName);
  if (!sessionCookie) return next();

  const cookieToken = getCookie(req, "csrfToken");
  const headerToken = req.get("X-CSRF-Token");
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    return next(new HttpError(403, "CSRF token không hợp lệ."));
  }

  return next();
}

module.exports = csrfProtection;
