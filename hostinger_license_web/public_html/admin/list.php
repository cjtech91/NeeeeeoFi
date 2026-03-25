<?php
declare(strict_types=1);

require __DIR__ . '/../api/config.php';

$token = isset($_GET['token']) ? trim((string)$_GET['token']) : '';
if ($ADMIN_TOKEN !== '' && !hash_equals($ADMIN_TOKEN, $token)) {
    json_response(['ok' => false, 'error' => 'unauthorized'], 401);
}

$pdo = pdo_conn($DB_HOST, $DB_NAME, $DB_USER, $DB_PASS);
$rows = $pdo->query('SELECT license_key,status,owner,type,expires_at,bound_serial FROM licenses ORDER BY created_at DESC LIMIT 500')->fetchAll();
json_response(['ok' => true, 'rows' => $rows], 200);
