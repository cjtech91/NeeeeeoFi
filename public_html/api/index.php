<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

// Define database files
$dbFile = 'db.json';
$usersFile = 'users.json';

// Initialize DBs if not exists
if (!file_exists($dbFile)) {
    file_put_contents($dbFile, json_encode([]));
}
if (!file_exists($usersFile)) {
    // Create default admin if users.json is missing
    $defaultAdmin = [
        [
            'id' => uniqid(),
            'name' => 'Admin User',
            'email' => 'smileradiosantafe@gmail.com',
            'password' => 'Hope@7777', // In real app, hash this!
            'role' => 'admin',
            'createdAt' => date('c')
        ]
    ];
    file_put_contents($usersFile, json_encode($defaultAdmin, JSON_PRETTY_PRINT));
}

// Helper to get input data
$data = json_decode(file_get_contents('php://input'), true);

// Helper to load DB
function loadDB() {
    global $dbFile;
    $content = file_get_contents($dbFile);
    return json_decode($content, true) ?? [];
}

function loadUsers() {
    global $usersFile;
    $content = file_get_contents($usersFile);
    return json_decode($content, true) ?? [];
}

// Helper to save DB
function saveDB($data) {
    global $dbFile;
    file_put_contents($dbFile, json_encode($data, JSON_PRETTY_PRINT));
}

function saveUsers($data) {
    global $usersFile;
    file_put_contents($usersFile, json_encode($data, JSON_PRETTY_PRINT));
}

function isSubVendoKey($license) {
    if (!is_string($license)) return false;
    return preg_match('/^SV[A-Z0-9]{8}$/', strtoupper($license)) === 1;
}

function generateSubVendoKey() {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $key = 'SV';
    for ($i = 0; $i < 8; $i++) {
        $key .= $chars[rand(0, strlen($chars) - 1)];
    }
    return $key;
}

$method = $_SERVER['REQUEST_METHOD'];
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';

// 1. GET ALL LICENSES & USERS
if ($method === 'GET') {
    if ($endpoint === 'licenses') {
        echo json_encode(loadDB());
        exit;
    }
    if ($endpoint === 'list') {
        echo json_encode(['success' => true, 'licenses' => loadDB()]);
        exit;
    }
    if ($endpoint === 'users') {
        // Return users but hide passwords
        $users = loadUsers();
        $safeUsers = array_map(function($u) {
            unset($u['password']);
            return $u;
        }, $users);
        echo json_encode($safeUsers);
        exit;
    }
    if ($endpoint === 'subvendo-list' || $endpoint === 'subvendo-mylist') {
        $all = loadDB();
        $items = array_values(array_filter($all, function($l) {
            $license = $l['license'] ?? '';
            $type = strtoupper((string)($l['type'] ?? ''));
            return isSubVendoKey($license) || $type === 'SUBVENDO' || $type === 'SUB_VENDO';
        }));
        echo json_encode(['success' => true, 'licenses' => $items]);
        exit;
    }
}

// POST REQUESTS
if ($method === 'POST') {

    // LOGIN
    if ($endpoint === 'login') {
        $email = $data['email'] ?? '';
        $password = $data['password'] ?? '';
        
        $users = loadUsers();
        foreach ($users as $u) {
            if ($u['email'] === $email && $u['password'] === $password) {
                unset($u['password']);
                echo json_encode(['success' => true, 'user' => $u]);
                exit;
            }
        }
        echo json_encode(['success' => false, 'message' => 'Invalid credentials']);
        exit;
    }

    // CREATE ADMIN (Admin Only - simplified check)
    if ($endpoint === 'create_admin') {
        $name = $data['name'] ?? '';
        $email = $data['email'] ?? '';
        $password = $data['password'] ?? '';
        
        if (!$name || !$email || !$password) {
            echo json_encode(['success' => false, 'message' => 'All fields required']);
            exit;
        }

        $users = loadUsers();
        
        // Check duplicate
        foreach ($users as $u) {
            if ($u['email'] === $email) {
                echo json_encode(['success' => false, 'message' => 'Email already exists']);
                exit;
            }
        }

        $newAdmin = [
            'id' => uniqid(),
            'name' => $name,
            'email' => $email,
            'password' => $password,
            'role' => 'admin',
            'createdAt' => date('c')
        ];

        $users[] = $newAdmin;
        
        // --- CRITICAL FIX: Save users array back to file ---
        saveUsers($users);
        // ---------------------------------------------------
        
        echo json_encode(['success' => true, 'message' => 'Admin created']);
        exit;
    }
    
    // 2. GENERATE LICENSE
    if ($endpoint === 'generate') {
        $qty = isset($data['qty']) ? intval($data['qty']) : 1;
        $owner = $data['owner'] ?? 'Admin';
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
            
            // Default logic: Expiry is set to +10 years from GENERATION (or will be updated on activation)
            // But since we want "10 years from ACTIVATION", we can set a far future date here 
            // and update it when the user actually activates it.
            // For now, let's just set it to 10 years from now as a placeholder.
            $expiryDate->modify('+10 years');

            $newLicense = [
                'id' => uniqid(),
                'license' => $key,
                'owner' => $owner,
                'name' => 'Unassigned Device',
                'machineId' => null,
                'status' => 'generated',
                'duration' => 120, // 10 years in months
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

    // 2b. GENERATE SUB VENDO KEYS
    if ($endpoint === 'subvendo-generate') {
        $qty = isset($data['qty']) ? intval($data['qty']) : 1;
        if ($qty < 1) $qty = 1;
        $owner = $data['owner'] ?? 'Admin';

        $licenses = loadDB();
        $newLicenses = [];
        $existing = [];
        foreach ($licenses as $l) {
            if (!empty($l['license'])) $existing[strtoupper((string)$l['license'])] = true;
        }

        for ($i = 0; $i < $qty; $i++) {
            $key = generateSubVendoKey();
            $guard = 0;
            while (isset($existing[$key]) && $guard < 50) {
                $key = generateSubVendoKey();
                $guard++;
            }
            $existing[$key] = true;

            $newLicense = [
                'id' => uniqid(),
                'type' => 'SUBVENDO',
                'license' => $key,
                'owner' => $owner,
                'name' => 'Unassigned Sub Vendo',
                'machineId' => null,
                'status' => 'generated',
                'duration' => 'lifetime',
                'expiry' => null,
                'createdAt' => date('c'),
                'deviceInfo' => null
            ];

            array_unshift($licenses, $newLicense);
            $newLicenses[] = $newLicense;
        }

        saveDB($licenses);
        echo json_encode(['success' => true, 'licenses' => $newLicenses]);
        exit;
    }

    // 3. ACTIVATE LICENSE (Device calls this)
    if ($endpoint === 'activate') {
        $licenseKey = $data['licenseKey'] ?? '';
        $machineId = $data['machineId'] ?? '';
        $deviceInfo = $data['deviceInfo'] ?? null;
        
        if (!$licenseKey || !$machineId) {
            echo json_encode(['success' => false, 'message' => 'Missing key or machine ID']);
            exit;
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
            echo json_encode(['success' => false, 'message' => 'Invalid License Key']);
            exit;
        }

        $license = $licenses[$foundIndex];

        // Check if bound to another machine
        if (!empty($license['machineId']) && $license['machineId'] !== $machineId) {
            echo json_encode(['success' => false, 'message' => 'License already bound to another device']);
            exit;
        }

        // Check expiry
        if (new DateTime($license['expiry']) < new DateTime()) {
            $licenses[$foundIndex]['status'] = 'expired';
            saveDB($licenses);
            echo json_encode(['success' => false, 'message' => 'License has expired']);
            exit;
        }

        // Bind if new
        if (empty($license['machineId'])) {
            $licenses[$foundIndex]['machineId'] = $machineId;
            $licenses[$foundIndex]['status'] = 'active';
            $licenses[$foundIndex]['activatedAt'] = date('c');
            $licenses[$foundIndex]['lastHeartbeatAt'] = $licenses[$foundIndex]['activatedAt'];
            $licenses[$foundIndex]['lastHeartbeatIp'] = $_SERVER['REMOTE_ADDR'] ?? null;
            if (isset($licenses[$foundIndex]['name']) && (string)$licenses[$foundIndex]['name'] === 'Unassigned Device') {
                $fallbackName = null;
                if (is_array($deviceInfo)) {
                    $fallbackName = $deviceInfo['hostname'] ?? ($deviceInfo['device_model'] ?? null);
                }
                if (!$fallbackName) $fallbackName = $machineId;
                $licenses[$foundIndex]['name'] = $fallbackName;
            }
            
            // --- UPDATE EXPIRY TO 10 YEARS FROM ACTIVATION DATE ---
            $activationDate = new DateTime();
            $activationDate->modify('+10 years');
            $licenses[$foundIndex]['expiry'] = $activationDate->format('Y-m-d');
            // ------------------------------------------------------

            $licenses[$foundIndex]['deviceInfo'] = $deviceInfo;
            saveDB($licenses);
        }

        echo json_encode([
            'success' => true,
            'message' => 'Activation Successful',
            'status' => 'active',
            'expiry' => $licenses[$foundIndex]['expiry'],
            'owner' => $licenses[$foundIndex]['owner']
        ]);
        exit;
    }

    // 3b. HEARTBEAT (Device calls this periodically)
    if ($endpoint === 'heartbeat') {
        $licenseKey = $data['key'] ?? ($data['licenseKey'] ?? ($data['license_key'] ?? ''));
        $machineId = $data['machineId'] ?? ($data['system_serial'] ?? ($data['hwid'] ?? ($data['machine_id'] ?? '')));

        $licenseKey = trim((string)$licenseKey);
        $machineId = trim((string)$machineId);

        if (!$licenseKey || !$machineId) {
            echo json_encode(['success' => false, 'allowed' => false, 'status' => 'bad_request', 'message' => 'Missing key or machine ID']);
            exit;
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            if (($l['license'] ?? '') === $licenseKey) {
                $foundIndex = $index;
                break;
            }
        }
        if ($foundIndex === -1) {
            echo json_encode(['success' => false, 'allowed' => false, 'status' => 'not_found', 'message' => 'Invalid License Key']);
            exit;
        }

        $license = $licenses[$foundIndex];
        if (!empty($license['machineId']) && $license['machineId'] !== $machineId) {
            echo json_encode(['success' => false, 'allowed' => false, 'status' => 'unbound', 'message' => 'Invalid or Unbound']);
            exit;
        }

        $licenses[$foundIndex]['machineId'] = $machineId;
        $licenses[$foundIndex]['status'] = 'active';
        $licenses[$foundIndex]['lastHeartbeatAt'] = date('c');
        $licenses[$foundIndex]['lastHeartbeatIp'] = $_SERVER['REMOTE_ADDR'] ?? null;

        if (($licenses[$foundIndex]['name'] ?? '') === 'Unassigned Device') {
            $meta = $data['metadata'] ?? null;
            $fallbackName = null;
            if (is_array($meta)) {
                $fallbackName = $meta['device_name'] ?? null;
            }
            if (!$fallbackName) $fallbackName = $machineId;
            $licenses[$foundIndex]['name'] = $fallbackName;
        }

        saveDB($licenses);
        echo json_encode(['success' => true, 'allowed' => true, 'status' => 'ok']);
        exit;
    }

    // 4. VALIDATE LICENSE (Heartbeat)
    if ($endpoint === 'validate') {
        $licenseKey = $data['licenseKey'] ?? '';
        $machineId = $data['machineId'] ?? '';
        
        $licenses = loadDB();
        $license = null;
        
        foreach ($licenses as $l) {
            if ($l['license'] === $licenseKey) {
                $license = $l;
                break;
            }
        }

        if (!$license || $license['machineId'] !== $machineId) {
            echo json_encode(['valid' => false, 'message' => 'Invalid or Unbound']);
            exit;
        }

        if (new DateTime($license['expiry']) < new DateTime()) {
            echo json_encode(['valid' => false, 'message' => 'Expired']);
            exit;
        }

        echo json_encode(['valid' => true, 'expiry' => $license['expiry']]);
        exit;
    }

    if ($endpoint === 'validate-license') {
        $licenseKey = $data['licenseKey'] ?? '';
        $machineId = $data['machineId'] ?? '';

        $licenses = loadDB();
        $license = null;

        foreach ($licenses as $l) {
            if (($l['license'] ?? '') === $licenseKey) {
                $license = $l;
                break;
            }
        }

        if (!$license || $license['machineId'] !== $machineId) {
            echo json_encode(['valid' => false, 'message' => 'Invalid or Unbound']);
            exit;
        }

        if (new DateTime($license['expiry']) < new DateTime()) {
            echo json_encode(['valid' => false, 'message' => 'Expired']);
            exit;
        }

        echo json_encode(['valid' => true, 'expiry' => $license['expiry']]);
        exit;
    }

    if ($endpoint === 'subvendo-activate') {
        $licenseKey = $data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? ''));
        $machineId = $data['system_serial'] ?? ($data['hwid'] ?? ($data['machineId'] ?? ($data['device_id'] ?? '')));
        $deviceInfo = $data['deviceInfo'] ?? null;
        $deviceModel = $data['device_model'] ?? null;

        $licenseKey = strtoupper(trim((string)$licenseKey));
        $machineId = trim((string)$machineId);

        if (!$licenseKey || !$machineId) {
            echo json_encode(['allowed' => false, 'success' => false, 'status' => 'bad_request', 'message' => 'Missing key or machine ID']);
            exit;
        }
        if (!isSubVendoKey($licenseKey)) {
            echo json_encode(['allowed' => false, 'success' => false, 'status' => 'not_found', 'message' => 'Invalid Sub Vendo Key']);
            exit;
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            $lic = strtoupper((string)($l['license'] ?? ''));
            $type = strtoupper((string)($l['type'] ?? ''));
            if ($lic === $licenseKey && (isSubVendoKey($lic) || $type === 'SUBVENDO' || $type === 'SUB_VENDO')) {
                $foundIndex = $index;
                break;
            }
        }
        if ($foundIndex === -1) {
            echo json_encode(['allowed' => false, 'success' => false, 'status' => 'not_found', 'message' => 'Key not found']);
            exit;
        }

        $license = $licenses[$foundIndex];
        if (!empty($license['machineId']) && $license['machineId'] !== $machineId) {
            echo json_encode(['allowed' => false, 'success' => false, 'status' => 'bind_failed', 'message' => 'Key already bound to another device']);
            exit;
        }

        if (empty($license['machineId'])) {
            $licenses[$foundIndex]['machineId'] = $machineId;
            $licenses[$foundIndex]['status'] = 'active';
            $licenses[$foundIndex]['activatedAt'] = date('c');
            $licenses[$foundIndex]['type'] = 'SUBVENDO';
            $licenses[$foundIndex]['duration'] = $licenses[$foundIndex]['duration'] ?? 'lifetime';
            $licenses[$foundIndex]['expiry'] = null;
            $licenses[$foundIndex]['deviceInfo'] = $deviceInfo;
            $licenses[$foundIndex]['lastHeartbeatAt'] = $licenses[$foundIndex]['activatedAt'];
            $licenses[$foundIndex]['lastHeartbeatIp'] = $_SERVER['REMOTE_ADDR'] ?? null;
            $name = $licenses[$foundIndex]['name'] ?? '';
            if (!$name || stripos((string)$name, 'Unassigned') !== false) {
                $newName = null;
                if (is_array($deviceInfo)) $newName = $deviceInfo['name'] ?? ($deviceInfo['hostname'] ?? null);
                if (!$newName && is_string($deviceModel) && trim($deviceModel) !== '') $newName = trim($deviceModel);
                if (!$newName) $newName = $machineId;
                $licenses[$foundIndex]['name'] = $newName;
            }
            saveDB($licenses);
        }

        echo json_encode([
            'allowed' => true,
            'success' => true,
            'status' => 'active',
            'message' => 'Activation Successful',
            'owner' => $licenses[$foundIndex]['owner'] ?? null,
            'expiry' => $licenses[$foundIndex]['expiry'] ?? null
        ]);
        exit;
    }

    if ($endpoint === 'subvendo-validate-license') {
        $licenseKey = $data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? ''));
        $machineId = $data['system_serial'] ?? ($data['hwid'] ?? ($data['machineId'] ?? ($data['device_id'] ?? '')));

        $licenseKey = strtoupper(trim((string)$licenseKey));
        $machineId = trim((string)$machineId);

        if (!$licenseKey || !$machineId) {
            echo json_encode(['allowed' => false, 'valid' => false, 'status' => 'bad_request', 'message' => 'Missing key or machine ID']);
            exit;
        }

        $licenses = loadDB();
        $license = null;
        foreach ($licenses as $l) {
            $lic = strtoupper((string)($l['license'] ?? ''));
            $type = strtoupper((string)($l['type'] ?? ''));
            if ($lic === $licenseKey && (isSubVendoKey($lic) || $type === 'SUBVENDO' || $type === 'SUB_VENDO')) {
                $license = $l;
                break;
            }
        }

        if (!$license) {
            echo json_encode(['allowed' => false, 'valid' => false, 'status' => 'not_found', 'message' => 'Key not found']);
            exit;
        }

        $st = strtolower((string)($license['status'] ?? ''));
        if ($st === 'revoked') {
            echo json_encode(['allowed' => false, 'valid' => false, 'status' => 'revoked', 'message' => 'Revoked']);
            exit;
        }

        if (empty($license['machineId']) || $license['machineId'] !== $machineId) {
            echo json_encode(['allowed' => false, 'valid' => false, 'status' => 'unbound', 'message' => 'Invalid or Unbound']);
            exit;
        }

        echo json_encode(['allowed' => true, 'valid' => true, 'status' => 'active', 'message' => 'ok', 'expiry' => $license['expiry'] ?? null]);
        exit;
    }

    if ($endpoint === 'subvendo-heartbeat') {
        $licenseKey = $data['key'] ?? ($data['license_key'] ?? ($data['licenseKey'] ?? ''));
        $machineId = $data['system_serial'] ?? ($data['hwid'] ?? ($data['machineId'] ?? ($data['device_id'] ?? '')));
        $lastActiveAt = $data['lastActiveAt'] ?? null;

        $licenseKey = strtoupper(trim((string)$licenseKey));
        $machineId = trim((string)$machineId);

        if (!$licenseKey || !$machineId) {
            echo json_encode(['success' => false, 'allowed' => false, 'status' => 'bad_request', 'message' => 'Missing key or machine ID']);
            exit;
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            $lic = strtoupper((string)($l['license'] ?? ''));
            $type = strtoupper((string)($l['type'] ?? ''));
            if ($lic === $licenseKey && (isSubVendoKey($lic) || $type === 'SUBVENDO' || $type === 'SUB_VENDO')) {
                $foundIndex = $index;
                break;
            }
        }
        if ($foundIndex === -1) {
            echo json_encode(['success' => false, 'allowed' => false, 'status' => 'not_found', 'message' => 'Key not found']);
            exit;
        }

        if (!empty($licenses[$foundIndex]['machineId']) && $licenses[$foundIndex]['machineId'] !== $machineId) {
            echo json_encode(['success' => false, 'allowed' => false, 'status' => 'unbound', 'message' => 'Invalid or Unbound']);
            exit;
        }

        $licenses[$foundIndex]['lastHeartbeatAt'] = date('c');
        $licenses[$foundIndex]['lastHeartbeatIp'] = $_SERVER['REMOTE_ADDR'] ?? null;
        if ($lastActiveAt) $licenses[$foundIndex]['lastActiveAt'] = $lastActiveAt;
        saveDB($licenses);
        echo json_encode(['success' => true, 'allowed' => true, 'status' => 'ok']);
        exit;
    }

    if ($endpoint === 'subvendo-commands-pull') {
        echo json_encode(['success' => true, 'commands' => []]);
        exit;
    }

    if ($endpoint === 'subvendo-commands-ack') {
        echo json_encode(['success' => true]);
        exit;
    }

    if ($endpoint === 'subvendo-unassign') {
        $licenseKey = $data['key'] ?? ($data['licenseKey'] ?? '');
        $licenseKey = strtoupper(trim((string)$licenseKey));
        if (!$licenseKey) {
            echo json_encode(['success' => false, 'message' => 'Missing key']);
            exit;
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            $lic = strtoupper((string)($l['license'] ?? ''));
            $type = strtoupper((string)($l['type'] ?? ''));
            if ($lic === $licenseKey && (isSubVendoKey($lic) || $type === 'SUBVENDO' || $type === 'SUB_VENDO')) {
                $foundIndex = $index;
                break;
            }
        }
        if ($foundIndex === -1) {
            echo json_encode(['success' => false, 'message' => 'Key not found']);
            exit;
        }

        $licenses[$foundIndex]['machineId'] = null;
        $licenses[$foundIndex]['status'] = 'generated';
        $licenses[$foundIndex]['unassignedAt'] = date('c');
        saveDB($licenses);
        echo json_encode(['success' => true, 'license' => $licenses[$foundIndex]]);
        exit;
    }

    // 5. TRANSFER LICENSE
    if ($endpoint === 'transfer') {
        $licenseKey = $data['licenseKey'] ?? '';
        $newOwner = $data['newOwner'] ?? '';
        
        if (!$licenseKey || !$newOwner) {
            echo json_encode(['success' => false, 'message' => 'Missing data']);
            exit;
        }

        $licenses = loadDB();
        $found = false;
        
        foreach ($licenses as $i => $l) {
            if ($l['license'] === $licenseKey) {
                $licenses[$i]['owner'] = $newOwner;
                $found = true;
                break;
            }
        }

        if ($found) {
            saveDB($licenses);
            echo json_encode(['success' => true, 'message' => 'Transferred successfully']);
        } else {
            echo json_encode(['success' => false, 'message' => 'License not found']);
        }
        exit;
    }

    // 6. REVOKE LICENSE
    if ($endpoint === 'revoke') {
        $licenseKey = $data['key'] ?? ($data['licenseKey'] ?? '');
        $reason = trim((string)($data['reason'] ?? ''));
        if (!$licenseKey) {
            echo json_encode(['success' => false, 'message' => 'Missing license key']);
            exit;
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
            echo json_encode(['success' => false, 'message' => 'License not found']);
            exit;
        }

        $licenses[$foundIndex]['status'] = 'revoked';
        $licenses[$foundIndex]['machineId'] = null;
        $licenses[$foundIndex]['revokedAt'] = date('c');
        if ($reason !== '') {
            $licenses[$foundIndex]['revokedReason'] = $reason;
        }
        saveDB($licenses);

        echo json_encode(['success' => true, 'message' => 'License revoked']);
        exit;
    }

    // 6b. REVOKE SUB VENDO KEY
    if ($endpoint === 'subvendo-revoke') {
        $licenseKey = $data['key'] ?? ($data['licenseKey'] ?? '');
        $reason = trim((string)($data['reason'] ?? ''));
        if (!$licenseKey) {
            echo json_encode(['success' => false, 'message' => 'Missing key']);
            exit;
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            $lic = strtoupper((string)($l['license'] ?? ''));
            $type = strtoupper((string)($l['type'] ?? ''));
            if ($lic === strtoupper((string)$licenseKey) && (isSubVendoKey($lic) || $type === 'SUBVENDO' || $type === 'SUB_VENDO')) {
                $foundIndex = $index;
                break;
            }
        }
        if ($foundIndex === -1) {
            echo json_encode(['success' => false, 'message' => 'Key not found']);
            exit;
        }

        $licenses[$foundIndex]['status'] = 'revoked';
        $licenses[$foundIndex]['machineId'] = null;
        $licenses[$foundIndex]['revokedAt'] = date('c');
        if ($reason !== '') $licenses[$foundIndex]['revokedReason'] = $reason;
        saveDB($licenses);

        echo json_encode(['success' => true, 'message' => 'Sub Vendo key revoked', 'license' => $licenses[$foundIndex]]);
        exit;
    }

    // 7. TRANSFER SUB VENDO KEY
    if ($endpoint === 'subvendo-transfer') {
        $licenseKey = $data['key'] ?? ($data['licenseKey'] ?? '');
        $newOwner = $data['newOwner'] ?? '';
        if (!$licenseKey || !$newOwner) {
            echo json_encode(['success' => false, 'message' => 'Missing data']);
            exit;
        }

        $licenses = loadDB();
        $foundIndex = -1;
        foreach ($licenses as $index => $l) {
            $lic = strtoupper((string)($l['license'] ?? ''));
            $type = strtoupper((string)($l['type'] ?? ''));
            if ($lic === strtoupper((string)$licenseKey) && (isSubVendoKey($lic) || $type === 'SUBVENDO' || $type === 'SUB_VENDO')) {
                $foundIndex = $index;
                break;
            }
        }

        if ($foundIndex === -1) {
            echo json_encode(['success' => false, 'message' => 'Key not found']);
            exit;
        }

        $licenses[$foundIndex]['owner'] = $newOwner;
        $licenses[$foundIndex]['updatedAt'] = date('c');
        saveDB($licenses);
        echo json_encode(['success' => true, 'message' => 'Transferred successfully', 'license' => $licenses[$foundIndex]]);
        exit;
    }
}

// Default
echo json_encode(['message' => 'NeoFi License API (PHP)']);
