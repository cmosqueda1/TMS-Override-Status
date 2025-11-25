// api/tms.js
// Correct TMS-only lookup using original working logic

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
  // LOGIN
  // ----------------------------
  async function loginTMS() {
    const loginURL = `${TMS_BASE_URL}/write/check_login.php`;

    const resp = await fetch(loginURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: new URLSearchParams({
        username: TMS_USER,
        password: TMS_PASS,
        UserID: "null",
        UserToken: "null",
        pageName: "/index.html"
      })
    });

    const cookie = resp.headers.get("set-cookie");
    return { cookie };
  }

  // ----------------------------
  // FETCH TMS RESULTS (REAL ENDPOINT)
  // ----------------------------
  async function fetchTmsStatusList(proList, cookie) {
    const url = `${TMS_BASE_URL}/write_new/search_tms_order_pro_status_v2.php`;

    const payload = new URLSearchParams({
      group_id: TMS_GROUP_ID,
      pro_list: JSON.stringify(proList)
    });

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: cookie,
        Origin: TMS_BASE_URL,
        Referer: `${TMS_BASE_URL}/tms-platform-order/order`,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: payload
    });

    const text = await resp.text();

    return JSON.parse(text);
  }

  // LOGIN
  const login = await loginTMS();

  // CLEAN PRO LIST
  const cleanList = pros.map(cleanPro);

  // FETCH TMS DATA ONCE (correct behavior)
  const tmsRows = await fetchTmsStatusList(cleanList, login.cookie);

  // MAP BY PRO
  const map = new Map();
  for (const row of tmsRows || []) {
    map.set(cleanPro(row.tms_order_pro), row);
  }

  const results = cleanList.map((pro) => {
    const row = map.get(pro);
    if (!row) {
      return {
        pro,
        status: "Not Found",
        order_id: ""
      };
    }

    return {
      pro,
      status: mapTMSStatus(row.StatusCode),
      order_id: row.OrderID || ""
    };
  });

  res.status(200).json({ results });
}
