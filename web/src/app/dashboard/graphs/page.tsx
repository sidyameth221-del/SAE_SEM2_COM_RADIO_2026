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
  }).format(d);
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  if (maxPoints < 2) return arr.slice(0, 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round((i * (arr.length - 1)) / (maxPoints - 1));
    out.push(arr[idx]);
  }
  return out;
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
): { path: string; min: number | null; max: number | null; last: number | null; lastX: number | null; lastY: number | null } {
  const values: number[] = [];
  for (const p of pts) {
    const v = accessor(p);
    if (typeof v === "number" && Number.isFinite(v)) values.push(v);
  }
  if (values.length === 0 || pts.length < 2) {
    return { path: "", min: null, max: null, last: null, lastX: null, lastY: null };
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }

  const xStep = width / (pts.length - 1);
  const xy: { x: number; y: number }[] = [];
  let last: number | null = null;
  let lastX: number | null = null;
  let lastY: number | null = null;
  for (let i = 0; i < pts.length; i++) {
    const v = accessor(pts[i]);
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const x = i * xStep;
    const t = (v - min) / (max - min);
    const y = height - t * height;
    const cy = clamp(y, 0, height);
    xy.push({ x, y: cy });
    last = v;
    lastX = x;
    lastY = cy;
  }
  return { path: buildLinePath(xy), min, max, last, lastX, lastY };
}

function ChartCard(props: {
  title: string;
  unit: string;
  points: GraphPoint[];
  inside: (p: GraphPoint) => number | null;
  outside: (p: GraphPoint) => number | null;
}) {
  const width = 900;
  const height = 220;

  const inS = normalizeSeries(props.points, props.inside, width, height);
  const outS = normalizeSeries(props.points, props.outside, width, height);
  const empty = !inS.path && !outS.path;

  const from = props.points.length ? props.points[0].ts : null;
  const to = props.points.length ? props.points[props.points.length - 1].ts : null;

  return (
    <div className="rounded-lg border border-foreground/15 bg-background/60 p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm text-foreground/60">{props.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-foreground/60">
            <span>
              Période: <span className="font-mono">{formatParis(from)}</span> →{" "}
              <span className="font-mono">{formatParis(to)}</span>
            </span>
            <span>
              Points: <span className="font-mono">{props.points.length}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-2 text-foreground/80">
            <span className="inline-block h-[2px] w-8 bg-current" /> IN
          </span>
          <span className="inline-flex items-center gap-2 text-foreground/60">
            <span className="inline-block h-[2px] w-8 bg-current opacity-60" style={{ backgroundImage: "linear-gradient(to right, currentColor 60%, transparent 0%)", backgroundSize: "10px 2px" }} />{" "}
            OUT
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-foreground/60">
        <span>
          IN dernier: <span className="font-mono">{inS.last ?? "--"}</span> {props.unit}
        </span>
        <span>
          OUT dernier: <span className="font-mono">{outS.last ?? "--"}</span> {props.unit}
        </span>
        <span>
          Min/Max: <span className="font-mono">{inS.min ?? outS.min ?? "--"}</span> →{" "}
          <span className="font-mono">{inS.max ?? outS.max ?? "--"}</span> {props.unit}
        </span>
      </div>

      <div className="mt-3 h-56 w-full">
        {empty ? (
          <div className="text-sm text-foreground/60">Pas assez de données.</div>
        ) : (
          <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full text-foreground">
            {/* grid */}
            <g opacity="0.25" stroke="currentColor" strokeWidth="1">
              <line x1={0} y1={height * 0.25} x2={width} y2={height * 0.25} />
              <line x1={0} y1={height * 0.5} x2={width} y2={height * 0.5} />
              <line x1={0} y1={height * 0.75} x2={width} y2={height * 0.75} />
            </g>

            {/* series */}
            <path d={inS.path} fill="none" stroke="currentColor" strokeWidth="2" />
            <path
              d={outS.path}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              opacity="0.6"
              strokeDasharray="8 6"
            />

            {/* last point markers */}
            {typeof inS.lastX === "number" && typeof inS.lastY === "number" ? (
              <circle cx={inS.lastX} cy={inS.lastY} r={4} fill="currentColor" />
            ) : null}
            {typeof outS.lastX === "number" && typeof outS.lastY === "number" ? (
              <circle cx={outS.lastX} cy={outS.lastY} r={4} fill="currentColor" opacity={0.6} />
            ) : null}

            {/* y labels */}
            <g fill="currentColor" opacity="0.7">
              {inS.max != null || outS.max != null ? (
                <text x={6} y={14} fontSize={12}>
                  {(inS.max ?? outS.max)?.toFixed(1)}{props.unit}
                </text>
              ) : null}
              {inS.min != null || outS.min != null ? (
                <text x={6} y={height - 6} fontSize={12}>
                  {(inS.min ?? outS.min)?.toFixed(1)}{props.unit}
                </text>
              ) : null}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
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
      setGraphPoints(downsample(pts, 120));
    });

    return () => {
      unsubLatest();
      unsubGraph();
    };
  }, [db, homeId]);

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
          <div className="text-lg font-semibold">Température</div>
          <div className="mt-3">
            <ChartCard
              title="Température (IN / OUT)"
              unit="°C"
              points={graphPoints}
              inside={(p) => p.insideT}
              outside={(p) => p.outsideT}
            />
          </div>
        </section>

        <section className="rounded-xl border border-foreground/15 bg-foreground/5 p-4 sm:p-5">
          <div className="text-lg font-semibold">Humidité</div>
          <div className="mt-3">
            <ChartCard
              title="Humidité (IN / OUT)"
              unit="%"
              points={graphPoints}
              inside={(p) => p.insideH}
              outside={(p) => p.outsideH}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
