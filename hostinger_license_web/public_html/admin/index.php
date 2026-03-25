<?php
declare(strict_types=1);

require __DIR__ . '/../api/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $token = '';
    if (isset($_GET['token'])) $token = trim((string)$_GET['token']);
    if ($ADMIN_TOKEN !== '' && !hash_equals($ADMIN_TOKEN, $token)) {
        http_response_code(401);
        echo 'Unauthorized';
        exit;
    }
    ?>
    <!doctype html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>NeoFi License Admin</title>
        <style>
            body{font-family:Arial,Helvetica,sans-serif;max-width:980px;margin:20px auto;padding:0 12px}
            input,select,button{padding:10px;font-size:14px}
            table{border-collapse:collapse;width:100%}
            th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}
            th{background:#f5f5f5}
            .row{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
            .row > *{flex:1}
        </style>
    </head>
    <body>
        <h2>NeoFi License Admin</h2>
        <div class="row">
            <input id="license_key" placeholder="License Key (e.g. NEO-XXXX-XXXX-XXXX)">
            <select id="type">
                <option value="PAID">PAID</option>
                <option value="TRIAL">TRIAL</option>
            </select>
            <input id="owner" placeholder="Owner">
            <select id="status">
                <option value="active">active</option>
                <option value="revoked">revoked</option>
            </select>
        </div>
        <div class="row">
            <input id="expires_at" placeholder="Expires At (ms unix) or 0" value="0">
            <input id="bound_serial" placeholder="Bound Serial (optional)">
            <button onclick="save()">Save License</button>
        </div>
        <div class="row">
            <button onclick="load()">Refresh List</button>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Key</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Owner</th>
                    <th>Expires</th>
                    <th>Bound Serial</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="rows"></tbody>
        </table>
        <script>
            const token = new URLSearchParams(location.search).get('token') || '';
            async function api(path, body) {
                const res = await fetch(path + '?token=' + encodeURIComponent(token), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {})
                });
                return await res.json();
            }
            async function load() {
                const data = await api('list.php', {});
                const rows = Array.isArray(data.rows) ? data.rows : [];
                const tbody = document.getElementById('rows');
                tbody.innerHTML = '';
                for (const r of rows) {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${r.license_key || ''}</td>
                        <td>${r.status || ''}</td>
                        <td>${r.type || ''}</td>
                        <td>${r.owner || ''}</td>
                        <td>${r.expires_at || 0}</td>
                        <td>${r.bound_serial || ''}</td>
                        <td>
                            <button onclick="revoke('${r.license_key || ''}')">Revoke</button>
                            <button onclick="unbind('${r.license_key || ''}')">Unbind</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                }
            }
            async function save() {
                const body = {
                    license_key: document.getElementById('license_key').value.trim(),
                    type: document.getElementById('type').value,
                    owner: document.getElementById('owner').value.trim(),
                    status: document.getElementById('status').value,
                    expires_at: Number(document.getElementById('expires_at').value || 0),
                    bound_serial: document.getElementById('bound_serial').value.trim()
                };
                const data = await api('save.php', body);
                alert(JSON.stringify(data));
                await load();
            }
            async function revoke(k) {
                const data = await api('revoke.php', { license_key: k });
                alert(JSON.stringify(data));
                await load();
            }
            async function unbind(k) {
                const data = await api('unbind.php', { license_key: k });
                alert(JSON.stringify(data));
                await load();
            }
            load();
        </script>
    </body>
    </html>
    <?php
    exit;
}

http_response_code(405);
echo 'Method Not Allowed';
