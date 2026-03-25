# Hostinger Licensing Server (PHP + MySQL)

This replaces the Cloudflare Worker approach. Upload this folder to Hostinger and point NeoFi to these endpoints:

- `https://<your-domain>/activate`
- `https://<your-domain>/validate-license`
- `https://<your-domain>/heartbeat` (optional)

## 1) Upload

Upload everything inside:

- [hostinger_license_web/public_html](file:///c:/Users/CJTECH%20NADS/Desktop/NeoFi/hostinger_license_web/public_html)

to your Hostinger `public_html/`.

## 2) Database

Create a MySQL database in Hostinger (hPanel), then run:

- [schema_mysql.sql](file:///c:/Users/CJTECH%20NADS/Desktop/NeoFi/hostinger_license_web/schema_mysql.sql)

## 3) Configure secrets (Environment Variables)

Set these environment variables in Hostinger (or hardcode them in `public_html/api/config.php` if your plan does not support env vars):

- `LICENSE_DB_HOST`
- `LICENSE_DB_NAME`
- `LICENSE_DB_USER`
- `LICENSE_DB_PASS`
- `LICENSE_API_TOKEN` (Bearer token required by the API; optional but recommended)
- `LICENSE_ADMIN_TOKEN` (token for admin page; optional)
- `LICENSE_PRIVATE_KEY_PEM` (RSA private key PEM, used to sign tokens)

## 4) Admin page

Open:

`https://<your-domain>/admin?token=<LICENSE_ADMIN_TOKEN>`

Use it to add/revoke/unbind license keys.

## 5) NeoFi settings

In NeoFi Admin → License:

- Activation URL: `https://<your-domain>/activate`
- Validate URL: `https://<your-domain>/validate-license`
- Heartbeat URL: `https://<your-domain>/heartbeat` (optional)
- API Token: your `LICENSE_API_TOKEN`

Restart NeoFi after saving settings.
