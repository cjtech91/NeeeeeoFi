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
if ($licenseKey === '') json_response(['ok' => false, 'error' => 'missing_key'], 400);

$pdo = pdo_conn($DB_HOST, $DB_NAME, $DB_USER, $DB_PASS);
$stmt = $pdo->prepare("UPDATE licenses SET bound_serial = NULL, updated_at = ? WHERE license_key = ?");
$stmt->execute([now_ms(), $licenseKey]);
json_response(['ok' => true], 200);
