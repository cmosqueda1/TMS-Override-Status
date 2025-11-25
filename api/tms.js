// api/tms.js
// Pure TMS-only status lookup (Login → Search → Return PRO, Status, Order_ID)

const TMS_LOGIN_URL = "https://tms.freightapp.com/write/check_login.php";
const TMS_STATUS_URL = "https://tms.freightapp.com/write_new/search_order_basic_v6.php";

/**
 * Normalize PRO
 */
function cleanPro(v) {
  return String(v ?? "").trim();
}

/**
 * Map TMS status/stage codes to readable text
 */
function mapTMSStatus(code) {
  const map = {
    "P": "Picked Up",
    "O": "Out For Delivery",
    "D": "Delivered",
    "C": "Closed",
    "X": "Cancelled"
  };
  return map[code] || "Unknown";
}

/**
 * Login to TMS → return cookie, UserID, UserToken
 */
async function loginTMS(username, password) {
  const payload = new URLSearchParams({
    username,
    password,
    UserID: "null",
    UserToken: "null",
    pageName: "/index.html"
  });

  const resp = await fetch(TMS_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: payload
  });

  const cookie = resp.headers.get("set-cookie");
  const data = await resp.json();

  return {
    userId: data.UserID || "",
    userToken: data.UserToken || "",
    cookie
  };
}

/**
 * Get TMS status by PRO
 */
async function getTMSStatus(pro, cookie) {
  const payload = new URLSearchParams({
    input_filter_pro: pro
  });

  const resp = await fetch(TMS_STATUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Cookie: cookie,
      Origin: "https://tms.freightapp.com",
      Referer: "https://tms.freightapp.com",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: payload
  });

  return resp.json();
}

/**
 * Vercel Handler — receives { pros:[], username, password }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { pros, username, password } = req.body || {};

  if (!Array.isArray(pros) || pros.length === 0) {
    res.status(400).json({ error: "pros must be a non-empty array" });
    return;
  }

  if (!username || !password) {
    res.status(400).json({ error: "Missing TMS login credentials" });
    return;
  }

  // login
  let login;
  try {
    login = await loginTMS(username, password);
  } catch (e) {
    res.status(500).json({ error: "TMS login failed", details: e.message });
    return;
  }

  const results = [];

  for (const raw of pros) {
    const pro = cleanPro(raw);

    try {
      const tmsResp = await getTMSStatus(pro, login.cookie);

      // If no results returned
      if (!tmsResp?.data || tmsResp.data.length === 0) {
        results.push({
          pro,
          status: "Not Found",
          order_id: ""
        });
        continue;
      }

      // TMS returns an array; take first record
      const record = tmsResp.data[0];

      results.push({
        pro,
        status: mapTMSStatus(record.StatusCode),
        order_id: record.OrderID || ""
      });

    } catch (err) {
      results.push({
        pro,
        status: "Error",
        order_id: "",
        error: err.message
      });
    }
  }

  res.status(200).json({ results });
}
