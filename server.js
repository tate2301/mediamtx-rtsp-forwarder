/**
 * Huchu CCTV Gateway - Windows Signaling Server
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(express.text({ type: "application/sdp" }));
app.use(cors());

// --- CONFIGURATION ---
const ERP_URL = process.env.ERP_URL || "http://localhost:3000";
const MTX_API_URL = process.env.MTX_API_URL || "http://localhost:9997";
const MTX_WEBRTC_PORT = process.env.MTX_WEBRTC_PORT || "8889";
const PORT = process.env.PORT || 8888;

/**
 * Sync Path with MediaMTX
 */
async function syncMtxPath(streamPath, rtspUrl) {
  try {
    console.log(`[CCTV Gateway] Syncing MediaMTX path: ${streamPath}`);

    try {
      await axios.delete(`${MTX_API_URL}/v3/config/paths/delete/${streamPath}`);
    } catch (e) {}

    // High-compatibility Hikvision settings
    await axios.post(`${MTX_API_URL}/v3/config/paths/add/${streamPath}`, {
      source: rtspUrl,
      sourceOnDemand: true,
      rtspTransport: "tcp", // Hikvision prefers TCP Interleaved
      rtspAnyPort: true,
      sourceOnDemandStartTimeout: "30s",
      sourceOnDemandCloseAfter: "10s",
    });

    console.log(`[CCTV Gateway] Path successfully configured.`);
    return true;
  } catch (error) {
    console.error(`[CCTV Gateway] MediaMTX Config Error: ${error.message}`);
    return false;
  }
}

/**
 * POST /api/stream/webrtc
 */
app.post("/api/stream/webrtc", async (req, res) => {
  try {
    const { cameraId, streamType, offer, token } = req.body;
    if (!cameraId || !offer || !token)
      return res.status(400).json({ error: "Missing params" });

    const streamPath = `camera-${cameraId}-${streamType}`;

    let rtspUrl;
    try {
      const resp = await axios.post(
        `${ERP_URL}/api/cctv/streams/config`,
        { cameraId, token },
        {
          headers: {
            "x-gateway-key": process.env.GATEWAY_KEY || "your-secret-key",
          },
        },
      );
      rtspUrl = resp.data.rtspUrl;
    } catch (e) {
      return res.status(403).json({ error: "ERP Auth failed" });
    }

    await syncMtxPath(streamPath, rtspUrl);

    const mtxResponse = await axios.post(
      `http://localhost:${MTX_WEBRTC_PORT}/${streamPath}/whep`,
      offer,
      {
        headers: { "Content-Type": "application/sdp" },
        responseType: "text",
      },
    );

    res.json({ answer: mtxResponse.data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /health
 */
app.get("/health", (req, res) => res.json({ status: "ok" }));

/**
 * GET /whep/:streamPath
 */
app.get("/whep/:streamPath", async (req, res) => {
  try {
    const { streamPath } = req.params;
    const token = req.query.token;
    if (!token) return res.status(401).send("Token Required");

    const match = streamPath.match(/^camera-(.+)-(main|sub|third)$/);
    if (!match) return res.status(400).send("Invalid path");
    const [, cameraId, streamType] = match;

    const resp = await axios.post(
      `${ERP_URL}/api/cctv/streams/config`,
      { cameraId, token },
      {
        headers: {
          "x-gateway-key": process.env.GATEWAY_KEY || "your-secret-key",
        },
      },
    );

    await syncMtxPath(streamPath, resp.data.rtspUrl);

    console.log(
      `[CCTV Gateway] Redirecting to MediaMTX for ${resp.data.rtspUrl}`,
    );

    const host = req.get("host").split(":")[0];
    res.redirect(`http://${host}:8889/${streamPath}/?token=${token}`);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

/**
 * POST /whep/:streamPath
 */
app.post("/whep/:streamPath", async (req, res) => {
  try {
    const { streamPath } = req.params;
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: "Token Required" });

    const match = streamPath.match(/^camera-(.+)-(main|sub|third)$/);
    if (!match) return res.status(400).json({ error: "Invalid path" });
    const [, cameraId, streamType] = match;

    const resp = await axios.post(
      `${ERP_URL}/api/cctv/streams/config`,
      { cameraId, token },
      {
        headers: {
          "x-gateway-key": process.env.GATEWAY_KEY || "your-secret-key",
        },
      },
    );

    await syncMtxPath(streamPath, resp.data.rtspUrl);

    const mtxResponse = await axios.post(
      `http://localhost:${MTX_WEBRTC_PORT}/${streamPath}/whep`,
      req.body,
      {
        headers: { "Content-Type": "application/sdp" },
        responseType: "text",
      },
    );

    res.send(mtxResponse.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`[CCTV Gateway] Running on port ${PORT}`));
