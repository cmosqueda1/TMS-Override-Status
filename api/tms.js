// api/tms.js
// TMS-only status lookup using Vercel environment variables
// Matches the logic style of the original check-status-pro.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pros } = req.body ?? {};

  if (!Array.isArray(pros) || pros.length === 0) {
    return res.status(400).json({ error: "pros must be a non-empty array" });
  }

  const TMS_USER = process.env.TMS_USER;
  const TMS_PASS = process.env.TMS_PASS;
  const TMS_BASE_URL = process.env.TMS_BASE_URL;
  const TMS_GROUP_ID = process.env.TMS_GROUP_ID;

  if (!TMS_USER || !TMS_PASS || !TMS_BASE_URL) {
    return res.status(500).json({ error: "Missing TMS environment variables" });
  }

  // Normalize PROs
  const cleanPro = (v) => String(v ?? "").trim();

  // Map status codes to readable values
  const mapTMSStatus = (code) => {
    const map = {
      "P": "Picked Up",
      "O": "Out For Delivery",
      "D": "Delivered",
      "C": "Closed",
      "X": "Cancelled"
    };
    return map[code] || "Unknown";
  };

  /**
   * LOGIN TO TMS
   */
  async function loginTMS() {
    const loginURL = `${TMS_BASE_URL}/write/check_login.php`;

    const payload = new URLSearchParams({
      username: TMS_USER,
      password: TMS_PASS,
      UserID: "null",
      UserToken: "null",
      pageName: "/index.html"
    });

    const resp = await fetch(loginURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: payload
    });

    const cookie = resp.headers.get("set-cookie");
    const data = await resp.json();

    return {
      cookie,
      userId: data.UserID || "",
      userToken: data.UserToken || ""
    };
  }

  /**
   * CALL TMS STATUS API
   */
  async function getTMSStatus(pro, cookie) {
    const url = `${TMS_BASE_URL}/write_new/search_order_basic_v6.php`;

    const payload = new URLSearchParams({
      input_filter_pro: pro,
      group_id: TMS_GROUP_ID || ""
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Origin: TMS_BASE_URL,
        Referer: TMS_BASE_URL,
        "X-Requested-With": "XMLHttpRequest"
      },
      body: payload
    });

    return resp.json();
  }

  // LOGIN FIRST
  let login;
  try {
    login = await loginTMS();
  } catch (err) {
    return res.status(500).json({ error: "TMS login failed", details: err.message });
  }

  const results = [];

  for (const raw of pros) {
    const pro = cleanPro(raw);

    try {
      const tmsResp = await getTMSStatus(pro, login.cookie);

      if (!tmsResp?.data || tmsResp.data.length === 0) {
        results.push({
          pro,
          status: "Not Found",
          order_id: ""
        });
        continue;
      }

      const row = tmsResp.data[0];

      results.push({
        pro,
        status: mapTMSStatus(row.StatusCode),
        order_id: row.OrderID || ""
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

  return res.status(200).json({ results });
}
