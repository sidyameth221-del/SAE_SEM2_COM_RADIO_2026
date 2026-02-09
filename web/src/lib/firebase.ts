import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function assertEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export function getFirebase() {
  const config = {
    apiKey: assertEnv(firebaseConfig.apiKey, "NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: assertEnv(
      firebaseConfig.authDomain,
      "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    ),
    databaseURL: assertEnv(
      firebaseConfig.databaseURL,
      "NEXT_PUBLIC_FIREBASE_DATABASE_URL",
    ),
    projectId: assertEnv(
      firebaseConfig.projectId,
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    ),
    appId: assertEnv(firebaseConfig.appId, "NEXT_PUBLIC_FIREBASE_APP_ID"),
  };

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  return {
    app,
    auth: getAuth(app),
    db: getDatabase(app),
  };
}
