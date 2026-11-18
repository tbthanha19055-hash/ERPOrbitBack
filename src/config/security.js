function isAuthRequired() {
  return String(process.env.AUTH_REQUIRED || "true").toLowerCase() !== "false";
}

function getBypassContext() {
  const tenantId = process.env.AUTH_BYPASS_TENANT_ID || "KCwvQrgxfgvnqla11eFI";
  const uid = process.env.AUTH_BYPASS_UID || "local-bypass-user";

  return {
    uid,
    tenantId,
    roleId: "bypass-admin",
    claims: { uid, authBypassed: true },
    user: { id: uid, tenantId, roleId: "bypass-admin", status: "active" },
    tenant: { id: tenantId, status: "active" },
    role: { id: "bypass-admin", status: "active", permissions: ["*"] }
  };
}

module.exports = { isAuthRequired, getBypassContext };
