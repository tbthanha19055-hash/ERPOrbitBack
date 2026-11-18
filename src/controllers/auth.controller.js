const crypto = require("crypto");
const { getAuthService } = require("../config/firebase");
const HttpError = require("../utils/http-error");
const { getCredentials } = require("../middleware/auth");

const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 5);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.SESSION_COOKIE_SAMESITE || "lax",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/"
  };
}

async function createSession(req, res) {
  const idToken = req.body?.idToken || (getCredentials(req)?.type === "token" ? getCredentials(req).token : null);
  if (!idToken) throw new HttpError(400, "idToken là bắt buộc.");

  const sessionCookie = await getAuthService().createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });
  res.cookie(process.env.SESSION_COOKIE_NAME || "session", sessionCookie, cookieOptions());
  res.cookie("csrfToken", crypto.randomBytes(32).toString("hex"), { ...cookieOptions(), httpOnly: false });
  res.json({ data: { authenticated: true } });
}

function clearSession(req, res) {
  res.clearCookie(process.env.SESSION_COOKIE_NAME || "session", { ...cookieOptions(), maxAge: undefined });
  res.clearCookie("csrfToken", { ...cookieOptions(), maxAge: undefined, httpOnly: false });
  res.json({ data: { authenticated: false } });
}

function currentUser(req, res) {
  const context = req.userContext;
  res.json({
    data: {
      uid: context.uid,
      user: context.user,
      tenant: context.tenant,
      role: context.role
    }
  });
}

module.exports = { createSession, clearSession, currentUser };
