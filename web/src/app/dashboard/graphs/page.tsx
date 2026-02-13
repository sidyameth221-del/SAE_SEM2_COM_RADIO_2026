"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { onAuthStateChanged, type User } from "firebase/auth";
import {
  limitToLast,
  onValue,
  orderByKey,
  query,
  ref,
  type DataSnapshot,
  type Database,
} from "firebase/database";

import { getFirebase } from "@/lib/firebase";

type MeasurementsNode = {
  inside?: { temperature?: number; humidity?: number };
  outside?: { temperature?: number; humidity?: number };
};

type GraphPoint = {
  ts: string;
  insideT: number | null;
  insideH: number | null;
  outsideT: number | null;
  outsideH: number | null;
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
    return true;
  });
  return found;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildLinePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points
    .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

function normalizeSeries(
  pts: GraphPoint[],
  accessor: (p: GraphPoint) => number | null,
  width: number,
  height: number
): { path: string; min: number | null; max: number | null } {
  const values: number[] = [];
  for (const p of pts) {
    const v = accessor(p);
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0 || pts.length < 2) return { path: "", min: null, max: null };

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const xStep = width / (pts.length - 1);
  const xy: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const v = accessor(pts[i]);
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const x = i * xStep;
    const t = (v - min) / (max - min);
    const y = height - t * height;
    xy.push({ x, y: clamp(y, 0, height) });
  }
  return { path: buildLinePath(xy), min, max };
}

export default function GraphsPage() {
  const router = useRouter();

  const [auth, setAuth] = useState<ReturnType<typeof getFirebase>["auth"] | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);

  const [latestTs, setLatestTs] = useState<string | null>(null);
  const [graphPoints, setGraphPoints] = useState<GraphPoint[]>([]);

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
      setLatestTs(null);
      setGraphPoints([]);
      if (!u) router.push("/login");
    });
    return () => unsub();
  }, [auth, router]);

  useEffect(() => {
    if (!user || !db) return;
    const unsub = onValue(ref(db, `users/${user.uid}/homeId`), (snap) => {
      const v = snap.val();
      if (typeof v === "string" && v.length > 0) setHomeId(v);
      else setHomeId(null);
    });
    return () => unsub();
  }, [db, user]);

  useEffect(() => {
    if (!db || !homeId) return;

    const latestQ = query(ref(db, `homes/${homeId}/measurements`), limitToLast(1));
    const unsubLatest = onValue(latestQ, (snap) => {
      const child = firstChild(snap);
      if (!child) return;
      setLatestTs(child.key);
    });

    const graphQ = query(ref(db, `homes/${homeId}/measurements`), orderByKey(), limitToLast(200));
    const unsubGraph = onValue(graphQ, (snap) => {
      const pts: GraphPoint[] = [];
      snap.forEach((child) => {
        const ts = child.key;
        if (!ts) return;
        const node = child.val() as MeasurementsNode;
        pts.push({
          ts,
          insideT: asNumber(node?.inside?.temperature),
          insideH: asNumber(node?.inside?.humidity),
          outsideT: asNumber(node?.outside?.temperature),
          outsideH: asNumber(node?.outside?.humidity),
        });
      });
      setGraphPoints(pts);
    });

    return () => {
      unsubLatest();
      unsubGraph();
    };
  }, [db, homeId]);

  const tempPaths = useMemo(() => {
    const width = 800;
    const height = 160;
    return {
      width,
      height,
      inside: normalizeSeries(graphPoints, (p) => p.insideT, width, height),
      outside: normalizeSeries(graphPoints, (p) => p.outsideT, width, height),
    };
  }, [graphPoints]);

  const humPaths = useMemo(() => {
    const width = 800;
    const height = 160;
    return {
      width,
      height,
      inside: normalizeSeries(graphPoints, (p) => p.insideH, width, height),
      outside: normalizeSeries(graphPoints, (p) => p.outsideH, width, height),
    };
  }, [graphPoints]);

  return (
    <div className="min-h-screen bg-background text-foreground px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Graphes</h1>
            <p className="text-sm text-foreground/60">Dernières mesures enregistrées</p>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm hover:bg-foreground/5"
            onClick={() => router.push("/dashboard")}
          >
            Retour
          </button>
        </header>

        {firebaseError ? <div className="text-sm text-red-600 break-words">{firebaseError}</div> : null}

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-foreground/60">Maison</div>
            <div className="text-sm break-words">
              <span className="font-mono">{homeId ?? "--"}</span>
            </div>
          </div>
          <div className="mt-2 text-sm text-foreground/60 break-words">
            Dernier timestamp: <span className="font-mono">{latestTs ?? "--"}</span>
          </div>
        </section>

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          <div className="text-sm text-foreground/60">Température (IN / OUT)</div>
          <div className="mt-3 h-40 w-full">
            {(() => {
              const empty = !tempPaths.inside.path && !tempPaths.outside.path;
              if (empty) return <div className="text-sm text-foreground/60">Pas assez de données.</div>;
              return (
                <svg viewBox={`0 0 ${tempPaths.width} ${tempPaths.height}`} className="h-full w-full text-foreground">
                  <path d={tempPaths.inside.path} fill="none" stroke="currentColor" strokeWidth="2" />
                  <path
                    d={tempPaths.outside.path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    opacity="0.6"
                    strokeDasharray="6 4"
                  />
                </svg>
              );
            })()}
          </div>
          <div className="mt-2 text-xs text-foreground/60">IN = ligne pleine, OUT = pointillée</div>
        </section>

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          <div className="text-sm text-foreground/60">Humidité (IN / OUT)</div>
          <div className="mt-3 h-40 w-full">
            {(() => {
              const empty = !humPaths.inside.path && !humPaths.outside.path;
              if (empty) return <div className="text-sm text-foreground/60">Pas assez de données.</div>;
              return (
                <svg viewBox={`0 0 ${humPaths.width} ${humPaths.height}`} className="h-full w-full text-foreground">
                  <path d={humPaths.inside.path} fill="none" stroke="currentColor" strokeWidth="2" />
                  <path
                    d={humPaths.outside.path}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    opacity="0.6"
                    strokeDasharray="6 4"
                  />
                </svg>
              );
            })()}
          </div>
          <div className="mt-2 text-xs text-foreground/60">IN = ligne pleine, OUT = pointillée</div>
        </section>
      </div>
    </div>
  );
}
