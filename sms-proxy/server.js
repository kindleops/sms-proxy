import express from "express";
import cors from "cors";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());

// SMS relay endpoint
app.post("/sms-proxy", async (req, res) => {
  const { to, from, body } = req.body;
  if (!to || !from || !body) return res.status(400).json({ error: "Missing to/from/body" });

  try {
    const ACCOUNT_SID = process.env.ACCOUNT_SID;
    const AUTH_TOKEN = process.env.AUTH_TOKEN;

    const url = `https://api.textgrid.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;

    const data = new URLSearchParams({
      From: `+${from.replace(/\D/g, "")}`,
      To: `+${to.replace(/\D/g, "")}`,
      Body: body,
    });

    const response = await axios.post(url, data, {
      auth: { username: ACCOUNT_SID, password: AUTH_TOKEN },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    console.log("✅ Sent:", to, body);
    res.json({ ok: true, data: response.data });
  } catch (err) {
    console.error("❌ Send error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("✅ SMS Proxy running"));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server active on port ${PORT}`));