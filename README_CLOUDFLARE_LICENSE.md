# Cloudflare Licensing (Replacing Supabase)

This repo can run licensing without Supabase by using a Cloudflare Worker + D1 as the licensing API.

## Worker

Location: [cloudflare/license-worker](file:///c:/Users/CJTECH%20NADS/Documents/trae_projects/NeoFi_licensing_manager/NeoFi/cloudflare/license-worker)

### Deploy (Wrangler)

1) Create the D1 database (pick any name, must match `wrangler.toml`):

```bash
wrangler d1 create neofi_license
```

2) Copy the returned `database_id` into [wrangler.toml](file:///c:/Users/CJTECH%20NADS/Documents/trae_projects/NeoFi_licensing_manager/NeoFi/cloudflare/license-worker/wrangler.toml) (`database_id = "..."`).

### Endpoints (POST)

- `/activate`
- `/validate-license`
- `/heartbeat`
- `/subvendo/claim`

If `API_TOKEN` is set (recommended), send:

```
Authorization: Bearer <API_TOKEN>
```

### D1 Schema

Apply the schema:

```bash
wrangler d1 execute neofi_license --file=./schema.sql
```

### Signing Key

The Worker signs license tokens using RSA so the client can verify with `src/config/license_public.pem`.

Set the private key as a Worker secret:

```bash
wrangler secret put LICENSE_PRIVATE_KEY_PEM
```

### API Token (recommended)

If you want to protect the endpoints, set a token:

```bash
wrangler secret put API_TOKEN
```

Then NeoFi should send:

```
Authorization: Bearer <API_TOKEN>
```

## PisoWiFi Client (this repo)

Update these settings (Admin DB `settings` table) to use Cloudflare:

- `license_backend`: `cloudflare`
- `license_activation_url`: `https://<your-worker-domain>/activate` (required)
- `license_validate_url`: `https://<your-worker-domain>/validate-license` (optional, auto-derived if empty)
- `license_heartbeat_url`: `https://<your-worker-domain>/heartbeat` (optional)
- `license_api_token`: `<API_TOKEN>` (optional but recommended)

Restart the app after changing settings.

### Admin UI shortcut

You can configure these via the built-in admin panel:

- License page → Cloudflare Licensing → Save License Settings
