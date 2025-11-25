// api/tms.js
// TMS-only: trace → optional override → verification trace
// FULL SYSTEM UPDATE FOR MODE "trace" or "override"

const TMS_USER     = process.env.TMS_USER;
const TMS_PASS     = process.env.TMS_PASS;
const TMS_BASE     = process.env.TMS_BASE_URL || "https://tms.freightapp.com";
const TMS_GROUP_ID = process.env.TMS_GROUP_ID || "28";
const DEBUG        = process.env.DEBUG === "true";

const TMS_LOGIN_URL   = `${TMS_BASE}/write/check_login.php`;
const TMS_GROUP_URL   = `${TMS_BASE}/write_new/write_change_user_group.php`;
const TMS_TRACE_URL   = `${TMS_BASE}/write_new/get_tms_trace.php`;
const TMS_OVERRIDE_URL = `${TMS_BASE}/write/write_update_tms_order_stage.php`;

const cleanPro = (v) => String(v ?? "").trim();
const cleanPu  = (v) => String(v ?? "").trim();

const safeLog = (label, payload) => {
  if (!DEBUG) return;
  console.log(`\n=== ${label} ===\n`, payload);
};

/* =====================================
   AUTH + GROUP
===================================== */

async function authTms() {
  const body = new URLSearchParams();
  body.set("username", TMS_USER);
  body.set("password", TMS_PASS);
  body.set("UserID", "null");
  body.set("UserToken", "null");
  body.set("pageName", "/index.html");

  const r = await fetch(TMS_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": TMS_BASE,
      "Referer": `${TMS_BASE}/index.html`,
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  if (!r.ok) throw new Error(`TMS login HTTP ${r.status}`);

  const j = await r.json().catch(() => ({}));
  const userId = j.UserID ?? null;
  const token = j.UserToken ?? null;

  if (!userId || !token) throw new Error("Missing TMS UserID/UserToken");

  // Group change call
  const gBody = new URLSearchParams();
  gBody.set("group_id", String(TMS_GROUP_ID));
  gBody.set("UserID", String(userId));
  gBody.set("UserToken", String(token));
  gBody.set("pageName", "dashboard");

  await fetch(TMS_GROUP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": TMS_BASE,
      "Referer": `${TMS_BASE}/dev.html`,
      "User-Agent": "Mozilla/5.0"
    },
    body: gBody
  });

  return { userId, token };
}

/* =====================================
   TMS TRACE (get_tms_trace.php)
===================================== */

async function tmsTraceForPros(auth, pros) {
  const { userId, token } = auth;
  const body = new URLSearchParams();

  body.set("input_filter_pro", pros.map(cleanPro).join("\n"));
  body.set("input_page_num", "1");
  body.set("input_page_size", "10000");
  body.set("input_total_rows", "0");
  body.set("UserID", String(userId));
  body.set("UserToken", String(token));
  body.set("pageName", "dashboardTmsTrace");

  const r = await fetch(TMS_TRACE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": TMS_BASE,
      "Referer": `${TMS_BASE}/dev.html`,
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  const raw = await r.text();

  let j;
  try {
    j = JSON.parse(raw);
  } catch (err) {
    return {
      error: "Invalid JSON from TMS trace",
      raw_response: raw,
      jsonError: err.message
    };
  }

  let rows = null;
  if (Array.isArray(j)) rows = j;
  else if (Array.isArray(j?.data)) rows = j.data;
  else if (Array.isArray(j?.rows)) rows = j.rows;
  else if (Array.isArray(j?.result)) rows = j.result;

  if (!rows) rows = [];

  const map = new Map();
  for (const row of rows) {
    const k = cleanPro(row.tms_order_pro);
    if (k) map.set(k, row);
  }

  return { map, raw };
}

/* =====================================
   TMS STAGE OVERRIDE
===================================== */

async function runTmsOverride(auth, row, override) {
  const { userId, token } = auth;

  const body = new URLSearchParams();
  body.set("order_id", String(row.tms_order_id));
  body.set("input_stage_overide", String(override.stage_code));
  body.set(
    "input_action",
    `Stage overide from ${row.tms_order_stage || "Unknown"} to ${override.stage_label}`
  );
  body.set("UserID", String(userId));
  body.set("UserToken", String(token));
  body.set("pageName", `/dashboard_tms_order.php?order_id=${row.tms_order_id}`);

  const r = await fetch(TMS_OVERRIDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": TMS_BASE,
      "Referer": `${TMS_BASE}/dashboard_tms_order.php?order_id=${row.tms_order_id}`,
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  const raw = await r.text();
  return { ok: r.ok, raw };
}

/* =====================================
   MAIN HANDLER
===================================== */

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { pros = [], override, mode = "trace" } = req.body ?? {};
  if (!Array.isArray(pros) || pros.length === 0) {
    return res.status(400).json({ error: "pros must be a non-empty array" });
  }

  try {
    const auth = await authTms();

    /* ------------------------
       Step 1: Initial Trace
    -------------------------*/
    const trace1 = await tmsTraceForPros(auth, pros);

    if (trace1.error) {
      return res.status(500).json({
        error: "TMS trace failed",
        details: trace1.error,
        raw_response: trace1.raw_response
      });
    }

    const results = pros.map((p) => {
      const key = cleanPro(p);
      const row = trace1.map.get(key);

      if (!row) {
        return {
          pro: key,
          status: "Not Found",
          substatus: "",
          order_id: "",
          loc: "",
          pu: "",
          override_ok: false,
          verified: false
        };
      }

      return {
        pro: key,
        status: row.tms_order_stage,
        substatus: row.tms_order_status,
        order_id: row.tms_order_id,
        loc: row.wa2_code,
        pu: cleanPu(row.fk_tms_order_group_id),
        override_ok: false,
        verified: false
      };
    });

    /* ------------------------
       If mode = "trace", STOP HERE
    -------------------------*/
    if (mode === "trace") {
      return res.status(200).json({ results });
    }

    /* ------------------------
       Step 2: Overrides (per order)
    -------------------------*/
    if (override && override.enabled) {
      for (const r of results) {
        if (!r.order_id || r.status === "Not Found") continue;

        const row = trace1.map.get(cleanPro(r.pro));
        const out = await runTmsOverride(auth, row, override);
        r.override_ok = out.ok;
      }
    }

    /* ------------------------
       Step 3: Verification Trace
    -------------------------*/
    const trace2 = await tmsTraceForPros(auth, pros);

    for (const r of results) {
      const updated = trace2.map.get(cleanPro(r.pro));
      if (!updated) continue;

      r.verified_status = updated.tms_order_stage;
      r.verified_substatus = updated.tms_order_status;
      r.verified = override
        ? updated.tms_order_stage === override.stage_label
        : false;
    }

    return res.status(200).json({ results });

  } catch (err) {
    return res.status(500).json({
      error: "TMS handler failure",
      details: err?.message
    });
  }
}
