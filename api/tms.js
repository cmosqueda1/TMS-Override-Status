// api/tms.js
// TMS-only status lookup using original tmstrace logic (get_tms_trace.php)

const TMS_USER     = process.env.TMS_USER;
const TMS_PASS     = process.env.TMS_PASS;
const TMS_BASE     = process.env.TMS_BASE_URL || "https://tms.freightapp.com";
const TMS_GROUP_ID = process.env.TMS_GROUP_ID || "28";
const DEBUG        = process.env.DEBUG === "true";

const TMS_LOGIN_URL = `${TMS_BASE}/write/check_login.php`;
const TMS_GROUP_URL = `${TMS_BASE}/write_new/write_change_user_group.php`;
const TMS_TRACE_URL = `${TMS_BASE}/write_new/get_tms_trace.php`;

// Helpers
const cleanPro = (v) => String(v ?? "").trim();
const cleanPu  = (v) => String(v ?? "").trim();

const safeLog = (label, payload) => {
  if (!DEBUG) return;
  console.log(`\n=== ${label} ===\n`, payload);
};

/* ========================
   TMS HELPERS
======================== */

async function authTms() {
  if (!TMS_USER || !TMS_PASS) {
    throw new Error("Missing TMS_USER / TMS_PASS in environment");
  }

  const body = new URLSearchParams();
  body.set("username", TMS_USER);
  body.set("password", TMS_PASS);
  body.set("UserID", "null");
  body.set("UserToken", "null");
  body.set("pageName", "/index.html");

  safeLog("TMS LOGIN REQUEST", {
    url: TMS_LOGIN_URL,
    payload: Object.fromEntries(body),
  });

  const r = await fetch(TMS_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": "https://tms.freightapp.com/index.html",
      "User-Agent": "Mozilla/5.0",
    },
    body,
  });

  const cookie = r.headers.get("set-cookie") || "";
  safeLog("TMS LOGIN RESPONSE HEADERS", {
    status: r.status,
    ok: r.ok,
    cookiePreview: cookie.slice(0, 80),
  });

  if (!r.ok) throw new Error(`TMS auth HTTP ${r.status}`);
  const j = await r.json().catch(() => ({}));

  const uid   = j.UserID    ?? j.user_id   ?? null;
  const token = j.UserToken ?? j.userToken ?? null;

  if (!uid || !token) {
    throw new Error("TMS auth: missing UserID/UserToken");
  }

  // Change group every time for safety (same as original)
  await tmsChangeGroup(uid, token);

  return { userId: uid, token };
}

async function tmsChangeGroup(userId, userToken) {
  const body = new URLSearchParams();
  body.set("group_id", String(TMS_GROUP_ID));
  body.set("UserID", String(userId));
  body.set("UserToken", String(userToken));
  body.set("pageName", "dashboard");

  safeLog("TMS CHANGE GROUP REQUEST", {
    url: TMS_GROUP_URL,
    payload: Object.fromEntries(body),
  });

  const r = await fetch(TMS_GROUP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": "https://tms.freightapp.com/dev.html",
      "User-Agent": "Mozilla/5.0",
    },
    body,
  });

  safeLog("TMS CHANGE GROUP RESPONSE", {
    status: r.status,
    ok: r.ok,
  });

  if (!r.ok) {
    console.warn("TMS group change HTTP", r.status);
  }
}

/**
 * Single TMS trace call for ALL PROs at once,
 * using the real browser payload structure (get_tms_trace.php).
 */
async function tmsTraceForPros(auth, pros) {
  const { userId, token } = auth;
  const body = new URLSearchParams();

  // (Direct copy of original payload structure)
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

  safeLog("TMS TRACE REQUEST", {
    url: TMS_TRACE_URL,
    payload: Object.fromEntries(body),
  });

  const r = await fetch(TMS_TRACE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Origin": "https://tms.freightapp.com",
      "Referer": "https://tms.freightapp.com/dev.html",
      "User-Agent": "Mozilla/5.0",
    },
    body,
  });

  const rawText = await r.text();
  safeLog("TMS TRACE RAW RESPONSE", rawText);

  if (!r.ok) {
    throw new Error(`TMS trace HTTP ${r.status}`);
  }

  let j;
  try {
    j = JSON.parse(rawText);
  } catch (err) {
    return {
      error: "Invalid JSON from TMS trace",
      raw: rawText,
      jsonError: err.message,
    };
  }

  let rows = null;
  if (Array.isArray(j)) rows = j;
  else if (Array.isArray(j?.data)) rows = j.data;
  else if (Array.isArray(j?.rows)) rows = j.rows;
  else if (Array.isArray(j?.result)) rows = j.result;

  if (!rows || !rows.length) {
    return { rows: [], raw: rawText };
  }

  // Build a map from cleaned PRO -> row
  const map = new Map();
  for (const rw of rows) {
    const key = cleanPro(rw.tms_order_pro);
    if (key) {
      map.set(key, rw);
    }
  }

  return { map, raw: rawText };
}

/* ========================
   VERCEL HANDLER
======================== */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pros = [] } = req.body ?? {};

  if (!Array.isArray(pros) || pros.length === 0) {
    return res.status(400).json({ error: "pros must be a non-empty array" });
  }

  try {
    const auth = await authTms();

    const { map: tmsMap, raw, error, jsonError } =
      (await tmsTraceForPros(auth, pros)) ?? {};

    // If tmstrace could not parse JSON, surface breakdown
    if (error) {
      return res.status(500).json({
        error: "TMS trace failed",
        details: jsonError,
        raw_response: raw,
      });
    }

    const results = pros.map((rawPro) => {
      const pro = cleanPro(rawPro);
      const row = tmsMap?.get(pro);

      if (!row) {
        return {
          pro,
          status: "Not Found",
          substatus: "",
          order_id: "",
          loc: "",
          pu: "",
        };
      }

      return {
        pro,
        // These names mirror your original mapping in check-status-pro.js
        status: row.tms_order_stage ?? null,     // "Out-For-Delivery"
        substatus: row.tms_order_status ?? null, // "Processing"
        order_id: row.tms_order_id ?? null,      // "8134363"
        loc: row.wa2_code ?? null,               // "EWR"
        pu: cleanPu(row.fk_tms_order_group_id ?? null)
      };
    });

    const responsePayload = {
      results,
    };

    if (DEBUG) {
      responsePayload.debug = {
        raw_tms_response: raw,
      };
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    safeLog("TMS HANDLER ERROR", {
      message: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      error: "TMS handler failure",
      details: err?.message || String(err),
    });
  }
}
