/**
 * Firebase Admin SDK — Server-Side Only
 *
 * Used exclusively in Next.js API Routes (server-side).
 * Never import this file in client components.
 *
 * Credentials are loaded from:
 *   1. FIREBASE_SERVICE_ACCOUNT_KEY env var (JSON string) — recommended for production
 *   2. serviceAccountKey.json at the project root — fallback for local development
 */
import * as admin from "firebase-admin";
import { readFileSync } from "fs";
import { join } from "path";

function getAdminApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  let credential: admin.credential.Credential;

  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (envKey) {
    // Production: JSON string in env var
    const serviceAccount = JSON.parse(envKey) as admin.ServiceAccount;
    credential = admin.credential.cert(serviceAccount);
  } else {
    // Development: read from serviceAccountKey.json at project root
    const keyPath = join(process.cwd(), "serviceAccountKey.json");
    const serviceAccount = JSON.parse(
      readFileSync(keyPath, "utf-8"),
    ) as admin.ServiceAccount;
    credential = admin.credential.cert(serviceAccount);
  }

  return admin.initializeApp({
    credential,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

// Lazy getters — the Admin SDK is only initialised on the first actual
// server-side request, never during Next.js build-time static analysis.
// This prevents the build from failing when serviceAccountKey.json is absent
// (e.g. on Vercel) and FIREBASE_SERVICE_ACCOUNT_KEY is not yet set.
let _app: admin.app.App | null = null;
function getApp(): admin.app.App {
  if (!_app) _app = getAdminApp();
  return _app;
}

export const adminDb = new Proxy({} as admin.firestore.Firestore, {
  get(_target, prop) {
    return (
      getApp().firestore() as unknown as Record<string | symbol, unknown>
    )[prop];
  },
});

export const adminAuth = new Proxy({} as admin.auth.Auth, {
  get(_target, prop) {
    return (getApp().auth() as unknown as Record<string | symbol, unknown>)[
      prop
    ];
  },
});

export const adminStorage = new Proxy({} as admin.storage.Storage, {
  get(_target, prop) {
    return (getApp().storage() as unknown as Record<string | symbol, unknown>)[
      prop
    ];
  },
});

export { admin };
