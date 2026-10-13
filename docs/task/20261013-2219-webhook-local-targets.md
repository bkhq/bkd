# 20261013-2219-webhook-local-targets Allow webhooks to target local addresses

- **status**: completed
- **priority**: P2
- **owner**: main/decision-telegram-20261013
- **createdAt**: 2026-10-13 22:19

## Description

Webhook URLs on loopback and private networks are rejected by the SSRF check,
so BKD cannot notify a system running on the same host or LAN (a local bridge,
n8n, another service on the tailnet). Allow them, so a webhook can work
together with local systems.

Acceptance criteria:

- A webhook URL on `localhost`, loopback, RFC 1918, CGNAT (`100.64.0.0/10`) or
  IPv6 unique-local addresses can be saved and is delivered to.
- Link-local addresses (including the cloud metadata address
  `169.254.169.254`), multicast, unspecified and reserved ranges stay blocked,
  both as literals and when a hostname resolves to them.

## ActiveForm

Allowing webhooks to target local addresses

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Requested directly by the user; approval was given in the request.

- complete: URL policy tests, lint and typecheck pass.
