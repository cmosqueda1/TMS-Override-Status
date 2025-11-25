// api/tms.js
// TMS-only status lookup using Vercel environment variables
// Fully restored to the EXACT logic TMS expects

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pros } = req.body ?? {};
  if (!Array.isArray(pros) || pros.length === 0) {
    return res.status(400).json({ error: "PRO list empty" });
  }

  const TMS_USER = process.env.TMS_USER;
  const TMS_PASS = process.env.TMS_PASS;
  const TMS_BASE_URL = process.env.TMS_BASE_URL;
  const TMS_GROUP_ID = process.env.TMS_GROUP_ID;

  const cleanPro = (v) => String(v ?? "").trim();

  function mapTMSStatus(code) {
    const map = {
      P: "Picked Up",
      O: "Out For Delivery",
      D: "Delivered",
      C: "Closed",
      X: "Cancelled"
    };
    return map[code] || "Unknown";
  }

  // ----------------------------
  // LOGIN TO TMS
  // ----------------------------
  async function loginTMS() {
    const loginURL = `${TMS_BASE_URL}/write/check_login.php`;

    const loginPayload = new URLSearchParams({
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
      body: loginPayload
    });

    const cookie = resp.headers.get("set-cookie");
    return { cookie };
  }

  // ----------------------------
  // REQUEST ORDER STATUS
  // ----------------------------
  async function getTMSStatus(pro, cookie) {
    const url = `${TMS_BASE_URL}/write_new/search_order_basic_v6.php`;

    // FULL REQUIRED PAYLOAD (from working script)
    const payload = new URLSearchParams({
      input_filter_pro: pro,
      group_id: TMS_GROUP_ID,
      customer_id: "1",
      company_id: "1",
      row_limit: "500",
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Origin: TMS_BASE_URL,
        Referer: `${TMS_BASE_URL}/tms-platform-order/order`,  // REQUIRED
        "X-Requested-With": "XMLHttpRequest"
      },
      body: payload
    });

    const text = await resp.text();

    // If TMS returns "File not found." → return null
    if (text.startsWith("File not found")) {
      return null;
    }

    return JSON.parse(text);
  }

  // LOGIN
  let login = await loginTMS();
  const results = [];

  for (const raw of pros) {
    const pro = cleanPro(raw);

    try {
      const data = await getTMSStatus(pro, login.cookie);

      if (!data || !data.data || data.data.length === 0) {
        results.push({
          pro,
          status: "Not Found",
          order_id: ""
        });
        continue;
      }

      const row = data.data[0];

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

  res.status(200).json({ results });
}
