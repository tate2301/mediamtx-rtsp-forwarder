# CCTV Server

Windows CCTV gateway for Huchu ERP. It pulls RTSP streams from on-site cameras/NVRs, serves local WebRTC for browser viewing, forwards live streams to the public relay, and now supports server-driven playback discovery/session setup for public WHEP and HLS playback.

## What This Repo Contains

- `server.js`: Express gateway used by the ERP to configure MediaMTX paths, negotiate WebRTC, search NVR playback, and mint playback stream paths.
- `mediamtx.yml`: Local MediaMTX config for on-demand RTSP ingestion and local playback.
- `forward.bat`: FFmpeg relay publisher that forwards active local streams to `stream.pagka.dev`.
- `package.json`: Node runtime dependencies for the gateway.

## Current Architecture

1. ERP requests a camera stream from the Windows gateway.
2. `server.js` creates or refreshes a MediaMTX path that points at the camera RTSP URL.
3. Local users watch through MediaMTX WebRTC on port `8889`.
4. When the local path becomes ready, `forward.bat` starts FFmpeg and republishes the stream to the public relay at `stream.pagka.dev:8554`.
5. The relay exposes HLS at `https://stream.pagka.dev/<stream-path>/index.m3u8`.

## Playback Flow

1. ERP calls `POST /api/playback/search` on the local gateway with `x-gateway-key` so the gateway can query the on-site NVR directly.
2. ERP calls `POST /api/playback/session` with `x-gateway-key` plus the selected playback record and optional `playbackSessionId` or `seekAt`.
3. The gateway creates a playback-specific MediaMTX path such as `playback-<record>-<session-or-seek>`.
4. The browser uses only tokenized public URLs:
   - WHEP: `https://stream.pagka.dev/whep/<stream-path>?token=...`
   - HLS: `https://stream.pagka.dev/<stream-path>/index.m3u8?token=...`
5. Seeking should be represented as a new playback session or a reopened path at a new timestamp, which yields a fresh playback stream path.

## Local Ports

- `8888`: Node gateway
- `8889`: Local WebRTC playback
- `9997`: Local MediaMTX API
- `8554`: Local RTSP listener used by FFmpeg
- `8887`: Local HLS output from the Windows MediaMTX instance

## Public Relay

- RTSP publish: `rtsp://stream.pagka.dev:8554/<stream-path>`
- HLS playback: `https://stream.pagka.dev/<stream-path>/index.m3u8`
- Droplet path: `/opt/cctv-relay`
- Relay services: Docker MediaMTX behind Nginx with Let's Encrypt TLS

## Dedicated Machine Setup

Use this when moving the local box to a dedicated Windows machine.

1. Copy the whole folder to `C:\cctv-server`.
2. Install:
   - Node.js
   - `pnpm`
   - FFmpeg
   - Tailscale
3. Sign in to Tailscale on the new machine and confirm it can reach the tailnet.
4. Copy `.env.example` to `.env` and set at least:
```powershell
ERP_URL=https://acme.apps.pagka.dev
GATEWAY_KEY=your-shared-key
```
5. Run the bootstrap script from an elevated PowerShell window:
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\scripts\bootstrap.ps1
```

The bootstrap script will:
- run `pnpm install`
- validate FFmpeg
- install the gateway as a Windows service with `nssm.exe`
- install MediaMTX as a Windows service with `nssm.exe`
- start both services

## Quick Commands

Bootstrap or refresh services:
```powershell
.\scripts\bootstrap.ps1
```

Remove services:
```powershell
.\scripts\remove-services.ps1
```

Manual gateway run:
```powershell
.\run-gateway.cmd
```

Manual MediaMTX run:
```powershell
.\run-mediamtx.cmd
```

## Required Environment

- `ERP_URL`: ERP base URL, default `http://localhost:3000`
- `MTX_API_URL`: MediaMTX API base URL, default `http://localhost:9997`
- `MTX_WEBRTC_PORT`: Local MediaMTX WebRTC port, default `8889`
- `PORT`: Gateway port, default `8888`
- `GATEWAY_KEY`: Shared secret expected by the ERP backend
- `RELAY_HOST`: Public relay hostname, default `stream.pagka.dev`
- `RELAY_PORT`: Public RTSP relay port, default `8554`
- `FFMPEG_PATH`: Optional absolute path to `ffmpeg.exe` if it is not on `PATH`

## Gateway Playback APIs

- `POST /api/playback/search`
  - Requires `x-gateway-key`
  - Body: `nvr`, `channelNumber`, `startTime`, `endTime`, optional `recordType`
  - Returns clip candidates found on the NVR
- `POST /api/playback/session`
  - Requires `x-gateway-key`
  - Body: `playbackRecordId`, `token`, optional `playbackSessionId`, optional `seekAt`
  - Returns `streamPath`, `whepUrl`, and `hlsUrl`
- `GET /playback/hls/:playbackRecordId`
  - Compatibility helper that primes playback and redirects to the tokenized HLS URL
- `POST /playback/whep/:playbackRecordId`
  - Compatibility helper that primes playback and proxies the SDP exchange

## Stream Flow Check

If local playback works but the public stream does not:

1. Confirm local playback first:
```text
http://localhost:8889/<stream-path>/
```
2. Check the forwarder log:
```powershell
Get-Content C:\cctv-server\forward-to-relay.log -Tail 100
```
3. Check the local MediaMTX log:
```powershell
Get-Content C:\cctv-server\mediamtx.log -Tail 100
```
4. Test the public HLS URL:
```text
https://stream.pagka.dev/<stream-path>/index.m3u8
```

## Machine Move Checklist

When moving to a dedicated Windows box:

1. Install Tailscale and verify the machine is signed in.
2. Copy this repo to `C:\cctv-server`.
3. Make sure `ffmpeg.exe` is on `PATH` or set `FFMPEG_PATH` in `.env`.
4. Set `ERP_URL` and `GATEWAY_KEY` in `.env`.
5. Run [`bootstrap.ps1`](C:/cctv-server/scripts/bootstrap.ps1) as Administrator.
6. Confirm:
   - `http://127.0.0.1:8888/health`
   - `http://127.0.0.1:8889/`
   - public playback from the ERP

## Known Notes

- Local WebRTC can work even when public HLS is broken; the relay depends on `forward.bat`.
- `forward.bat` uses an absolute FFmpeg path so the Windows service account can find FFmpeg reliably.
- The current relay HLS output skips the G711 audio track, so public HLS is presently video-only.
