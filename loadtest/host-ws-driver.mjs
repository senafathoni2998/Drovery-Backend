#!/usr/bin/env node
// Docker-free WS-tracking load driver (zero new deps: global WebSocket [Node 22+] + fetch +
// the existing pg). Exercises the §3/§4 REALTIME path the HTTP journey can't: it creates sim
// deliveries (the worker drives their lifecycle, emitting status + position frames), opens
// FANOUT WebSocket clients PER delivery (all owned by the delivery's user), subscribes each,
// and measures the fan-out — sim position write → tracking hot-store (§3) → sharded pub/sub
// (§4) → the WS gateway's local fan-out → N clients. Run with the scaling flags ON.
//
//   POOL=20 FANOUT=5 HOLD=90 node loadtest/host-ws-driver.mjs
import pg from "pg";

const BASE = process.env.BASE || "http://localhost:3000/api/v1";
const WS_BASE = process.env.WS_BASE || "ws://localhost:3000";
const WORKER_METRICS =
  process.env.WORKER_METRICS || "http://localhost:9091/metrics";
const POOL = Number(process.env.POOL || 20);
const FANOUT = Number(process.env.FANOUT || 5); // WS clients subscribed per delivery
const HOLD_MS = Number(process.env.HOLD || 90) * 1000;
const EMAIL_PREFIX = "hostws-";
const J = { "Content-Type": "application/json" };

const FROM = { lat: -6.9218, lng: 107.6071 };
const TO = { lat: -6.9175, lng: 107.6191 };

async function signup(i) {
  const email = `${EMAIL_PREFIX}${i}-${Date.now()}@loadtest.local`;
  const res = await fetch(`${BASE}/auth/signup`, {
    method: "POST",
    headers: J,
    body: JSON.stringify({ name: "WS Load", email, password: "loadtest123" }),
  });
  if (res.status !== 201) throw new Error(`signup ${res.status}`);
  return { email, token: (await res.json()).data.accessToken };
}

async function createDelivery(token) {
  const res = await fetch(`${BASE}/deliveries`, {
    method: "POST",
    headers: { ...J, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fromAddress: "Jl. Asia Afrika, Bandung",
      toAddress: "Jl. Braga, Bandung",
      receiver: "Recipient",
      packages: "1 box",
      packageSize: "Small",
      packageWeight: 1.5,
      packageTypes: ["document"],
      pickupDate: new Date().toISOString().slice(0, 10),
      pickupTime: "10:00 AM",
      fromLat: FROM.lat,
      fromLng: FROM.lng,
      toLat: TO.lat,
      toLng: TO.lng,
    }),
  });
  if (res.status !== 201) throw new Error(`create ${res.status}`);
  return (await res.json()).data.id;
}

async function scrapeDropped() {
  try {
    const text = await (await fetch(WORKER_METRICS)).text();
    return text
      .split("\n")
      .filter((l) => l.startsWith("drovery_ws_dropped_frames_total"))
      .reduce((s, l) => s + Number(l.trim().split(/\s+/).pop() || 0), 0);
  } catch {
    return 0;
  }
}

function openClient(token, deliveryId, stats) {
  return new Promise((resolve) => {
    let settled = false;
    const ws = new WebSocket(`${WS_BASE}/?token=${token}`);
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    ws.addEventListener("open", () => {
      stats.opened++;
      ws.send(JSON.stringify({ event: "subscribe", data: { deliveryId } }));
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.event === "subscribed") {
        stats.subscribed++;
        done(true);
      } else if (msg.event === "tracking:update") {
        stats.frames++;
        if (msg.data && msg.data.status !== undefined) stats.statusFrames++;
        else stats.posFrames++;
      } else if (msg.event === "error") {
        stats.subErrors++;
        done(false);
      }
    });
    ws.addEventListener("close", (ev) => {
      if (ev.code === 1008) stats.authClosed++;
      done(false);
    });
    ws.addEventListener("error", () => {
      stats.connErrors++;
      done(false);
    });
    stats.sockets.push(ws);
    // Don't block setup forever if a subscribe ack is slow.
    setTimeout(() => done(false), 8000);
  });
}

async function main() {
  console.log("# Drovery docker-free WS-tracking load run");
  console.log(
    `BASE=${BASE} WS=${WS_BASE} POOL=${POOL} FANOUT=${FANOUT} (=${POOL * FANOUT} sockets) HOLD=${HOLD_MS / 1000}s`,
  );

  // 1. SETUP — a user + a sim delivery each.
  process.stdout.write(`setup: ${POOL} users + sim deliveries ... `);
  const deliveries = [];
  for (let i = 0; i < POOL; i++) {
    try {
      const u = await signup(i);
      const id = await createDelivery(u.token);
      deliveries.push({ token: u.token, id });
    } catch {
      /* tolerate a few */
    }
  }
  if (!deliveries.length) throw new Error("no deliveries created — is the api up?");
  console.log(`${deliveries.length} deliveries.`);

  const stats = {
    opened: 0,
    subscribed: 0,
    subErrors: 0,
    authClosed: 0,
    connErrors: 0,
    frames: 0,
    posFrames: 0,
    statusFrames: 0,
    sockets: [],
  };

  // 2. CONNECT — FANOUT clients per delivery (all owned by that delivery's user).
  process.stdout.write(`connecting ${deliveries.length * FANOUT} WS clients ... `);
  await Promise.all(
    deliveries.flatMap((d) =>
      Array.from({ length: FANOUT }, () => openClient(d.token, d.id, stats)),
    ),
  );
  console.log(`opened=${stats.opened} subscribed=${stats.subscribed}`);

  // 3. HOLD — the worker drives each sim (status @10/25/45/70s, positions every 5s in transit);
  //    every published frame fans out to that delivery's FANOUT local sockets.
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, HOLD_MS));
  const elapsed = (Date.now() - t0) / 1000;
  const dropped = await scrapeDropped();

  // 4. REPORT.
  console.log(`\n## Results (${elapsed.toFixed(0)}s hold)`);
  console.log(`  WS sockets opened:        ${stats.opened} / ${deliveries.length * FANOUT}`);
  console.log(`  subscribe acks:           ${stats.subscribed}`);
  console.log(`  subscribe errors:         ${stats.subErrors}`);
  console.log(`  auth closes (1008):       ${stats.authClosed}`);
  console.log(`  connection errors:        ${stats.connErrors}`);
  console.log(`  frames fanned out:        ${stats.frames}  (${(stats.frames / elapsed).toFixed(1)}/s)`);
  console.log(`    position frames:        ${stats.posFrames}`);
  console.log(`    status frames:          ${stats.statusFrames}  (never dropped — §4 invariant)`);
  console.log(`  position frames dropped:  ${dropped}  (backpressure watermark; slow clients)`);

  // 5. TEARDOWN.
  for (const ws of stats.sockets) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const ids = await db.query(`SELECT id FROM "users" WHERE email LIKE $1`, [
    `${EMAIL_PREFIX}%`,
  ]);
  const userIds = ids.rows.map((r) => r.id);
  if (userIds.length) {
    await db.query(`DELETE FROM "deliveries" WHERE "userId" = ANY($1)`, [userIds]);
    await db.query(`DELETE FROM "wallet_transactions" WHERE "userId" = ANY($1)`, [userIds]);
    await db.query(`DELETE FROM "users" WHERE id = ANY($1)`, [userIds]);
  }
  await db.end();
  console.log(`\ncleaned up ${userIds.length} pool users + their data.`);

  const clean =
    stats.subscribed >= deliveries.length * FANOUT * 0.98 &&
    stats.frames > 0 &&
    stats.connErrors === 0;
  console.log(
    clean
      ? "\nWS LOAD RUN: CLEAN (≥98% subscribed, frames fanned out, 0 conn errors)"
      : "\nWS LOAD RUN: CHECK (see counts above)",
  );
  process.exit(clean ? 0 : 1);
}

main().catch((e) => {
  console.error("WS DRIVER ERROR:", e?.stack ?? e);
  process.exit(2);
});
