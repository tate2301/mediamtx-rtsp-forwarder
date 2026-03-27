/**
 * Huchu CCTV Gateway - Windows Signaling + Playback Server
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const DigestFetchModule = require("digest-fetch");
const { XMLParser } = require("fast-xml-parser");

const DigestFetch = DigestFetchModule.default || DigestFetchModule;

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: "application/sdp" }));
app.use(cors());

// --- CONFIGURATION ---
const ERP_URL = process.env.ERP_URL || "http://localhost:3000";
const MTX_API_URL = process.env.MTX_API_URL || "http://localhost:9997";
const MTX_WEBRTC_PORT = process.env.MTX_WEBRTC_PORT || "8889";
const MTX_HLS_PORT = process.env.MTX_HLS_PORT || "8887";
const PORT = process.env.PORT || 8888;
const GATEWAY_KEY = process.env.GATEWAY_KEY || "your-secret-key";
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: true,
});

function requireGatewayKey(req, res) {
  const gatewayKey = req.get("x-gateway-key");
  if (gatewayKey !== GATEWAY_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function getPublicBaseUrl(req) {
  const forwardedProto = req.get("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.get("host");
  return `${protocol}://${host}`;
}

function sanitizePathSegment(value, fallback = "session") {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || fallback;
}

function buildPlaybackStreamPath({
  playbackRecordId,
  playbackSessionId,
  seekAt,
  startTime,
  endTime,
}) {
  const recordPart = sanitizePathSegment(playbackRecordId, "record");
  const sessionPart = sanitizePathSegment(
    playbackSessionId || seekAt || startTime || endTime,
    "origin",
  );
  return `playback-${recordPart}-${sessionPart}`;
}

function encodeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatHikvisionTime(isoValue) {
  return new Date(isoValue).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function buildPlaybackSearchXml({
  channelNumber,
  startTime,
  endTime,
  recordType = "all",
  searchPosition = 0,
  maxResults = 40,
}) {
  const trackId = `${channelNumber}01`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
  <searchID>SEARCH-${Date.now()}</searchID>
  <trackIDList>
    <trackID>${trackId}</trackID>
  </trackIDList>
  <timeSpanList>
    <timeSpan>
      <startTime>${encodeXml(formatHikvisionTime(startTime))}</startTime>
      <endTime>${encodeXml(formatHikvisionTime(endTime))}</endTime>
    </timeSpan>
  </timeSpanList>
  <maxResults>${maxResults}</maxResults>
  <searchResultPostion>${searchPosition}</searchResultPostion>
  <metadataList>
    <metadataDescriptor>${encodeXml(recordType)}</metadataDescriptor>
  </metadataList>
</CMSearchDescription>`;
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function parsePlaybackSize(playbackUri) {
  try {
    const parsedUrl = new URL(playbackUri);
    const rawSize = parsedUrl.searchParams.get("size");
    return rawSize ? Number(rawSize) : 0;
  } catch {
    return 0;
  }
}

function toPlaybackClips(searchResult) {
  const items = normalizeArray(searchResult?.CMSearchResult?.matchList?.searchMatchItem);
  return items
    .map((item) => {
      const startTime = item.startTime;
      const endTime = item.endTime;
      const playbackUri = item.playbackURI;
      if (!startTime || !endTime || !playbackUri) {
        return null;
      }

      const start = new Date(startTime);
      const end = new Date(endTime);
      const duration = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));

      return {
        startTime,
        endTime,
        duration,
        fileSize: parsePlaybackSize(playbackUri),
        playbackUri,
        recordingType: item.metadataDescriptor || "CONTINUOUS",
      };
    })
    .filter(Boolean);
}

async function searchPlaybackClips({
  nvr,
  channelNumber,
  startTime,
  endTime,
  recordType,
}) {
  const client = new DigestFetch(nvr.username, nvr.password);
  const url = `http://${nvr.ipAddress}:${nvr.httpPort}/ISAPI/ContentMgmt/search`;
  const clips = [];
  let searchPosition = 0;
  let hasMore = true;
  let firstSearchXml = null;

  while (hasMore) {
    const searchXml = buildPlaybackSearchXml({
      channelNumber,
      startTime,
      endTime,
      recordType,
      searchPosition,
      maxResults: 40,
    });

    if (!firstSearchXml) {
      firstSearchXml = searchXml;
    }

    const response = await client.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
      },
      body: searchXml,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Playback search failed (${response.status}): ${details}`);
    }

    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);
    const searchResult = parsed?.CMSearchResult;
    const batchClips = toPlaybackClips(parsed);
    clips.push(...batchClips);

    const responseStatus = String(searchResult?.responseStatusStrg || "OK").toUpperCase();
    const numOfMatches = Number(searchResult?.numOfMatches || batchClips.length || 0);

    hasMore = responseStatus === "MORE" && numOfMatches > 0;
    searchPosition += numOfMatches;
  }

  return {
    clips,
    searchXml: firstSearchXml,
  };
}

/**
 * Sync Path with MediaMTX
 */
async function syncMtxPath(streamPath, rtspUrl) {
  try {
    console.log(`[CCTV Gateway] Syncing MediaMTX path: ${streamPath}`);

    try {
      await axios.delete(`${MTX_API_URL}/v3/config/paths/delete/${streamPath}`);
    } catch {}

    await axios.post(`${MTX_API_URL}/v3/config/paths/add/${streamPath}`, {
      source: rtspUrl,
      sourceOnDemand: true,
      rtspTransport: "tcp",
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

async function fetchLiveRtspUrl(cameraId, token) {
  const response = await axios.post(
    `${ERP_URL}/api/cctv/streams/config`,
    { cameraId, token },
    {
      headers: {
        "x-gateway-key": GATEWAY_KEY,
      },
    },
  );

  return response.data.rtspUrl;
}

async function fetchPlaybackRtspUrl(playbackRecordId, token) {
  const response = await axios.post(
    `${ERP_URL}/api/cctv/playback/config`,
    { playbackRecordId, token },
    {
      headers: {
        "x-gateway-key": GATEWAY_KEY,
      },
    },
  );

  return response.data.rtspUrl;
}

async function fetchPlaybackRtspUrlForSession(payload) {
  const response = await axios.post(`${ERP_URL}/api/cctv/playback/config`, payload, {
    headers: {
      "x-gateway-key": GATEWAY_KEY,
    },
  });

  return response.data.rtspUrl;
}

async function primePlaybackSession({ req, token, playbackRecordId, playbackSessionId, seekAt }) {
  const streamPath = buildPlaybackStreamPath({
    playbackRecordId,
    playbackSessionId,
    seekAt,
  });
  const rtspUrl = await fetchPlaybackRtspUrlForSession({
    playbackRecordId,
    playbackSessionId,
    seekAt,
    streamPath,
    token,
  });

  await syncMtxPath(streamPath, rtspUrl);

  const publicBaseUrl = getPublicBaseUrl(req);
  const params = new URLSearchParams({
    token: String(token),
  });
  if (playbackSessionId) {
    params.set("playbackSessionId", String(playbackSessionId));
  }
  if (seekAt) {
    params.set("seekAt", String(seekAt));
  }

  return {
    streamPath,
    rtspUrl,
    whepUrl: `${publicBaseUrl}/whep/${streamPath}?${params.toString()}`,
    hlsUrl: `${publicBaseUrl}/${streamPath}/index.m3u8?${params.toString()}`,
  };
}

async function proxyWhepOffer(streamPath, offerSdp) {
  const response = await axios.post(
    `http://localhost:${MTX_WEBRTC_PORT}/${streamPath}/whep`,
    offerSdp,
    {
      headers: { "Content-Type": "application/sdp" },
      responseType: "text",
      validateStatus: () => true,
    },
  );

  return response;
}

async function resolveStreamPathRtspUrl(streamPath, query) {
  if (streamPath.startsWith("playback-")) {
    return fetchPlaybackRtspUrlForSession({
      streamPath,
      token: query.token,
      playbackSessionId: query.playbackSessionId,
      seekAt: query.seekAt,
    });
  }

  const match = streamPath.match(/^camera-(.+)-(main|sub|third)$/);
  if (!match) {
    throw new Error("Invalid path");
  }

  const [, cameraId] = match;
  return fetchLiveRtspUrl(cameraId, query.token);
}

async function proxyHlsAsset(req, res, assetPath) {
  const upstreamUrl = `http://127.0.0.1:${MTX_HLS_PORT}${assetPath}`;
  const upstreamResponse = await axios.get(upstreamUrl, {
    responseType: "stream",
    validateStatus: () => true,
    headers: {
      ...(req.headers.range ? { range: req.headers.range } : {}),
    },
  });

  res.status(upstreamResponse.status);
  Object.entries(upstreamResponse.headers).forEach(([header, value]) => {
    if (value === undefined) return;
    if (header.toLowerCase() === "transfer-encoding") return;
    res.setHeader(header, value);
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  upstreamResponse.data.pipe(res);
}

/**
 * POST /api/stream/webrtc
 */
app.post("/api/stream/webrtc", async (req, res) => {
  try {
    const { cameraId, streamType, offer, token } = req.body;
    if (!cameraId || !offer || !token) {
      return res.status(400).json({ error: "Missing params" });
    }

    const streamPath = `camera-${cameraId}-${streamType}`;
    const rtspUrl = await fetchLiveRtspUrl(cameraId, token);
    await syncMtxPath(streamPath, rtspUrl);

    const mtxResponse = await proxyWhepOffer(streamPath, offer);
    res.status(mtxResponse.status).send(mtxResponse.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playback/search
 */
app.post("/api/playback/search", async (req, res) => {
  try {
    if (!requireGatewayKey(req, res)) return;

    const { nvr, channelNumber, startTime, endTime, recordType = "all" } = req.body;
    if (!nvr || !channelNumber || !startTime || !endTime) {
      return res.status(400).json({
        error: "nvr, channelNumber, startTime, and endTime are required",
      });
    }

    const payload = await searchPlaybackClips({
      nvr,
      channelNumber,
      startTime,
      endTime,
      recordType,
    });

    res.json(payload);
  } catch (error) {
    console.error("[CCTV Gateway] Playback search failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playback/session
 *
 * Server-to-server session creation for playback. The ERP can reopen playback
 * at a new timestamp by requesting a new playbackSessionId or seekAt value,
 * which yields a fresh playback-specific stream path for public WHEP/HLS.
 */
app.post("/api/playback/session", async (req, res) => {
  try {
    if (!requireGatewayKey(req, res)) return;

    const { playbackRecordId, playbackSessionId, seekAt, token } = req.body || {};
    if (!playbackRecordId || !token) {
      return res.status(400).json({
        error: "playbackRecordId and token are required",
      });
    }

    const payload = await primePlaybackSession({
      req,
      token,
      playbackRecordId,
      playbackSessionId,
      seekAt,
    });

    res.json(payload);
  } catch (error) {
    console.error("[CCTV Gateway] Playback session failed:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /health
 */
app.get("/health", (req, res) => res.json({ status: "ok" }));

/**
 * Proxy HLS playlists and media assets through the gateway so the public edge
 * only needs to reach the gateway port on the private box.
 */
app.head(/^\/([^/]+)\/(.+)$/, async (req, res, next) => {
  try {
    const [, streamPath, assetName] = req.path.match(/^\/([^/]+)\/(.+)$/) || [];
    if (!streamPath || !assetName) {
      return next();
    }
    if (["api", "whep", "playback", "health"].includes(streamPath)) {
      return next();
    }

    if (assetName === "index.m3u8" && req.query.token) {
      const rtspUrl = await resolveStreamPathRtspUrl(streamPath, req.query);
      await syncMtxPath(streamPath, rtspUrl);
    }

    await proxyHlsAsset(req, res, req.originalUrl);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get(/^\/([^/]+)\/(.+)$/, async (req, res, next) => {
  try {
    const [, streamPath, assetName] = req.path.match(/^\/([^/]+)\/(.+)$/) || [];
    if (!streamPath || !assetName) {
      return next();
    }
    if (["api", "whep", "playback", "health"].includes(streamPath)) {
      return next();
    }

    if (assetName === "index.m3u8" && req.query.token) {
      const rtspUrl = await resolveStreamPathRtspUrl(streamPath, req.query);
      await syncMtxPath(streamPath, rtspUrl);
    }

    await proxyHlsAsset(req, res, req.originalUrl);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

/**
 * GET /whep/:streamPath
 */
app.get("/whep/:streamPath", async (req, res) => {
  try {
    const { streamPath } = req.params;
    const token = req.query.token;
    if (!token) return res.status(401).send("Token Required");

    const rtspUrl = await resolveStreamPathRtspUrl(streamPath, req.query);
    await syncMtxPath(streamPath, rtspUrl);

    const publicBaseUrl = getPublicBaseUrl(req);
    res.redirect(`${publicBaseUrl}/${streamPath}/?token=${encodeURIComponent(token)}`);
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

    const rtspUrl = await resolveStreamPathRtspUrl(streamPath, req.query);
    await syncMtxPath(streamPath, rtspUrl);

    const mtxResponse = await proxyWhepOffer(streamPath, req.body);
    res.status(mtxResponse.status);
    if (mtxResponse.headers.location) {
      const publicBaseUrl = getPublicBaseUrl(req);
      const rewrittenLocation = String(mtxResponse.headers.location).replace(
        `http://localhost:${MTX_WEBRTC_PORT}`,
        publicBaseUrl,
      );
      res.setHeader("Location", rewrittenLocation);
    }
    res.send(mtxResponse.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /playback/hls/:playbackRecordId
 * Compatibility route that primes a playback path and redirects to the public
 * HLS URL. New callers should prefer POST /api/playback/session.
 */
app.get("/playback/hls/:playbackRecordId", async (req, res) => {
  try {
    const { playbackRecordId } = req.params;
    const token = req.query.token;
    if (!token) return res.status(401).send("Token Required");
    const playbackSessionId = req.query.playbackSessionId;
    const seekAt = req.query.seekAt;

    const session = await primePlaybackSession({
      req,
      token,
      playbackRecordId,
      playbackSessionId,
      seekAt,
    });

    res.redirect(session.hlsUrl);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

/**
 * POST /playback/whep/:playbackRecordId
 * Compatibility route that primes a playback path and proxies the SDP
 * exchange. New callers should prefer the tokenized /whep/<streamPath> URL
 * returned by POST /api/playback/session.
 */
app.post("/playback/whep/:playbackRecordId", async (req, res) => {
  try {
    const { playbackRecordId } = req.params;
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: "Token Required" });
    const playbackSessionId = req.query.playbackSessionId;
    const seekAt = req.query.seekAt;

    const session = await primePlaybackSession({
      req,
      token,
      playbackRecordId,
      playbackSessionId,
      seekAt,
    });

    const mtxResponse = await proxyWhepOffer(session.streamPath, req.body);
    res.status(mtxResponse.status);
    if (mtxResponse.headers.location) {
      const publicBaseUrl = getPublicBaseUrl(req);
      const rewrittenLocation = String(mtxResponse.headers.location).replace(
        `http://localhost:${MTX_WEBRTC_PORT}/${session.streamPath}`,
        `${publicBaseUrl}/whep/${session.streamPath}`,
      );
      res.setHeader("Location", rewrittenLocation);
    }
    res.send(mtxResponse.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`[CCTV Gateway] Running on port ${PORT}`));
