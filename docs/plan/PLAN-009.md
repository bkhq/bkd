# PLAN-009 Allow unresolved webhook hostnames on save

- **status**: completed
- **createdAt**: 2026-05-11 00:00
- **approvedAt**: 2026-05-11 00:00
- **relatedTask**: ENG-006

## Context

Webhook create/update routes call the full SSRF validation helper. That helper
resolves DNS and rejects any resolution failure with `Failed to resolve
hostname`. Delivery already revalidates the URL with DNS before sending.

The storage-time validation is too strict because saving a webhook target does
not make a network request. The stronger DNS/private-IP check is still needed
at delivery time to prevent DNS rebinding and private-network delivery.

## Proposal

Add a separate storage-time validation helper that parses the URL, restricts
protocols to HTTP/HTTPS, and rejects obviously private hostnames or IP literals.
Use that helper in create/update routes. Keep `validateWebhookUrl` for
delivery-time DNS validation.

## Risks

- Users can save typoed hostnames. Delivery and test-send will still fail and
  record the delivery error.
- Hostnames that later resolve to private addresses will be saved, but delivery
  will continue to block them.

## Scope

- Runtime changes:
  - `apps/api/src/utils/url-safety.ts`
  - `apps/api/src/routes/settings/webhooks.ts`
- Tests:
  - `apps/api/test/url-safety.test.ts`
  - `apps/api/test/api-settings.test.ts`
- PMA tracking updates for `ENG-006` and `PLAN-009`

## Alternatives

- Allow DNS failure in the full validation helper. Rejected because delivery
  must keep strict DNS validation.
- Add a UI bypass flag. Rejected because this is backend validation policy, not
  a UI concern.

## Annotations

- 2026-05-11: User reported webhook setup fails with `Failed to resolve
  hostname`, preventing invalid or unresolved webhook URLs from being saved.
- 2026-05-11: Implemented by splitting storage-time validation from
  delivery-time DNS validation.
