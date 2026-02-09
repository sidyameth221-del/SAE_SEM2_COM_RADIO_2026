"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";

import { getFirebase } from "@/lib/firebase";

export default function LoginPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [auth, setAuth] = useState<ReturnType<typeof getFirebase>["auth"] | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    try {
      const fb = getFirebase();
      setAuth(fb.auth);
      setAuthReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Firebase config error");
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!auth) {
      setError("Firebase not initialized. Check .env.local.");
      return;
    }

    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAccount() {
    setError(null);
    setInfo(null);

    if (!auth) {
      setError("Firebase not initialized. Check .env.local.");
      return;
    }

    setBusy(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    setError(null);
    setInfo(null);

    if (!auth) {
      setError("Firebase not initialized. Check .env.local.");
      return;
    }

    const cleanedEmail = email.trim();
    if (!cleanedEmail) {
      setError("Entre ton email d'abord.");
      return;
    }

    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, cleanedEmail);
      setInfo("Email de réinitialisation envoyé (si le compte existe). Vérifie tes spams.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-black/10 dark:border-white/15 bg-white/70 dark:bg-black/20 p-6">
        <h1 className="text-xl font-semibold">Connexion</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Firebase Auth (email / password)
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1">
            <label className="text-sm">Email</label>
            <input
              className="w-full rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm">Mot de passe</label>
            <input
              className="w-full rounded-md border border-black/10 dark:border-white/15 bg-background px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error ? <div className="text-sm text-red-600 break-words">{error}</div> : null}
          {info ? <div className="text-sm text-foreground/70 break-words">{info}</div> : null}

          <button
            className="w-full rounded-md bg-foreground text-background py-2 font-medium disabled:opacity-60"
            type="submit"
            disabled={busy || !authReady}
          >
            {busy ? "Connexion..." : "Se connecter"}
          </button>

          <button
            className="w-full rounded-md border border-foreground/15 bg-background py-2 font-medium disabled:opacity-60"
            type="button"
            onClick={onForgotPassword}
            disabled={busy || !authReady}
          >
            Mot de passe oublié ?
          </button>

          <button
            className="w-full rounded-md border border-foreground/15 bg-background py-2 font-medium disabled:opacity-60"
            type="button"
            onClick={onCreateAccount}
            disabled={busy || !authReady}
          >
            {busy ? "..." : "Créer un compte"}
          </button>
        </form>
      </div>
    </div>
  );
}
