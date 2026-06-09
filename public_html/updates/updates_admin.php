<?php

declare(strict_types=1);

function json_response(int $status, array $data): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function h(string $s): string {
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function require_token(string $token): void {
    $expected = trim((string)getenv('NEOFI_UPDATE_TOKEN'));
    if ($expected === '') {
        json_response(500, ['error' => 'Server missing NEOFI_UPDATE_TOKEN env var']);
    }
    if (!hash_equals($expected, $token)) {
        json_response(401, ['error' => 'Unauthorized']);
    }
}

function base_url(): string {
    $forced = trim((string)getenv('NEOFI_UPDATE_BASE_URL'));
    if ($forced !== '') return rtrim($forced, '/');
    $proto = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $proto . '://' . $host;
}

function safe_filename(string $name): string {
    $name = preg_replace('/[^\w.\-]+/u', '_', $name);
    $name = trim($name, '._');
    if ($name === '') $name = 'update.tar.gz';
    return $name;
}

function read_json_file(string $path, array $fallback): array {
    if (!is_file($path)) return $fallback;
    $raw = file_get_contents($path);
    if ($raw === false) return $fallback;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $fallback;
}

function write_json_file_atomic(string $path, array $data): void {
    $dir = dirname($path);
    if (!is_dir($dir)) {
        if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Failed to create directory: ' . $dir);
        }
    }
    $tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($json === false) throw new RuntimeException('Failed to encode JSON');
    if (file_put_contents($tmp, $json) === false) throw new RuntimeException('Failed to write temp file');
    if (!rename($tmp, $path)) throw new RuntimeException('Failed to replace target file');
}

function sha256_file_hex(string $path): string {
    $hash = hash_file('sha256', $path);
    if ($hash === false) throw new RuntimeException('Failed to hash file');
    return strtolower($hash);
}

$updatesDir = __DIR__;
$packagesDir = $updatesDir . DIRECTORY_SEPARATOR . 'packages';
$indexPath = $packagesDir . DIRECTORY_SEPARATOR . 'index.json';
$manifestPath = $updatesDir . DIRECTORY_SEPARATOR . 'manifest.json';

$action = $_GET['action'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'upload') {
    $token = (string)($_POST['token'] ?? '');
    require_token($token);

    if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
        json_response(400, ['error' => 'Missing file']);
    }
    $f = $_FILES['file'];
    if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        json_response(400, ['error' => 'Upload failed']);
    }

    $version = trim((string)($_POST['version'] ?? ''));
    if ($version === '' || !preg_match('/^\d+\.\d+(\.\d+)?$/', $version)) {
        json_response(400, ['error' => 'Invalid version (use like 1.3 or 1.3.0)']);
    }

    $notes = trim((string)($_POST['notes'] ?? ''));

    if (!is_dir($packagesDir)) {
        if (!mkdir($packagesDir, 0775, true) && !is_dir($packagesDir)) {
            json_response(500, ['error' => 'Failed to create packages directory']);
        }
    }

    $original = safe_filename((string)($f['name'] ?? 'update.tar.gz'));
    $extOk = preg_match('/\.(tar\.gz|tgz|bin)$/i', $original) === 1;
    if (!$extOk) {
        json_response(400, ['error' => 'Invalid file type. Use .tar.gz / .tgz / .bin (tar.gz)']);
    }

    $ts = gmdate('Ymd\THis\Z');
    $storedName = safe_filename('neofi-' . $version . '-' . $ts . '-' . $original);
    $dest = $packagesDir . DIRECTORY_SEPARATOR . $storedName;

    if (!move_uploaded_file((string)$f['tmp_name'], $dest)) {
        json_response(500, ['error' => 'Failed to store uploaded file']);
    }

    $sha256 = sha256_file_hex($dest);
    $size = filesize($dest);
    if ($size === false) $size = null;

    $index = read_json_file($indexPath, ['packages' => []]);
    $list = isset($index['packages']) && is_array($index['packages']) ? $index['packages'] : [];
    $entry = [
        'id' => bin2hex(random_bytes(8)),
        'version' => $version,
        'file' => $storedName,
        'sha256' => $sha256,
        'notes' => $notes,
        'size' => $size,
        'uploaded_at' => gmdate('c')
    ];
    array_unshift($list, $entry);
    $index['packages'] = $list;
    write_json_file_atomic($indexPath, $index);

    json_response(200, ['success' => true, 'package' => $entry]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'publish') {
    $token = (string)($_POST['token'] ?? '');
    require_token($token);

    $packageId = trim((string)($_POST['package_id'] ?? ''));
    if ($packageId === '') json_response(400, ['error' => 'Missing package_id']);

    $rollout = (int)($_POST['rollout_percentage'] ?? 100);
    if ($rollout < 0) $rollout = 0;
    if ($rollout > 100) $rollout = 100;

    $releaseId = trim((string)($_POST['release_id'] ?? ''));
    if ($releaseId === '') $releaseId = gmdate('Y-m-d') . '-' . bin2hex(random_bytes(3));

    $seed = trim((string)($_POST['rollout_seed'] ?? ''));
    if ($seed === '') $seed = $releaseId;

    $index = read_json_file($indexPath, ['packages' => []]);
    $list = isset($index['packages']) && is_array($index['packages']) ? $index['packages'] : [];
    $pkg = null;
    foreach ($list as $p) {
        if (is_array($p) && ($p['id'] ?? '') === $packageId) {
            $pkg = $p;
            break;
        }
    }
    if (!$pkg) json_response(404, ['error' => 'Package not found']);

    $pkgFile = (string)($pkg['file'] ?? '');
    $pkgVersion = (string)($pkg['version'] ?? '');
    $pkgSha = (string)($pkg['sha256'] ?? '');
    if ($pkgFile === '' || $pkgVersion === '' || $pkgSha === '') {
        json_response(500, ['error' => 'Package metadata incomplete']);
    }
    $pkgPath = $packagesDir . DIRECTORY_SEPARATOR . $pkgFile;
    if (!is_file($pkgPath)) json_response(500, ['error' => 'Package file missing on disk']);

    $pkgShaNow = sha256_file_hex($pkgPath);
    if (!hash_equals(strtolower($pkgSha), strtolower($pkgShaNow))) {
        json_response(500, ['error' => 'Package SHA256 mismatch on disk']);
    }

    $url = base_url() . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/packages/' . rawurlencode($pkgFile);
    $manifest = [
        'latest_version' => $pkgVersion,
        'package_url' => $url,
        'sha256' => strtolower($pkgShaNow),
        'notes' => (string)($pkg['notes'] ?? ''),
        'release_id' => $releaseId,
        'rollout_percentage' => $rollout,
        'rollout_seed' => $seed
    ];
    write_json_file_atomic($manifestPath, $manifest);

    json_response(200, ['success' => true, 'manifest' => $manifest]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'list') {
    $index = read_json_file($indexPath, ['packages' => []]);
    $manifest = read_json_file($manifestPath, []);
    json_response(200, [
        'base_url' => base_url(),
        'manifest_url' => base_url() . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/') . '/manifest.json',
        'packages' => $index['packages'] ?? [],
        'current_manifest' => $manifest
    ]);
}

?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NeoFi Updates Admin</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; background: #0b1220; color: #e5e7eb; }
        .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
        .card { background: #111a2e; border: 1px solid #24314f; border-radius: 12px; padding: 16px; margin-bottom: 14px; }
        .row { display: flex; gap: 10px; flex-wrap: wrap; }
        .row > * { flex: 1 1 220px; }
        label { font-size: 12px; color: #93a4c7; display: block; margin-bottom: 6px; }
        input, textarea, select { width: 100%; padding: 10px; border-radius: 10px; border: 1px solid #24314f; background:#0b1220; color:#e5e7eb; }
        textarea { min-height: 90px; resize: vertical; }
        button { padding: 10px 12px; border-radius: 10px; border: 0; cursor: pointer; background: #2563eb; color: #fff; font-weight: 700; }
        button.secondary { background: #334155; }
        button.danger { background: #ef4444; }
        .muted { color: #93a4c7; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border-bottom: 1px solid #24314f; text-align: left; font-size: 13px; }
        th { color: #93a4c7; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
        .pill { display:inline-block; padding: 3px 8px; border-radius: 999px; border: 1px solid #24314f; color:#cbd5e1; font-size: 12px; }
        .ok { border-color:#14532d; color:#86efac; }
        .warn { border-color:#7c2d12; color:#fdba74; }
        .err { border-color:#7f1d1d; color:#fca5a5; }
        .top { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
        .top h1 { margin: 0; font-size: 18px; }
        a { color: #60a5fa; }
    </style>
</head>
<body>
    <div class="wrap">
        <div class="card top">
            <h1>NeoFi Updates Admin</h1>
            <div class="muted">
                Manifest: <a id="manifestLink" href="#" target="_blank" rel="noopener">—</a>
            </div>
        </div>

        <div class="card">
            <div class="row">
                <div>
                    <label>Admin Token (NEOFI_UPDATE_TOKEN)</label>
                    <input id="token" type="password" placeholder="Enter token" />
                    <div class="muted">Store token on server env var. This UI sends it for upload/publish only.</div>
                </div>
                <div>
                    <label>Rollout Percentage</label>
                    <input id="rollout" type="number" min="0" max="100" value="100" />
                    <div class="muted">100 = notify/update all systems. Lower = staged rollout.</div>
                </div>
                <div>
                    <label>Release ID</label>
                    <input id="releaseId" type="text" placeholder="auto" />
                    <div class="muted">Unique ID for rollout. Leave blank to auto-generate.</div>
                </div>
                <div>
                    <label>Rollout Seed</label>
                    <input id="seed" type="text" placeholder="auto (release id)" />
                    <div class="muted">Keep same seed when increasing rollout % for the same release.</div>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="row">
                <div>
                    <label>Version</label>
                    <input id="version" type="text" placeholder="e.g. 1.3.0" />
                </div>
                <div>
                    <label>Update File</label>
                    <input id="file" type="file" accept=".tar.gz,.tgz,.bin" />
                    <div class="muted">Use NeoFi “Create Update (.bin)” or any tar.gz archive.</div>
                </div>
            </div>
            <div style="margin-top:10px;">
                <label>Release Notes</label>
                <textarea id="notes" placeholder="What’s new..."></textarea>
            </div>
            <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                <button onclick="uploadPackage()">Upload Package</button>
                <button class="secondary" onclick="refreshList()">Refresh</button>
                <span id="status" class="muted"></span>
            </div>
        </div>

        <div class="card">
            <div class="top" style="margin-bottom:10px;">
                <div>
                    <div style="font-weight:700;">Packages</div>
                    <div class="muted">Select a package then click Rollout.</div>
                </div>
                <div class="muted" id="currentManifest"></div>
            </div>
            <div style="overflow:auto;">
                <table>
                    <thead>
                        <tr>
                            <th></th>
                            <th>Version</th>
                            <th>File</th>
                            <th>SHA256</th>
                            <th>Uploaded</th>
                        </tr>
                    </thead>
                    <tbody id="rows">
                        <tr><td colspan="5" class="muted">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
            <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
                <button class="danger" onclick="publishSelected()">Rollout / Publish</button>
                <span class="muted">Publishing updates <code>manifest.json</code> so all NeoFi systems can detect it.</span>
            </div>
        </div>
    </div>

    <script>
        let packageList = [];
        let selectedId = null;

        function setStatus(msg) {
            const el = document.getElementById('status');
            if (el) el.textContent = msg || '';
        }

        function qs(id) { return document.getElementById(id); }

        async function refreshList() {
            setStatus('Loading...');
            const res = await fetch('?action=list', { cache: 'no-store' });
            const data = await res.json();
            packageList = Array.isArray(data.packages) ? data.packages : [];

            const m = data.current_manifest || {};
            const manifestUrl = data.manifest_url || '';
            const manifestLink = qs('manifestLink');
            if (manifestLink) {
                manifestLink.href = manifestUrl || '#';
                manifestLink.textContent = manifestUrl || '—';
            }

            const cm = qs('currentManifest');
            if (cm) {
                if (m.latest_version) {
                    cm.innerHTML = `Current manifest: <span class="pill ok">v${m.latest_version}</span> <span class="muted">rollout ${m.rollout_percentage ?? 100}%</span>`;
                } else {
                    cm.innerHTML = `Current manifest: <span class="pill warn">none</span>`;
                }
            }

            const tbody = qs('rows');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (packageList.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="muted">No packages yet.</td></tr>';
                setStatus('');
                return;
            }
            for (const p of packageList) {
                const tr = document.createElement('tr');
                const checked = (p.id === selectedId) ? 'checked' : '';
                tr.innerHTML = `
                    <td><input type="radio" name="pkg" ${checked}></td>
                    <td>${p.version || '—'}</td>
                    <td><a href="packages/${encodeURIComponent(p.file || '')}" target="_blank" rel="noopener">${p.file || '—'}</a></td>
                    <td style="font-family:monospace; font-size:12px;">${(p.sha256 || '').slice(0, 16)}…</td>
                    <td>${p.uploaded_at || '—'}</td>
                `;
                tr.addEventListener('click', () => {
                    selectedId = p.id;
                    refreshList();
                });
                tbody.appendChild(tr);
            }
            setStatus('');
        }

        async function uploadPackage() {
            const token = (qs('token').value || '').trim();
            const version = (qs('version').value || '').trim();
            const notes = (qs('notes').value || '').trim();
            const fileEl = qs('file');
            const file = fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;
            if (!token) return alert('Token required');
            if (!version) return alert('Version required');
            if (!file) return alert('File required');

            setStatus('Uploading...');
            const form = new FormData();
            form.append('token', token);
            form.append('version', version);
            form.append('notes', notes);
            form.append('file', file);
            const res = await fetch('?action=upload', { method: 'POST', body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus('');
                alert(data.error || 'Upload failed');
                return;
            }
            qs('version').value = '';
            qs('notes').value = '';
            if (fileEl) fileEl.value = '';
            selectedId = data.package && data.package.id ? data.package.id : selectedId;
            await refreshList();
            setStatus('Uploaded.');
        }

        async function publishSelected() {
            const token = (qs('token').value || '').trim();
            if (!token) return alert('Token required');
            if (!selectedId) return alert('Select a package first');

            const rollout = parseInt((qs('rollout').value || '100'), 10);
            const releaseId = (qs('releaseId').value || '').trim();
            const seed = (qs('seed').value || '').trim();

            if (!confirm('Publish rollout now? This will update manifest.json and notify systems.')) return;

            setStatus('Publishing...');
            const form = new URLSearchParams();
            form.set('token', token);
            form.set('package_id', selectedId);
            form.set('rollout_percentage', String(isFinite(rollout) ? rollout : 100));
            if (releaseId) form.set('release_id', releaseId);
            if (seed) form.set('rollout_seed', seed);

            const res = await fetch('?action=publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString()
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setStatus('');
                alert(data.error || 'Publish failed');
                return;
            }
            await refreshList();
            setStatus('Published.');
        }

        refreshList();
    </script>
</body>
</html>

