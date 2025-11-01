import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Airtable config
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = "Conversations";
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// ✅ Handle incoming SMS from TextGrid
app.post("/incoming", async (req, res) => {
  try {
    const { From, To, Body } = req.body;

    if (!From || !To || !Body) {
      return res.status(400).json({ error: "Missing From, To, or Body" });
    }

    console.log("📩 Incoming SMS:", { From, To, Body });

    // Format timestamp for Airtable
    const receivedTime = new Date().toISOString();

    // Create record in Airtable
    await axios.post(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(
        AIRTABLE_TABLE
      )}`,
      {
        fields: {
          "Direction": "Inbound",
          "Received Time": receivedTime,
          "Seller Phone Number": From,
          "TextGrid Phone Number": To,
          "Message": Body,
          "Processed Time": receivedTime,
          "Delivery Status": "Received",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Logged to Airtable!");
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Error saving to Airtable:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => res.send("✅ SMS Proxy running"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));