const { getAuthService, getDb } = require("../config/firebase");
const { tenantDocument } = require("../utils/firestore");
const HttpError = require("../utils/http-error");
const { ACTIVE_STATUS } = require("../constants/status");
const { getBypassContext, isAuthRequired } = require("../config/security");

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const item = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function getCredentials(req) {
  const sessionCookie = getCookie(req, process.env.SESSION_COOKIE_NAME || "session");
  if (sessionCookie) return { type: "session", token: sessionCookie };

  const authorization = req.headers.authorization || "";
  if (authorization.startsWith("Bearer ")) {
    return { type: "token", token: authorization.slice(7) };
  }

  return null;
}

async function verifyRequest(req) {
  const credentials = getCredentials(req);
  if (!credentials) {
    throw new HttpError(401, "Yêu cầu đăng nhập.");
  }

  try {
    const auth = getAuthService();
    return credentials.type === "session"
      ? await auth.verifySessionCookie(credentials.token, true)
      : await auth.verifyIdToken(credentials.token, true);
  } catch (error) {
    if (error.statusCode) throw error;
    throw new HttpError(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.");
  }
}

async function loadUserContext(decodedToken) {
  const db = getDb();
  const userSnapshot = await db.collection("users").doc(decodedToken.uid).get();
  if (!userSnapshot.exists) throw new HttpError(403, "Tài khoản chưa được cấp hồ sơ hệ thống.");

  const user = userSnapshot.data();
  if (user.status !== ACTIVE_STATUS) throw new HttpError(403, "Tài khoản không hoạt động.");
  if (!user.tenantId || !user.roleId) throw new HttpError(403, "Hồ sơ tài khoản thiếu tenant hoặc role.");

  const tenantSnapshot = await tenantDocument(db, user.tenantId).get();
  if (!tenantSnapshot.exists || tenantSnapshot.data().status !== ACTIVE_STATUS) {
    throw new HttpError(403, "Tenant không hoạt động.");
  }

  const roleSnapshot = await db.collection("roles").doc(user.roleId).get();
  if (!roleSnapshot.exists || roleSnapshot.data().tenantId !== user.tenantId || roleSnapshot.data().status !== ACTIVE_STATUS) {
    throw new HttpError(403, "Role không hoạt động.");
  }

  return {
    uid: decodedToken.uid,
    claims: decodedToken,
    user: { id: userSnapshot.id, ...user },
    tenant: { id: tenantSnapshot.id, ...tenantSnapshot.data() },
    role: { id: roleSnapshot.id, ...roleSnapshot.data() },
    tenantId: user.tenantId,
    roleId: user.roleId
  };
}

function hasPermission(role, permission) {
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  return permissions.includes("*") || permissions.includes(permission);
}

function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      if (!isAuthRequired()) {
        req.userContext = getBypassContext();
        return next();
      }

      const decodedToken = await verifyRequest(req);
      const context = await loadUserContext(decodedToken);
      if (!hasPermission(context.role, permission)) {
        throw new HttpError(403, "Bạn không có quyền thực hiện thao tác này.");
      }

      req.userContext = context;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAuth() {
  return async (req, res, next) => {
    try {
      if (!isAuthRequired()) {
        req.auth = getBypassContext().claims;
        req.userContext = getBypassContext();
        return next();
      }

      const decodedToken = await verifyRequest(req);
      req.auth = decodedToken;
      req.userContext = await loadUserContext(decodedToken);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { requireAuth, requirePermission, getCredentials, loadUserContext, getCookie };
