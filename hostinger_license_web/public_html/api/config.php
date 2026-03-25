<?php
declare(strict_types=1);

$LICENSE_API_TOKEN = getenv('LICENSE_API_TOKEN') ?: '';
$DB_HOST = getenv('LICENSE_DB_HOST') ?: 'localhost';
$DB_NAME = getenv('LICENSE_DB_NAME') ?: '';
$DB_USER = getenv('LICENSE_DB_USER') ?: '';
$DB_PASS = getenv('LICENSE_DB_PASS') ?: '';
$PRIVATE_KEY_PEM = getenv('LICENSE_PRIVATE_KEY_PEM') ?: '';

$ADMIN_TOKEN = getenv('LICENSE_ADMIN_TOKEN') ?: '';

function json_response(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: *');
    echo json_encode($data);
    exit;
}

function get_bearer_token(): string {
    $h = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) $h = (string)$_SERVER['HTTP_AUTHORIZATION'];
    else if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $h = (string)$_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    $h = trim($h);
    if ($h === '') return '';
    if (stripos($h, 'bearer ') === 0) return trim(substr($h, 7));
    return '';
}

function require_api_auth(string $expected): void {
    $expected = trim($expected);
    if ($expected === '') return;
    $token = get_bearer_token();
    if ($token === '' || !hash_equals($expected, $token)) {
        json_response(['ok' => false, 'error' => 'unauthorized'], 401);
    }
}

function pdo_conn(string $host, string $db, string $user, string $pass): PDO {
    if ($db === '' || $user === '') {
        json_response(['ok' => false, 'error' => 'server_misconfigured'], 500);
    }
    $dsn = "mysql:host={$host};dbname={$db};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    return $pdo;
}

function now_ms(): int {
    return (int) floor(microtime(true) * 1000);
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function pem_private_key_resource(string $pem) {
    $pem = trim($pem);
    if ($pem === '') return null;
    $key = openssl_pkey_get_private($pem);
    return $key ?: null;
}

function sign_token(array $token, string $privatePem): string {
    $key = pem_private_key_resource($privatePem);
    if (!$key) {
        json_response(['ok' => false, 'error' => 'missing_private_key'], 500);
    }
    $data = json_encode($token, JSON_UNESCAPED_SLASHES);
    if ($data === false) json_response(['ok' => false, 'error' => 'sign_failed'], 500);
    $sig = '';
    $ok = openssl_sign($data, $sig, $key, OPENSSL_ALGO_SHA256);
    if (!$ok) json_response(['ok' => false, 'error' => 'sign_failed'], 500);
    return base64_encode($sig);
}

function normalize_str($v): string {
    return trim((string)($v ?? ''));
}
