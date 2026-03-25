<?php
declare(strict_types=1);

require __DIR__ . '/../api/config.php';

$token = isset($_GET['token']) ? trim((string)$_GET['token']) : '';
if ($ADMIN_TOKEN !== '' && !hash_equals($ADMIN_TOKEN, $token)) {
    json_response(['ok' => false, 'error' => 'unauthorized'], 401);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);

$b = read_json_body();
$licenseKey = normalize_str($b['license_key'] ?? '');
$owner = normalize_str($b['owner'] ?? '');
$type = strtoupper(normalize_str($b['type'] ?? 'PAID')) ?: 'PAID';
$status = strtolower(normalize_str($b['status'] ?? 'active')) ?: 'active';
$expiresAt = (int)($b['expires_at'] ?? 0);
$boundSerial = normalize_str($b['bound_serial'] ?? '');

if ($licenseKey === '') json_response(['ok' => false, 'error' => 'missing_key'], 400);
if (!in_array($status, ['active', 'revoked'], true)) json_response(['ok' => false, 'error' => 'bad_status'], 400);
if (!in_array($type, ['PAID', 'TRIAL'], true)) $type = 'PAID';

$pdo = pdo_conn($DB_HOST, $DB_NAME, $DB_USER, $DB_PASS);
$ts = now_ms();
$stmt = $pdo->prepare('INSERT INTO licenses (license_key,status,owner,type,expires_at,bound_serial,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status), owner=VALUES(owner), type=VALUES(type), expires_at=VALUES(expires_at), bound_serial=VALUES(bound_serial), updated_at=VALUES(updated_at)');
$stmt->execute([$licenseKey, $status, $owner !== '' ? $owner : null, $type, $expiresAt > 0 ? $expiresAt : 0, $boundSerial !== '' ? $boundSerial : null, $ts, $ts]);

json_response(['ok' => true], 200);

