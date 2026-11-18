const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const hasServiceAccount =
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
  (process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY);

let firebaseApp;
let initializationError;

try {
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
  } else if (hasServiceAccount) {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : {
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        };

    firebaseApp = initializeApp({ credential: cert(serviceAccount) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    firebaseApp = initializeApp();
  }
} catch (error) {
  initializationError = error;
}

function getDb() {
  if (initializationError) {
    const error = new Error(`Không thể khởi tạo Firebase: ${initializationError.message}`);
    error.statusCode = 503;
    throw error;
  }

  if (!firebaseApp) {
    const error = new Error(
      "Firebase chưa được cấu hình. Vui lòng thiết lập FIREBASE_SERVICE_ACCOUNT_JSON hoặc bộ FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY."
    );
    error.statusCode = 503;
    throw error;
  }

  return getFirestore(firebaseApp);
}

function getAuthService() {
  if (!firebaseApp) {
    getDb();
  }

  return getAuth(firebaseApp);
}

function isFirebaseConfigured() {
  return Boolean(firebaseApp) && !initializationError;
}

module.exports = { getDb, getAuthService, isFirebaseConfigured };
