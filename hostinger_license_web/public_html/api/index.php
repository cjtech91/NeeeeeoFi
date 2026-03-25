<?php
declare(strict_types=1);

require __DIR__ . '/config.php';

require_api_auth($LICENSE_API_TOKEN);

$endpoint = isset($_GET['endpoint']) ? (string)$_GET['endpoint'] : '';
$endpoint = trim($endpoint);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['ok' => false, 'error' => 'method_not_allowed'], 405);
}

$pdo = pdo_conn($DB_HOST, $DB_NAME, $DB_USER, $DB_PASS);
$body = read_json_body();

$key = normalize_str($body['key'] ?? ($body['license_key'] ?? ''));
$systemSerial = normalize_str($body['system_serial'] ?? ($body['System_Serial'] ?? ($body['hwid'] ?? ($body['serial'] ?? ''))));
$deviceModel = normalize_str($body['device_model'] ?? '');

if ($endpoint === 'activate') {
    if ($key === '' || $systemSerial === '') json_response(['allowed' => false, 'status' => 'bad_request'], 400);

    $stmt = $pdo->prepare('SELECT license_key,status,owner,type,expires_at,bound_serial FROM licenses WHERE license_key = ? LIMIT 1');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if (!$row) json_response(['allowed' => false, 'status' => 'not_found'], 200);

    $status = strtolower((string)($row['status'] ?? ''));
    if ($status !== 'active') json_response(['allowed' => false, 'status' => 'revoked'], 200);

    $expiresAt = (int)($row['expires_at'] ?? 0);
    if ($expiresAt > 0 && $expiresAt < now_ms()) json_response(['allowed' => false, 'status' => 'expired'], 200);

    $bound = normalize_str($row['bound_serial'] ?? '');
    if ($bound !== '' && $bound !== $systemSerial) {
        json_response(['allowed' => false, 'status' => 'bind_failed', 'message' => 'Key is bound to another device'], 200);
    }

    if ($bound === '') {
        $u = $pdo->prepare("UPDATE licenses SET bound_serial = ?, updated_at = ? WHERE license_key = ? AND (bound_serial IS NULL OR bound_serial = '')");
        $u->execute([$systemSerial, now_ms(), $key]);
    }

    $token = [
        'type' => normalize_str($row['type'] ?? 'PAID') ?: 'PAID',
        'owner' => normalize_str($row['owner'] ?? 'Customer') ?: 'Customer',
        'expires' => $expiresAt > 0 ? gmdate('c', (int)floor($expiresAt / 1000)) : 'Never',
        'system_serial' => $systemSerial,
        'System_Serial' => $systemSerial,
        'device_model' => $deviceModel !== '' ? $deviceModel : null
    ];
    $signature = sign_token($token, $PRIVATE_KEY_PEM);
    json_response(['allowed' => true, 'token' => $token, 'signature' => $signature], 200);
}

if ($endpoint === 'validate-license') {
    if ($key === '' || $systemSerial === '') json_response(['allowed' => false, 'status' => 'bad_request'], 400);

    $stmt = $pdo->prepare('SELECT license_key,status,owner,type,expires_at,bound_serial FROM licenses WHERE license_key = ? LIMIT 1');
    $stmt->execute([$key]);
    $row = $stmt->fetch();
    if (!$row) json_response(['allowed' => false, 'status' => 'not_found'], 200);

    $status = strtolower((string)($row['status'] ?? ''));
    if ($status !== 'active') json_response(['allowed' => false, 'status' => 'revoked'], 200);

    $expiresAt = (int)($row['expires_at'] ?? 0);
    if ($expiresAt > 0 && $expiresAt < now_ms()) json_response(['allowed' => false, 'status' => 'expired'], 200);

    $bound = normalize_str($row['bound_serial'] ?? '');
    if ($bound !== '' && $bound !== $systemSerial) {
        json_response(['allowed' => false, 'status' => 'serial_mismatch', 'message' => 'Device mismatch'], 200);
    }

    $token = [
        'type' => normalize_str($row['type'] ?? 'PAID') ?: 'PAID',
        'owner' => normalize_str($row['owner'] ?? 'Customer') ?: 'Customer',
        'expires' => $expiresAt > 0 ? gmdate('c', (int)floor($expiresAt / 1000)) : 'Never',
        'system_serial' => $systemSerial,
        'System_Serial' => $systemSerial,
        'device_model' => $deviceModel !== '' ? $deviceModel : null
    ];
    $signature = sign_token($token, $PRIVATE_KEY_PEM);
    json_response(['allowed' => true, 'status' => 'ok', 'token' => $token, 'signature' => $signature], 200);
}

if ($endpoint === 'heartbeat') {
    $serial = normalize_str($body['system_serial'] ?? ($body['System_Serial'] ?? ''));
    if ($serial === '') json_response(['ok' => false, 'error' => 'bad_request'], 400);

    $meta = $body['metadata'] ?? null;
    $metaJson = $meta === null ? null : json_encode($meta, JSON_UNESCAPED_SLASHES);
    if ($metaJson === false) $metaJson = null;

    $stmt = $pdo->prepare('INSERT INTO machines (system_serial, device_model, last_seen_at, metadata_json) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE device_model=VALUES(device_model), last_seen_at=VALUES(last_seen_at), metadata_json=VALUES(metadata_json)');
    $stmt->execute([$serial, $deviceModel !== '' ? $deviceModel : null, now_ms(), $metaJson]);
    json_response(['ok' => true], 200);
}

json_response(['ok' => false, 'error' => 'not_found'], 404);
