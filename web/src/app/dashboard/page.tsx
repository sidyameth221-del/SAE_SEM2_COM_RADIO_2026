"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  onAuthStateChanged,
  signOut,
  type User,
} from "firebase/auth";
import {
  get,
  onValue,
  query,
  ref,
  limitToLast,
  orderByKey,
  endAt,
  set,
  type DataSnapshot,
  type Database,
} from "firebase/database";

import { getFirebase } from "@/lib/firebase";

type MeasurementsNode = {
  inside?: { temperature?: number; humidity?: number };
  outside?: { temperature?: number; humidity?: number };
};

type LampNode = {
  state?: "ON" | "OFF";
  timestamp?: string;
};

type HomeSettingsNode = {
  logPeriodSec?: number | string;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstChild(snapshot: DataSnapshot): { key: string; val: unknown } | null {
  let found: { key: string; val: unknown } | null = null;
  snapshot.forEach((child) => {
    found = { key: child.key ?? "", val: child.val() };
    return true; // stop after first
  });
  return found;
}

function isoNowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isoUtcSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatParis(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}


export default function DashboardPage() {
  const router = useRouter();

  const [auth, setAuth] = useState<ReturnType<typeof getFirebase>["auth"] | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeIdInput, setHomeIdInput] = useState<string>("");
  const [homeSaveError, setHomeSaveError] = useState<string | null>(null);
  const [homeSaveBusy, setHomeSaveBusy] = useState<boolean>(false);
  const [latestTs, setLatestTs] = useState<string | null>(null);
  const [insideT, setInsideT] = useState<number | null>(null);
  const [insideH, setInsideH] = useState<number | null>(null);
  const [outsideT, setOutsideT] = useState<number | null>(null);
  const [outsideH, setOutsideH] = useState<number | null>(null);

  const [lampState, setLampState] = useState<"ON" | "OFF">("OFF");
  const [lampTs, setLampTs] = useState<string | null>(null);

  const [logPeriodSec, setLogPeriodSec] = useState<number | null>(null);
  const [logPeriodInput, setLogPeriodInput] = useState<string>("");
  const [logSaveBusy, setLogSaveBusy] = useState<boolean>(false);
  const [logSaveError, setLogSaveError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState<string>("");
  const [searchBusy, setSearchBusy] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTs, setSearchTs] = useState<string | null>(null);
  const [searchInsideT, setSearchInsideT] = useState<number | null>(null);
  const [searchInsideH, setSearchInsideH] = useState<number | null>(null);
  const [searchOutsideT, setSearchOutsideT] = useState<number | null>(null);
  const [searchOutsideH, setSearchOutsideH] = useState<number | null>(null);

  useEffect(() => {
    try {
      const fb = getFirebase();
      setAuth(fb.auth);
      setDb(fb.db);
    } catch (err) {
      setFirebaseError(err instanceof Error ? err.message : "Firebase config error");
    }
  }, []);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setHomeId(null);
      setHomeError(null);
      setHomeIdInput("");
      setHomeSaveError(null);
      setHomeSaveBusy(false);
      setSearchInput("");
      setSearchBusy(false);
      setSearchError(null);
      setSearchTs(null);
      setSearchInsideT(null);
      setSearchInsideH(null);
      setSearchOutsideT(null);
      setSearchOutsideH(null);

      setLogPeriodSec(null);
      setLogPeriodInput("");
      setLogSaveBusy(false);
      setLogSaveError(null);
      if (!u) router.push("/login");
    });
    return () => unsub();
  }, [auth, router]);

  useEffect(() => {
    if (!user || !db) return;

    const userHomeRef = ref(db, `users/${user.uid}/homeId`);
    const unsub = onValue(userHomeRef, (snap) => {
      const v = snap.val();
      if (typeof v === "string" && v.length > 0) {
        setHomeId(v);
        setHomeError(null);
        setHomeIdInput(v);
      } else {
        setHomeId(null);
        setHomeError(null);
      }
    });

    return () => unsub();
  }, [db, user]);

  useEffect(() => {
    if (!user || !db || !homeId) return;

    const measQ = query(ref(db, `homes/${homeId}/measurements`), limitToLast(1));
    const measUnsub = onValue(measQ, (snap) => {
      const child = firstChild(snap);
      if (!child) return;
      setLatestTs(child.key);
      const node = child.val as MeasurementsNode;
      setInsideT(asNumber(node?.inside?.temperature));
      setInsideH(asNumber(node?.inside?.humidity));
      setOutsideT(asNumber(node?.outside?.temperature));
      setOutsideH(asNumber(node?.outside?.humidity));
    });

    const lampUnsub = onValue(ref(db, `homes/${homeId}/commands/lamp`), (snap) => {
      const node = snap.val() as LampNode | null;
      if (!node) return;
      if (node.state === "ON" || node.state === "OFF") setLampState(node.state);
      if (typeof node.timestamp === "string") setLampTs(node.timestamp);
    });

    const settingsUnsub = onValue(ref(db, `homes/${homeId}/settings`), (snap) => {
      const node = snap.val() as HomeSettingsNode | null;
      const sec = asNumber(node?.logPeriodSec);
      if (typeof sec === "number") {
        const cleaned = Math.round(sec);
        setLogPeriodSec(cleaned);
        setLogPeriodInput(String(cleaned));
      }
    });

    return () => {
      measUnsub();
      lampUnsub();
      settingsUnsub();
    };
  }, [db, homeId, user]);

  async function saveLogPeriod() {
    if (!db || !homeId) return;
    setLogSaveError(null);

    const raw = logPeriodInput.trim();
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setLogSaveError("Fréquence invalide.");
      return;
    }
    const sec = clamp(Math.round(n), 1, 3600);

    setLogSaveBusy(true);
    try {
      await set(ref(db, `homes/${homeId}/settings/logPeriodSec`), sec);
      setLogPeriodSec(sec);
      setLogPeriodInput(String(sec));
    } catch (err) {
      setLogSaveError(err instanceof Error ? err.message : "Erreur lors de l'enregistrement");
    } finally {
      setLogSaveBusy(false);
    }
  }

  async function saveHomeId() {
    if (!db || !user) return;
    setHomeSaveError(null);

    const cleaned = homeIdInput.trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(cleaned)) {
      setHomeSaveError("HOME_ID invalide. Utilise 3-32 caractères: lettres/chiffres/_/-");
      return;
    }

    setHomeSaveBusy(true);
    try {
      await set(ref(db, `users/${user.uid}/homeId`), cleaned);
    } catch (err) {
      setHomeSaveError(err instanceof Error ? err.message : "Erreur lors de l'association HOME_ID");
    } finally {
      setHomeSaveBusy(false);
    }
  }

  async function toggleLamp() {
    if (!db || !homeId) return;
    const next = lampState === "ON" ? "OFF" : "ON";
    await set(ref(db, `homes/${homeId}/commands/lamp`), {
      state: next,
      timestamp: isoNowUtc(),
    } satisfies LampNode);
  }

  async function runSearch() {
    if (!db || !homeId) return;
    setSearchError(null);
    setSearchTs(null);
    setSearchInsideT(null);
    setSearchInsideH(null);
    setSearchOutsideT(null);
    setSearchOutsideH(null);

    const cleaned = searchInput.trim();
    if (!cleaned) {
      setSearchError("Choisis une date et une heure.");
      return;
    }

    // datetime-local returns a string without timezone. JS parses it as local time.
    const d = new Date(cleaned);
    if (Number.isNaN(d.valueOf())) {
      setSearchError("Date/heure invalide.");
      return;
    }

    // Measurements keys are UTC ISO strings. We query the last key <= target time.
    const end = new Date(d);
    end.setSeconds(59, 999);
    const targetIso = isoUtcSeconds(end);

    setSearchBusy(true);
    try {
      const q = query(
        ref(db, `homes/${homeId}/measurements`),
        orderByKey(),
        endAt(targetIso),
        limitToLast(1)
      );
      const snap = await get(q);
      const child = firstChild(snap);
      if (!child) {
        setSearchError("Aucune mesure trouvée avant cette date.");
        return;
      }

      setSearchTs(child.key);
      const node = child.val as MeasurementsNode;
      setSearchInsideT(asNumber(node?.inside?.temperature));
      setSearchInsideH(asNumber(node?.inside?.humidity));
      setSearchOutsideT(asNumber(node?.outside?.temperature));
      setSearchOutsideH(asNumber(node?.outside?.humidity));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Erreur recherche");
    } finally {
      setSearchBusy(false);
    }
  }

  async function logout() {
    if (!auth) return;
    await signOut(auth);
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-foreground/60">Mesures temps réel + commande lampe</p>
          </div>
          <div className="flex gap-2">
            <button
              className="inline-flex items-center justify-center rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm hover:bg-foreground/5"
              onClick={() => router.push("/dashboard/graphs")}
            >
              Graphes
            </button>
            <button
              className="inline-flex items-center justify-center rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm hover:bg-foreground/5"
              onClick={logout}
            >
              Déconnexion
            </button>
          </div>
        </header>

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          {firebaseError ? (
            <div className="mb-3 text-sm text-red-600 break-words">{firebaseError}</div>
          ) : null}
          {homeError ? (
            <div className="mb-3 text-sm text-red-600 break-words">{homeError}</div>
          ) : null}
          {homeSaveError ? (
            <div className="mb-3 text-sm text-red-600 break-words">{homeSaveError}</div>
          ) : null}
          {logSaveError ? (
            <div className="mb-3 text-sm text-red-600 break-words">{logSaveError}</div>
          ) : null}

          <div className="mb-4 rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="text-sm text-foreground/60">Compte</div>
                <div className="text-sm break-words">
                  UID: <span className="font-mono">{user?.uid ?? "--"}</span>
                </div>
                <div className="text-sm break-words">
                  Maison (homeId): <span className="font-mono">{homeId ?? "--"}</span>
                </div>
              </div>
            </div>
            {!homeId ? (
              <div className="mt-4 space-y-2">
                <div className="text-xs text-foreground/60">
                  Entre le code maison (HOME_ID) fourni par l’installateur (ex: <span className="font-mono">homeA</span>).
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className="w-full rounded-md border border-foreground/15 bg-background/60 px-3 py-2 text-sm outline-none focus:border-foreground/30"
                    value={homeIdInput}
                    onChange={(e) => setHomeIdInput(e.target.value)}
                    placeholder="HOME_ID (ex: homeA)"
                    autoComplete="off"
                  />
                  <button
                    className="inline-flex items-center justify-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-60"
                    onClick={saveHomeId}
                    disabled={homeSaveBusy || !user}
                  >
                    {homeSaveBusy ? "..." : "Associer"}
                  </button>
                </div>
                <div className="text-[11px] text-foreground/60">
                  Note: une fois associé, ce HOME_ID ne peut pas être changé depuis le dashboard.
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
            <div className="text-sm text-foreground/60">Enregistrement</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                Fréquence d'enregistrement dans la base: <span className="font-mono">{logPeriodSec ?? "--"}</span> s
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className="w-full rounded-md border border-foreground/15 bg-background/60 px-3 py-2 text-sm outline-none focus:border-foreground/30 sm:w-40"
                  value={logPeriodInput}
                  onChange={(e) => setLogPeriodInput(e.target.value)}
                  placeholder="Secondes (1-3600)"
                  inputMode="numeric"
                />
                <button
                  className="inline-flex items-center justify-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-60"
                  onClick={saveLogPeriod}
                  disabled={!homeId || logSaveBusy}
                >
                  {logSaveBusy ? "..." : "Enregistrer"}
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
              <div className="text-sm text-foreground/60">Intérieur</div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <div className="text-3xl font-semibold tabular-nums">
                  {insideT ?? "--"}
                  <span className="ml-1 text-base font-medium text-foreground/60">°C</span>
                </div>
                <div className="text-xl font-medium tabular-nums">
                  {insideH ?? "--"}
                  <span className="ml-1 text-sm font-medium text-foreground/60">%</span>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
              <div className="text-sm text-foreground/60">Extérieur</div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <div className="text-3xl font-semibold tabular-nums">
                  {outsideT ?? "--"}
                  <span className="ml-1 text-base font-medium text-foreground/60">°C</span>
                </div>
                <div className="text-xl font-medium tabular-nums">
                  {outsideH ?? "--"}
                  <span className="ml-1 text-sm font-medium text-foreground/60">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-sm text-foreground/60 break-words">
            Timestamp mesures: <span className="font-mono">{formatParis(latestTs)}</span>
          </div>
        </section>

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <div className="text-lg font-semibold">Recherche</div>
              <div className="text-sm text-foreground/60">
                Choisis une date/heure et on affiche la dernière mesure enregistrée avant ce moment.
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className="w-full rounded-md border border-foreground/15 bg-background/60 px-3 py-2 text-sm outline-none focus:border-foreground/30"
                type="datetime-local"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button
                className="inline-flex items-center justify-center rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-60"
                onClick={runSearch}
                disabled={searchBusy || !homeId}
              >
                {searchBusy ? "..." : "Rechercher"}
              </button>
            </div>
          </div>

          {searchError ? <div className="mt-3 text-sm text-red-600 break-words">{searchError}</div> : null}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
              <div className="text-sm text-foreground/60">Intérieur</div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <div className="text-3xl font-semibold tabular-nums">
                  {searchInsideT ?? "--"}
                  <span className="ml-1 text-base font-medium text-foreground/60">°C</span>
                </div>
                <div className="text-xl font-medium tabular-nums">
                  {searchInsideH ?? "--"}
                  <span className="ml-1 text-sm font-medium text-foreground/60">%</span>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
              <div className="text-sm text-foreground/60">Extérieur</div>
              <div className="mt-2 flex items-baseline justify-between gap-3">
                <div className="text-3xl font-semibold tabular-nums">
                  {searchOutsideT ?? "--"}
                  <span className="ml-1 text-base font-medium text-foreground/60">°C</span>
                </div>
                <div className="text-xl font-medium tabular-nums">
                  {searchOutsideH ?? "--"}
                  <span className="ml-1 text-sm font-medium text-foreground/60">%</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-sm text-foreground/60 break-words">
            Timestamp trouvé: <span className="font-mono">{formatParis(searchTs)}</span>
          </div>
        </section>

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-sm text-foreground/60">Lampe</div>
              <div className="flex items-center gap-2">
                <div className="text-lg font-semibold">{lampState}</div>
                <span className="rounded-full border border-foreground/15 bg-background/60 px-2 py-0.5 text-xs text-foreground/70">
                  {lampState === "ON" ? "Allumée" : "Éteinte"}
                </span>
              </div>
              <div className="text-sm text-foreground/60 break-words">
                Dernière commande: <span className="font-mono">{formatParis(lampTs)}</span>
              </div>
            </div>
            <button
              className="inline-flex items-center justify-center rounded-md bg-foreground text-background px-5 py-2.5 font-medium"
              onClick={toggleLamp}
            >
              Passer à {lampState === "ON" ? "OFF" : "ON"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
