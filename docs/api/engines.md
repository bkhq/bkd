# Engines

## GET /api/engines/available

List detected engines and their models. Uses 3-tier cache (memory -> DB -> live probe).

**Response:**

```json
{
  "success": true,
  "data": {
    "engines": [
      {
        "engineType": "claude-code",
        "installed": true,
        "executable": true,
        "version": "1.0.0",
        "binaryPath": "/usr/local/bin/claude",
        "authStatus": "authenticated"
      }
    ],
    "models": {
      "claude-code": [
        { "id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "isDefault": true },
        { "id": "claude-opus-5-5", "name": "Claude Opus 5.5" }
      ],
      "codex": [
        { "id": "gpt-5.6-sol", "name": "gpt-5.6-sol", "isDefault": true }
      ]
    }
  }
}
```

`engines` items follow `EngineAvailability` (`engineType`, `installed`, `executable`, `version`, `binaryPath`, `authStatus`, `error`). `models` is a per-engine map (`Record<string, EngineModel[]>`), not a flat array.

## GET /api/engines/profiles

List engine profiles.

**Response:** `EngineProfile[]`

## GET /api/engines/settings

Get all engine settings: default engine, per-engine default models, and hidden models.

**Response:**

```json
{
  "success": true,
  "data": {
    "defaultEngine": "claude-code",
    "engines": {
      "claude-code": { "defaultModel": "claude-sonnet-5-5", "hiddenModels": [] },
      "codex": { "defaultModel": "gpt-5.6-sol" }
    }
  }
}
```

## PATCH /api/engines/default-engine

Set the global default engine. Accepts a real engine type (`claude-code`, `codex`, `grok`, `cursor`) or a configured virtual engine id; anything else returns `400`.

**Request Body:** `{ defaultEngine: string }`

## GET /api/engines/:engineType/models

List models for a specific engine.

**Response:** `{ engineType, defaultModel, models }`

## PATCH /api/engines/:engineType/settings

Set an engine's default model.

**Request Body:** `{ defaultModel: string }`

## PATCH /api/engines/:engineType/hidden-models

Update hidden models for an engine type.

**Request Body:** `{ hiddenModels: string[] }` (max 500 items, each matching `/^[\w./:\-[\]]{1,160}$/`)

## POST /api/engines/probe

Force live re-probe of all engines. Bypasses cache.

**Response:** `{ engines, models }`

## GET /api/engines/virtual

List virtual engines. A virtual engine runs a base engine's executor with preset environment variables, for example a different API endpoint.

**Response:** `VirtualEngine[]`

`VirtualEngine`: `{ id, name, baseEngine: "claude-code" | "codex", baseUrl?, authToken?, model?, envVars }`

## PUT /api/engines/virtual

Replace the whole list.

**Request Body:** `{ engines: VirtualEngine[] }`

**Response:** `VirtualEngine[]`

## GET /api/engines/model-configs

Model configs of every real engine, keyed by engine type.

**Response:** `Record<engineType, ModelConfig[]>`

`ModelConfig`: `{ id, name?, baseModel?, envVars }`. Without `baseModel` the entry renames a detected model and adds
environment variables to its runs. With `baseModel` it is a custom model: its `id` must not be a detected model id,
and the CLI runs on `baseModel`. Custom models appear in `/api/engines/available` with `custom: true`. Environment
precedence at spawn: project < model < virtual engine.

## PUT /api/engines/:engineType/model-configs

Replace the model configs of one real engine.

**Request Body:** `{ configs: ModelConfig[] }`

**Response:** `ModelConfig[]`

## POST /api/engines/:engineType/update

Run the engine CLI's own updater (`<binary> update`). One update runs at a time and cannot be cancelled. Returns
`202` with the update; poll it for output.

**Response:** `{ id, engineType, status, output, error, fromVersion, toVersion, startedAt, finishedAt }`

## GET /api/engines/updates/:id

The update with its output lines so far.

## GET /api/engines/claude/usage

Claude subscription usage.

**Response:** `{ available, reason?, fiveHour?: { usedPercentage, resetsAt }, sevenDay?: { usedPercentage, resetsAt }, modelWindows?: [{ model, usedPercentage, resetsAt }] }`

When `available` is `false`, `reason` is one of `no_credentials`, `api_key_mode`, `token_expired`, `upstream_error`.

## GET /api/engines/codex/usage

Codex subscription usage.

**Response:** `{ available, reason?, primary?: { usedPercentage, windowMinutes, resetsAt }, secondary?, planType? }`

When `available` is `false`, `reason` is one of `not_installed`, `unauthenticated`, `unsupported`, `upstream_error`.
