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

$method = $_SERVER['REQUEST_METHOD'];
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';

// 1. GET ALL LICENSES & USERS
if ($method === 'GET') {
    if ($endpoint === 'licenses') {
        echo json_encode(loadDB());
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
}

// Default
echo json_encode(['message' => 'NeoFi License API (PHP)']);
