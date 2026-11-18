const { now } = require("./firestore");

function addAuditLog(transaction, db, tenantId, data) {
  const ref = db.collection("auditLogs").doc();
  transaction.set(ref, {
    ...data,
    tenantId,
    createdAt: now()
  });
}

module.exports = { addAuditLog };
