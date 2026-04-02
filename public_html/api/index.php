<?php
// CORS (supports same-origin + optional www/non-www usage with credentials)
$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
$allowedOrigins = [
    'https://neofisystem.com',
    'https://www.neofisystem.com',
    'http://neofisystem.com',
    'http://www.neofisystem.com'
];
if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header("Access-Control-Allow-Origin: {$origin}");
    header("Access-Control-Allow-Credentials: true");
} else {
    header("Access-Control-Allow-Origin: *");
}
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Content-Type: application/json");

$secureCookie = (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') || (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string)$_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'secure' => $secureCookie,
    'httponly' => true,
    'samesite' => 'Lax'
]);
session_start();

// Define database file
$dbFile = 'db.json';
$subVendoDbFile = 'subvendo_db.json';
$usersFile = 'users.json';
$transferLogFile = 'transfer_log.json';
$subVendoCmdFile = 'subvendo_cmd.json';
$downloadsDbFile = 'downloads_db.json';
$downloadsUploadsFile = 'downloads_uploads.json';

// Initialize DB if not exists
if (!file_exists($dbFile)) {
    file_put_contents($dbFile, json_encode([]));
}
if (!file_exists($subVendoDbFile)) {
    file_put_contents($subVendoDbFile, json_encode([]));
}
if (!file_exists($transferLogFile)) {
    file_put_contents($transferLogFile, json_encode([]));
}
if (!file_exists($subVendoCmdFile)) {
    file_put_contents($subVendoCmdFile, json_encode([]));
}
if (!file_exists($downloadsDbFile)) {
    file_put_contents($downloadsDbFile, json_encode([]));
}
if (!file_exists($downloadsUploadsFile)) {
    file_put_contents($downloadsUploadsFile, json_encode([]));
}
if (!file_exists($usersFile)) {
    $defaultAdminEmail = (string)(getenv('NEOFI_DEFAULT_ADMIN_EMAIL') ?: 'smileradiosantafe@gmail.com');
    $defaultAdminPassword = (string)(getenv('NEOFI_DEFAULT_ADMIN_PASSWORD') ?: 'Hope@7777');
    $defaultAdminName = (string)(getenv('NEOFI_DEFAULT_ADMIN_NAME') ?: 'Admin User');
    $defaultAdmin = [[
        'id' => uniqid(),
        'name' => $defaultAdminName,
        'email' => $defaultAdminEmail,
        'password' => $defaultAdminPassword,
        'role' => 'admin',
        'createdAt' => date('c'),
        'email_verified_at' => date('c')
    ]];
    file_put_contents($usersFile, json_encode($defaultAdmin, JSON_PRETTY_PRINT));
}

// Helper to get input data
$contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
if (strpos($contentType, 'application/json') !== false) {
    $rawInput = file_get_contents('php://input');
    $data = json_decode($rawInput ?: 'null', true);
    if (!is_array($data)) $data = [];
} else {
    $data = is_array($_POST) ? $_POST : [];
}

function normalize_str($v) {
    return trim((string)($v ?? ''));
}

function json_response($data, $status = 200) {
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode($data);
    exit;
}

function loadSubVendoCmds() {
    global $subVendoCmdFile;
    $raw = @file_get_contents($subVendoCmdFile);
    $arr = json_decode($raw ?: '[]', true);
    return is_array($arr) ? $arr : [];
}

function saveSubVendoCmds($items) {
    global $subVendoCmdFile;
    file_put_contents($subVendoCmdFile, json_encode(array_values($items), JSON_PRETTY_PRINT));
}

function loadDownloadsDB() {
    global $downloadsDbFile;
    $raw = @file_get_contents($downloadsDbFile);
    $arr = json_decode($raw ?: '[]', true);
    return is_array($arr) ? $arr : [];
}

function saveDownloadsDB($items) {
    global $downloadsDbFile;
    file_put_contents($downloadsDbFile, json_encode(array_values($items), JSON_PRETTY_PRINT));
}

function loadDownloadsUploads() {
    global $downloadsUploadsFile;
    $raw = @file_get_contents($downloadsUploadsFile);
    $arr = json_decode($raw ?: '[]', true);
    return is_array($arr) ? $arr : [];
}

function saveDownloadsUploads($items) {
    global $downloadsUploadsFile;
    file_put_contents($downloadsUploadsFile, json_encode(array_values($items), JSON_PRETTY_PRINT));
}

function ini_bytes($v) {
    $s = trim((string)$v);
    if ($s === '') return 0;
    if (is_numeric($s)) return (int)$s;
    $unit = strtolower(substr($s, -1));
    $num = (float)substr($s, 0, -1);
    if ($unit === 'g') return (int)($num * 1024 * 1024 * 1024);
    if ($unit === 'm') return (int)($num * 1024 * 1024);
    if ($unit === 'k') return (int)($num * 1024);
    return 0;
}

function bearer_token() {
    $h = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) $h = (string)$_SERVER['HTTP_AUTHORIZATION'];
    else if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $h = (string)$_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    $h = trim($h);
    if ($h === '') return '';
    if (stripos($h, 'bearer ') === 0) return trim(substr($h, 7));
    return '';
}

function require_api_auth() {
    $expected = trim((string)(getenv('LICENSE_API_TOKEN') ?: ''));
    if ($expected === '') return;
    $token = bearer_token();
    if ($token === '' || !hash_equals($expected, $token)) {
        json_response(['ok' => false, 'error' => 'unauthorized'], 401);
    }
}

function session_user() {
    if (!isset($_SESSION['user']) || !is_array($_SESSION['user'])) return null;
    return $_SESSION['user'];
}

function require_session_user() {
    $u = session_user();
    if (!$u) json_response(['success' => false, 'message' => 'Unauthorized'], 401);
    return $u;
}

function require_admin_session() {
    $u = require_session_user();
    if (($u['role'] ?? '') !== 'admin') json_response(['success' => false, 'message' => 'Forbidden'], 403);
    return $u;
}

function load_private_key_pem() {
    $pem = (string)(getenv('LICENSE_PRIVATE_KEY_PEM') ?: '');
    $pem = trim($pem);
    if ($pem !== '') return $pem;
    
    // Check .b64 file first (it seems to contain the raw PEM)
    $b64Path = __DIR__ . '/private.pem.b64';
    if (file_exists($b64Path)) {
        $content = file_get_contents($b64Path);
        if ($content !== false) {
            $decoded = base64_decode(trim($content), true);
            if ($decoded !== false && strpos($decoded, 'BEGIN PRIVATE KEY') !== false) {
                return $decoded;
            }
            // If it's not actually base64 encoded but contains PEM text
            if (strpos($content, 'BEGIN PRIVATE KEY') !== false) {
                return $content;
            }
        }
    }

    $paths = [
        __DIR__ . '/private.pem',
        __DIR__ . '/private.key',
        __DIR__ . '/private.pem.example',
        __DIR__ . '/keys/private.pem',
        __DIR__ . '/keys/private.key'
    ];
    foreach ($paths as $path) {
        if (!file_exists($path)) continue;
        $c = file_get_contents($path);
        if ($c !== false) {
            $t = trim($c);
            if ($t !== '') return $t;
        }
    }
    return '';
}

function normalize_pem($pem) {
    $pem = str_replace("\r", "", (string)$pem);
    if (strlen($pem) >= 3 && substr($pem, 0, 3) === "\xEF\xBB\xBF") {
        $pem = substr($pem, 3);
    }
    $pem = trim($pem);
    $isPkcs8 = (strpos($pem, 'BEGIN PRIVATE KEY') !== false);
    $isPkcs1 = (strpos($pem, 'BEGIN RSA PRIVATE KEY') !== false);
    if (!$isPkcs8 && !$isPkcs1) return $pem;
    if ($isPkcs8) {
        $head = '-----BEGIN PRIVATE KEY-----';
        $foot = '-----END PRIVATE KEY-----';
    } else {
        $head = '-----BEGIN RSA PRIVATE KEY-----';
        $foot = '-----END RSA PRIVATE KEY-----';
    }
    $start = strpos($pem, $head);
    $end = strpos($pem, $foot);
    if ($start === false || $end === false) return $pem;
    $start += strlen($head);
    $body = substr($pem, $start, $end - $start);
    $body = preg_replace('/[^A-Za-z0-9+\/=]/', '', (string)$body);
    $body = rtrim(chunk_split($body, 64, "\n"));
    return $head . "\n" . $body . "\n" . $foot . "\n";
}

function sign_token($token) {
    $pem = load_private_key_pem();
    if ($pem === '') json_response(['ok' => false, 'error' => 'missing_private_key'], 500);
    $pemNorm = normalize_pem($pem);
    $key = @openssl_pkey_get_private($pemNorm);
    if (!$key) {
        $errs = [];
        while ($e = openssl_error_string()) $errs[] = $e;
        json_response(['ok' => false, 'error' => 'invalid_private_key', 'details' => $errs], 500);
    }
    
    // Stable JSON encoding for signing
    // We use JSON_UNESCAPED_SLASHES and JSON_UNESCAPED_UNICODE to match common Node.js defaults
    $payload = json_encode($token, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($payload === false) json_response(['ok' => false, 'error' => 'sign_failed'], 500);
    
    $sig = '';
    $ok = @openssl_sign($payload, $sig, $key, OPENSSL_ALGO_SHA256);
    if (!$ok) json_response(['ok' => false, 'error' => 'sign_failed'], 500);
    
    return [
        'signature' => base64_encode($sig),
        'payload' => $payload
    ];
}

function license_plan_info($duration) {
    $duration = normalize_str($duration);
    if ($duration === '') return ['type' => 'PAID', 'duration' => null, 'duration_months' => null, 'label' => null];
    if (strtolower($duration) === 'lifetime') {
        return ['type' => 'LIFETIME', 'duration' => 'lifetime', 'duration_months' => null, 'label' => 'lifetime access'];
    }
    $months = (int)$duration;
    if ($months <= 0) return ['type' => 'PAID', 'duration' => $duration, 'duration_months' => null, 'label' => null];
    if ($months === 1) return ['type' => 'TRIAL', 'duration' => (string)$months, 'duration_months' => $months, 'label' => '1 month trial'];
    if ($months === 3) return ['type' => 'STANDARD', 'duration' => (string)$months, 'duration_months' => $months, 'label' => '3 months standard'];
    if ($months === 6) return ['type' => 'PREMIUM', 'duration' => (string)$months, 'duration_months' => $months, 'label' => '6 months premium'];
    if ($months === 12) return ['type' => 'ENTERPRISE', 'duration' => (string)$months, 'duration_months' => $months, 'label' => '1 year enterprise'];
    return ['type' => 'PAID', 'duration' => (string)$months, 'duration_months' => $months, 'label' => $months . ' months'];
}

// Helper to load DB
function loadDB() {
    global $dbFile;
    $content = file_get_contents($dbFile);
    return json_decode($content, true) ?? [];
}

// Helper to save DB
function saveDB($data) {
    global $dbFile;
    file_put_contents($dbFile, json_encode($data, JSON_PRETTY_PRINT));
}

function loadSubVendoDB() {
    global $subVendoDbFile;
    $content = file_get_contents($subVendoDbFile);
    return json_decode($content, true) ?? [];
}

function saveSubVendoDB($data) {
    global $subVendoDbFile;
    file_put_contents($subVendoDbFile, json_encode($data, JSON_PRETTY_PRINT));
}

function loadUsers() {
    global $usersFile;
    $content = file_get_contents($usersFile);
    return json_decode($content, true) ?? [];
}

function saveUsers($data) {
    global $usersFile;
    file_put_contents($usersFile, json_encode($data, JSON_PRETTY_PRINT));
}

function loadTransferLog() {
    global $transferLogFile;
    $content = file_get_contents($transferLogFile);
    return json_decode($content, true) ?? [];
}

function saveTransferLog($data) {
    global $transferLogFile;
    file_put_contents($transferLogFile, json_encode($data, JSON_PRETTY_PRINT));
}

function find_user_by_name_or_email($needle) {
    $needle = strtolower(trim((string)$needle));
    if ($needle === '') return null;
    $users = loadUsers();
    foreach ($users as $u) {
        if (!is_array($u)) continue;
        $email = strtolower((string)($u['email'] ?? ''));
        $name = strtolower((string)($u['name'] ?? ''));
        if ($email !== '' && $email === $needle) return $u;
        if ($name !== '' && $name === $needle) return $u;
    }
    return null;
}

function normalize_owner_fields($newOwnerInput) {
    $newOwnerInput = trim((string)$newOwnerInput);
    $u = find_user_by_name_or_email($newOwnerInput);
    if ($u) {
        return [
            'owner' => (string)($u['email'] ?? $newOwnerInput),
            'ownerName' => (string)($u['name'] ?? ($u['email'] ?? $newOwnerInput)),
            'ownerEmail' => (string)($u['email'] ?? ''),
            'ownerId' => (string)($u['id'] ?? '')
        ];
    }
    $isEmail = filter_var($newOwnerInput, FILTER_VALIDATE_EMAIL) ? true : false;
    return [
        'owner' => $newOwnerInput,
        'ownerName' => $newOwnerInput,
        'ownerEmail' => $isEmail ? $newOwnerInput : '',
        'ownerId' => ''
    ];
}

function is_https() {
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
    if (!empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string)$_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https') return true;
    return false;
}

function base_url() {
    $host = (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '') return '';
    $scheme = is_https() ? 'https' : 'http';
    return $scheme . '://' . $host;
}

function send_verification_email($toEmail, $verifyLink) {
    $from = (string)(getenv('NEOFI_EMAIL_FROM') ?: '');
    $subject = 'Confirm your NeoFi account';
    $body = "Hello,\n\nPlease confirm your NeoFi account by clicking this link:\n\n{$verifyLink}\n\nIf you did not sign up, you can ignore this email.\n";

    $headers = [];
    if ($from !== '') {
        $headers[] = 'From: ' . $from;
        $headers[] = 'Reply-To: ' . $from;
    }
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';

    $ok = false;
    try {
        $ok = @mail($toEmail, $subject, $body, implode("\r\n", $headers));
    } catch (Throwable $e) {
        $ok = false;
    }
    if (!$ok) {
        try {
            $logPath = __DIR__ . '/email_debug.log';
            $line = date('c') . " EMAIL_FAIL to={$toEmail} link={$verifyLink}\n";
            @file_put_contents($logPath, $line, FILE_APPEND);
        } catch (Throwable $e) {}
    }
    return $ok;
}

function send_password_reset_email($toEmail, $code) {
    $from = (string)(getenv('NEOFI_EMAIL_FROM') ?: '');
    $subject = 'NeoFi password reset code';
    $body = "Hello,\n\nYour NeoFi password reset code is:\n\n{$code}\n\nThis code expires in 15 minutes.\nIf you did not request this, you can ignore this email.\n";

    $headers = [];
    if ($from !== '') {
        $headers[] = 'From: ' . $from;
        $headers[] = 'Reply-To: ' . $from;
    }
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';

    $ok = false;
    try {
        $ok = @mail($toEmail, $subject, $body, implode("\r\n", $headers));
    } catch (Throwable $e) {
        $ok = false;
    }
    if (!$ok) {
        try {
            $logPath = __DIR__ . '/email_debug.log';
            $line = date('c') . " RESET_EMAIL_FAIL to={$toEmail} code={$code}\n";
            @file_put_contents($logPath, $line, FILE_APPEND);
        } catch (Throwable $e) {}
    }
    return $ok;
}

function generate_subvendo_key($existingKeys) {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for ($attempt = 0; $attempt < 50; $attempt++) {
        $k = 'SV';
        for ($i = 0; $i < 8; $i++) {
            $k .= $chars[rand(0, strlen($chars) - 1)];
        }
        if (!isset($existingKeys[$k])) {
            return $k;
        }
    }
    return '';
}

$method = $_SERVER['REQUEST_METHOD'];
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';

if ($method === 'OPTIONS') {
    json_response(['ok' => true], 200);
}

if (
    $endpoint === 'activate' || $endpoint === 'validate-license' || $endpoint === 'validate' || $endpoint === 'heartbeat' || $endpoint === 'debug' ||
    $endpoint === 'subvendo-activate' || $endpoint === 'subvendo-validate-license' || $endpoint === 'subvendo-validate' || $endpoint === 'subvendo-heartbeat' ||
    $endpoint === 'subvendo-commands-pull' || $endpoint === 'subvendo-commands-ack'
) {
    require_api_auth();
}

if ($endpoint === 'transfer' || $endpoint === 'subvendo-transfer' || $endpoint === 'subvendo-generate') {
    if ($method !== 'GET') {
        require_admin_session();
    }
}

// WEBSITE AUTH (Dashboard)
if ($method === 'GET' && $endpoint === 'users') {
    require_admin_session();
    $users = loadUsers();
    $safeUsers = array_map(function($u) {
        if (is_array($u) && array_key_exists('password', $u)) unset($u['password']);
        return $u;
    }, $users);
    json_response($safeUsers, 200);
}

if ($method === 'GET' && $endpoint === 'me') {
    $u = session_user();
    if (!$u) json_response(['success' => false, 'message' => 'Unauthorized'], 401);
    json_response(['success' => true, 'user' => $u], 200);
}

if ($method === 'GET' && $endpoint === 'transfer-log') {
    require_admin_session();
    $log = loadTransferLog();
    json_response(['success' => true, 'items' => $log], 200);
}

if ($method === 'GET' && $endpoint === 'downloads-list') {
    $u = require_session_user();
    $items = loadDownloadsDB();
    $isAdmin = (($u['role'] ?? '') === 'admin');
    $out = [];
    foreach ($items as $it) {
        if (!is_array($it)) continue;
        if (!$isAdmin) {
            if (isset($it['isPublic']) && !$it['isPublic']) continue;
        }
        $out[] = [
            'id' => (string)($it['id'] ?? ''),
            'name' => (string)($it['name'] ?? ''),
            'category' => (string)($it['category'] ?? 'general'),
            'size' => (int)($it['size'] ?? 0),
            'uploadedAt' => (string)($it['uploadedAt'] ?? ''),
            'uploadedBy' => (string)($it['uploadedBy'] ?? ''),
            'description' => (string)($it['description'] ?? ''),
            'downloads' => (int)($it['downloads'] ?? 0),
            'isPublic' => (bool)($it['isPublic'] ?? true),
        ];
    }
    json_response(['success' => true, 'files' => $out], 200);
}

if ($method === 'GET' && $endpoint === 'downloads-limits') {
    require_session_user();
    $uploadMax = (string)ini_get('upload_max_filesize');
    $postMax = (string)ini_get('post_max_size');
    $maxExec = (string)ini_get('max_execution_time');
    $maxInput = (string)ini_get('max_input_time');
    json_response([
        'success' => true,
        'upload_max_filesize' => $uploadMax,
        'post_max_size' => $postMax,
        'max_execution_time' => $maxExec,
        'max_input_time' => $maxInput,
        'upload_max_bytes' => ini_bytes($uploadMax),
        'post_max_bytes' => ini_bytes($postMax)
    ], 200);
}

if ($method === 'GET' && $endpoint === 'downloads-download') {
    require_session_user();
    $id = normalize_str($_GET['id'] ?? '');
    if ($id === '') json_response(['success' => false, 'message' => 'Missing id'], 400);

    $items = loadDownloadsDB();
    $idx = -1;
    for ($i = 0; $i < count($items); $i++) {
        if (!is_array($items[$i])) continue;
        if (($items[$i]['id'] ?? '') === $id) { $idx = $i; break; }
    }
    if ($idx === -1) json_response(['success' => false, 'message' => 'Not found'], 404);

    $stored = (string)($items[$idx]['stored'] ?? '');
    $orig = (string)($items[$idx]['name'] ?? 'download.bin');
    $mime = (string)($items[$idx]['mime'] ?? 'application/octet-stream');
    $path = __DIR__ . '/../_downloads/' . $stored;
    if ($stored === '' || !file_exists($path)) json_response(['success' => false, 'message' => 'Missing file'], 404);

    $items[$idx]['downloads'] = (int)($items[$idx]['downloads'] ?? 0) + 1;
    $items[$idx]['lastDownloadedAt'] = date('c');
    saveDownloadsDB($items);

    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $orig) . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
}

if ($method === 'POST' && $endpoint === 'logout') {
    $_SESSION = [];
    if (session_id() !== '') {
        session_destroy();
    }
    json_response(['success' => true], 200);
}

if ($method === 'GET' && $endpoint === 'verify-email') {
    $token = normalize_str($_GET['token'] ?? '');
    if ($token === '') {
        http_response_code(400);
        header('Content-Type: text/html; charset=UTF-8');
        echo '<h3>Invalid verification link.</h3>';
        exit;
    }

    $tokenHash = hash('sha256', $token);
    $users = loadUsers();
    $found = false;
    for ($i = 0; $i < count($users); $i++) {
        $u = $users[$i];
        if (!is_array($u)) continue;
        if (($u['verify_token_hash'] ?? '') !== $tokenHash) continue;
        $exp = (string)($u['verify_expires_at'] ?? '');
        if ($exp !== '' && strtotime($exp) !== false && strtotime($exp) < time()) {
            http_response_code(400);
            header('Content-Type: text/html; charset=UTF-8');
            echo '<h3>Verification link expired. Please request a new one.</h3>';
            exit;
        }
        $users[$i]['email_verified_at'] = date('c');
        $users[$i]['verify_token_hash'] = null;
        $users[$i]['verify_expires_at'] = null;
        $found = true;
        break;
    }
    if ($found) {
        saveUsers($users);
        $site = base_url();
        $redirect = $site !== '' ? ($site . '/#/login?verified=1') : '/#/login?verified=1';
        http_response_code(200);
        header('Content-Type: text/html; charset=UTF-8');
        echo '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' . htmlspecialchars($redirect) . '"></head><body>';
        echo '<h3>Email verified. Redirecting to login...</h3>';
        echo '</body></html>';
        exit;
    }
    http_response_code(400);
    header('Content-Type: text/html; charset=UTF-8');
    echo '<h3>Invalid verification link.</h3>';
    exit;
}

if ($method === 'POST' && $endpoint === 'login') {
    $email = normalize_str($data['email'] ?? '');
    $password = normalize_str($data['password'] ?? '');
    if ($email === '' || $password === '') {
        json_response(['success' => false, 'message' => 'Missing credentials'], 400);
    }

    $users = loadUsers();
    foreach ($users as $u) {
        if (!is_array($u)) continue;
        $stored = (string)($u['password'] ?? '');
        $ok = false;
        if ($stored !== '' && strpos($stored, '$') === 0) {
            $ok = password_verify($password, $stored);
        } else {
            $ok = (($u['email'] ?? '') === $email && ($u['password'] ?? '') === $password);
        }
        if (($u['email'] ?? '') === $email && $ok) {
            $role = (string)($u['role'] ?? 'user');
            $verifiedAt = (string)($u['email_verified_at'] ?? '');
            $verifyHash = (string)($u['verify_token_hash'] ?? '');
            if ($role !== 'admin' && $verifiedAt === '' && $verifyHash !== '') {
                json_response(['success' => false, 'message' => 'Email not verified', 'code' => 'EMAIL_NOT_VERIFIED'], 200);
            }
            unset($u['password']);
            session_regenerate_id(true);
            $_SESSION['user'] = $u;
            json_response(['success' => true, 'user' => $u], 200);
        }
    }
    json_response(['success' => false, 'message' => 'Invalid credentials'], 200);
}

if ($method === 'POST' && $endpoint === 'signup') {
    $name = normalize_str($data['name'] ?? '');
    $email = normalize_str($data['email'] ?? '');
    $password = normalize_str($data['password'] ?? '');

    if ($name === '' || $email === '' || $password === '') {
        json_response(['success' => false, 'message' => 'All fields required'], 400);
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_response(['success' => false, 'message' => 'Invalid email'], 400);
    }

    $users = loadUsers();
    foreach ($users as $u) {
        if (!is_array($u)) continue;
        if (strcasecmp((string)($u['email'] ?? ''), $email) === 0) {
            json_response(['success' => false, 'message' => 'Email already exists'], 200);
        }
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $token = bin2hex(random_bytes(16));
    $tokenHash = hash('sha256', $token);
    $expiresAt = date('c', time() + 60 * 60 * 24);
    $newUser = [
        'id' => uniqid(),
        'name' => $name,
        'email' => $email,
        'password' => $hash,
        'role' => 'user',
        'createdAt' => date('c'),
        'email_verified_at' => null,
        'verify_token_hash' => $tokenHash,
        'verify_expires_at' => $expiresAt
    ];
    $users[] = $newUser;
    saveUsers($users);
    unset($newUser['password']);
    $apiBase = base_url();
    $verifyLink = ($apiBase !== '' ? $apiBase : '') . '/api/index.php?endpoint=verify-email&token=' . urlencode($token);
    send_verification_email($email, $verifyLink);
    json_response(['success' => true, 'message' => 'Verification email sent. Please check your inbox.', 'user' => $newUser], 200);
}

if ($method === 'POST' && $endpoint === 'resend-verification') {
    $email = normalize_str($data['email'] ?? '');
    if ($email === '') {
        json_response(['success' => false, 'message' => 'Missing email'], 400);
    }
    $users = loadUsers();
    $updated = false;
    $token = bin2hex(random_bytes(16));
    $tokenHash = hash('sha256', $token);
    $expiresAt = date('c', time() + 60 * 60 * 24);
    for ($i = 0; $i < count($users); $i++) {
        $u = $users[$i];
        if (!is_array($u)) continue;
        if (strcasecmp((string)($u['email'] ?? ''), $email) !== 0) continue;
        $role = (string)($u['role'] ?? 'user');
        if ($role === 'admin') {
            json_response(['success' => true, 'message' => 'Admin account does not require verification'], 200);
        }
        $verifiedAt = (string)($u['email_verified_at'] ?? '');
        if ($verifiedAt !== '') {
            json_response(['success' => true, 'message' => 'Email already verified'], 200);
        }
        $users[$i]['verify_token_hash'] = $tokenHash;
        $users[$i]['verify_expires_at'] = $expiresAt;
        $updated = true;
        break;
    }
    if (!$updated) {
        json_response(['success' => true, 'message' => 'If the email exists, a verification link will be sent.'], 200);
    }
    saveUsers($users);
    $apiBase = base_url();
    $verifyLink = ($apiBase !== '' ? $apiBase : '') . '/api/index.php?endpoint=verify-email&token=' . urlencode($token);
    send_verification_email($email, $verifyLink);
    json_response(['success' => true, 'message' => 'Verification email sent. Please check your inbox.'], 200);
}

if ($method === 'POST' && $endpoint === 'forgot-password') {
    $email = normalize_str($data['email'] ?? '');
    if ($email === '') {
        json_response(['success' => false, 'message' => 'Missing email'], 400);
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        json_response(['success' => false, 'message' => 'Invalid email'], 400);
    }

    $users = loadUsers();
    $foundIndex = -1;
    for ($i = 0; $i < count($users); $i++) {
        $u = $users[$i];
        if (!is_array($u)) continue;
        if (strcasecmp((string)($u['email'] ?? ''), $email) !== 0) continue;
        $foundIndex = $i;
        break;
    }
    if ($foundIndex === -1) {
        json_response(['success' => false, 'message' => 'Email not available'], 200);
    }

    $code = (string)random_int(100000, 999999);
    $codeHash = hash('sha256', $code);
    $expiresAt = date('c', time() + 60 * 15);
    $resetToken = bin2hex(random_bytes(16));
    $resetTokenHash = hash('sha256', $resetToken);

    $users[$foundIndex]['reset_code_hash'] = $codeHash;
    $users[$foundIndex]['reset_expires_at'] = $expiresAt;
    $users[$foundIndex]['reset_token_hash'] = $resetTokenHash;
    $users[$foundIndex]['reset_verified_at'] = null;
    saveUsers($users);

    send_password_reset_email($email, $code);
    json_response(['success' => true, 'message' => 'Verification code sent', 'email' => $email], 200);
}

if ($method === 'POST' && $endpoint === 'verify-reset-code') {
    $email = normalize_str($data['email'] ?? '');
    $code = normalize_str($data['code'] ?? '');
    if ($email === '' || $code === '') {
        json_response(['success' => false, 'message' => 'Missing email or code'], 400);
    }

    $users = loadUsers();
    $foundIndex = -1;
    for ($i = 0; $i < count($users); $i++) {
        $u = $users[$i];
        if (!is_array($u)) continue;
        if (strcasecmp((string)($u['email'] ?? ''), $email) !== 0) continue;
        $foundIndex = $i;
        break;
    }
    if ($foundIndex === -1) {
        json_response(['success' => false, 'message' => 'Email not available'], 200);
    }

    $u = $users[$foundIndex];
    $exp = (string)($u['reset_expires_at'] ?? '');
    $codeHash = (string)($u['reset_code_hash'] ?? '');
    if ($exp === '' || $codeHash === '') {
        json_response(['success' => false, 'message' => 'No reset request found'], 200);
    }
    $expTs = strtotime($exp);
    if ($expTs !== false && $expTs < time()) {
        json_response(['success' => false, 'message' => 'Code expired'], 200);
    }
    if (!hash_equals($codeHash, hash('sha256', $code))) {
        json_response(['success' => false, 'message' => 'Invalid code'], 200);
    }

    $users[$foundIndex]['reset_verified_at'] = date('c');
    saveUsers($users);
    json_response(['success' => true, 'message' => 'Code verified'], 200);
}

if ($method === 'POST' && $endpoint === 'reset-password') {
    $email = normalize_str($data['email'] ?? '');
    $newPassword = normalize_str($data['new_password'] ?? ($data['password'] ?? ''));
    $code = normalize_str($data['code'] ?? '');
    if ($email === '' || $newPassword === '' || $code === '') {
        json_response(['success' => false, 'message' => 'Missing email, code, or password'], 400);
    }

    if (strlen($newPassword) < 6) {
        json_response(['success' => false, 'message' => 'Password must be at least 6 characters'], 400);
    }

    $users = loadUsers();
    $foundIndex = -1;
    for ($i = 0; $i < count($users); $i++) {
        $u = $users[$i];
        if (!is_array($u)) continue;
        if (strcasecmp((string)($u['email'] ?? ''), $email) !== 0) continue;
        $foundIndex = $i;
        break;
    }
    if ($foundIndex === -1) {
        json_response(['success' => false, 'message' => 'Email not available'], 200);
    }

    $u = $users[$foundIndex];
    $exp = (string)($u['reset_expires_at'] ?? '');
    $codeHash = (string)($u['reset_code_hash'] ?? '');
    if ($exp === '' || $codeHash === '') {
        json_response(['success' => false, 'message' => 'No reset request found'], 200);
    }
    $expTs = strtotime($exp);
    if ($expTs !== false && $expTs < time()) {
        json_response(['success' => false, 'message' => 'Code expired'], 200);
    }
    if (!hash_equals($codeHash, hash('sha256', $code))) {
        json_response(['success' => false, 'message' => 'Invalid code'], 200);
    }

    $hash = password_hash($newPassword, PASSWORD_DEFAULT);
    $users[$foundIndex]['password'] = $hash;
    $users[$foundIndex]['reset_code_hash'] = null;
    $users[$foundIndex]['reset_expires_at'] = null;
    $users[$foundIndex]['reset_token_hash'] = null;
    $users[$foundIndex]['reset_verified_at'] = null;
    saveUsers($users);
    json_response(['success' => true, 'message' => 'Password updated'], 200);
}

if ($method === 'POST' && $endpoint === 'create_admin') {
    require_admin_session();
    $name = normalize_str($data['name'] ?? '');
    $email = normalize_str($data['email'] ?? '');
    $password = normalize_str($data['password'] ?? '');

    if ($name === '' || $email === '' || $password === '') {
        json_response(['success' => false, 'message' => 'All fields required'], 400);
    }

    $users = loadUsers();
    foreach ($users as $u) {
        if (!is_array($u)) continue;
        if (($u['email'] ?? '') === $email) {
            json_response(['success' => false, 'message' => 'Email already exists'], 200);
        }
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $newAdmin = [
        'id' => uniqid(),
        'name' => $name,
        'email' => $email,
        'password' => $hash,
        'role' => 'admin',
        'createdAt' => date('c'),
        'email_verified_at' => date('c')
    ];
    $users[] = $newAdmin;
    saveUsers($users);
    json_response(['success' => true, 'message' => 'Admin created'], 200);
}

if ($method === 'GET' && $endpoint === 'debug') {
    $envToken = (string)(getenv('LICENSE_API_TOKEN') ?: '');
    $envPriv = (string)(getenv('LICENSE_PRIVATE_KEY_PEM') ?: '');
    $paths = [
        __DIR__ . '/private.pem',
        __DIR__ . '/private.key',
        __DIR__ . '/private.pem.example',
        __DIR__ . '/keys/private.pem',
        __DIR__ . '/keys/private.key',
        __DIR__ . '/keys/private.pem.example'
    ];
    $files = [];
    foreach ($paths as $p) {
        $files[] = [
            'path' => $p,
            'exists' => file_exists($p),
            'readable' => is_readable($p),
            'size' => file_exists($p) ? (int)filesize($p) : 0
        ];
    }
    json_response([
        'ok' => true,
        'php_version' => PHP_VERSION,
        'cwd' => getcwd(),
        'dir' => __DIR__,
        'openssl_loaded' => extension_loaded('openssl'),
        'env' => [
            'LICENSE_API_TOKEN_set' => trim($envToken) !== '',
            'LICENSE_PRIVATE_KEY_PEM_len' => strlen(trim($envPriv))
        ],
        'db' => [
            'dbFile' => $dbFile,
            'db_exists' => file_exists($dbFile),
            'db_readable' => is_readable($dbFile),
            'db_size' => file_exists($dbFile) ? (int)filesize($dbFile) : 0
        ],
        'key_files' => $files
    ], 200);
}

// 1. GET ALL LICENSES
if ($method === 'GET' && $endpoint === 'licenses') {
    json_response(loadDB());
}

// SUB VENDO - LIST GENERATED KEYS
if ($method === 'GET' && $endpoint === 'subvendo-list') {
    require_admin_session();
    $keys = loadSubVendoDB();
    $changed = false;
    $now = new DateTime();
    foreach ($keys as $i => $k) {
        $status = (string)($k['status'] ?? '');
        if ($status === 'revoked') continue;
        $exp = (string)($k['expiry'] ?? '');
        if ($status === 'expired' && $exp !== '') {
            try {
                if (new DateTime($exp) >= $now) {
                    $keys[$i]['status'] = 'generated';
                    $keys[$i]['machineId'] = null;
                    $keys[$i]['name'] = 'Unassigned Sub Vendo';
                    $keys[$i]['activatedAt'] = null;
                    $keys[$i]['lastHeartbeatAt'] = null;
                    $keys[$i]['expiredAt'] = null;
                    $keys[$i]['resetAt'] = date('c');
                    $changed = true;
                    continue;
                }
            } catch (Throwable $e) {}
        }
        if ($exp !== '' && (new DateTime($exp) < $now)) {
            if (($keys[$i]['status'] ?? '') !== 'expired') {
                $keys[$i]['status'] = 'expired';
                $keys[$i]['expiredAt'] = date('c');
                $changed = true;
            }
        }
    }
    if ($changed) saveSubVendoDB($keys);
    json_response(['success' => true, 'licenses' => $keys]);
}

if ($method === 'GET' && $endpoint === 'subvendo-mylist') {
    $u = require_session_user();
    $matchA = strtolower((string)($u['name'] ?? ''));
    $matchB = strtolower((string)($u['email'] ?? ''));
    $matchId = (string)($u['id'] ?? '');
    $keys = loadSubVendoDB();
    $now = new DateTime();
    $result = [];
    $changed = false;
    foreach ($keys as $i => $k) {
        $status = (string)($k['status'] ?? '');
        $exp = (string)($k['expiry'] ?? '');
        if ($status === 'expired' && $exp !== '') {
            try {
                if (new DateTime($exp) >= $now) {
                    $keys[$i]['status'] = 'generated';
                    $keys[$i]['machineId'] = null;
                    $keys[$i]['name'] = 'Unassigned Sub Vendo';
                    $keys[$i]['activatedAt'] = null;
                    $keys[$i]['lastHeartbeatAt'] = null;
                    $keys[$i]['expiredAt'] = null;
                    $keys[$i]['resetAt'] = date('c');
                    $changed = true;
                    $status = 'generated';
                }
            } catch (Throwable $e) {}
        }
        if ($status !== 'revoked' && $exp !== '' && (new DateTime($exp) < $now)) {
            if (($keys[$i]['status'] ?? '') !== 'expired') {
                $keys[$i]['status'] = 'expired';
                $keys[$i]['expiredAt'] = date('c');
                $changed = true;
            }
        }
        $owner = strtolower((string)($keys[$i]['owner'] ?? ($k['owner'] ?? '')));
        $ownerEmail = strtolower((string)($keys[$i]['ownerEmail'] ?? ''));
        $ownerName = strtolower((string)($keys[$i]['ownerName'] ?? ''));
        $ownerId = (string)($keys[$i]['ownerId'] ?? '');
        $match = false;
        if ($matchId !== '' && $ownerId !== '' && $ownerId === $matchId) $match = true;
        if (!$match && $owner !== '' && ($owner === $matchA || $owner === $matchB)) $match = true;
        if (!$match && $ownerEmail !== '' && ($ownerEmail === $matchA || $ownerEmail === $matchB)) $match = true;
        if (!$match && $ownerName !== '' && ($ownerName === $matchA || $ownerName === $matchB)) $match = true;
        if ($match) {
            $result[] = $keys[$i];
        }
    }
    if ($changed) saveSubVendoDB($keys);
    json_response(['success' => true, 'licenses' => $result]);
}

// POST REQUESTS
if ($method === 'POST') {
    
    if ($endpoint === 'downloads-upload-init') {
        $u = require_admin_session();
        $name = normalize_str($data['name'] ?? '');
        $size = (int)($data['size'] ?? 0);
        $desc = normalize_str($data['description'] ?? '');
        $category = normalize_str($data['category'] ?? '');
        if ($category === '') $category = 'general';
        $allowedCategories = ['general', 'neofi_update', 'subvendo_firmware'];
        if (!in_array($category, $allowedCategories, true)) {
            json_response(['success' => false, 'message' => 'Invalid category'], 400);
        }
        if ($name === '' || $size <= 0) {
            json_response(['success' => false, 'message' => 'Missing name/size'], 400);
        }
        if ($size > 2 * 1024 * 1024 * 1024) json_response(['success' => false, 'message' => 'File too large (max 2GB)'], 400);

        $orig = basename($name);
        $orig = preg_replace('/[^a-zA-Z0-9._ -]/', '_', $orig);
        if ($orig === '') $orig = 'upload.bin';

        $ext = '';
        $dot = strrpos($orig, '.');
        if ($dot !== false) $ext = strtolower(substr($orig, $dot + 1));
        $allowedExt = ['pdf', 'zip', 'rar', '7z', 'txt', 'png', 'jpg', 'jpeg', 'mp3', 'wav', 'bin', 'exe', 'gz'];
        if ($ext !== '' && !in_array($ext, $allowedExt, true)) {
            json_response(['success' => false, 'message' => 'File type not allowed'], 400);
        }

        $tmpDir = __DIR__ . '/../_downloads_tmp';
        if (!is_dir($tmpDir)) @mkdir($tmpDir, 0755, true);
        if (!is_dir($tmpDir)) json_response(['success' => false, 'message' => 'Storage not available'], 500);

        $uploadId = uniqid('upl_', true);
        $tmpName = $uploadId . '.part';
        $tmpPath = $tmpDir . '/' . $tmpName;
        @file_put_contents($tmpPath, '');

        $uploads = loadDownloadsUploads();
        $uploads[] = [
            'id' => $uploadId,
            'tmp' => $tmpName,
            'name' => $orig,
            'size' => $size,
            'category' => $category,
            'description' => $desc,
            'uploadedBy' => (string)($u['email'] ?? ($u['name'] ?? 'admin')),
            'createdAt' => date('c'),
            'status' => 'uploading'
        ];
        saveDownloadsUploads($uploads);
        json_response(['success' => true, 'uploadId' => $uploadId], 200);
    }

    if ($endpoint === 'downloads-upload-chunk') {
        require_admin_session();
        $uploadId = normalize_str($_GET['uploadId'] ?? ($data['uploadId'] ?? ''));
        if ($uploadId === '') json_response(['success' => false, 'message' => 'Missing uploadId'], 400);

        $uploads = loadDownloadsUploads();
        $idx = -1;
        for ($i = 0; $i < count($uploads); $i++) {
            if (!is_array($uploads[$i])) continue;
            if (($uploads[$i]['id'] ?? '') === $uploadId) { $idx = $i; break; }
        }
        if ($idx === -1) json_response(['success' => false, 'message' => 'Upload not found'], 404);

        $tmp = (string)($uploads[$idx]['tmp'] ?? '');
        $expected = (int)($uploads[$idx]['size'] ?? 0);
        if ($tmp === '' || $expected <= 0) json_response(['success' => false, 'message' => 'Upload invalid'], 400);

        $tmpPath = __DIR__ . '/../_downloads_tmp/' . $tmp;
        if (!file_exists($tmpPath)) @file_put_contents($tmpPath, '');

        $offset = (int)($_SERVER['HTTP_X_UPLOAD_OFFSET'] ?? 0);
        $current = (int)@filesize($tmpPath);
        if ($offset !== $current) {
            json_response(['success' => false, 'message' => 'Offset mismatch', 'expectedOffset' => $current], 409);
        }

        $chunk = file_get_contents('php://input');
        if ($chunk === false || $chunk === '') {
            json_response(['success' => false, 'message' => 'Empty chunk'], 400);
        }

        $fp = @fopen($tmpPath, 'ab');
        if (!$fp) json_response(['success' => false, 'message' => 'Cannot write chunk'], 500);
        fwrite($fp, $chunk);
        fclose($fp);

        $newSize = (int)@filesize($tmpPath);
        if ($newSize > $expected) {
            json_response(['success' => false, 'message' => 'Upload exceeds expected size'], 400);
        }
        json_response(['success' => true, 'received' => $newSize, 'total' => $expected], 200);
    }

    if ($endpoint === 'downloads-upload-finish') {
        $u = require_admin_session();
        $uploadId = normalize_str($data['uploadId'] ?? '');
        if ($uploadId === '') json_response(['success' => false, 'message' => 'Missing uploadId'], 400);

        $uploads = loadDownloadsUploads();
        $idx = -1;
        for ($i = 0; $i < count($uploads); $i++) {
            if (!is_array($uploads[$i])) continue;
            if (($uploads[$i]['id'] ?? '') === $uploadId) { $idx = $i; break; }
        }
        if ($idx === -1) json_response(['success' => false, 'message' => 'Upload not found'], 404);

        $tmp = (string)($uploads[$idx]['tmp'] ?? '');
        $orig = (string)($uploads[$idx]['name'] ?? 'upload.bin');
        $size = (int)($uploads[$idx]['size'] ?? 0);
        $desc = (string)($uploads[$idx]['description'] ?? '');
        $category = (string)($uploads[$idx]['category'] ?? 'general');

        $tmpPath = __DIR__ . '/../_downloads_tmp/' . $tmp;
        if ($tmp === '' || !file_exists($tmpPath)) json_response(['success' => false, 'message' => 'Temp file missing'], 404);
        $actual = (int)@filesize($tmpPath);
        if ($size <= 0 || $actual !== $size) {
            json_response(['success' => false, 'message' => 'Size mismatch', 'received' => $actual, 'expected' => $size], 400);
        }

        $ext = '';
        $dot = strrpos($orig, '.');
        if ($dot !== false) $ext = strtolower(substr($orig, $dot + 1));
        $mime = 'application/octet-stream';
        if ($ext === 'pdf') $mime = 'application/pdf';
        if ($ext === 'png') $mime = 'image/png';
        if ($ext === 'jpg' || $ext === 'jpeg') $mime = 'image/jpeg';
        if ($ext === 'txt') $mime = 'text/plain';
        if ($ext === 'zip') $mime = 'application/zip';

        $dir = __DIR__ . '/../_downloads';
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (!is_dir($dir)) json_response(['success' => false, 'message' => 'Storage not available'], 500);

        $stored = uniqid('dl_', true) . ($ext !== '' ? ('.' . $ext) : '');
        $dest = $dir . '/' . $stored;
        if (!@rename($tmpPath, $dest)) {
            if (!@copy($tmpPath, $dest)) json_response(['success' => false, 'message' => 'Failed to finalize file'], 500);
            @unlink($tmpPath);
        }

        $items = loadDownloadsDB();
        $items[] = [
            'id' => uniqid('dlid_', true),
            'name' => $orig,
            'stored' => $stored,
            'category' => $category,
            'size' => $size,
            'mime' => $mime,
            'description' => $desc,
            'downloads' => 0,
            'isPublic' => true,
            'uploadedAt' => date('c'),
            'uploadedBy' => (string)($u['email'] ?? ($u['name'] ?? 'admin'))
        ];
        saveDownloadsDB($items);

        $next = [];
        foreach ($uploads as $i => $rec) {
            if (!is_array($rec)) continue;
            if (($rec['id'] ?? '') === $uploadId) continue;
            $next[] = $rec;
        }
        saveDownloadsUploads($next);

        json_response(['success' => true], 200);
    }

    if ($endpoint === 'downloads-upload') {
        $u = require_admin_session();

        if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
            $cl = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($cl > 0) {
                json_response([
                    'success' => false,
                    'message' => 'Missing file (upload may exceed server limits). Check upload_max_filesize/post_max_size.'
                ], 400);
            }
            json_response(['success' => false, 'message' => 'Missing file'], 400);
        }
        $f = $_FILES['file'];
        if (($f['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            $code = (int)($f['error'] ?? 0);
            $msg = 'Upload error';
            if ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE) $msg = 'File too large for server limits';
            if ($code === UPLOAD_ERR_PARTIAL) $msg = 'Upload incomplete (partial)';
            if ($code === UPLOAD_ERR_NO_TMP_DIR) $msg = 'Server missing temp directory';
            if ($code === UPLOAD_ERR_CANT_WRITE) $msg = 'Server cannot write file';
            if ($code === UPLOAD_ERR_EXTENSION) $msg = 'Upload blocked by server extension';
            json_response(['success' => false, 'message' => $msg, 'code' => $code], 400);
        }
        $orig = basename((string)($f['name'] ?? 'upload.bin'));
        $orig = preg_replace('/[^a-zA-Z0-9._ -]/', '_', $orig);
        if ($orig === '') $orig = 'upload.bin';

        $size = (int)($f['size'] ?? 0);
        if ($size <= 0) json_response(['success' => false, 'message' => 'Empty file'], 400);
        if ($size > 50 * 1024 * 1024) json_response(['success' => false, 'message' => 'File too large (max 50MB)'], 400);

        $tmp = (string)($f['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            json_response(['success' => false, 'message' => 'Invalid upload'], 400);
        }

        $ext = '';
        $dot = strrpos($orig, '.');
        if ($dot !== false) $ext = strtolower(substr($orig, $dot + 1));
        $allowedExt = ['pdf', 'zip', 'rar', '7z', 'txt', 'png', 'jpg', 'jpeg', 'mp3', 'wav', 'bin', 'exe'];
        if ($ext !== '' && !in_array($ext, $allowedExt, true)) {
            json_response(['success' => false, 'message' => 'File type not allowed'], 400);
        }

        $mime = (string)($f['type'] ?? 'application/octet-stream');
        if ($mime === '') $mime = 'application/octet-stream';

        $dir = __DIR__ . '/../_downloads';
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        if (!is_dir($dir)) json_response(['success' => false, 'message' => 'Storage not available'], 500);

        $stored = uniqid('dl_', true) . ($ext !== '' ? ('.' . $ext) : '');
        $dest = $dir . '/' . $stored;
        if (!move_uploaded_file($tmp, $dest)) {
            json_response(['success' => false, 'message' => 'Failed to save file'], 500);
        }

        $desc = normalize_str($_POST['description'] ?? '');
        $category = normalize_str($_POST['category'] ?? '');
        if ($category === '') $category = 'general';
        $allowedCategories = ['general', 'neofi_update', 'subvendo_firmware'];
        if (!in_array($category, $allowedCategories, true)) {
            json_response(['success' => false, 'message' => 'Invalid category'], 400);
        }
        $isPublic = true;
        $items = loadDownloadsDB();
        $items[] = [
            'id' => uniqid('dlid_', true),
            'name' => $orig,
            'stored' => $stored,
            'category' => $category,
            'size' => $size,
            'mime' => $mime,
            'description' => $desc,
            'downloads' => 0,
            'isPublic' => $isPublic,
            'uploadedAt' => date('c'),
            'uploadedBy' => (string)($u['email'] ?? ($u['name'] ?? 'admin'))
        ];
        saveDownloadsDB($items);
        json_response(['success' => true], 200);
    }

    if ($endpoint === 'downloads-delete') {
        require_admin_session();
        $id = normalize_str($data['id'] ?? '');
        if ($id === '') json_response(['success' => false, 'message' => 'Missing id'], 400);
        $items = loadDownloadsDB();
        $next = [];
        $removed = null;
        foreach ($items as $it) {
            if (!is_array($it)) continue;
            if (($it['id'] ?? '') === $id) { $removed = $it; continue; }
            $next[] = $it;
        }
        if (!$removed) json_response(['success' => false, 'message' => 'Not found'], 404);
        $stored = (string)($removed['stored'] ?? '');
        if ($stored !== '') {
            $path = __DIR__ . '/../_downloads/' . $stored;
            if (file_exists($path)) @unlink($path);
        }
        saveDownloadsDB($next);
        json_response(['success' => true], 200);
    }

    // SUB VENDO - COMMANDS (NeoFi gateway pulls pending commands)
    if ($endpoint === 'subvendo-commands-pull') {
        $limit = isset($data['limit']) ? intval($data['limit']) : 50;
        if ($limit < 1) $limit = 1;
        if ($limit > 200) $limit = 200;
        $cmds = loadSubVendoCmds();
        $pending = [];
        foreach ($cmds as $c) {
            if (!is_array($c)) continue;
            if (($c['status'] ?? '') !== 'pending') continue;
            $pending[] = $c;
            if (count($pending) >= $limit) break;
        }
        json_response(['success' => true, 'commands' => $pending], 200);
    }

    if ($endpoint === 'subvendo-commands-ack') {
        $ids = $data['ids'] ?? [];
        if (!is_array($ids)) $ids = [];
        $ids = array_values(array_filter(array_map('strval', $ids), function($x) { return $x !== ''; }));
        $cmds = loadSubVendoCmds();
        if (count($ids) > 0) {
            $set = array_flip($ids);
            foreach ($cmds as $i => $c) {
                if (!is_array($c)) continue;
                $id = (string)($c['id'] ?? '');
                if ($id !== '' && isset($set[$id])) {
                    $cmds[$i]['status'] = 'done';
                    $cmds[$i]['doneAt'] = date('c');
                }
            }
            saveSubVendoCmds($cmds);
        }
        json_response(['success' => true], 200);
    }

    // 2. GENERATE LICENSE
    if ($endpoint === 'generate') {
        $qty = isset($data['qty']) ? intval($data['qty']) : 1;
        $ownerInput = $data['owner'] ?? 'Admin';
        $ownerData = normalize_owner_fields($ownerInput);
        $duration = $data['duration'] ?? '1';
        
        $licenses = loadDB();
        $newLicenses = [];
        
        for ($i = 0; $i < $qty; $i++) {
            $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            $key = 'NEO-' . date('Y') . '-';
            
            // First group of 4
            for ($j = 0; $j < 4; $j++) $key .= $chars[rand(0, strlen($chars) - 1)];
            
            $key .= '-';
            
            // Second group of 4
            for ($j = 0; $j < 4; $j++) $key .= $chars[rand(0, strlen($chars) - 1)];

            $expiryDate = new DateTime();
            if ($duration === 'lifetime') {
                $expiryDate->modify('+99 years');
            } else {
                $expiryDate->modify("+$duration months");
            }

            $newLicense = [
                'id' => uniqid(),
                'license' => $key,
                'owner' => $ownerData['owner'],
                'ownerName' => $ownerData['ownerName'],
                'ownerEmail' => $ownerData['ownerEmail'],
                'ownerId' => $ownerData['ownerId'],
                'name' => 'Unassigned Device',
                'machineId' => null,
                'status' => 'generated',
                'duration' => $duration,
                'expiry' => $expiryDate->format('Y-m-d'),
                'createdAt' => date('c'),
                'deviceInfo' => null
            ];
            
            // Add to beginning of array
            array_unshift($licenses, $newLicense);
            $newLicenses[] = $newLicense;
        }
        
        saveDB($licenses);
        echo json_encode(['success' => true, 'licenses' => $newLicenses]);
        exit;
    }

    // SUB VENDO - GENERATE LICENSE KEYS (10 chars: SV + 8 alnum)
    if ($endpoint === 'subvendo-generate') {
        require_admin_session();
        $qty = isset($data['qty']) ? intval($data['qty']) : 1;
        if ($qty < 1) $qty = 1;
        if ($qty > 500) $qty = 500;
        $ownerInput = $data['owner'] ?? 'Admin';
        $ownerData = normalize_owner_fields($ownerInput);
        $duration = $data['duration'] ?? 'lifetime';

        $keys = loadSubVendoDB();
        $existing = [];
        foreach ($keys as $k) {
            if (isset($k['license'])) $existing[(string)$k['license']] = true;
        }

        $newKeys = [];
        for ($i = 0; $i < $qty; $i++) {
            $key = generate_subvendo_key($existing);
            if ($key === '') {
                json_response(['success' => false, 'message' => 'Failed to generate unique key'], 500);
            }
            $existing[$key] = true;

            $expiryDate = new DateTime();
            if ($duration === 'lifetime') $expiryDate->modify('+99 years');
            else $expiryDate->modify("+" . intval($duration) . " months");

            $row = [
                'id' => uniqid('sv_', true),
                'license' => $key,
                'owner' => $ownerData['owner'],
                'ownerName' => $ownerData['ownerName'],
                'ownerEmail' => $ownerData['ownerEmail'],
                'ownerId' => $ownerData['ownerId'],
                'name' => 'Unassigned Sub Vendo',
                'machineId' => null,
                'status' => 'generated',
                'duration' => $duration,
                'expiry' => $expiryDate->format('Y-m-d'),
                'createdAt' => date('c'),
                'activatedAt' => null,
                'lastHeartbeatAt' => null,
                'revokedAt' => null,
                'revokedReason' => null
            ];

            array_unshift($keys, $row);
            $newKeys[] = $row;
        }

        saveSubVendoDB($keys);
        json_response(['success' => true, 'licenses' => $newKeys], 200);
    }

    // SUB VENDO - ACTIVATE KEY (Device calls this)
    if ($endpoint === 'subvendo-activate') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $machineId = normalize_str($data['system_serial'] ?? ($data['System_Serial'] ?? ($data['machineId'] ?? ($data['hwid'] ?? ($data['serial'] ?? '')))));

        if ($licenseKey === '' || $machineId === '') {
            json_response(['allowed' => false, 'success' => false, 'message' => 'Missing key or machine ID', 'status' => 'bad_request'], 400);
        }

        $keys = loadSubVendoDB();
        $foundIndex = -1;
        foreach ($keys as $i => $k) {
            if (($k['license'] ?? '') === $licenseKey) { $foundIndex = $i; break; }
        }
        if ($foundIndex === -1) {
            json_response(['allowed' => false, 'success' => false, 'message' => 'Invalid License Key', 'status' => 'not_found'], 200);
        }

        $row = $keys[$foundIndex];
        if (($row['status'] ?? '') === 'expired' && !empty($row['expiry'])) {
            try {
                if (new DateTime((string)$row['expiry']) >= new DateTime()) {
                    $keys[$foundIndex]['status'] = 'generated';
                    $keys[$foundIndex]['machineId'] = null;
                    $keys[$foundIndex]['activatedAt'] = null;
                    $keys[$foundIndex]['lastHeartbeatAt'] = null;
                    $keys[$foundIndex]['expiredAt'] = null;
                    $keys[$foundIndex]['resetAt'] = date('c');
                    saveSubVendoDB($keys);
                    $row = $keys[$foundIndex];
                }
            } catch (Throwable $e) {}
        }
        if (($row['status'] ?? '') === 'revoked' || ($row['status'] ?? '') === 'expired') {
            json_response(['allowed' => false, 'success' => false, 'message' => strtoupper((string)($row['status'] ?? 'revoked')), 'status' => (string)($row['status'] ?? 'revoked')], 200);
        }

        if (!empty($row['machineId']) && ($row['machineId'] ?? '') !== $machineId) {
            json_response(['allowed' => false, 'success' => false, 'message' => 'License already bound to another device', 'status' => 'bind_failed'], 200);
        }

        if (!empty($row['expiry']) && (new DateTime($row['expiry']) < new DateTime())) {
            $keys[$foundIndex]['status'] = 'expired';
            $keys[$foundIndex]['expiredAt'] = date('c');
            saveSubVendoDB($keys);
            json_response(['allowed' => false, 'success' => false, 'message' => 'License has expired', 'status' => 'expired'], 200);
        }

        $keys[$foundIndex]['machineId'] = $machineId;
        $keys[$foundIndex]['status'] = 'active';
        $keys[$foundIndex]['name'] = normalize_str($data['device_model'] ?? '') ?: ($keys[$foundIndex]['name'] ?? 'Sub Vendo');
        if (empty($keys[$foundIndex]['activatedAt'])) $keys[$foundIndex]['activatedAt'] = date('c');
        $keys[$foundIndex]['lastHeartbeatAt'] = date('c');
        if (!empty($keys[$foundIndex]['revokedMachineId'])) $keys[$foundIndex]['revokedMachineId'] = null;
        saveSubVendoDB($keys);

        json_response([
            'allowed' => true,
            'success' => true,
            'message' => 'Activation Successful',
            'status' => 'active',
            'expiry' => $keys[$foundIndex]['expiry'] ?? null
        ], 200);
    }

    // SUB VENDO - VALIDATE (Device calls this periodically)
    if ($endpoint === 'subvendo-validate' || $endpoint === 'subvendo-validate-license') {
        $isServerCheck = ($endpoint === 'subvendo-validate-license');
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $machineId = normalize_str($data['system_serial'] ?? ($data['System_Serial'] ?? ($data['machineId'] ?? ($data['hwid'] ?? ($data['serial'] ?? '')))));

        if ($licenseKey === '' || $machineId === '') {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Missing key or machine ID', 'status' => 'bad_request'], 200);
        }

        $keys = loadSubVendoDB();
        $row = null;
        $idxFound = -1;
        foreach ($keys as $i => $k) {
            if (($k['license'] ?? '') === $licenseKey) { $row = $k; $idxFound = $i; break; }
        }
        if (!$row) {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Invalid or Unbound', 'status' => 'unbound'], 200);
        }
        if (($row['status'] ?? '') === 'revoked' || ($row['status'] ?? '') === 'expired') {
            json_response(['allowed' => false, 'valid' => false, 'message' => strtoupper((string)($row['status'] ?? 'revoked')), 'status' => (string)($row['status'] ?? 'revoked')], 200);
        }

        if (!empty($row['expiry']) && (new DateTime($row['expiry']) < new DateTime())) {
            $keys[$idxFound]['status'] = 'expired';
            $keys[$idxFound]['machineId'] = null;
            $keys[$idxFound]['expiredAt'] = date('c');
            saveSubVendoDB($keys);
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Expired', 'status' => 'expired'], 200);
        }

        if ($isServerCheck) {
            $keys[$idxFound]['lastValidateAt'] = date('c');
            saveSubVendoDB($keys);
            if (empty($row['machineId'])) {
                json_response(['allowed' => false, 'valid' => false, 'message' => 'Unbound', 'status' => 'unbound'], 200);
            }
            if (($row['machineId'] ?? '') !== $machineId) {
                json_response(['allowed' => false, 'valid' => false, 'message' => 'Invalid or Unbound', 'status' => 'unbound'], 200);
            }
            json_response(['allowed' => true, 'valid' => true, 'status' => 'ok', 'expiry' => $row['expiry'] ?? null], 200);
        }

        // Device-side validate: only refresh if already activated/bound
        if (empty($row['machineId'])) {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Unbound', 'status' => 'unbound'], 200);
        } elseif (($row['machineId'] ?? '') !== $machineId) {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Invalid or Unbound', 'status' => 'unbound'], 200);
        } else {
            $keys[$idxFound]['lastHeartbeatAt'] = date('c');
            if (($keys[$idxFound]['status'] ?? '') !== 'active') $keys[$idxFound]['status'] = 'active';
            saveSubVendoDB($keys);
        }

        json_response(['allowed' => true, 'valid' => true, 'status' => 'ok', 'expiry' => $row['expiry'] ?? null], 200);
    }

    // SUB VENDO - HEARTBEAT (Device sends pings)
    if ($endpoint === 'subvendo-heartbeat') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $machineId = normalize_str($data['system_serial'] ?? ($data['System_Serial'] ?? ($data['machineId'] ?? ($data['hwid'] ?? ($data['serial'] ?? '')))));
        if ($licenseKey !== '' && $machineId !== '') {
            $ip = normalize_str($_SERVER['HTTP_CF_CONNECTING_IP'] ?? ($_SERVER['REMOTE_ADDR'] ?? ''));
            $ua = normalize_str($_SERVER['HTTP_USER_AGENT'] ?? '');
            $sentAt = normalize_str($data['sentAt'] ?? '');
            $lastActiveAt = normalize_str($data['lastActiveAt'] ?? '');
            $keys = loadSubVendoDB();
            foreach ($keys as $i => $k) {
                if (($k['license'] ?? '') !== $licenseKey) continue;
                if (($k['status'] ?? '') === 'revoked' || ($k['status'] ?? '') === 'expired') break;
                if (($k['status'] ?? '') !== 'active') break;
                if (!empty($k['machineId']) && ($k['machineId'] ?? '') !== $machineId) break;
                $keys[$i]['machineId'] = $machineId;
                $keys[$i]['lastHeartbeatAt'] = date('c');
                $keys[$i]['lastHeartbeatIp'] = $ip;
                $keys[$i]['lastHeartbeatUa'] = $ua;
                if ($sentAt !== '') $keys[$i]['lastHeartbeatSentAt'] = $sentAt;
                if ($lastActiveAt !== '') $keys[$i]['lastGatewayActiveAt'] = $lastActiveAt;
                if (empty($keys[$i]['activatedAt'])) $keys[$i]['activatedAt'] = date('c');
                if (($keys[$i]['status'] ?? '') !== 'active') $keys[$i]['status'] = 'active';
                saveSubVendoDB($keys);
                break;
            }
        }
        json_response(['ok' => true], 200);
    }

    // SUB VENDO - REVOKE
    if ($endpoint === 'subvendo-revoke') {
        $u = require_session_user();
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $reason = normalize_str($data['reason'] ?? '');
        if ($licenseKey === '') {
            json_response(['success' => false, 'message' => 'Missing license key'], 400);
        }
        $keys = loadSubVendoDB();
        $foundIndex = -1;
        foreach ($keys as $i => $k) {
            if (($k['license'] ?? '') === $licenseKey) { $foundIndex = $i; break; }
        }
        if ($foundIndex === -1) {
            json_response(['success' => false, 'message' => 'License not found'], 404);
        }
        if (($u['role'] ?? '') !== 'admin') {
            $owner = strtolower((string)($keys[$foundIndex]['owner'] ?? ''));
            $a = strtolower((string)($u['name'] ?? ''));
            $b = strtolower((string)($u['email'] ?? ''));
            if ($owner === '' || ($owner !== $a && $owner !== $b)) {
                json_response(['success' => false, 'message' => 'Forbidden'], 403);
            }
            if (($keys[$foundIndex]['status'] ?? '') !== 'active') {
                json_response(['success' => false, 'message' => 'Only active licenses can be revoked'], 400);
            }
        }
        $prevMachine = normalize_str($keys[$foundIndex]['machineId'] ?? '');
        if ($prevMachine !== '') $keys[$foundIndex]['revokedMachineId'] = $prevMachine;
        $keys[$foundIndex]['status'] = 'generated';
        $keys[$foundIndex]['machineId'] = null;
        $keys[$foundIndex]['name'] = 'Unassigned Sub Vendo';
        $keys[$foundIndex]['activatedAt'] = null;
        $keys[$foundIndex]['lastHeartbeatAt'] = null;
        $keys[$foundIndex]['revokedAt'] = date('c');
        $keys[$foundIndex]['resetAt'] = date('c');
        if ($reason !== '') $keys[$foundIndex]['revokedReason'] = $reason;
        saveSubVendoDB($keys);
        $cmds = loadSubVendoCmds();
        $cmds[] = [
            'id' => uniqid('svcmd_', true),
            'type' => 'subvendo_expire',
            'license' => $licenseKey,
            'machineId' => $prevMachine,
            'status' => 'pending',
            'createdAt' => date('c')
        ];
        saveSubVendoCmds($cmds);
        json_response(['success' => true, 'message' => 'Sub Vendo license revoked successfully']);
    }

    // SUB VENDO - TRANSFER (change owner)
    if ($endpoint === 'subvendo-transfer') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $newOwnerInput = normalize_str($data['newOwner'] ?? ($data['owner'] ?? ''));
        if ($licenseKey === '' || $newOwnerInput === '') {
            json_response(['success' => false, 'message' => 'Missing license key or new owner'], 400);
        }

        $keys = loadSubVendoDB();
        $foundIndex = -1;
        foreach ($keys as $i => $k) {
            if (($k['license'] ?? '') === $licenseKey) { $foundIndex = $i; break; }
        }
        if ($foundIndex === -1) {
            json_response(['success' => false, 'message' => 'License not found'], 404);
        }

        $prevOwner = (string)($keys[$foundIndex]['owner'] ?? '');
        $prevOwnerName = (string)($keys[$foundIndex]['ownerName'] ?? $prevOwner);
        $ownerData = normalize_owner_fields($newOwnerInput);

        $keys[$foundIndex]['owner'] = $ownerData['owner'];
        $keys[$foundIndex]['ownerName'] = $ownerData['ownerName'];
        $keys[$foundIndex]['ownerEmail'] = $ownerData['ownerEmail'];
        $keys[$foundIndex]['ownerId'] = $ownerData['ownerId'];
        $keys[$foundIndex]['transferredAt'] = date('c');
        saveSubVendoDB($keys);

        $actor = session_user();
        $log = loadTransferLog();
        $log[] = [
            'id' => uniqid('xfer_', true),
            'type' => 'subvendo',
            'license' => $licenseKey,
            'fromOwner' => $prevOwner,
            'fromOwnerName' => $prevOwnerName,
            'toOwner' => $ownerData['owner'],
            'toOwnerName' => $ownerData['ownerName'],
            'by' => $actor ? (($actor['email'] ?? '') ?: ($actor['name'] ?? '')) : '',
            'at' => date('c')
        ];
        saveTransferLog($log);

        json_response(['success' => true, 'message' => 'Sub Vendo license transferred successfully', 'license' => $keys[$foundIndex]]);
    }

    // SUB VENDO - UNASSIGN/RESET (make reusable)
    if ($endpoint === 'subvendo-unassign') {
        $u = require_session_user();
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        if ($licenseKey === '') {
            json_response(['success' => false, 'message' => 'Missing license key'], 400);
        }

        $keys = loadSubVendoDB();
        $foundIndex = -1;
        foreach ($keys as $i => $k) {
            if (($k['license'] ?? '') === $licenseKey) { $foundIndex = $i; break; }
        }
        if ($foundIndex === -1) {
            json_response(['success' => false, 'message' => 'License not found'], 404);
        }

        if (($u['role'] ?? '') !== 'admin') {
            $owner = strtolower((string)($keys[$foundIndex]['owner'] ?? ''));
            $a = strtolower((string)($u['name'] ?? ''));
            $b = strtolower((string)($u['email'] ?? ''));
            if ($owner === '' || ($owner !== $a && $owner !== $b)) {
                json_response(['success' => false, 'message' => 'Forbidden'], 403);
            }
            if (($keys[$foundIndex]['status'] ?? '') !== 'expired') {
                json_response(['success' => false, 'message' => 'Only expired licenses can be reset by owner'], 400);
            }
            $exp = normalize_str($keys[$foundIndex]['expiry'] ?? '');
            if ($exp !== '') {
                try {
                    if (new DateTime($exp) < new DateTime()) {
                        json_response(['success' => false, 'message' => 'This license is truly expired and cannot be reset'], 400);
                    }
                } catch (Throwable $e) {}
            }
        }

        $keys[$foundIndex]['status'] = 'generated';
        $keys[$foundIndex]['machineId'] = null;
        $keys[$foundIndex]['name'] = 'Unassigned Sub Vendo';
        $keys[$foundIndex]['activatedAt'] = null;
        $keys[$foundIndex]['lastHeartbeatAt'] = null;
        $keys[$foundIndex]['revokedAt'] = null;
        $keys[$foundIndex]['revokedReason'] = null;
        $keys[$foundIndex]['expiredAt'] = null;
        $keys[$foundIndex]['resetAt'] = date('c');
        saveSubVendoDB($keys);
        json_response(['success' => true, 'message' => 'Sub Vendo license unassigned successfully']);
    }


    // 3. ACTIVATE LICENSE (Device calls this)
    if ($endpoint === 'activate') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $machineId = normalize_str($data['system_serial'] ?? ($data['System_Serial'] ?? ($data['machineId'] ?? ($data['hwid'] ?? ($data['serial'] ?? '')))));
        $deviceInfo = $data['deviceInfo'] ?? null;
        
        // Debug Log
        // file_put_contents('debug.log', date('c') . " Activation Request: Key=$licenseKey, Machine=$machineId\n", FILE_APPEND);

        if (!$licenseKey || !$machineId) {
            json_response(['allowed' => false, 'success' => false, 'message' => 'Missing key or machine ID', 'status' => 'bad_request'], 400);
        }

        $licenses = loadDB();
        $foundIndex = -1;
        
        // Search by exact license key
        foreach ($licenses as $index => $l) {
            if ($l['license'] === $licenseKey) {
                $foundIndex = $index;
                break;
            }
        }

        // If not found, try to search if this machine already has ANY license bound
        if ($foundIndex === -1) {
            foreach ($licenses as $index => $l) {
                if (!empty($l['machineId']) && $l['machineId'] === $machineId) {
                    $foundIndex = $index;
                    break;
                }
            }
        }

        if ($foundIndex === -1) {
            json_response(['allowed' => false, 'success' => false, 'message' => 'Invalid License Key', 'status' => 'not_found'], 200);
        }

        $license = $licenses[$foundIndex];

        // Check if bound to another machine
        if (!empty($license['machineId']) && $license['machineId'] !== $machineId) {
            json_response(['allowed' => false, 'success' => false, 'message' => 'License already bound to another device', 'status' => 'bind_failed'], 200);
        }

        // Check expiry
        if (new DateTime($license['expiry']) < new DateTime()) {
            $licenses[$foundIndex]['status'] = 'expired';
            saveDB($licenses);
            json_response(['allowed' => false, 'success' => false, 'message' => 'License has expired', 'status' => 'expired'], 200);
        }

        // Force update status and machineId
        $licenses[$foundIndex]['machineId'] = $machineId;
        $licenses[$foundIndex]['status'] = 'active';
        $licenses[$foundIndex]['name'] = normalize_str($data['device_model'] ?? ($deviceInfo['device_model'] ?? ($deviceInfo['model'] ?? 'OrangePi Zero3')));
        if (empty($licenses[$foundIndex]['activatedAt'])) {
            $licenses[$foundIndex]['activatedAt'] = date('c');
        }
        $licenses[$foundIndex]['deviceInfo'] = $deviceInfo;
        saveDB($licenses);

        $expiryIso = null;
        try {
            $d = new DateTime($licenses[$foundIndex]['expiry'] . ' 23:59:59', new DateTimeZone('UTC'));
            $expiryIso = $d->format(DateTime::ATOM);
        } catch (Exception $e) {
            $expiryIso = (string)$licenses[$foundIndex]['expiry'];
        }

        $plan = license_plan_info($licenses[$foundIndex]['duration'] ?? null);
        if (($plan['duration'] ?? '') === 'lifetime') {
            $expiryIso = 'Never';
        }

        $token = [
            'type' => $plan['type'] ?? 'PAID',
            'owner' => $licenses[$foundIndex]['owner'] ?? 'Customer',
            'expires' => $expiryIso,
            'license_duration' => $plan['duration'],
            'license_duration_months' => $plan['duration_months'],
            'license_plan' => $plan['label'],
            'system_serial' => $machineId,
            'System_Serial' => $machineId,
            'device_model' => normalize_str($data['device_model'] ?? ($deviceInfo['device_model'] ?? ($deviceInfo['model'] ?? ''))) ?: null
        ];
        $signatureData = sign_token($token);
        json_response([
            'allowed' => true,
            'success' => true,
            'message' => 'Activation Successful',
            'status' => 'active',
            'expiry' => $licenses[$foundIndex]['expiry'],
            'owner' => $licenses[$foundIndex]['owner'],
            'token' => $token,
            'token_raw' => $signatureData['payload'],
            'signature' => $signatureData['signature']
        ], 200);
    }

    // 4. VALIDATE LICENSE (Heartbeat)
    if ($endpoint === 'validate' || $endpoint === 'validate-license') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $machineId = normalize_str($data['system_serial'] ?? ($data['System_Serial'] ?? ($data['machineId'] ?? ($data['hwid'] ?? ($data['serial'] ?? '')))));
        
        $licenses = loadDB();
        $license = null;
        
        foreach ($licenses as $l) {
            if ($l['license'] === $licenseKey) {
                $license = $l;
                break;
            }
        }

        if ($license && (($license['status'] ?? '') === 'revoked')) {
            $blocked = normalize_str($license['revokedMachineId'] ?? '');
            if ($blocked !== '' && $blocked === $machineId) {
                json_response(['allowed' => false, 'valid' => false, 'message' => 'Reset - cannot be used on previous device', 'status' => 'revoked'], 200);
            }
            $licenses = loadDB();
            foreach ($licenses as $idx => $l) {
                if (($l['license'] ?? '') === $licenseKey) {
                    $licenses[$idx]['status'] = 'generated';
                    $licenses[$idx]['machineId'] = null;
                    saveDB($licenses);
                    $license = $licenses[$idx];
                    break;
                }
            }
        }

        if (!$license) {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Invalid or Unbound', 'status' => 'unbound'], 200);
        }

        // Auto-bind during validate if license is not yet bound
        if (empty($license['machineId'])) {
            $licenses = loadDB();
            foreach ($licenses as $idx => $l) {
                if ($l['license'] === $licenseKey) {
                    $licenses[$idx]['machineId'] = $machineId;
                    $licenses[$idx]['status'] = 'active';
                    $licenses[$idx]['name'] = normalize_str($data['device_model'] ?? '') ?: ($licenses[$idx]['name'] ?? 'Unassigned Device');
                    if (empty($licenses[$idx]['activatedAt'])) {
                        $licenses[$idx]['activatedAt'] = date('c');
                    }
                    $licenses[$idx]['deviceInfo'] = $data['deviceInfo'] ?? ($licenses[$idx]['deviceInfo'] ?? null);
                    if (!empty($licenses[$idx]['revokedMachineId'])) $licenses[$idx]['revokedMachineId'] = null;
                    saveDB($licenses);
                    $license = $licenses[$idx];
                    break;
                }
            }
        } elseif (($license['machineId'] ?? '') !== $machineId) {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Invalid or Unbound', 'status' => 'unbound'], 200);
        }

        // Auto-fix status if it's not active but machineId matches
        if (($license['status'] ?? '') !== 'active' && ($license['status'] ?? '') !== 'revoked') {
            $licenses = loadDB();
            foreach ($licenses as $idx => $l) {
                if ($l['license'] === $licenseKey) {
                    $licenses[$idx]['status'] = 'active';
                    if (empty($licenses[$idx]['activatedAt'])) {
                        $licenses[$idx]['activatedAt'] = date('c');
                    }
                    if (!empty($licenses[$idx]['revokedMachineId'])) $licenses[$idx]['revokedMachineId'] = null;
                    saveDB($licenses);
                    break;
                }
            }
        }

        if (new DateTime($license['expiry']) < new DateTime()) {
            json_response(['allowed' => false, 'valid' => false, 'message' => 'Expired', 'status' => 'expired'], 200);
        }

        $expiryIso = null;
        try {
            $d = new DateTime($license['expiry'] . ' 23:59:59', new DateTimeZone('UTC'));
            $expiryIso = $d->format(DateTime::ATOM);
        } catch (Exception $e) {
            $expiryIso = (string)$license['expiry'];
        }
        $plan = license_plan_info($license['duration'] ?? null);
        if (($plan['duration'] ?? '') === 'lifetime') {
            $expiryIso = 'Never';
        }
        $token = [
            'type' => $plan['type'] ?? 'PAID',
            'owner' => $license['owner'] ?? 'Customer',
            'expires' => $expiryIso,
            'license_duration' => $plan['duration'],
            'license_duration_months' => $plan['duration_months'],
            'license_plan' => $plan['label'],
            'system_serial' => $machineId,
            'System_Serial' => $machineId,
            'device_model' => normalize_str($data['device_model'] ?? '') ?: null
        ];
        $signatureData = sign_token($token);
        json_response([
            'allowed' => true,
            'valid' => true,
            'status' => 'ok',
            'expiry' => $license['expiry'],
            'token' => $token,
            'token_raw' => $signatureData['payload'],
            'signature' => $signatureData['signature']
        ], 200);
    }

    // 6. HEARTBEAT
    if ($endpoint === 'heartbeat') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? '')));
        $machineId = normalize_str($data['system_serial'] ?? ($data['System_Serial'] ?? ($data['machineId'] ?? ($data['hwid'] ?? ($data['serial'] ?? '')))));

        if ($licenseKey !== '' && $machineId !== '') {
            $licenses = loadDB();
            foreach ($licenses as $idx => $l) {
                if ($l['license'] !== $licenseKey) continue;
                if (($l['status'] ?? '') === 'revoked') {
                    $blocked = normalize_str($l['revokedMachineId'] ?? '');
                    if ($blocked !== '' && $blocked === $machineId) break;
                    $licenses[$idx]['status'] = 'generated';
                    $licenses[$idx]['machineId'] = null;
                }
                if (!empty($l['machineId']) && ($l['machineId'] ?? '') !== $machineId) break;
                $licenses[$idx]['machineId'] = $machineId;
                if (($licenses[$idx]['status'] ?? '') !== 'active') {
                    $licenses[$idx]['status'] = 'active';
                }
                $licenses[$idx]['name'] = normalize_str($data['device_model'] ?? '') ?: ($licenses[$idx]['name'] ?? 'Unassigned Device');
                $licenses[$idx]['lastHeartbeatAt'] = date('c');
                if (empty($licenses[$idx]['activatedAt'])) {
                    $licenses[$idx]['activatedAt'] = date('c');
                }
                if (!empty($licenses[$idx]['revokedMachineId'])) $licenses[$idx]['revokedMachineId'] = null;
                saveDB($licenses);
                break;
            }
        }

        json_response(['ok' => true], 200);
    }

    // 5. TRANSFER LICENSE
    if ($endpoint === 'transfer') {
        $licenseKey = normalize_str($data['licenseKey'] ?? '');
        $newOwnerInput = normalize_str($data['newOwner'] ?? '');
        
        if ($licenseKey === '' || $newOwnerInput === '') {
            json_response(['success' => false, 'message' => 'Missing data'], 400);
        }

        $licenses = loadDB();
        $foundIndex = -1;
        
        foreach ($licenses as $i => $l) {
            if (($l['license'] ?? '') === $licenseKey) { $foundIndex = $i; break; }
        }

        if ($foundIndex === -1) {
            json_response(['success' => false, 'message' => 'License not found'], 404);
        }

        $prevOwner = (string)($licenses[$foundIndex]['owner'] ?? '');
        $prevOwnerName = (string)($licenses[$foundIndex]['ownerName'] ?? $prevOwner);
        $ownerData = normalize_owner_fields($newOwnerInput);

        $licenses[$foundIndex]['owner'] = $ownerData['owner'];
        $licenses[$foundIndex]['ownerName'] = $ownerData['ownerName'];
        $licenses[$foundIndex]['ownerEmail'] = $ownerData['ownerEmail'];
        $licenses[$foundIndex]['ownerId'] = $ownerData['ownerId'];
        $licenses[$foundIndex]['transferredAt'] = date('c');

        $actor = session_user();
        $log = loadTransferLog();
        $log[] = [
            'id' => uniqid('xfer_', true),
            'type' => 'main',
            'license' => $licenseKey,
            'fromOwner' => $prevOwner,
            'fromOwnerName' => $prevOwnerName,
            'toOwner' => $ownerData['owner'],
            'toOwnerName' => $ownerData['ownerName'],
            'by' => $actor ? (($actor['email'] ?? '') ?: ($actor['name'] ?? '')) : '',
            'at' => date('c')
        ];
        saveTransferLog($log);
        saveDB($licenses);

        json_response(['success' => true, 'message' => 'Transferred successfully', 'license' => $licenses[$foundIndex]], 200);
    }

    // 7. REVOKE LICENSE
    if ($endpoint === 'revoke') {
        $licenseKey = normalize_str($data['key'] ?? ($data['license_key'] ?? ''));
        $reason = normalize_str($data['reason'] ?? '');
        
        if (!$licenseKey) {
            json_response(['success' => false, 'message' => 'Missing license key'], 400);
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            if ($l['license'] === $licenseKey) {
                $foundIndex = $index;
                break;
            }
        }

        if ($foundIndex === -1) {
            json_response(['success' => false, 'message' => 'License not found'], 404);
        }

        $prevMachine = normalize_str($licenses[$foundIndex]['machineId'] ?? '');
        if ($prevMachine !== '') $licenses[$foundIndex]['revokedMachineId'] = $prevMachine;
        $licenses[$foundIndex]['status'] = 'generated';
        $licenses[$foundIndex]['machineId'] = null;
        $licenses[$foundIndex]['name'] = 'Unassigned Device';
        $licenses[$foundIndex]['activatedAt'] = null;
        $licenses[$foundIndex]['lastHeartbeatAt'] = null;
        $licenses[$foundIndex]['deviceInfo'] = null;
        $licenses[$foundIndex]['revokedAt'] = date('c');
        $licenses[$foundIndex]['resetAt'] = date('c');
        if ($reason !== '') $licenses[$foundIndex]['revokedReason'] = $reason;
        
        saveDB($licenses);
        json_response(['success' => true, 'message' => 'License reset successfully']);
    }
    // 8. LIST LICENSES (For Admin Panel)
    if ($endpoint === 'list') {
        $licenses = loadDB();
        json_response(['success' => true, 'licenses' => $licenses]);
    }
}

// Default
if ($endpoint === 'list' || $endpoint === 'revoke' || $endpoint === 'transfer') {
    // Already handled inside endpoint logic
} else {
    echo json_encode(['message' => 'NeoFi License API (PHP)']);
}
