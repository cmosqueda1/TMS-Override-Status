export default async function handler(req, res) {
  const DEBUG = process.env.DEBUG === "true";

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pros = [] } = req.body ?? {};
  if (!Array.isArray(pros) || pros.length === 0) {
    return res.status(400).json({ error: "PRO list empty" });
  }

  const TMS_USER = process.env.TMS_USER;
  const TMS_PASS = process.env.TMS_PASS;
  const TMS_BASE_URL = process.env.TMS_BASE_URL;
  const TMS_GROUP_ID = process.env.TMS_GROUP_ID;

  const safeLog = (label, obj) => {
    if (DEBUG) console.log(`\n=== ${label} ===\n`, obj);
  };

  const cleanPro = (v) => String(v ?? "").trim();

  const mapTMSStatus = (code) => {
    const map = {
      P: "Picked Up",
      O: "Out For Delivery",
      D: "Delivered",
      C: "Closed",
      X: "Cancelled",
    };
    return map[code] || "Unknown";
  };

  // ----------------------------
  // LOGIN — same as original
  // ----------------------------
  async function loginTMS() {
    const url = `${TMS_BASE_URL}/write/check_login.php`;

    const payload = new URLSearchParams({
      username: TMS_USER,
      password: TMS_PASS,
      UserID: "null",
      UserToken: "null",
      pageName: "/index.html",
    });

    safeLog("LOGIN REQUEST", {
      url,
      payload: Object.fromEntries(payload),
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Origin: TMS_BASE_URL,
        Referer: `${TMS_BASE_URL}/index.html`,
        "User-Agent": "Mozilla/5.0",
      },
      body: payload,
    });

    const cookie = resp.headers.get("set-cookie");

    safeLog("LOGIN RESPONSE HEADERS", {
      status: resp.status,
      ok: resp.ok,
      cookie,
    });

    return { cookie };
  }

  // ----------------------------
  // TMS STATUS — full breakdown
  // ----------------------------
  async function fetchTmsStatusList(proList, cookie) {
    const url = `${TMS_BASE_URL}/write_new/search_tms_order_pro_status_v2.php`;

    const payload = new URLSearchParams({
      group_id: TMS_GROUP_ID,
      pro_list: JSON.stringify(proList),
    });

    safeLog("TMS STATUS REQUEST", {
      url,
      payload: Object.fromEntries(payload),
      cookiePreview: cookie?.substring(0, 50),
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Origin: TMS_BASE_URL,
        Referer: `${TMS_BASE_URL}/tms-platform-order/order`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body: payload,
    });

    const rawText = await resp.text();

    safeLog("TMS RAW RESPONSE BODY", rawText);

    // Check for "File not found."
    if (rawText.startsWith("File not found")) {
      return { rows: [], raw: rawText };
    }

    try {
      const parsed = JSON.parse(rawText);

      safeLog("TMS PARSED JSON", parsed);

      return { rows: parsed, raw: rawText };
    } catch (err) {
      // Return complete debug information to caller
      return {
        error: "Invalid JSON from TMS",
        raw: rawText,
        jsonError: err.message,
      };
    }
  }

  // LOGIN
  const login = await loginTMS();

  // CLEAN LIST
  const cleanList = pros.map(cleanPro);

  // FETCH RAW TMS DATA
  const tmsResponse = await fetchTmsStatusList(cleanList, login.cookie);

  // ERROR: invalid JSON / redirect / HTML
  if (tmsResponse.error) {
    return res.status(500).json({
      error: "TMS returned invalid JSON",
      details: tmsResponse.jsonError,
      raw_response: tmsResponse.raw,
    });
  }

  // NORMAL FLOW
  const tmsRows = tmsResponse.rows || [];

  const rowMap = new Map();
  for (const row of tmsRows) {
    rowMap.set(cleanPro(row.tms_order_pro), row);
  }

  const results = cleanList.map((pro) => {
    const row = rowMap.get(pro);
    if (!row) {
      return {
        pro,
        status: "Not Found",
        order_id: "",
      };
    }

    return {
      pro,
      status: mapTMSStatus(row.StatusCode),
      order_id: row.OrderID || "",
    };
  });

  return res.status(200).json({
    results,
    debug: DEBUG ? { raw_tms: tmsResponse.raw } : undefined,
  });
}
