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

  return admin.initializeApp({ credential });
}

const adminApp = getAdminApp();
export const adminDb = adminApp.firestore();
export const adminAuth = adminApp.auth();
export { admin };
