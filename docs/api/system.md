# System

## GET /api

API status check.

**Response:**

```json
{
  "success": true,
  "data": { "name": "bkd-api", "status": "ok", "routes": ["GET /api", "GET /api/health", "GET /api/runtime"] }
}
```

## GET /api/health

Health check with database status.

**Response:**

```json
{
  "success": true,
  "data": { "status": "ok", "version": "0.0.6", "commit": "abc1234", "db": "ok", "timestamp": "..." }
}
```

## GET /api/status

Detailed status with memory metrics.

**Response:**

```json
{
  "success": true,
  "data": {
    "uptime": 12345,
    "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0 },
    "db": { "ok": true }
  }
}
```

## GET /api/runtime

Runtime information including Bun/Node versions, process details, and platform info. Requires `ENABLE_RUNTIME_ENDPOINT=true` environment variable; returns `404` otherwise.

Sensitive fields (e.g. `execPath`) are stripped from the response.
