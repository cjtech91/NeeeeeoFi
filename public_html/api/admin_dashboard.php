<?php
// Define the API URL
$apiUrl = 'index.php';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NeoFi License Admin Panel</title>
    <style>
        :root {
            --bg: #0f172a;
            --card: #1e293b;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --primary: #3b82f6;
            --danger: #ef4444;
            --success: #22c55e;
            --border: #334155;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }
        .header h1 {
            margin: 0;
            font-size: 1.8rem;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .card {
            background-color: var(--card);
            padding: 20px;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
        .stat-card h3 {
            margin: 0;
            font-size: 0.9rem;
            color: var(--text-muted);
            text-transform: uppercase;
        }
        .stat-card p {
            margin: 10px 0 0;
            font-size: 2rem;
            font-weight: bold;
        }
        .license-table {
            width: 100%;
            border-collapse: collapse;
            background-color: var(--card);
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--border);
        }
        .license-table th, .license-table td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        .license-table th {
            background-color: rgba(0,0,0,0.2);
            color: var(--text-muted);
            font-weight: 600;
            font-size: 0.85rem;
            text-transform: uppercase;
        }
        .status-badge {
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .status-active { background: rgba(34, 197, 94, 0.2); color: var(--success); }
        .status-ready { background: rgba(59, 130, 246, 0.2); color: var(--primary); }
        .status-revoked { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
        
        .btn {
            padding: 8px 12px;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 600;
            transition: opacity 0.2s;
        }
        .btn:hover { opacity: 0.8; }
        .btn-danger { background-color: var(--danger); color: white; }
        .btn-refresh { background-color: var(--primary); color: white; }
        
        .license-key {
            color: var(--primary);
            font-family: monospace;
            font-weight: bold;
        }
        .device-info {
            font-size: 0.9rem;
        }
        .device-serial {
            font-size: 0.75rem;
            color: var(--text-muted);
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>Peso Wifi Admin Panel</h1>
                <p style="color: var(--text-muted); margin: 5px 0 0;">System Management & License Control</p>
            </div>
            <button class="btn btn-refresh" onclick="fetchLicenses()">Refresh Data</button>
        </div>

        <div class="stats">
            <div class="card stat-card">
                <h3>Total Licenses</h3>
                <p id="stat-total">0</p>
            </div>
            <div class="card stat-card">
                <h3>Used Licenses</h3>
                <p id="stat-used" style="color: var(--success)">0</p>
            </div>
            <div class="card stat-card">
                <h3>Unused Licenses</h3>
                <p id="stat-unused" style="color: var(--primary)">0</p>
            </div>
        </div>

        <div class="card" style="padding: 0;">
            <table class="license-table">
                <thead>
                    <tr>
                        <th>Device / Machine ID</th>
                        <th>License Key</th>
                        <th>Owner</th>
                        <th>Status</th>
                        <th>Expiry</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="license-list">
                    <!-- Data will be loaded here -->
                </tbody>
            </table>
        </div>
    </div>

    <script>
        async function fetchLicenses() {
            try {
                const res = await fetch('index.php?endpoint=list');
                const data = await res.json();
                if (data.success) {
                    renderLicenses(data.licenses);
                }
            } catch (e) {
                console.error('Failed to fetch licenses', e);
            }
        }

        function renderLicenses(licenses) {
            const list = document.getElementById('license-list');
            list.innerHTML = '';
            
            let used = 0;
            let unused = 0;

            licenses.forEach(l => {
                const isOnline = l.status === 'active' || l.status === 'online';
                if (isOnline) used++; else unused++;

                const row = document.createElement('tr');
                
                const statusClass = l.status === 'active' || l.status === 'online' ? 'status-active' : 
                                   (l.status === 'revoked' ? 'status-revoked' : 'status-ready');
                
                const statusLabel = l.status.charAt(0).toUpperCase() + l.status.slice(1);

                row.innerHTML = `
                    <td>
                        <div class="device-info">
                            <strong>${l.name || 'Unassigned Device'}</strong>
                            <span class="device-serial">${l.machineId || 'Pending'}</span>
                        </div>
                    </td>
                    <td><span class="license-key">${l.license}</span></td>
                    <td>${l.owner || 'Admin User'}</td>
                    <td><span class="status-badge ${statusClass}">${l.status === 'active' ? 'Online' : statusLabel}</span></td>
                    <td>${l.expiry}</td>
                    <td>
                        ${(l.status === 'active' || l.status === 'online') ? 
                            `<button class="btn btn-danger" onclick="revokeLicense('${l.license}')">Revoke</button>` : 
                            '--'}
                    </td>
                `;
                list.appendChild(row);
            });

            document.getElementById('stat-total').textContent = licenses.length;
            document.getElementById('stat-used').textContent = used;
            document.getElementById('stat-unused').textContent = unused;
        }

        async function revokeLicense(key) {
            if (!confirm(`Are you sure you want to revoke license ${key}? This will automatically remove the license from the NeoFi device.`)) {
                return;
            }

            try {
                const res = await fetch('index.php?endpoint=revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: key })
                });
                const data = await res.json();
                if (data.success) {
                    alert('License revoked successfully!');
                    fetchLicenses();
                } else {
                    alert('Failed to revoke: ' + data.message);
                }
            } catch (e) {
                alert('Error revoking license');
            }
        }

        // Initial load
        fetchLicenses();
    </script>
</body>
</html>
