// api/tms.js
// TMS-only: trace → optional stage override → verification trace
// Uses same TMS login / group / trace logic as check-status-pro.js

// =======================
// Helpers & config
// =======================
const cleanPro = (v) => String(v ?? "").trim();
const cleanPu  = (v) => String(v ?? "").trim();
const DEBUG    = process.env.DEBUG === "true";

const safeLog = (label, payload) => {
  if (!DEBUG) return;
  console.log(`\n=== ${label} ===\n`, payload);
};

const TMS_BASE      = process.env.TMS_BASE_URL || "https://tms.freightapp.com";
const TMS_LOGIN_URL = `${TMS_BASE}/write/check_login.php`;
const TMS_GROUP_URL = `${TMS_BASE}/write_new/write_change_user_group.php`;
const TMS_TRACE_URL = `${TMS_BASE}/write_new/get_tms_trace.php`;
const TMS_OVERRIDE_URL = `${TMS_BASE}/write/write_update_tms_order_stage.php`;

// Defaults to your known credentials if env not set
const TMS_USER     = process.env.TMS_USER || "cmosqueda";
const TMS_PASS     = process.env.TMS_PASS || "UWF2NjUyODk="; // base64 as UI
const TMS_GROUP_ID = process.env.TMS_GROUP_ID || "28";

// =======================
// Stage mapping (code -> target status / description)
// =======================
// "action" is the human description; we derive the target status from it.
const STAGE_OVERRIDES = [
  { code: -4, action: "overide to Tendered" },
  { code: -3, action: "overide to Load Building" },
  { code: -2, action: "overide to Quote" },
  { code: -1, action: "overide to Cancelled" },
  { code:  0, action: "overide to Pickup" },
  { code:  1, action: "overide to Linehaul" },
  { code:  2, action: "overide to Pickup Complete" },
  { code:  3, action: "overide to Linehaul Complete" },
  { code:  4, action: "overide to Out-For-Delivery" }
];

function getStageInfo(code) {
  const num = Number(code);
  return STAGE_OVERRIDES.find((s) => Number(s.code) === num) || null;
}

/**
 * Given a stageInfo/action/label, derive the target status text:
 * "overide to Tendered"  -> "Tendered"
 * "overide to Out-For-Delivery" -> "Out-For-Delivery"
 */
function deriveTargetStatus(stageInfo, override) {
  // Prefer mapping
  if (stageInfo && stageInfo.action) {
    const m = stageInfo.action.match(/overide to\s+(.+)$/i);
    if (m) return m[1].trim();
  }

  // Fallback: override.stage_label if frontend sends it
  if (override && override.stage_label) {
    return String(override.stage_label).trim();
  }

  // Fallback: override.action (strip leading phrase if present)
  if (override && override.action) {
    const a = String(override.action);
    const m = a.match(/overide to\s+(.+)$/i);
    if (m) return m[1].trim();
    return a.trim();
  }

  // Last resort: use code-string
  if (override && override.stage_code != null) {
    return String(override.stage_code);
  }

  return null;
}

// =======================
// Vercel handler
// =======================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};
  const { pros, mode = "trace", override } = body;

  if (!Array.isArray(pros) || pros.length === 0) {
    res.status(400).json({ error: "pros must be a non-empty array" });
    return;
  }

  const trimmedPros = pros.map(cleanPro).filter(Boolean);

  try {
    const auth = await authTms();

    // 1) Initial trace
    const tmsMap1 = await tmsTraceForPros(auth, trimmedPros);

    // Build base results from first trace
    const results = trimmedPros.map((pro) => {
      const row = tmsMap1.get(pro);

      if (!row) {
        return {
          pro,
          status: "Not Found",
          substatus: "",
          order_id: "",
          loc: "",
          pu: "",
          override_ok: false,
          override_skipped: true,
          override_error: "No TMS row found",
          verified: false,
          verified_status: undefined,
          verified_substatus: undefined
        };
      }

      return {
        pro,
        status: row.tms_order_stage ?? null,
        substatus: row.tms_order_status ?? null,
        order_id: row.tms_order_id ?? null,
        loc: row.wa2_code ?? null,
        pu: cleanPu(row.fk_tms_order_group_id ?? null),
        override_ok: false,
        override_skipped: true,
        override_error: "",
        verified: false,
        verified_status: undefined,
        verified_substatus: undefined
      };
    });

    // If TRACE only or no override enabled – stop here
    if (mode === "trace" || !override || !override.enabled) {
      res.status(200).json({ results });
      return;
    }

    const globalStageInfo = getStageInfo(override.stage_code);

    // 2) Run overrides per found order
    for (const r of results) {
      if (!r.order_id || r.status === "Not Found") {
        r.override_skipped = true;
        if (!r.override_error) {
          r.override_error = "Missing order_id or status";
        }
        continue;
      }

      const row = tmsMap1.get(cleanPro(r.pro));
      if (!row) {
        r.override_skipped = true;
        r.override_error = "No TMS row for override";
        continue;
      }

      try {
        const out = await runTmsOverride(auth, row, override, globalStageInfo);
        r.override_ok = out.ok;
        r.override_skipped = !!out.skipped;
        if (!out.ok && !r.override_error) {
          r.override_error = out.error || out.reason || "Override failed";
        }
      } catch (err) {
        r.override_ok = false;
        r.override_skipped = false;
        r.override_error = err?.message || String(err);
      }
    }

    // 3) Verification trace
    const tmsMap2 = await tmsTraceForPros(auth, trimmedPros);

    for (const r of results) {
      const updated = tmsMap2.get(cleanPro(r.pro));
      if (!updated) continue;

      r.verified_status = updated.tms_order_stage ?? null;
      r.verified_substatus = updated.tms_order_status ?? null;

      const stageInfo = globalStageInfo || getStageInfo(override.stage_code);
      const expected = deriveTargetStatus(stageInfo, override);

      r.verified =
        !!override &&
        !!override.enabled &&
        !!expected &&
        updated.tms_order_stage === expected;
    }

    res.status(200).json({ results });
  } catch (err) {
    console.error("tms handler error:", err);
    res.status(500).json({
      error: "Internal error running TMS trace/override",
      details: err?.message || String(err)
    });
  }
}

// =======================
// TMS helpers (from original logic)
// =======================
async function authTms() {
  const body = new URLSearchParams();
  body.set("username", TMS_USER);
  body.set("password", TMS_PASS);
  body.set("UserID", "null");
  body.set("UserToken", "null");
  body.set("pageName", "/index.html");

  safeLog("TMS LOGIN REQUEST", { url: TMS_LOGIN_URL });

  const r = await fetch(TMS_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": "https://tms.freightapp.com/index.html",
      "User-Agent": "Mozilla/5.0"
    },
    body,
    redirect: "follow"
  });

  if (!r.ok) throw new Error(`TMS auth HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));

  const uid   = j.UserID    ?? j.user_id   ?? null;
  const token = j.UserToken ?? j.userToken ?? null;

  if (!uid || !token) {
    throw new Error("TMS auth: missing UserID/UserToken");
  }

  await tmsChangeGroup(uid, token);

  return { userId: uid, token };
}

async function tmsChangeGroup(userId, userToken) {
  const body = new URLSearchParams();
  body.set("group_id", String(TMS_GROUP_ID));
  body.set("UserID", String(userId));
  body.set("UserToken", String(userToken));
  body.set("pageName", "dashboard");

  safeLog("TMS CHANGE GROUP REQUEST", { url: TMS_GROUP_URL });

  const r = await fetch(TMS_GROUP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": "https://tms.freightapp.com/dev.html",
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  if (!r.ok) {
    console.warn("TMS group change HTTP", r.status);
  }
}

/**
 * Single TMS trace call for ALL PROs at once.
 * Returns Map<cleanPro, row>
 */
async function tmsTraceForPros(auth, pros) {
  const { userId, token } = auth;
  const body = new URLSearchParams();

  body.set("input_filter_tracking_num", "");
  body.set("input_billing_reference", "");
  body.set("input_filter_pro", pros.map(cleanPro).join("\n"));
  body.set("input_filter_trip", "");
  body.set("input_filter_order", "");
  body.set("input_filter_pu", "");
  body.set("input_filter_pickup_from", "");
  body.set("input_filter_pickup_to", "");
  body.set("input_filter_delivery_from", "");
  body.set("input_filter_delivery_to", "");
  body.set("input_filter_shipper", "");
  body.set("input_filter_shipper_code", "");
  body.set("input_filter_shipper_street", "");
  body.set("input_filter_shipper_city", "");
  body.set("input_filter_shipper_state", "0");
  body.set("input_filter_shipper_phone", "");
  body.set("input_filter_shipper_zip", "");
  body.set("input_filter_consignee", "");
  body.set("input_filter_consignee_code", "");
  body.set("input_filter_consignee_street", "");
  body.set("input_filter_consignee_city", "");
  body.set("input_filter_consignee_state", "0");
  body.set("input_filter_consignee_phone", "");
  body.set("input_filter_consignee_zip", "");
  body.set("input_filter_billto", "");
  body.set("input_filter_billto_code", "");
  body.set("input_filter_billto_street", "");
  body.set("input_filter_billto_city", "");
  body.set("input_filter_billto_state", "0");
  body.set("input_filter_billto_phone", "");
  body.set("input_filter_billto_zip", "");
  body.set("input_filter_manifest", "");
  body.set("input_filter_interline", "");
  body.set("input_filter_pieces", "");
  body.set("input_filter_trailer", "");
  body.set("input_filter_weight", "");
  body.set("input_filter_pallet", "");
  body.set("input_filter_ref", "");
  body.set("input_filter_load", "");
  body.set("input_filter_po", "");
  body.set("input_filter_pickup_apt", "");
  body.set("input_filter_pickup_actual_from", "");
  body.set("input_filter_pickup_actual_to", "");
  body.set("input_filter_delivery_apt", "");
  body.set("input_filter_delivery_actual_from", "");
  body.set("input_filter_delivery_actual_to", "");
  body.set("input_filter_cust_po", "");
  body.set("input_filter_cust_ref", "");
  body.set("input_filter_cust_pro", "");
  body.set("input_filter_cust_bol", "");
  body.set("input_filter_cust_dn", "");
  body.set("input_filter_cust_so", "");
  body.set("input_filter_tender_pro", "");
  body.set("input_carrier_name", "");
  body.set("input_carrier_pro", "");
  body.set("input_carrier_inv", "");
  body.set("input_hold", "0");
  body.set("input_filter_group", "0");
  body.set("input_wa1", "0");
  body.set("input_wa2", "0");
  body.set("input_has_pro", "0");
  body.set("input_filter_scac", "");
  body.set("input_exclude_delivered", "0");
  body.set("input_filter_created_by", "");
  body.set("input_include_cancel", "0");
  body.set("input_carrier_type", "1");
  body.set("input_approved", "-1");
  body.set("input_fk_revenue_id", "0");
  body.set("input_stage_id", "");
  body.set("input_status_id", "");
  body.set("input_filter_create_date_from", "");
  body.set("input_filter_create_date_to", "");
  body.set("input_filter_tracking_no", "");
  body.set("input_filter_contriner", "");
  body.set("input_filter_cust_rn", "");
  body.set("input_page_num", "1");
  body.set("input_page_size", "10000");
  body.set("input_total_rows", "0");
  body.set("UserID", String(userId));
  body.set("UserToken", String(token));
  body.set("pageName", "dashboardTmsTrace");

  safeLog("TMS TRACE REQUEST", { url: TMS_TRACE_URL });

  const r = await fetch(TMS_TRACE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": "https://tms.freightapp.com/dev.html",
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  if (!r.ok) {
    throw new Error(`TMS trace HTTP ${r.status}`);
  }

  const j = await r.json().catch(() => ({}));

  let rows = null;
  if (Array.isArray(j)) rows = j;
  else if (Array.isArray(j?.data)) rows = j.data;
  else if (Array.isArray(j?.rows)) rows = j.rows;
  else if (Array.isArray(j?.result)) rows = j.result;

  if (!rows || !rows.length) {
    return new Map();
  }

  const map = new Map();
  for (const rw of rows) {
    const key = cleanPro(rw.tms_order_pro);
    if (key) {
      map.set(key, rw);
    }
  }

  return map;
}

/**
 * Override stage for a single order using write_update_tms_order_stage.php
 */
async function runTmsOverride(auth, row, override, stageInfoFromCaller) {
  const { userId, token } = auth;
  const orderId = row.tms_order_id;

  if (!orderId) {
    return { ok: false, skipped: true, reason: "Missing order_id" };
  }

  const code = Number(override.stage_code);
  const stageInfo = stageInfoFromCaller || getStageInfo(code);
  const targetStatus = deriveTargetStatus(stageInfo, override);

  const body = new URLSearchParams();
  body.set("order_id", String(orderId));
  body.set("input_stage_overide", String(code));
  body.set(
    "input_action",
    `Stage overide from ${row.tms_order_stage || "Unknown"} to ${targetStatus || code}`
  );
  body.set("UserID", String(userId));
  body.set("UserToken", String(token));
  body.set("pageName", `/dashboard_tms_order.php?order_id=${orderId}`);

  safeLog("TMS OVERRIDE REQUEST", {
    url: TMS_OVERRIDE_URL,
    orderId,
    code,
    targetStatus
  });

  const r = await fetch(TMS_OVERRIDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": `https://tms.freightapp.com/dashboard_tms_order.php?order_id=${orderId}`,
      "User-Agent": "Mozilla/5.0"
    },
    body
  });

  const raw = await r.text();
  safeLog("TMS OVERRIDE RAW RESPONSE", { status: r.status, raw });

  if (!r.ok) {
    return {
      ok: false,
      skipped: false,
      error: `HTTP ${r.status}`,
      raw
    };
  }

  // Endpoint usually returns small JSON or plain "OK". Either is fine.
  return { ok: true, skipped: false, raw };
}
