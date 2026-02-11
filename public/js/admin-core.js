// Extracted from admin.html


        // Optional: Add simple placeholder if Chart is missing
        if (typeof Chart === 'undefined') {
             console.warn('Chart.js not found locally. Charts will be disabled.');
        }



        // --- Rates Management ---
        async function loadRatesData() {
            try {
                const res = await fetch('/api/admin/rates');
                const rates = await res.json();
                const tbody = document.querySelector('#rates-table tbody');
                tbody.innerHTML = '';
                
                rates.forEach(r => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>₱${r.amount}</td>
                        <td>${r.minutes} m</td>
                        <td>
                            <div style="font-size:0.8rem;">UL: ${(r.upload_speed/1024).toFixed(1)} Mbps</div>
                            <div style="font-size:0.8rem;">DL: ${(r.download_speed/1024).toFixed(1)} Mbps</div>
                        </td>
                        <td>${r.is_pausable ? '<span class="badge badge-success">Pausable</span>' : '<span class="badge">One-time</span>'}</td>
                        <td>
                            <button class="btn btn-sm" onclick='openRateModal(${JSON.stringify(r)})' style="background:#f39c12; color:white;">Edit</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteRate(${r.id})">Delete</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Rates load error", e);
            }
        }

        function openRateModal(rate = null) {
            const modal = document.getElementById('rate-modal');
            const idInput = document.getElementById('rate-id');
            const amountInput = document.getElementById('rate-amount');
            const minutesInput = document.getElementById('rate-minutes');
            const ulInput = document.getElementById('rate-ul');
            const dlInput = document.getElementById('rate-dl');
            const pausableInput = document.getElementById('rate-pausable');
            
            if (rate) {
                idInput.value = rate.id;
                amountInput.value = rate.amount;
                minutesInput.value = rate.minutes;
                ulInput.value = rate.upload_speed;
                dlInput.value = rate.download_speed;
                pausableInput.checked = !!rate.is_pausable;
            } else {
                idInput.value = '';
                amountInput.value = '';
                minutesInput.value = '';
                ulInput.value = 5120;
                dlInput.value = 5120;
                pausableInput.checked = true;
            }
            modal.style.display = 'flex';
        }

        async function saveRate() {
            const rate = {
                id: document.getElementById('rate-id').value || null,
                amount: parseInt(document.getElementById('rate-amount').value),
                minutes: parseInt(document.getElementById('rate-minutes').value),
                upload_speed: parseInt(document.getElementById('rate-ul').value),
                download_speed: parseInt(document.getElementById('rate-dl').value),
                is_pausable: document.getElementById('rate-pausable').checked ? 1 : 0
            };
            
            if (!rate.amount || !rate.minutes) return alert('Amount and Minutes are required');
            
            await fetch('/api/admin/rates', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(rate)
            });
            
            document.getElementById('rate-modal').style.display = 'none';
            loadRatesData();
        }

        async function deleteRate(id) {
            if(!await showConfirm('Are you sure you want to delete this rate?', true)) return;
            await fetch('/api/admin/rates/' + id, { method: 'DELETE' });
            loadRatesData();
        }
        // Helper for display
        function formatDuration(totalMinutes) {
            const d = Math.floor(totalMinutes / 1440);
            const h = Math.floor((totalMinutes % 1440) / 60);
            const m = totalMinutes % 60;
            const parts = [];
            if (d > 0) parts.push(d + 'd');
            if (h > 0) parts.push(h + 'h');
            if (m > 0 || parts.length === 0) parts.push(m + 'm');
            return parts.join(' ');
        }

        // --- Rates Management ---
        async function loadRatesData() {
            try {
                const res = await fetch('/api/admin/rates');
                const rates = await res.json();
                const tbody = document.querySelector('#rates-table tbody');
                tbody.innerHTML = '';

                if (rates.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No rates configured</td></tr>';
                    return;
                }

                rates.forEach(rate => {
                    const tr = document.createElement('tr');
                    // Check if speed is stored in kbps and display in Mbps if suitable
                    const uploadMbps = (rate.upload_speed >= 1024) ? (rate.upload_speed / 1024).toFixed(1) + ' Mbps' : rate.upload_speed + ' Kbps';
                    const downloadMbps = (rate.download_speed >= 1024) ? (rate.download_speed / 1024).toFixed(1) + ' Mbps' : rate.download_speed + ' Kbps';
                    
                    tr.innerHTML = `
                        <td>₱${rate.amount}</td>
                        <td>${formatDuration(rate.minutes)}</td>
                        <td>${uploadMbps} / ${downloadMbps}</td>
                        <td>${rate.is_pausable ? '<span class="badge bg-success">Pausable</span>' : '<span class="badge bg-secondary">Continuous</span>'}</td>
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="deleteRate(${rate.id})">Delete</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error('Error loading rates:', e);
            }
        }

        function openRateModal(rate) {
            const modal = document.getElementById('rate-modal');
            const idInput = document.getElementById('rate-id');
            const amountInput = document.getElementById('rate-amount');
            const daysInput = document.getElementById('rate-days');
            const hoursInput = document.getElementById('rate-hours');
            const minutesInput = document.getElementById('rate-minutes');
            const ulInput = document.getElementById('rate-ul');
            const dlInput = document.getElementById('rate-dl');
            const pausableInput = document.getElementById('rate-pausable');

            if (rate && typeof rate === 'object') {
                idInput.value = rate.id || '';
                amountInput.value = rate.amount != null ? rate.amount : '';

                const totalMinutes = parseInt(rate.minutes, 10) || 0;
                const d = Math.floor(totalMinutes / 1440);
                const h = Math.floor((totalMinutes % 1440) / 60);
                const m = totalMinutes % 60;
                daysInput.value = d;
                hoursInput.value = h;
                minutesInput.value = m;

                const upKbps = Number(rate.upload_speed) || 5120;
                const downKbps = Number(rate.download_speed) || 5120;
                ulInput.value = (upKbps / 1024).toFixed(1);
                dlInput.value = (downKbps / 1024).toFixed(1);

                pausableInput.checked = !!rate.is_pausable;
            } else {
                idInput.value = '';
                amountInput.value = '';
                daysInput.value = 0;
                hoursInput.value = 0;
                minutesInput.value = 15;
                ulInput.value = 5;
                dlInput.value = 5;
                pausableInput.checked = true;
            }

            modal.style.display = 'flex';
        }

        function closeRateModal() {
            document.getElementById('rate-modal').style.display = 'none';
        }

        async function saveRate() {
            const amount = document.getElementById('rate-amount').value;
            
            const days = parseInt(document.getElementById('rate-days').value) || 0;
            const hours = parseInt(document.getElementById('rate-hours').value) || 0;
            const minutes = parseInt(document.getElementById('rate-minutes').value) || 0;
            const totalMinutes = (days * 1440) + (hours * 60) + minutes;

            const uploadMbps = parseFloat(document.getElementById('rate-ul').value);
            const downloadMbps = parseFloat(document.getElementById('rate-dl').value);
            const isPausable = document.getElementById('rate-pausable').checked;

            if (!amount || totalMinutes <= 0 || !uploadMbps || !downloadMbps) {
                alert('Please fill in all fields. Duration must be greater than 0.');
                return;
            }

            const data = {
                amount: parseInt(amount),
                minutes: totalMinutes,
                upload_speed: Math.round(uploadMbps * 1024),
                download_speed: Math.round(downloadMbps * 1024),
                is_pausable: isPausable ? 1 : 0
            };

            try {
                const res = await fetch('/api/admin/rates', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                if (res.ok) {
                    closeRateModal();
                    loadRatesData();
                    try {
                        if (currentSubVendoDeviceId) {
                            populateSubVendoDeviceRates(currentSubVendoDeviceId);
                        }
                    } catch (e) {}
                    alert('Rate saved successfully');
                } else {
                    const err = await res.json();
                    alert('Error: ' + err.error);
                }
            } catch (e) {
                console.error(e);
                alert('Failed to save rate');
            }
        }

        // --- Devices Management ---
        async function loadDevicesData() {
            try {
                const res = await fetch('/api/admin/devices');
                if (!res.ok) throw new Error(`API Error: ${res.status}`);
                
                const devices = await res.json();
                if (!Array.isArray(devices)) return;

                const tbody = document.querySelector('#devices-table tbody');
                tbody.innerHTML = '';

                if (devices.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">No devices found</td></tr>';
                    return;
                }

                devices.forEach(dev => {
                    const tr = document.createElement('tr');
                    
                    // Format time remaining
                    let timeDisplay = 'Expired';
                    if (dev.time_remaining > 0) {
                        // Reuse existing helper, expects minutes
                        timeDisplay = formatDuration(Math.ceil(dev.time_remaining / 60)); 
                    }

                    // Status Badge
                    let statusBadge = '<span class="badge bg-secondary">Offline</span>';
                    if (dev.is_connected) {
                        statusBadge = dev.is_paused 
                            ? '<span class="badge bg-warning">Paused</span>' 
                            : '<span class="badge bg-success">Connected</span>';
                    }

                    // Traffic Stats
                    const dl = formatBytes(dev.total_data_down || 0);
                    const ul = formatBytes(dev.total_data_up || 0);
                    
                    const toMbps = (bytes) => ((bytes || 0) * 8 / 1000000).toFixed(2);
                    const dlSpeed = dev.current_speed ? toMbps(dev.current_speed.dl_speed) : '0.00';
                    const ulSpeed = dev.current_speed ? toMbps(dev.current_speed.ul_speed) : '0.00';

                    tr.innerHTML = `
                        <td>${dev.mac_address}</td>
                        <td>${(dev.ip_address || 'N/A').replace('::ffff:', '')}</td>
                        <td>${timeDisplay}</td>
                        <td>
                            <div style="font-size:0.85rem;"><span style="color:#2ecc71;">↓</span> ${dl} <span style="font-weight:bold; color:#27ae60;">(${dlSpeed} Mbps)</span></div>
                            <div style="font-size:0.85rem;"><span style="color:#3498db;">↑</span> ${ul} <span style="font-weight:bold; color:#2980b9;">(${ulSpeed} Mbps)</span></div>
                        </td>
                        <td>${statusBadge}</td>
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="disconnectDevice(${dev.id})">Disconnect</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error('Error loading devices:', e);
            }
        }

        async function disconnectDevice(id) {
            if (!await showConfirm('Are you sure you want to disconnect and remove this device?', true)) return;
            try {
                const res = await fetch(`/api/admin/devices/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    loadDevicesData();
                } else {
                    alert('Failed to disconnect device');
                }
            } catch (e) {
                console.error(e);
                alert('Error disconnecting device');
            }
        }

        async function deleteRate(id) {
            if (!await showConfirm('Are you sure you want to delete this rate?', true)) return;

            try {
                const res = await fetch(`/api/admin/rates/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    loadRatesData();
                } else {
                    alert('Failed to delete rate');
                }
            } catch (e) {
                console.error(e);
                alert('Error deleting rate');
            }
        }
        // --- QoS Logic ---
        function formatBytes(bytes, decimals = 2) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const dm = decimals < 0 ? 0 : decimals;
            const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
        }

        function loadQoSUsers() {
            fetch('/api/admin/dashboard')
                .then(res => res.json())
                .then(data => {
                    const tbody = document.querySelector('#qos-users-table tbody');
                    tbody.innerHTML = '';
                    if (!data.active_sessions || data.active_sessions.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No active users</td></tr>';
                        return;
                    }
                    
                    data.active_sessions.forEach(user => {
                        const tr = document.createElement('tr');
                        // Rate is in Mbps, convert to readable
                        // Traffic is in bytes
                        const dlRate = (user.rate_down || 0).toFixed(2) + ' Mbps';
                        const ulRate = (user.rate_up || 0).toFixed(2) + ' Mbps';
                        const dlTotal = formatBytes(user.traffic_down || 0);
                        const ulTotal = formatBytes(user.traffic_up || 0);

                        tr.innerHTML = `
                            <td>${user.ip}</td>
                            <td>${user.mac}</td>
                            <td>
                                <div style="font-weight:600; color:#00b894;">${dlRate}</div>
                                <div style="font-size:0.8rem; color:#636e72;">Total: ${dlTotal}</div>
                            </td>
                            <td>
                                <div style="font-weight:600; color:#0984e3;">${ulRate}</div>
                                <div style="font-size:0.8rem; color:#636e72;">Total: ${ulTotal}</div>
                            </td>
                            <td>
                                <div><small>DL:</small> ${(user.speed_limit_down / 1024).toFixed(2)} Mbps</div>
                                <div><small>UL:</small> ${(user.speed_limit_up / 1024).toFixed(2)} Mbps</div>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-primary" onclick="editQosLimit('${user.ip}', ${(user.speed_limit_down / 1024).toFixed(2)}, ${(user.speed_limit_up / 1024).toFixed(2)})">Edit Limit</button>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                });
        }

        let currentQosIp = null;
        function editQosLimit(ip, dl, ul) {
            currentQosIp = ip;
            document.getElementById('qos-modal-ip').textContent = `User IP: ${ip}`;
            document.getElementById('qos-edit-dl').value = dl;
            document.getElementById('qos-edit-ul').value = ul;
            document.getElementById('qos-limit-modal').style.display = 'flex';
        }

        function saveQosLimit() {
            const dl = document.getElementById('qos-edit-dl').value;
            const ul = document.getElementById('qos-edit-ul').value;
            if (!currentQosIp) return;

            const dlKbps = Math.floor(parseFloat(dl) * 1024);
            const ulKbps = Math.floor(parseFloat(ul) * 1024);

            fetch('/api/admin/qos/limit', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ ip: currentQosIp, download_speed: dlKbps, upload_speed: ulKbps })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('qos-limit-modal').style.display = 'none';
                    loadQoSUsers(); // Refresh list
                    alert('Limit updated successfully');
                } else {
                    alert(data.error || 'Failed to set limit');
                }
            });
        }

        const qosDescriptions = {
            'gaming': '<strong>Gaming / Low-Latency Focused</strong><br>AI-driven prioritization for competitive gaming. Minimizes jitter (<5ms) and protects against lag spikes using micro-burst protection. Ideal for gamers and streamers.',
            'family': '<strong>Family / Household Management</strong><br>Balances bandwidth across all users. Ensures fair sharing for video calls, streaming, and browsing. Includes priority ladders for parents vs kids.',
            'enterprise': '<strong>Enterprise / Business Critical</strong><br>Guaranteed performance for VoIP, Teams, and mission-critical apps. Uses strict slicing to ensure reliability even during heavy load.',
            'green': '<strong>Green / Sustainable Angle</strong><br>Optimizes network for energy efficiency. Delays non-critical background tasks during high-load/high-carbon periods while keeping real-time apps smooth.'
        };

        function updateQoSDescription() {
            const mode = document.getElementById('qos-mode-select').value;
            let html = qosDescriptions[mode];
            
            if (mode === 'gaming') {
                html += '<div style="margin-top:15px; padding-top:15px; border-top:1px solid #ddd;">' +
                        '<button class="btn btn-danger" style="background:#f72585; border:none;" onclick="triggerRageMode()">🔥 Activate Rage Mode (5m)</button>' +
                        '<p style="font-size:0.85rem; color:#666; margin-top:5px;">Temporarily boosts all gaming traffic to absolute priority. Use when you experience lag spikes.</p>' +
                        '</div>';
            } else if (mode === 'green') {
                 html += '<div style="margin-top:15px; padding-top:15px; border-top:1px solid #ddd; display:flex; gap:15px;">' +
                        '<div style="text-align:center;"><div style="font-size:1.2rem; font-weight:bold; color:#2ecc71;">12.4g</div><div style="font-size:0.8rem; color:#666;">CO₂ Saved Today</div></div>' +
                        '<div style="text-align:center;"><div style="font-size:1.2rem; font-weight:bold; color:#2ecc71;">142Wh</div><div style="font-size:0.8rem; color:#666;">Energy Saved</div></div>' +
                        '</div>';
            }
            
            document.getElementById('qos-mode-desc').innerHTML = html;
        }

        async function triggerRageMode() {
            if(!await showConfirm("Activate Rage Mode? This will prioritize gaming traffic over everything else for 5 minutes.")) return;
            try {
                const res = await fetch('/api/admin/qos/rage', { method: 'POST' });
                const data = await res.json();
                if(data.success) alert("🔥 Rage Mode Activated! You have 5 minutes of god-mode priority.");
                else alert("Failed to activate Rage Mode");
            } catch(e) { console.error(e); }
        }

        async function loadQoSMode() {
             try {
                const res = await fetch('/api/admin/qos/config');
                const config = await res.json();
                if(config.qos_mode) {
                    document.getElementById('qos-mode-select').value = config.qos_mode;
                }
                updateQoSDescription();
            } catch(e) { console.error(e); }
        }

        async function saveQoSMode() {
            const mode = document.getElementById('qos-mode-select').value;
             try {
                const res = await fetch('/api/admin/qos/config', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ qos_mode: mode })
                });
                if(res.ok) alert('QoS Mode Updated');
                else alert('Failed to update QoS Mode');
            } catch(e) { console.error(e); alert('Error saving mode'); }
        }
        // --- Security & Maintenance ---
        async function loadSecurityCredentials() {
            try {
                const res = await fetch('/api/admin/security/credentials');
                const data = await res.json();
                
                if (data.username) {
                    document.getElementById('admin-username').value = data.username;
                }
                if (data.security_question) {
                    document.getElementById('admin-security-question').value = data.security_question;
                }
                if (data.security_answer) {
                    document.getElementById('admin-security-answer').value = data.security_answer;
                }
            } catch (e) {
                console.error("Failed to load security credentials", e);
            }
        }

        function togglePasswordVisibility(inputId, iconId) {
            const input = document.getElementById(inputId);
            const icon = document.getElementById(iconId);
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        }

        async function updateCredentials(e) {
            e.preventDefault();
            const username = document.getElementById('admin-username').value;
            const password = document.getElementById('admin-password').value;
            const confirm = document.getElementById('admin-confirm-password').value;
            const security_question = document.getElementById('admin-security-question').value;
            const security_answer = document.getElementById('admin-security-answer').value;

            if (password !== confirm) {
                alert("Passwords do not match!");
                return;
            }

            try {
                const res = await fetch('/api/admin/security/credentials', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ username, password, security_question, security_answer })
                });
                
                if (res.ok) {
                    await showConfirm("Credentials updated successfully. Please login again.", false, "Success");
                    logout(true);
                } else {
                    const data = await res.json();
                    alert("Error: " + data.error);
                }
            } catch (e) {
                console.error(e);
                alert("Failed to update credentials");
            }
        }

        async function rebootSystem() {
            if (!await showConfirm("Are you sure you want to REBOOT the system?", true)) return;
            try {
                const res = await fetch('/api/admin/system/reboot', { method: 'POST' });
                if (res.ok) {
                    alert("System is rebooting. Please wait about 60 seconds before refreshing.");
                } else {
                    alert("Failed to initiate reboot");
                }
            } catch (e) {
                alert("Error sending reboot command");
            }
        }

        async function downloadBackup() {
            if (!await showConfirm("Generate and download app data backup?", true)) return;
            try {
                const res = await fetch('/api/admin/system/backup');
                if (!res.ok) {
                    let message = "Failed to generate backup";
                    try {
                        const data = await res.json();
                        if (data && data.error) {
                            message = data.error;
                        }
                    } catch (err) {}
                    alert(message);
                    return;
                }

                const blob = await res.blob();
                let filename = "pisowifi-backup.sqlite";
                const disposition = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
                if (disposition) {
                    const match = disposition.match(/filename="?([^"]+)"?/i);
                    if (match && match[1]) {
                        filename = match[1];
                    }
                }

                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
            } catch (e) {
                alert("Error generating backup: " + e.message);
            }
        }

        async function restoreFromBackup() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.sqlite,application/octet-stream';

            input.onchange = async (event) => {
                const file = event.target.files && event.target.files[0];
                if (!file) return;

                if (!await showConfirm("Restore from this backup? This will overwrite current data.", true)) {
                    return;
                }

                const reader = new FileReader();
                reader.onload = async () => {
                    try {
                        const backup = reader.result;
                        const res = await fetch('/api/admin/system/restore', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ backup })
                        });

                        if (res.ok) {
                            alert('Restore completed. It is recommended to REBOOT the system.');
                        } else {
                            let message = 'Failed to restore from backup';
                            try {
                                const data = await res.json();
                                if (data && data.error) {
                                    message = data.error;
                                }
                            } catch (err) {}
                            alert(message);
                        }
                    } catch (e) {
                        alert('Error restoring backup: ' + e.message);
                    }
                };
                reader.readAsDataURL(file);
            };

            input.click();
        }

        async function factoryReset() {
            const code = await showPrompt("Type 'RESET' to confirm factory reset. This will delete all data!", "Type RESET here", "Factory Reset");
            if (code !== 'RESET') return;
            
            try {
                const res = await fetch('/api/admin/system/reset', { method: 'POST' });
                if (res.ok) {
                    await showConfirm("Factory reset complete. System will now restart.", false, "Success");
                    // Reload or logout
                    location.reload();
                } else {
                    alert("Failed to factory reset");
                }
            } catch (e) {
                alert("Error performing factory reset");
            }
        }

        async function upgradeSystem(type) {
            if (!await showConfirm(`Start ${type} system upgrade? System may be offline for a few minutes.`, true)) return;
            try {
                const res = await fetch('/api/admin/system/upgrade', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ type })
                });
                if (res.ok) {
                    alert("Upgrade initiated. Check logs or wait for system restart.");
                } else {
                    alert("Failed to start upgrade");
                }
            } catch (e) {
                alert("Error starting upgrade");
            }
        }

        async function verifyConfiguration() {
            const modal = document.getElementById('verify-modal');
            const content = document.getElementById('verify-results');
            modal.style.display = 'flex';
            content.innerHTML = '<div style="text-align:center; padding:20px;"><div class="spin" style="width:30px; height:30px; border:3px solid #f3f3f3; border-top:3px solid #3498db; border-radius:50%; margin:0 auto 10px;"></div>Running system checks...</div>';

            try {
                const res = await fetch('/api/admin/system/verify');
                const data = await res.json();
                
                let html = '<table style="width:100%; border-collapse:collapse;">';
                html += '<thead><tr style="background:#f8f9fa; text-align:left;"><th style="padding:10px;">Category</th><th style="padding:10px;">Status</th><th style="padding:10px;">Message</th></tr></thead><tbody>';
                
                data.checks.forEach(check => {
                    let color = '#666';
                    let icon = '•';
                    if (check.status === 'success') { color = '#2ecc71'; icon = '✔'; }
                    else if (check.status === 'warning') { color = '#f1c40f'; icon = '⚠'; }
                    else if (check.status === 'error') { color = '#e74c3c'; icon = '✖'; }
                    else if (check.status === 'info') { color = '#3498db'; icon = 'ℹ'; }
                    
                    html += `<tr style="border-bottom:1px solid #eee;">
                        <td style="padding:10px; font-weight:600;">${check.category}</td>
                        <td style="padding:10px; color:${color}; font-weight:bold;">${icon} ${check.status.toUpperCase()}</td>
                        <td style="padding:10px;">${check.message}</td>
                    </tr>`;
                });
                html += '</tbody></table>';
                html += `<div style="margin-top:15px; font-size:0.8rem; color:#999; text-align:right;">Checked at: ${new Date(data.timestamp).toLocaleString()}</div>`;
                
                content.innerHTML = html;
            } catch (e) {
                content.innerHTML = `<div style="color:red; text-align:center; padding:20px;">Error running checks: ${e.message}</div>`;
            }
        }

        // --- Chat System ---
        let chatSocket = null;
        let currentChatMac = null;

        function updateChatStatus(connected) {
            const indicator = document.getElementById('chat-status-indicator');
            const dot = indicator.querySelector('.status-dot');
            const text = indicator.querySelector('.status-text');
            
            indicator.style.display = 'flex';
            if (connected) {
                dot.style.background = '#2ecc71';
                text.textContent = 'Connected';
            } else {
                dot.style.background = '#e74c3c';
                text.textContent = 'Disconnected';
            }
        }

        function initChatSocket() {
            if (chatSocket) return;
            
            // Connect to root namespace
            // Note: Socket.io client script must be loaded
            if (typeof io === 'undefined') {
                console.error("Socket.io not loaded");
                return;
            }

            chatSocket = io({
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                reconnectionAttempts: Infinity
            });

            chatSocket.on('connect', () => {
                console.log('Admin Chat Connected');
                updateChatStatus(true);
                if (currentChatMac) {
                    chatSocket.emit('admin_join_chat', { mac: currentChatMac });
                }
            });

            chatSocket.on('disconnect', () => {
                console.log('Admin Chat Disconnected');
                updateChatStatus(false);
            });
            
            chatSocket.on('connect_error', (err) => {
                console.log('Chat connection error:', err);
                updateChatStatus(false);
            });

            // Listen for new messages from users (Global broadcast)
            chatSocket.on('admin_new_message', (data) => {
                // data: { mac, sender: 'user', message, timestamp, unread_count }
                
                // If viewing this conversation, append message
                if (currentChatMac === data.mac) {
                    appendChatMessage({
                        message: data.message,
                        timestamp: data.timestamp,
                        is_from_admin: 0 
                    });
                    // Mark as read
                    fetch(`/api/admin/chat/history/${data.mac}`);
                }
                
                // Refresh list
                loadConversations();
            });

            // Listen for messages in the room (including my own echo if I joined)
            chatSocket.on('new_message', (data) => {
                // Ignore own messages or handle duplicates
            });
        }


        async function loadConversations() {
            try {
                const res = await fetch('/api/admin/chat/conversations');
                const conversations = await res.json();
                
                const list = document.getElementById('chat-list');
                list.innerHTML = '';

                if (!Array.isArray(conversations) || conversations.length === 0) {
                    list.innerHTML = '<div style="padding:20px; text-align:center; color:#b2bec3;">No conversations yet.</div>';
                    return;
                }

                const byKey = new Map();
                conversations.forEach(c => {
                    const mac = c.sender_mac;
                    const key = c.user_code || c.client_id || mac;
                    const unread = Number(c.unread_count || 0);
                    const ts = c.timestamp ? new Date(c.timestamp).getTime() : 0;
                    const existing = byKey.get(key);
                    if (!existing) {
                        byKey.set(key, {
                            key,
                            sender_mac: mac,
                            user_code: c.user_code,
                            client_id: c.client_id,
                            message: c.message,
                            timestamp: c.timestamp,
                            unread_count: unread
                        });
                    } else {
                        const existingTs = existing.timestamp ? new Date(existing.timestamp).getTime() : 0;
                        if (ts > existingTs) {
                            existing.sender_mac = mac;
                            existing.message = c.message;
                            existing.timestamp = c.timestamp;
                        }
                        existing.unread_count = Number(existing.unread_count || 0) + unread;
                    }
                });

                const uniqueConversations = Array.from(byKey.values()).sort((a, b) => {
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                });

                uniqueConversations.forEach(c => {
                    const mac = c.sender_mac;
                    const displayName = c.user_code ? `ID: ${c.user_code}` : (c.client_id ? `Dev: ${c.client_id.substring(0,8)}...` : mac);
                    
                    const div = document.createElement('div');
                    div.className = `chat-item ${currentChatMac === mac ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}`;
                    div.dataset.chatKey = mac;
                    div.dataset.chatLabel = displayName;
                    div.onclick = () => selectConversation(mac, displayName);
                    
                    const time = c.timestamp ? new Date(c.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                    const unreadHtml = c.unread_count > 0 ? `<span class="chat-badge">${c.unread_count}</span>` : '';
                    const preview = c.message || '<i>No messages</i>';
                    
                    div.innerHTML = `
                        <div class="chat-item-header">
                            <span class="chat-mac" style="${c.unread_count > 0 ? 'font-weight:800; color:#000;' : ''}">${displayName}</span>
                            <span class="chat-time">${time}</span>
                        </div>
                        <div class="chat-preview">
                            ${preview}
                        </div>
                        ${unreadHtml}
                    `;
                    list.appendChild(div);
                });
            } catch (e) {
                console.error("Load conversations error", e);
            }
        }

        function toggleChatSidebar() {
            const sidebar = document.getElementById('chat-sidebar');
            sidebar.classList.toggle('hidden');
        }

        async function selectConversation(mac, label) {
            currentChatMac = mac;
            localStorage.setItem('admin_chat_active_mac', mac);
            
            // Auto-hide sidebar on mobile
            if (window.innerWidth <= 768) {
                document.getElementById('chat-sidebar').classList.add('hidden');
            }
            
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            document.getElementById('chat-current-user').textContent = `Chat with ${label || mac}`;
            document.getElementById('chat-input').disabled = false;
            document.getElementById('chat-send-btn').disabled = false;
            document.getElementById('chat-input').focus();
            
            // Join the room
            if (chatSocket && chatSocket.connected) {
                chatSocket.emit('admin_join_chat', { mac: mac });
            }

            // Load History
            await loadChatHistory(mac);
            
            // Refresh list to clear unread
            loadConversations();
        }

        async function loadChatHistory(mac) {
            const container = document.getElementById('chat-messages');
            container.innerHTML = '<div style="text-align:center; padding:20px; color:#ccc;">Loading history...</div>';
            
            try {
                const res = await fetch(`/api/admin/chat/history/${mac}`);
                const messages = await res.json();
                
                container.innerHTML = '';
                if (messages.length === 0) {
                     container.innerHTML = '<div style="text-align:center; padding:20px; color:#ccc;">No messages yet. Start chatting!</div>';
                } else {
                    messages.forEach(msg => appendChatMessage(msg));
                }
                scrollToBottom();
            } catch (e) {
                container.innerHTML = '<div style="text-align:center; color:red;">Failed to load history</div>';
            }
        }

        function appendChatMessage(msg) {
            const container = document.getElementById('chat-messages');
            // Remove "No messages" placeholder if exists
            if (container.textContent.includes('No messages yet') || container.textContent.includes('Loading history')) {
                container.innerHTML = '';
            }

            const div = document.createElement('div');
            // Check if msg is from admin or user
            const isMe = msg.is_from_admin == 1; 
            
            div.className = `message ${isMe ? 'sent' : 'received'}`;
            div.innerHTML = `
                ${msg.message}
                <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            `;
            container.appendChild(div);
            scrollToBottom();
        }

        function scrollToBottom() {
            const container = document.getElementById('chat-messages');
            if (container) {
                setTimeout(() => {
                    container.scrollTop = container.scrollHeight;
                }, 50);
            }
        }

        async function sendAdminMessage() {
            if (!currentChatMac) return;
            
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (!message) return;
            
            // Check socket connection
            if (!chatSocket || !chatSocket.connected) {
                // Try to reconnect if socket exists but disconnected
                if (chatSocket) {
                     console.log("Socket disconnected. Attempting to reconnect...");
                     chatSocket.connect();
                     // Give it a moment? No, better to show status.
                } else {
                     initChatSocket();
                }
                
                // If still not connected immediately, we can't send.
                // But let's check again in 500ms? 
                // For now, show alert.
                alert('Chat is currently disconnected. Please wait for reconnection (check status indicator).');
                return;
            }
            
            // Emit via socket
            chatSocket.emit('admin_send_message', {
                mac: currentChatMac,
                message: message
            });
            
            // Optimistically append
            appendChatMessage({
                message: message,
                is_from_admin: 1,
                timestamp: new Date().toISOString()
            });
            
            input.value = '';
            input.focus();
        }

        // Initialize socket and event listeners when DOM is ready
        document.addEventListener('DOMContentLoaded', () => {
             // Chat Input Listener
             const chatInput = document.getElementById('chat-input');
             if (chatInput) {
                 chatInput.addEventListener('keypress', function (e) {
                     if (e.key === 'Enter') {
                         sendAdminMessage();
                     }
                 });
             }
             
             const sendBtn = document.getElementById('chat-send-btn');
            if (sendBtn) {
                const handleSendClick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sendAdminMessage();
                };
                sendBtn.addEventListener('mousedown', handleSendClick);
                sendBtn.addEventListener('touchstart', handleSendClick, {passive: false});
            }
             
             // Initialize Socket
             initChatSocket();

             // Restore active chat session or load list
             const storedMac = localStorage.getItem('admin_chat_active_mac');
             if (storedMac) {
                 selectConversation(storedMac);
             } else {
                 loadConversations();
             }
         });

        // --- Sub Vendo Functions ---

        async function loadSubVendoConfig() {
            try {
                const res = await fetch('/api/admin/subvendo/key');
                if (res.status === 401) return location.reload();
                const data = await res.json();
                document.getElementById('subvendo-key').value = data.key || '';
                try {
                    const wRes = await fetch('/api/admin/subvendo/free-time-widget');
                    if (wRes.status === 401) return location.reload();
                    const wData = await wRes.json();
                    const toggle = document.getElementById('subvendo-free-time-widget-toggle');
                    if (toggle) toggle.checked = !!wData.enabled;
                } catch (e) {}
                try {
                    const sRes = await fetch('/api/admin/settings');
                    if (sRes.status === 401) return location.reload();
                    const settings = await sRes.json();
                    const enabledRaw = settings.main_free_time_enabled;
                    const enabled = enabledRaw === '1' || enabledRaw === 1 || enabledRaw === true || enabledRaw === 'true';
                    const enabledEl = document.getElementById('main-free-enabled');
                    const hEl = document.getElementById('main-free-h');
                    const mEl = document.getElementById('main-free-m');
                    const sEl = document.getElementById('main-free-s');
                    const dlEl = document.getElementById('main-free-dl');
                    const ulEl = document.getElementById('main-free-ul');
                    const reclaimEl = document.getElementById('main-free-reclaim');
                    const vlanEl = document.getElementById('main-free-vlan');
                    if (enabledEl) enabledEl.checked = enabled;
                    const totalSeconds = Number(settings.main_free_time_seconds || 0);
                    if (Number.isFinite(totalSeconds) && totalSeconds > 0) {
                        const h = Math.floor(totalSeconds / 3600);
                        const m = Math.floor((totalSeconds % 3600) / 60);
                        const s = totalSeconds % 60;
                        if (hEl) hEl.value = h || '';
                        if (mEl) mEl.value = m || '';
                        if (sEl) sEl.value = s || '';
                    } else {
                        if (hEl) hEl.value = '';
                        if (mEl) mEl.value = '';
                        if (sEl) sEl.value = '';
                    }
                    if (dlEl) {
                        const dlKbps = Number(settings.main_free_time_download_speed || 0);
                        if (Number.isFinite(dlKbps) && dlKbps > 0) {
                            dlEl.value = (dlKbps / 1024);
                        } else {
                            dlEl.value = '';
                        }
                    }
                    if (ulEl) {
                        const ulKbps = Number(settings.main_free_time_upload_speed || 0);
                        if (Number.isFinite(ulKbps) && ulKbps > 0) {
                            ulEl.value = (ulKbps / 1024);
                        } else {
                            ulEl.value = '';
                        }
                    }
                    if (reclaimEl) reclaimEl.value = settings.main_free_time_reclaim_days || '';
                    if (vlanEl) vlanEl.value = settings.main_free_time_vlan || '';
                } catch (e) {}
            } catch (e) {
                console.error("Failed to load sub vendo config", e);
            }
        }

        async function saveSubVendoKey() {
            const key = document.getElementById('subvendo-key').value;
            try {
                const res = await fetch('/api/admin/subvendo/key', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ key })
                });
                const data = await res.json();
                if (data.success) {
                    alert('Sub Vendo Key Saved');
                } else {
                    alert('Error saving key');
                }
            } catch (e) {
                console.error("Failed to save sub vendo key", e);
                alert('Error saving key');
            }
        }

        async function toggleSubVendoFreeTimeWidget(el) {
            const enabled = !!(el && el.checked);
            try {
                const res = await fetch('/api/admin/subvendo/free-time-widget', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ enabled })
                });
                const data = await res.json();
                if (!data || !data.success) {
                    alert('Failed to update Free Time widget setting');
                }
            } catch (e) {
                console.error("Failed to update free time widget", e);
                alert('Error updating Free Time widget setting');
            }
        }

        async function saveMainFreeTimeConfig() {
            const enabledEl = document.getElementById('main-free-enabled');
            const hEl = document.getElementById('main-free-h');
            const mEl = document.getElementById('main-free-m');
            const sEl = document.getElementById('main-free-s');
            const dlEl = document.getElementById('main-free-dl');
            const ulEl = document.getElementById('main-free-ul');
            const reclaimEl = document.getElementById('main-free-reclaim');
            const vlanEl = document.getElementById('main-free-vlan');
            const payload = {};
            if (enabledEl && enabledEl.checked) {
                payload.main_free_time_enabled = '1';
            } else {
                payload.main_free_time_enabled = '0';
            }
            const h = hEl ? Number(hEl.value) || 0 : 0;
            const m = mEl ? Number(mEl.value) || 0 : 0;
            const s = sEl ? Number(sEl.value) || 0 : 0;
            const totalSeconds = (h * 3600) + (m * 60) + s;
            payload.main_free_time_seconds = String(totalSeconds);
            const dlMbps = dlEl ? Number(dlEl.value) || 0 : 0;
            const ulMbps = ulEl ? Number(ulEl.value) || 0 : 0;
            if (dlMbps > 0) {
                payload.main_free_time_download_speed = String(Math.round(dlMbps * 1024));
            } else {
                payload.main_free_time_download_speed = '';
            }
            if (ulMbps > 0) {
                payload.main_free_time_upload_speed = String(Math.round(ulMbps * 1024));
            } else {
                payload.main_free_time_upload_speed = '';
            }
            if (reclaimEl) {
                payload.main_free_time_reclaim_days = reclaimEl.value || '';
            }
            if (vlanEl) {
                payload.main_free_time_vlan = vlanEl.value || '';
            }
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    alert('Main Vendo Free Time Saved');
                } else {
                    alert('Failed to save Main Vendo Free Time');
                }
            } catch (e) {
                console.error("Failed to save main free time", e);
                alert('Error saving Main Vendo Free Time');
            }
        }

        async function loadSubVendoDevices() {
            try {
                const res = await fetch('/api/admin/subvendo/devices');
                if (res.status === 401) return location.reload();
                const devices = await res.json();
                window.subVendoDevicesCache = Array.isArray(devices) ? devices : [];
                const tbody = document.querySelector('#subvendo-devices-table tbody');
                const list = document.getElementById('subvendo-devices-list');
                tbody.innerHTML = '';
                if (list) list.innerHTML = '';
                
                if (devices.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No devices registered</td></tr>';
                    if (list) list.innerHTML = '<div style="text-align:center; padding:12px; color:#636e72;">No devices registered</div>';
                    return;
                }

                devices.forEach(device => {
                    const tr = document.createElement('tr');
                    const isOnline = device.online;
                    const statusDot = isOnline 
                        ? '<span style="display:inline-block; width:8px; height:8px; background:#2ecc71; border-radius:50%; margin-right:6px;" title="Online"></span>' 
                        : '<span style="display:inline-block; width:8px; height:8px; background:#e74c3c; border-radius:50%; margin-right:6px;" title="Offline"></span>';
                    const hasFree = (Number(device.free_time_seconds || 0) > 0) && !!device.free_time_enabled;
                    const freeBadge = hasFree ? '<span style="margin-left:2px; padding:2px 8px; font-size:0.7rem; border-radius:999px; background:#3498db; color:#fff; display:inline-flex; align-items:center; justify-content:center; text-align:center;">Free Time</span>' : '';
                    
                    tr.innerHTML = `
                        <td style="display:flex; align-items:center;">${statusDot}<span>${device.name || '-'}</span>${freeBadge}</td>
                        <td style="font-family:monospace;">${device.device_id}</td>
                        <td><span class="status-badge ${device.status === 'active' ? 'status-active' : 'status-inactive'}">${device.status}</span></td>
                        <td>${isOnline ? '<span style="color:#2ecc71; font-weight:bold;">Online Now</span>' : (device.last_active_at ? new Date(device.last_active_at).toLocaleString() : 'Never')}</td>
                        <td>
                            <button class="btn-icon" onclick="openSubVendoDeviceSettings(${device.id})" title="Settings">
                                <svg style="width:16px;height:16px;fill:currentColor;" viewBox="0 0 24 24"><path d="M12 8a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z"/></svg>
                            </button>
                            <button class="btn-icon" onclick="openSubVendoFreeTimeConfig(${device.id})" title="Free Time Config" style="color:#2980b9;">
                                <svg style="width:16px;height:16px;fill:currentColor;" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
                            </button>
                            <button class="btn-icon delete" onclick="deleteSubVendoDevice(${device.id})">
                                <svg style="width:16px;height:16px;fill:currentColor;" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                            </button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                    
                    if (list) {
                        const card = document.createElement('div');
                        card.className = 'device-card';
                        const lastActive = isOnline ? '<span style="color:#2ecc71; font-weight:bold;">Online Now</span>' : (device.last_active_at ? new Date(device.last_active_at).toLocaleString() : 'Never');
                        const statusBadgeClass = device.status === 'active' ? 'status-active' : 'status-inactive';
                        const hasFreeCard = (Number(device.free_time_seconds || 0) > 0) && !!device.free_time_enabled;
                        const freeBadgeCard = hasFreeCard ? '<span style="margin-left:2px; padding:2px 8px; font-size:0.7rem; border-radius:999px; background:#3498db; color:#fff; display:inline-flex; align-items:center; justify-content:center; text-align:center;">Free Time</span>' : '';
                        card.innerHTML = `
                            <div class="device-card-header">
                                <div class="device-name">${statusDot}<span>${device.name || '-'}</span>${freeBadgeCard}</div>
                                <div class="device-id">${device.device_id}</div>
                            </div>
                            <div class="device-meta">
                                <span class="status-badge ${statusBadgeClass}">${device.status}</span>
                                <span>${lastActive}</span>
                            </div>
                            <div class="device-actions">
                                <button class="btn btn-sm" onclick="openSubVendoDeviceSettings(${device.id})" style="background:#f39c12; color:white;">Settings</button>
                                <button class="btn btn-sm" onclick="openSubVendoFreeTimeConfig(${device.id})" style="background:#3498db; color:white;">Free Time</button>
                                <button class="btn btn-sm btn-danger" onclick="deleteSubVendoDevice(${device.id})">Delete</button>
                            </div>
                        `;
                        list.appendChild(card);
                    }
                });
            } catch (e) {
                console.error("Failed to load sub vendo devices", e);
            }
        }

        async function coinsOut(id, name, amount) {
            if (amount <= 0) {
                if (!confirm(`Device ${name} has no recorded un-out sales. Do you want to reset the counter anyway?`)) return;
            } else {
                if (!confirm(`Confirm Coins Out for ${name}?\nAmount: ₱${amount}`)) return;
            }

            try {
                const res = await fetch(`/api/admin/subvendo/devices/${id}/coins-out`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    alert('Coins Out Successful!');
                    loadSubVendoDevices();
                } else {
                    alert('Failed: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                alert('Error performing coins out');
                console.error(e);
            }
        }

        let currentSubVendoDeviceId = null;

        function openSubVendoDeviceSettings(id) {
            currentSubVendoDeviceId = id;
            const devices = window.subVendoDevicesCache || [];
            const device = devices.find(d => Number(d.id) === Number(id));
            if (!device) return;

            document.getElementById('subvendo-device-name').value = device.name || '';
            document.getElementById('subvendo-device-description').value = device.description || '';
            document.getElementById('subvendo-device-rate').value = device.peso_per_pulse != null ? device.peso_per_pulse : 1;
            document.getElementById('subvendo-device-coin-pin').value = device.coin_pin != null ? device.coin_pin : 6;
            document.getElementById('subvendo-device-relay-pin').value = device.relay_pin != null ? device.relay_pin : 5;
            document.getElementById('subvendo-device-relay-active-state').value = device.relay_pin_active_state || 'HIGH';
            document.getElementById('subvendo-device-download').value = device.download_speed ? (device.download_speed / 1024) : '';
            document.getElementById('subvendo-device-upload').value = device.upload_speed ? (device.upload_speed / 1024) : '';
            const freeSeconds = Number(device.free_time_seconds || 0);
            const freeH = Math.floor(freeSeconds / 3600);
            const freeM = Math.floor((freeSeconds % 3600) / 60);
            const freeS = freeSeconds % 60;
            document.getElementById('subvendo-device-free-h').value = freeH > 0 ? freeH : '';
            document.getElementById('subvendo-device-free-m').value = freeM > 0 ? freeM : '';
            document.getElementById('subvendo-device-free-s').value = freeS > 0 ? freeS : '';
            document.getElementById('subvendo-device-free-reclaim').value = device.free_time_reclaim_days != null ? device.free_time_reclaim_days : '';
            document.getElementById('subvendo-device-free-vlan').value = device.free_time_vlan || '';
            document.getElementById('subvendo-device-free-enabled').checked = !!device.free_time_enabled;

            populateSubVendoDeviceRates(id);
            document.getElementById('subvendo-device-modal').style.display = 'flex';
        }

        function closeSubVendoDeviceSettings() {
            document.getElementById('subvendo-device-modal').style.display = 'none';
            currentSubVendoDeviceId = null;
        }

        async function saveSubVendoDeviceSettings() {
            if (!currentSubVendoDeviceId) return;
            const freeH = Number(document.getElementById('subvendo-device-free-h').value) || 0;
            const freeM = Number(document.getElementById('subvendo-device-free-m').value) || 0;
            const freeS = Number(document.getElementById('subvendo-device-free-s').value) || 0;
            const totalFreeSeconds = (freeH * 3600) + (freeM * 60) + freeS;
            const reclaimVal = document.getElementById('subvendo-device-free-reclaim').value;
            const reclaimDays = reclaimVal === '' ? null : Number(reclaimVal);
            const freeVlan = document.getElementById('subvendo-device-free-vlan').value.trim();
            const freeEnabled = document.getElementById('subvendo-device-free-enabled').checked;
            const payload = {
                name: document.getElementById('subvendo-device-name').value,
                description: document.getElementById('subvendo-device-description').value,
                peso_per_pulse: Number(document.getElementById('subvendo-device-rate').value),
                coin_pin: Number(document.getElementById('subvendo-device-coin-pin').value),
                relay_pin: Number(document.getElementById('subvendo-device-relay-pin').value),
                relay_pin_active_state: document.getElementById('subvendo-device-relay-active-state').value,
                download_speed: document.getElementById('subvendo-device-download').value ? Math.round(Number(document.getElementById('subvendo-device-download').value) * 1024) : null,
                upload_speed: document.getElementById('subvendo-device-upload').value ? Math.round(Number(document.getElementById('subvendo-device-upload').value) * 1024) : null,
                free_time_seconds: totalFreeSeconds,
                free_time_reclaim_days: reclaimDays,
                free_time_vlan: freeVlan || null,
                free_time_enabled: freeEnabled
            };

            try {
                const res = await fetch(`/api/admin/subvendo/devices/${currentSubVendoDeviceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data && data.success) {
                    const rateContainer = document.getElementById('subvendo-device-rates');
                    const checked = Array.from(rateContainer.querySelectorAll('input[type="checkbox"][data-rate-id]:checked'))
                        .map(x => Number(x.getAttribute('data-rate-id')))
                        .filter(x => Number.isFinite(x));
                    try {
                        await fetch(`/api/admin/subvendo/devices/${currentSubVendoDeviceId}/rates`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ visible_rate_ids: checked })
                        });
                    } catch (e) {}
                    closeSubVendoDeviceSettings();
                    loadSubVendoDevices();
                } else {
                    alert('Failed to save settings: ' + (data && data.error ? data.error : 'Unknown error'));
                }
            } catch (e) {
                console.error('Failed to save device settings', e);
                alert('Error saving device settings');
            }
        }

        async function populateSubVendoDeviceRates(id) {
            const container = document.getElementById('subvendo-device-rates');
            if (!container) return;
            container.innerHTML = 'Loading rates...';
            try {
                const res = await fetch(`/api/admin/subvendo/devices/${id}/rates`);
                const rates = await res.json();
                if (!Array.isArray(rates) || rates.length === 0) {
                    container.innerHTML = '<div>No rates configured</div>';
                    return;
                }
                const html = rates.map(r => {
                    const minutes = Number(r.minutes) || 0;
                    let dur = minutes + 'm';
                    if (minutes >= 60) {
                        const h = Math.floor(minutes / 60);
                        const m = minutes % 60;
                        dur = h + 'h' + (m > 0 ? ' ' + m + 'm' : '');
                    }
                    const ul = r.upload_speed >= 1024 ? (r.upload_speed / 1024).toFixed(1) + ' Mbps' : r.upload_speed + ' Kbps';
                    const dl = r.download_speed >= 1024 ? (r.download_speed / 1024).toFixed(1) + ' Mbps' : r.download_speed + ' Kbps';
                    const type = r.is_pausable ? 'Pausable' : 'Continuous';
                    const checked = r.visible ? 'checked' : '';
                    return `
                        <label style="display:flex; align-items:center; gap:10px; padding:8px; border:1px solid #eee; border-radius:6px; font-size:0.8rem;">
                            <input type="checkbox" data-rate-id="${r.id}" ${checked}>
                            <div style="display:flex; flex-wrap:wrap; gap:12px; flex:1;">
                                <span><strong>Coin:</strong> ₱${r.amount}</span>
                                <span><strong>Duration:</strong> ${dur}</span>
                                <span><strong>Type:</strong> ${type}</span>
                                <span><strong>Upload:</strong> ${ul}</span>
                                <span><strong>Download:</strong> ${dl}</span>
                            </div>
                            <button class="btn btn-sm btn-warning subvendo-rate-edit-btn" data-rate-id="${r.id}" type="button">
                                Edit
                            </button>
                        </label>
                    `;
                }).join('');
                const addBtn = `
                    <div style="display:flex; justify-content:flex-end; margin-top:8px;">
                        <button class="btn btn-sm btn-primary" onclick="if (typeof openRateModal === 'function') { openRateModal(); }">+ Add Rate</button>
                    </div>
                `;
                container.innerHTML = html + addBtn;

                try {
                    const buttons = container.querySelectorAll('.subvendo-rate-edit-btn');
                    buttons.forEach(btn => {
                        btn.addEventListener('click', () => {
                            const rateId = Number(btn.getAttribute('data-rate-id'));
                            const rate = Array.isArray(rates) ? rates.find(x => Number(x.id) === rateId) : null;
                            if (!rate) return;
                            if (typeof openRateModal === 'function') {
                                openRateModal(rate);
                            }
                        });
                    });
                } catch (e) {
                    console.error('Failed to wire rate edit buttons', e);
                }
            } catch (e) {
                console.error('Failed to load device rates', e);
                container.innerHTML = '<div>Failed to load rates</div>';
            }
        }

        let currentFreeTimeDeviceId = null;
        function openSubVendoFreeTimeConfig(id) {
            currentFreeTimeDeviceId = id;
            const devices = window.subVendoDevicesCache || [];
            const device = devices.find(d => Number(d.id) === Number(id));
            if (!device) return;

            // Populate fields
            const freeSeconds = Number(device.free_time_seconds || 0);
            const freeH = Math.floor(freeSeconds / 3600);
            const freeM = Math.floor((freeSeconds % 3600) / 60);
            const freeS = freeSeconds % 60;
            
            document.getElementById('ft-device-name').textContent = device.name || 'Device';
            document.getElementById('ft-h').value = freeH > 0 ? freeH : '';
            document.getElementById('ft-m').value = freeM > 0 ? freeM : '';
            document.getElementById('ft-s').value = freeS > 0 ? freeS : '';
            document.getElementById('ft-reclaim').value = device.free_time_reclaim_days != null ? device.free_time_reclaim_days : '';
            document.getElementById('ft-vlan').value = device.free_time_vlan || '';
            document.getElementById('ft-enabled').checked = !!device.free_time_enabled;

            const dlInput = document.getElementById('ft-dl');
            const ulInput = document.getElementById('ft-ul');
            if (dlInput) {
                const dlKbps = Number(device.free_time_download_speed || 0);
                if (Number.isFinite(dlKbps) && dlKbps > 0) {
                    dlInput.value = dlKbps / 1024;
                } else {
                    dlInput.value = '';
                }
            }
            if (ulInput) {
                const ulKbps = Number(device.free_time_upload_speed || 0);
                if (Number.isFinite(ulKbps) && ulKbps > 0) {
                    ulInput.value = ulKbps / 1024;
                } else {
                    ulInput.value = '';
                }
            }

            document.getElementById('subvendo-free-time-modal').style.display = 'flex';
        }

        function closeSubVendoFreeTimeConfig() {
            document.getElementById('subvendo-free-time-modal').style.display = 'none';
            currentFreeTimeDeviceId = null;
        }

        async function saveSubVendoFreeTimeConfig() {
            if (!currentFreeTimeDeviceId) return;
            
            const freeH = Number(document.getElementById('ft-h').value) || 0;
            const freeM = Number(document.getElementById('ft-m').value) || 0;
            const freeS = Number(document.getElementById('ft-s').value) || 0;
            const totalFreeSeconds = (freeH * 3600) + (freeM * 60) + freeS;
            
            const reclaimVal = document.getElementById('ft-reclaim').value;
            const reclaimDays = reclaimVal === '' ? null : Number(reclaimVal);
            const freeVlan = document.getElementById('ft-vlan').value.trim();
            const freeEnabled = document.getElementById('ft-enabled').checked;

            const dlInput = document.getElementById('ft-dl');
            const ulInput = document.getElementById('ft-ul');
            const dlMbps = dlInput ? Number(dlInput.value) || 0 : 0;
            const ulMbps = ulInput ? Number(ulInput.value) || 0 : 0;
            const dlKbps = dlMbps > 0 ? Math.round(dlMbps * 1024) : 0;
            const ulKbps = ulMbps > 0 ? Math.round(ulMbps * 1024) : 0;

            const payload = {
                free_time_seconds: totalFreeSeconds,
                free_time_reclaim_days: reclaimDays,
                free_time_vlan: freeVlan || null,
                free_time_enabled: freeEnabled,
                free_time_download_speed: dlKbps,
                free_time_upload_speed: ulKbps
            };

            try {
                const res = await fetch(`/api/admin/subvendo/devices/${currentFreeTimeDeviceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data && data.success) {
                    closeSubVendoFreeTimeConfig();
                    loadSubVendoDevices();
                } else {
                    alert('Failed to save configuration: ' + (data && data.error ? data.error : 'Unknown error'));
                }
            } catch (e) {
                console.error('Failed to save free time config', e);
                alert('Error saving configuration');
            }
        }

        async function deleteSubVendoDevice(id) {
            if(!confirm('Are you sure you want to remove this device?')) return;
            try {
                const res = await fetch(`/api/admin/subvendo/devices/${id}`, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if(data.success) {
                    loadSubVendoDevices();
                } else {
                    alert('Failed to delete device: ' + data.error);
                }
            } catch(e) {
                console.error("Failed to delete device", e);
                alert('Error deleting device');
            }
        }
    

// --- END BLOCK ---


        // --- Init Charts ---
        let bwChart, cpuDoughnut;
        let voucherInterval = null;
        let devicesInterval = null;
        let subVendoDevicesInterval = null;
        let visualInterfaceMap = {}; // Map real interface names to visual names (e.g. end0 -> eth0)
        let chartsEnabled = false;
        let topVendoPeriod = 'monthly';
        let topClientsPeriod = 'monthly';

        // Cyan Theme matching the design (Default fallback)
        const cpuColor = '#00cec9'; 
        const cpuTrack = '#dfe6e9';

        // Unique colors for each core
        const gaugeColors = [
            '#00cec9', // Cyan
            '#0984e3', // Blue
            '#6c5ce7', // Purple
            '#fdcb6e', // Orange
            '#e17055', // Terra Cotta
            '#00b894', // Green
            '#e84393', // Pink
            '#2d3436'  // Dark
        ];

        function updateCpuChart(cores) {
            if (!cpuDoughnut) return;
            if (!Array.isArray(cores) || cores.length === 0) return;

            const avg = cores.reduce((a, b) => a + b, 0) / cores.length;

            const labels = ['AVG', ...cores.map((_, i) => `CPU ${i + 1}`)];
            const data = [avg, ...cores].map(v => {
                const n = Number(v) || 0;
                return Math.max(0, Math.min(100, n));
            });
            const colors = [gaugeColors[0], ...cores.map((_, i) => gaugeColors[(i + 1) % gaugeColors.length])];

            cpuDoughnut.data.labels = labels;

            if (!cpuDoughnut.data.datasets || cpuDoughnut.data.datasets.length === 0) {
                cpuDoughnut.data.datasets = [{
                    label: 'CPU Usage',
                    data: data,
                    backgroundColor: colors,
                    borderWidth: 0,
                    borderRadius: 4,
                    maxBarThickness: 18
                }];
            } else {
                cpuDoughnut.data.datasets[0].data = data;
                cpuDoughnut.data.datasets[0].backgroundColor = colors;
            }

            cpuDoughnut.update();
        }

        function initCharts() {
            if (typeof Chart === 'undefined') {
                console.warn("Chart.js not loaded.");
                return;
            }
            chartsEnabled = true;

            // Bandwidth Chart
            const ctxBw = document.getElementById('bandwidthChart').getContext('2d');
            
            // Define Colors (Download = Green, Upload = Blue to match UI)
            const dlColor = '#10b981'; // Emerald-500 (Green)
            const ulColor = '#3b82f6'; // Blue-500

            // Gradient Fills
            const dlFill = ctxBw.createLinearGradient(0, 0, 0, 300);
            dlFill.addColorStop(0, 'rgba(16, 185, 129, 0.25)'); 
            dlFill.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

            const ulFill = ctxBw.createLinearGradient(0, 0, 0, 300);
            ulFill.addColorStop(0, 'rgba(59, 130, 246, 0.25)'); 
            ulFill.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

            bwChart = new Chart(ctxBw, {
                type: 'line',
                data: {
                    labels: Array(60).fill(''),
                    datasets: [
                        { 
                            label: 'Download', 
                            data: Array(60).fill(0), 
                            borderColor: dlColor,
                            backgroundColor: dlFill,
                            fill: 'start',
                            tension: 0.4,
                            pointRadius: 0,
                            pointHoverRadius: 6,
                            borderWidth: 2,
                            order: 1
                        },
                        { 
                            label: 'Upload', 
                            data: Array(60).fill(0), 
                            borderColor: ulColor,
                            backgroundColor: ulFill,
                            fill: 'start',
                            tension: 0.4,
                            pointRadius: 0,
                            pointHoverRadius: 6,
                            borderWidth: 2,
                            order: 2
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: { 
                        legend: { 
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: {
                                usePointStyle: true,
                                boxWidth: 8,
                                font: { size: 11, family: "'Inter', sans-serif" }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            titleColor: '#1f2937',
                            bodyColor: '#374151',
                            borderColor: '#e5e7eb',
                            borderWidth: 1,
                            padding: 10,
                            cornerRadius: 8,
                            titleFont: { weight: '600' },
                            callbacks: {
                                label: (ctx) => {
                                    const v = Number(ctx.parsed.y || 0);
                                    return `${ctx.dataset.label}: ${v.toFixed(2)} Mbps`;
                                }
                            }
                        }
                    },
                    scales: { 
                        x: { 
                            display: false,
                            grid: { display: false }
                        },
                        y: { 
                            beginAtZero: true,
                            grid: { 
                                color: 'rgba(243, 244, 246, 1)', 
                                borderDash: [4, 4],
                                drawBorder: false 
                            },
                            ticks: { 
                                color: '#9ca3af',
                                font: { size: 10 },
                                callback: (value) => value + ' M'
                            }
                        } 
                    },
                    animation: false
                }
            });

            const ctxCpu = document.getElementById('cpuChart').getContext('2d');
            cpuDoughnut = new Chart(ctxCpu, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'CPU Usage',
                        data: [],
                        backgroundColor: [],
                        borderWidth: 0,
                        borderRadius: 4,
                        maxBarThickness: 18
                    }]
                },
                options: { 
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { 
                        legend: { display: false }, 
                        tooltip: { 
                            callbacks: { 
                                label: function(ctx) {
                                    const value = typeof ctx.parsed.x === 'number' ? ctx.parsed.x : ctx.parsed.y;
                                    const label = ctx.label || `CPU ${ctx.dataIndex + 1}`;
                                    return label + ': ' + value.toFixed(1) + '%';
                                }
                            } 
                        } 
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            max: 100,
                            grid: { color: 'rgba(0,0,0,0.08)', borderDash: [2, 3] },
                            ticks: { 
                                color: '#374151',
                                callback: function(value) { return value + '%'; }
                            }
                        },
                        y: {
                            grid: { display: false },
                            ticks: { color: '#374151' }
                        }
                    },
                    animation: {
                        duration: 300,
                        easing: 'linear'
                    }
                }
            });
        }

        // --- Core Logic ---
        let currentView = 'dashboard';

        // --- Idle Timeout Logic ---
        let idleTimer;
        const IDLE_LIMIT = 3600000; // 1 hour

        function resetIdleTimer() {
            clearTimeout(idleTimer);
            // Only set timer if user is logged in (dashboard is visible)
            const dashboard = document.getElementById('dashboard-ui');
            if (dashboard && dashboard.style.display !== 'none') {
                idleTimer = setTimeout(() => {
                    logout(true); 
                }, IDLE_LIMIT);
            }
        }

        function initIdleTimer() {
             const events = ['mousemove', 'mousedown', 'click', 'keypress', 'touchstart'];
             events.forEach(evt => {
                window.addEventListener(evt, resetIdleTimer, { passive: true });
             });
             // Scroll doesn't bubble, so use capture to catch scrolling in divs
             window.addEventListener('scroll', resetIdleTimer, { capture: true, passive: true });
             resetIdleTimer();
        }

        async function checkAuth() {
            try {
                const res = await fetch('/api/admin/dashboard', { credentials: 'include', cache: 'no-store' });
                document.getElementById('loading-overlay').style.display = 'none';
                if (res.ok) showDashboard(false);
                else document.getElementById('login-screen').style.display = 'flex';
            } catch(e) {
                document.getElementById('loading-overlay').style.display = 'none';
                document.getElementById('login-screen').style.display = 'flex';
            }
        }

        async function manualRefresh(btn) {
            const icon = document.getElementById('refresh-icon');
            icon.classList.add('spin');
            
            try {
                if (currentView === 'dashboard') await loadDashboardData();
                else if (currentView === 'sales') await loadSalesData('daily'); // Default to daily for now
                // Settings doesn't need refresh usually
            } catch (e) {
                console.error("Refresh failed", e);
            } finally {
                setTimeout(() => icon.classList.remove('spin'), 500); // Min 500ms spin
            }
        }


        async function login() {
            const u = document.getElementById('username').value;
            const p = document.getElementById('password').value;
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ username: u, password: p })
            });
            if (res.ok) showDashboard(true);
            else document.getElementById('login-error').textContent = 'Invalid credentials';
        }

        async function logout(skipConfirm = false) {
            if (!skipConfirm) {
                if (!await showConfirm("Are you sure you want to log out?", true, "Logout")) return;
            }
            fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).then(() => location.reload());
        }

        let systemClockInterval = null;

        function startClock(serverTimeString) {
            if (systemClockInterval) clearInterval(systemClockInterval);

            const serverTime = new Date(serverTimeString);
            const clientTime = new Date();
            const offset = serverTime - clientTime;

            const updateClock = () => {
                const now = new Date();
                const estimatedServerTime = new Date(now.getTime() + offset);
                
                // Update Topbar Time
                const topbarTime = document.getElementById('topbar-time');
                if (topbarTime) {
                    topbarTime.style.display = 'block';
                    // Format: Jan 11, 10:30:45 AM
                    topbarTime.textContent = estimatedServerTime.toLocaleString('en-US', { 
                        month: 'short', day: 'numeric', 
                        hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true 
                    });
                }

                // Update Settings Page Time (if element exists and is visible)
                const settingsTime = document.getElementById('current-system-time');
                if (settingsTime) {
                    settingsTime.textContent = estimatedServerTime.toLocaleString();
                }
            };

            updateClock();
            systemClockInterval = setInterval(updateClock, 1000);
        }

        async function initSystemClock() {
            try {
                const res = await fetch('/api/admin/system/time');
                if (res.ok) {
                    const settings = await res.json();
                    if (settings.current_system_time) {
                        startClock(settings.current_system_time);
                    }
                }
            } catch (e) {
                console.error("Failed to init system clock", e);
            }
        }

        function showDashboard(forceDashboard) {
            document.getElementById('login-screen').style.display = 'none';
            document.getElementById('dashboard-ui').style.display = 'flex';
            initCharts();
            initIdleTimer();
            initSystemClock(); // Start the clock
            
            const view = forceDashboard ? 'dashboard' : (localStorage.getItem('admin_last_view') || 'dashboard');
            showView(view);

            setInterval(() => {
                if(currentView === 'dashboard') loadDashboardData();
            }, 5000); 
        }

        function nav(view) {
            showView(view);
            // On mobile, close sidebar after click
            if (window.innerWidth <= 768) {
                setSidebarOpen(false);
            }
        }

        function showView(view) {
            // Clear intervals
            if (voucherInterval) {
                clearInterval(voucherInterval);
                voucherInterval = null;
            }
            if (devicesInterval) {
                clearInterval(devicesInterval);
                devicesInterval = null;
            }
            if (subVendoDevicesInterval) {
                clearInterval(subVendoDevicesInterval);
                subVendoDevicesInterval = null;
            }

            currentView = view;
            localStorage.setItem('admin_last_view', view); // Persist view

            // Hide all
            document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            
            // Show selected
            document.getElementById('view-' + view).style.display = 'block';
            
            // Update Menu Active State
            const menuItems = document.querySelectorAll('.menu-item');
            menuItems.forEach(item => {
                if(item.getAttribute('onclick').includes(view)) {
                    item.classList.add('active');
                    // Update Header Icon
                    const svg = item.querySelector('svg');
                    const headerIcon = document.getElementById('header-icon');
                    if (svg && headerIcon) {
                        headerIcon.innerHTML = svg.innerHTML;
                    }
                }
            });

            const titleMap = {
                dashboard: 'Dashboard',
                interfaces: 'Interfaces',
                pppoe: 'PPPoE',
                voucher: 'Vouchers',
                rates: 'Rates',
                network: 'Network',
                qos: 'QoS',
                firewall: 'Firewall',
                subvendo: 'Sub Vendo',
                portal: 'Portal',
                syslogs: 'Logs',
                devices: 'Devices',
                chat: 'Chat',
                sales: 'Sales',
                settings: 'Settings'
            };
            const title = titleMap[view] || view.charAt(0).toUpperCase() + view.slice(1);
            document.getElementById('page-title').textContent = title;

            const scroller = document.querySelector('.content-scroll');
            if (scroller) scroller.scrollTop = 0;

            // Load Data
                if (view === 'dashboard') {
                loadDashboardData();
            } else if (view === 'sales') {
                loadSalesData('daily');
            } else if (view === 'settings') {
                loadSettingsData();
            } else if (view === 'portal') {
                loadPortalConfig();
            } else if (view === 'voucher') {
                    loadVoucherBatches();
                loadVouchersData();
                loadActiveCodes();
                // Start auto-refresh for vouchers
                voucherInterval = setInterval(() => {
                        loadVoucherBatches();
                    loadVouchersData();
                    loadActiveCodes();
                }, 3000);
            } else if (view === 'interfaces') {
                loadInterfaces();
            } else if (view === 'rates') {
                loadRatesData();
            } else if (view === 'chat') {
                loadConversations();
                loadChatSettings();
                // Ensure sidebar is visible when entering chat view
                const sidebar = document.getElementById('chat-sidebar');
                if(sidebar) sidebar.classList.remove('hidden');
            } else if (view === 'qos') {
                loadQoSUsers();
                loadQoSMode();
            } else if (view === 'network') {
                loadNetworkConfig();
                loadWifiConfig();
                loadWalledGarden();
                loadVlans();
                loadDhcp();
            } else if (view === 'devices') {
                loadDevicesData();
                devicesInterval = setInterval(() => {
                    loadDevicesData();
                }, 3000);
            } else if (view === 'firewall') {
                loadFirewallRules();
            } else if (view === 'pppoe') {
                loadPppoeServerConfig();
            } else if (view === 'syslogs') {
                loadLogs('system');
            } else if (view === 'subvendo') {
                loadSubVendoConfig();
                loadSubVendoDevices();
                subVendoDevicesInterval = setInterval(() => {
                    if (currentView === 'subvendo') loadSubVendoDevices();
                }, 3000);
            }
        }

        function setSidebarOpen(open) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (!sidebar) return;
            sidebar.classList.toggle('open', !!open);
            if (overlay) overlay.classList.toggle('open', !!open);
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            setSidebarOpen(!sidebar.classList.contains('open'));
        }

        function setSidebarCollapsed(collapsed) {
            const sidebar = document.getElementById('sidebar');
            const logo = document.getElementById('sidebar-logo');
            if (!sidebar) return;
            sidebar.classList.toggle('collapsed', !!collapsed);
            document.body.classList.toggle('sidebar-collapsed', !!collapsed);
            if (logo) {
                const full = logo.getAttribute('data-logo-full') || '/neofi_logo.png';
                const compact = logo.getAttribute('data-logo-compact') || '/neologo.png';
                logo.src = collapsed ? compact : full;
            }
        }

        function toggleSidebarCollapsed() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
        }

        // --- Data Loading ---
        async function loadDashboardData() {
            try {
                const res = await fetch('/api/admin/dashboard', { credentials: 'include', cache: 'no-store' });
                if(res.status === 401) return location.reload();
                const data = await res.json();

                if (data.device_model) {
                    document.getElementById('board-model').textContent = data.device_model;
                }

                // Cards
                document.getElementById('sales-daily').textContent = '₱' + data.total_sales_today.toFixed(2);
                document.getElementById('sales-weekly').textContent = '₱' + (data.total_sales_week || 0).toFixed(2);
                document.getElementById('sales-monthly').textContent = '₱' + (data.total_sales_month || 0).toFixed(2);
                document.getElementById('sales-yearly').textContent = '₱' + (data.total_sales_year || 0).toFixed(2);
                
                document.getElementById('cpu-temp').textContent = data.cpu_temp ? data.cpu_temp.toFixed(1) + '°C' : 'N/A';
                document.getElementById('ram-usage').textContent = 
                    ((data.memory.total - data.memory.free) / 1024 / 1024).toFixed(0) + ' / ' + 
                    (data.memory.total / 1024 / 1024).toFixed(0) + ' MB';
                
                if (data.storage) {
                    const totalGB = (data.storage.total / 1024 / 1024 / 1024).toFixed(1);
                    const usedGB = (data.storage.used / 1024 / 1024 / 1024).toFixed(1);
                    const storageEl = document.getElementById('storage-usage');
                    if(storageEl) storageEl.textContent = `Used: ${usedGB} GB / Total: ${totalGB} GB`;
                }

                const uptimeHrs = (data.uptime / 3600).toFixed(1);
                document.getElementById('uptime').textContent = uptimeHrs + ' hrs';

                const connectedEl = document.getElementById('clients-connected-count');
                const pausedEl = document.getElementById('clients-paused-count');
                const disconnectedEl = document.getElementById('clients-disconnected-count');
                if (connectedEl) connectedEl.textContent = (data.clients_connected || 0);
                if (pausedEl) pausedEl.textContent = (data.clients_paused || 0);
                if (disconnectedEl) disconnectedEl.textContent = (data.clients_disconnected || 0);

                await refreshTopVendoSummary(false);
                await refreshTopClientsSummary(false);

                // CPU Chart Update
                let avgCpu = 0;
                let cores = [];
                
                if (data.cpu_usage) {
                    if (typeof data.cpu_usage === 'object' && data.cpu_usage.cores) {
                        // New format with per-core data
                        if (data.cpu_usage.cores.length > 0) {
                            // Calculate exact average of all cores as requested
                            const totalLoad = data.cpu_usage.cores.reduce((a, b) => a + b, 0);
                            avgCpu = totalLoad / data.cpu_usage.cores.length;
                        } else {
                            avgCpu = data.cpu_usage.avg;
                        }
                        cores = data.cpu_usage.cores;
                    } else {
                        // Old format or simple number
                        avgCpu = data.cpu_usage;
                        cores = [avgCpu];
                    }
                } else {
                    // Fallback to load_avg
                    avgCpu = (data.load_avg && data.load_avg.length > 0) ? (data.load_avg[0] * 10) : 0;
                    cores = [avgCpu];
                }

                // Ensure avgCpu is a valid number
                avgCpu = Number(avgCpu) || 0;

                // Update text elements immediately (before charts to prevent blocking on chart errors)
                const cpuTextEl = document.getElementById('cpu-text');
                if (cpuTextEl) cpuTextEl.textContent = Math.min(100, avgCpu).toFixed(1) + '%';

                const cpuLoadEl = document.getElementById('cpu-load');
                if (cpuLoadEl) cpuLoadEl.textContent = Math.min(100, avgCpu).toFixed(1) + '%';

                if (chartsEnabled && cpuDoughnut) {
                    try {
                        updateCpuChart(cores);
                    } catch(e) {
                        console.error("Chart Update Error:", e);
                    }
                }

                // DNS Stats Update
                if (data.dns) {
                    const stats = data.dns.stats;
                    const sHtml = `
                        <div style="margin-bottom:4px;">Total DNS Queries: <b>${stats.total_queries}</b></div>
                        <div style="margin-bottom:4px;">Answered from Cache: <b>${stats.cache_hits}</b> (${stats.cache_percent} %)</div>
                        <div style="margin-bottom:4px;">Blocked Request: <b>${stats.blocked_requests}</b></div>
                        <div style="margin-bottom:4px;">Block Rate: <b>${stats.block_rate} %</b></div>
                        <div style="margin-bottom:4px;">Blocklist Entries: <b>${stats.blocklist_entries.toLocaleString()}</b></div>
                    `;
                    const dnsContent = document.getElementById('dns-stats-content');
                    if(dnsContent) dnsContent.innerHTML = sHtml;

                    const renderList = (id, items) => {
                        const el = document.getElementById(id);
                        if (!el) return;
                        if (!items || items.length === 0) {
                            el.innerHTML = '<li>No data</li>';
                            return;
                        }
                        el.innerHTML = items.map(i => `<li style="margin-bottom:4px;">${i.name || i.ip} (${i.count})</li>`).join('');
                    };

                    renderList('dns-top-blocked', data.dns.top_blocked);
                    renderList('dns-top-queried', data.dns.top_queried);
                    renderList('dns-top-clients', data.dns.top_clients);
                }



               // Bandwidth Chart
                if (data.network_interfaces) {
                    updateBandwidthChart(data.network_interfaces);
                } else {
                    updateBandwidthChart();
                }
                
                // If on Network tab, refresh specific network data
                if (document.getElementById('view-network').style.display === 'block') {
                    // Only fetch if we haven't fetched recently or forced
                    // For simplicity, we might just let the user click Refresh or rely on this loop
                    // But to avoid flicker, maybe we don't auto-refresh the tables every 3s
                }

            } catch(e) {
                console.error("Dashboard Load Error:", e);
            }
        }

        async function refreshTopVendoSummary(showLoading) {
            const topVendoEl = document.getElementById('top-vendo-summary');
            if (!topVendoEl) return;

            const period = topVendoPeriod || 'monthly';
            if (showLoading) {
                topVendoEl.textContent = 'Loading...';
            }

            try {
                const res = await fetch(`/api/admin/sales/by-device?type=${encodeURIComponent(period)}`, { credentials: 'include', cache: 'no-store' });
                if (res.ok) {
                    const rows = await res.json();
                    if (Array.isArray(rows) && rows.length > 0) {
                        const sorted = rows.slice().sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
                        const top = sorted.slice(0, 5);
                        const html = top.map(r => {
                            const name = r.name || r.source || '-';
                            const amt = (Number(r.total) || 0).toFixed(2);
                            return `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                        <span>${name}</span>
                                        <span style="font-weight:bold;">₱${amt}</span>
                                    </div>`;
                        }).join('');
                        topVendoEl.innerHTML = html;
                    } else {
                        let text = 'No sales data';
                        if (period === 'daily') text += ' today';
                        else if (period === 'weekly') text += ' in last 7 days';
                        else if (period === 'monthly') text += ' this month';
                        else if (period === 'yearly') text += ' this year';
                        topVendoEl.textContent = text;
                    }
                } else {
                    topVendoEl.textContent = 'Unable to load data';
                }
            } catch (e) {
                topVendoEl.textContent = 'Error loading data';
            }
        }

        async function refreshTopClientsSummary(showLoading) {
            const topClientsEl = document.getElementById('top-clients-summary');
            if (!topClientsEl) return;

            const period = topClientsPeriod || 'monthly';
            if (showLoading) {
                topClientsEl.textContent = 'Loading...';
            }

            try {
                const res = await fetch(`/api/admin/sales/by-client?type=${encodeURIComponent(period)}`, { credentials: 'include', cache: 'no-store' });
                if (res.ok) {
                    const rows = await res.json();
                    if (Array.isArray(rows) && rows.length > 0) {
                        const sorted = rows.slice().sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
                        const top = sorted.slice(0, 5);
                        const html = top.map(r => {
                            const mac = r.mac_address || 'Unknown';
                            const alias = (r.alias || '').trim();
                            const clientId = (r.client_id || '').trim();
                            const name = alias || mac;
                            const metaParts = [];
                            if (mac) metaParts.push(`MAC: ${mac}`);
                            if (clientId) metaParts.push(`ID: ${clientId}`);
                            const metaLine = metaParts.length ? `<div style="font-size:0.75rem; color:#636e72;">${metaParts.join(' | ')}</div>` : '';
                            const amt = (Number(r.total) || 0).toFixed(2);
                            return `<div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                                        <div style="display:flex; flex-direction:column;">
                                            <span>${name}</span>
                                            ${metaLine}
                                        </div>
                                        <span style="font-weight:bold;">₱${amt}</span>
                                    </div>`;
                        }).join('');
                        topClientsEl.innerHTML = html;
                    } else {
                        let text = 'No client sales';
                        if (period === 'daily') text += ' today';
                        else if (period === 'weekly') text += ' in last 7 days';
                        else if (period === 'monthly') text += ' this month';
                        else if (period === 'yearly') text += ' this year';
                        topClientsEl.textContent = text;
                    }
                } else {
                    topClientsEl.textContent = 'Unable to load data';
                }
            } catch (e) {
                topClientsEl.textContent = 'Error loading data';
            }
        }

        function onTopVendoPeriodChange(value) {
            topVendoPeriod = value || 'monthly';
            const select = document.getElementById('top-vendo-period');
            if (select && select.value !== topVendoPeriod) {
                select.value = topVendoPeriod;
            }
            refreshTopVendoSummary(true);
        }

        function onTopClientsPeriodChange(value) {
            topClientsPeriod = value || 'monthly';
            const select = document.getElementById('top-clients-period');
            if (select && select.value !== topClientsPeriod) {
                select.value = topClientsPeriod;
            }
            refreshTopClientsSummary(true);
        }

        // --- Logs Logic ---
        async function loadLogs(category = 'system') {
            const displayArea = document.getElementById('log-display-area');
            const categorySelect = document.getElementById('log-category-filter');
            
            // Sync select if called without event
            if (categorySelect.value !== category) {
                categorySelect.value = category;
            }

            displayArea.innerHTML = '<div style="color: #bdc3c7;">Loading logs...</div>';

            try {
                const res = await fetch(`/api/logs?source=${category}&limit=100`, { credentials: 'include' });
                if (!res.ok) {
                    let errMsg = res.statusText;
                    try {
                        const errJson = await res.json();
                        errMsg = errJson.error || errMsg;
                    } catch (err) {
                        errMsg = await res.text();
                    }
                    throw new Error(`Failed to fetch logs (${res.status}): ${errMsg}`);
                }
                const logs = await res.json();

                if (!logs || logs.length === 0) {
                    displayArea.innerHTML = '<div style="color: #bdc3c7;">No logs found.</div>';
                    return;
                }

                let html = '';
                logs.forEach(log => {
                    let line = '';
                    // Formatting based on category
                    if (category === 'system' || category === 'errors') {
                        // system_logs table: id, level, category, message, timestamp
                        const color = log.level === 'CRITICAL' ? '#e74c3c' : 
                                      log.level === 'ERROR' ? '#e74c3c' : 
                                      log.level === 'WARN' ? '#f39c12' : '#2ecc71';
                        
                        line = `<div style="margin-bottom: 4px; border-bottom: 1px solid #2c3e50; padding-bottom: 2px;">
                                    <span style="color: #95a5a6;">[${new Date(log.timestamp).toLocaleString()}]</span> 
                                    <span style="color: ${color}; font-weight: bold;">[${log.level}]</span> 
                                    <span style="color: #3498db;">[${log.category}]</span> 
                                    <span style="color: #ecf0f1;">${log.message}</span>
                                </div>`;
                    } else if (category === 'vouchers') {
                        // voucher query result: code, plan_name, price, used_at, mac_address, ip_address
                        line = `<div style="margin-bottom: 4px; border-bottom: 1px solid #2c3e50; padding-bottom: 2px;">
                                    <span style="color: #95a5a6;">[${new Date(log.used_at).toLocaleString()}]</span> 
                                    <span style="color: #f1c40f;">[VOUCHER]</span> 
                                    <span style="color: #ecf0f1;">Code: ${log.code} (${log.plan_name} - ₱${log.price})</span> 
                                    <span style="color: #bdc3c7;">used by ${log.mac_address} (${log.ip_address || 'N/A'})</span>
                                </div>`;
                    } else if (category === 'pppoe') {
                        // Raw text or object
                        const msg = log.message || log.raw || JSON.stringify(log);
                        const time = log.timestamp ? `[${new Date(log.timestamp).toLocaleString()}] ` : '';
                        line = `<div style="margin-bottom: 4px; border-bottom: 1px solid #2c3e50; padding-bottom: 2px;">
                                    <span style="color: #95a5a6;">${time}</span>
                                    <span style="color: #e67e22;">[PPPoE]</span> 
                                    <span style="color: #ecf0f1;">${msg}</span>
                                </div>`;
                    }
                    html += line;
                });

                displayArea.innerHTML = html;
            } catch (e) {
                console.error("Log load error:", e);
                displayArea.innerHTML = `<div style="color: #e74c3c;">Error loading logs: ${e.message}</div>`;
            }
        }

        async function verifyConfiguration() {
            const modal = document.getElementById('verify-modal');
            const resultsDiv = document.getElementById('verify-results');
            
            modal.style.display = 'flex';
            resultsDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#666;"><i class="fas fa-spinner fa-spin"></i> Running system checks...</div>';
            
            try {
                const res = await fetch('/api/admin/system/verify', { credentials: 'include' });
                const data = await res.json();
                
                if (data.error) throw new Error(data.error);
                
                let html = '';
                data.checks.forEach(check => {
                    let icon = '';
                    let color = '';
                    
                    switch(check.status) {
                        case 'success':
                            icon = '<i class="fas fa-check-circle"></i>';
                            color = '#2ecc71';
                            break;
                        case 'warning':
                            icon = '<i class="fas fa-exclamation-triangle"></i>';
                            color = '#f1c40f';
                            break;
                        case 'error':
                            icon = '<i class="fas fa-times-circle"></i>';
                            color = '#e74c3c';
                            break;
                        default:
                            icon = '<i class="fas fa-info-circle"></i>';
                            color = '#3498db';
                    }
                    
                    html += `<div style="display:flex; align-items:center; margin-bottom:10px; padding:10px; background:#f8f9fa; border-radius:5px; border-left: 4px solid ${color};">
                        <div style="color:${color}; font-size:1.2rem; margin-right:15px; min-width:20px; text-align:center;">${icon}</div>
                        <div>
                            <div style="font-weight:600; color:#2c3e50;">${check.category}</div>
                            <div style="font-size:0.9rem; color:#555;">${check.message}</div>
                        </div>
                    </div>`;
                });
                
                resultsDiv.innerHTML = html;
                
            } catch (e) {
                console.error("Verification failed", e);
                resultsDiv.innerHTML = `<div style="color:#e74c3c; padding:20px; text-align:center;">
                    <i class="fas fa-exclamation-circle" style="font-size:2rem; margin-bottom:10px;"></i><br>
                    Verification failed: ${e.message}
                </div>`;
            }
        }

        // --- WiFi Config Logic ---
        async function loadWifiConfig() {
            try {
                const res = await fetch('/api/admin/wifi/config', { credentials: 'include' });
                const config = await res.json();
                
                document.getElementById('wifi-enabled').checked = config.enabled;
                document.getElementById('wifi-ssid').value = config.ssid || 'NeoFi_Built-In_WiFi';
                document.getElementById('wifi-password').value = config.password || '';
                document.getElementById('wifi-channel').value = config.channel || 6;
                document.getElementById('wifi-hw-mode').value = config.hw_mode || 'g';
                
                // Toggle inputs based on enabled state
                toggleWifiInputs(config.enabled);
            } catch (e) {
                console.error('Error loading WiFi config:', e);
            }
        }

        document.getElementById('wifi-enabled').addEventListener('change', (e) => {
            toggleWifiInputs(e.target.checked);
        });

        function toggleWifiInputs(enabled) {
            const inputs = ['wifi-ssid', 'wifi-password', 'wifi-channel', 'wifi-hw-mode'];
            inputs.forEach(id => {
                document.getElementById(id).disabled = !enabled;
            });
        }

        async function saveWifiConfig(e) {
            e.preventDefault();
            const enabled = document.getElementById('wifi-enabled').checked;
            const ssid = document.getElementById('wifi-ssid').value;
            const password = document.getElementById('wifi-password').value;
            const channel = parseInt(document.getElementById('wifi-channel').value);
            const hw_mode = document.getElementById('wifi-hw-mode').value;

            try {
                const res = await fetch('/api/admin/wifi/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled, ssid, password, channel, hw_mode }),
                    credentials: 'include'
                });
                
                if (res.ok) {
                    alert('WiFi configuration saved. Access Point is restarting...');
                } else {
                    const err = await res.json();
                    alert('Error saving WiFi config: ' + err.error);
                }
            } catch (e) {
                console.error('Error saving WiFi config:', e);
                alert('Network error saving WiFi config');
            }
        }

        window.addEventListener('afterprint', () => {
            if (document && document.body) {
                document.body.classList.remove('voucher-printing');
            }
        });

        let lastRx = 0;
        let lastTx = 0;
        let lastTime = Date.now();
        let baseRx = 0;
        let baseTx = 0;
        let lastInterface = '';

        function formatTrafficAmount(bytes) {
            const mb = bytes / (1024 * 1024);
            if (mb >= 1024) {
                const gb = mb / 1024;
                return gb.toFixed(2) + ' GB';
            }
            return mb.toFixed(2) + ' MB';
        }

        async function updateBandwidthChart(providedStats = null) {
            try {
                let stats = providedStats;
                if (!stats) {
                    const res = await fetch('/api/admin/network-stats', { credentials: 'include' });
                    stats = await res.json();
                }
                
                // Detect LAN Interface (Primary for Hotspot Monitoring)
                // Priority: br0/br-lan (LAN Bridge) > wlan0 (WiFi) > WAN (Fallback)
                let currentRx = 0;
                let currentTx = 0;
                let isWanInterface = false; // Default to LAN logic
                let detectedIfaceName = '';

                const br0 = stats.find(i => i.interface === 'br0' || i.interface === 'br-lan');
                const wlan0 = stats.find(i => i.interface === 'wlan0');

                // WAN Interfaces (Fallback)
                const end0 = stats.find(i => i.interface === 'end0');
                const pppoe = stats.find(i => i.interface === 'pppoe-wan' || i.interface === 'ppp0');
                const eth0 = stats.find(i => i.interface === 'eth0');
                const usb = stats.find(i => i.interface.startsWith('usb'));
                const wwan = stats.find(i => i.interface.startsWith('wwan'));
                const wlan1 = stats.find(i => i.interface === 'wlan1');

                if (br0) {
                    currentRx = br0.rx_bytes;
                    currentTx = br0.tx_bytes;
                    detectedIfaceName = (br0.interface === 'br-lan' ? 'br-lan' : 'br0') + ' (LAN)';
                } else if (wlan0) {
                    currentRx = wlan0.rx_bytes;
                    currentTx = wlan0.tx_bytes;
                    detectedIfaceName = 'wlan0 (WiFi)';
                } else if (end0) {
                    currentRx = end0.rx_bytes;
                    currentTx = end0.tx_bytes;
                    isWanInterface = true;
                    detectedIfaceName = 'end0 (WAN)';
                } else if (pppoe) {
                    currentRx = pppoe.rx_bytes;
                    currentTx = pppoe.tx_bytes;
                    isWanInterface = true;
                    detectedIfaceName = pppoe.interface + ' (WAN)';
                } else if (eth0) {
                    currentRx = eth0.rx_bytes;
                    currentTx = eth0.tx_bytes;
                    isWanInterface = true;
                    detectedIfaceName = 'eth0 (WAN)';
                } else if (usb) {
                    currentRx = usb.rx_bytes;
                    currentTx = usb.tx_bytes;
                    isWanInterface = true;
                    detectedIfaceName = usb.interface + ' (WAN)';
                } else if (wwan) {
                    currentRx = wwan.rx_bytes;
                    currentTx = wwan.tx_bytes;
                    isWanInterface = true;
                    detectedIfaceName = wwan.interface + ' (WAN)';
                } else if (wlan1) {
                    currentRx = wlan1.rx_bytes;
                    currentTx = wlan1.tx_bytes;
                    isWanInterface = true;
                    detectedIfaceName = 'wlan1 (WAN)';
                } else {
                    stats.forEach(iface => {
                        if (iface.interface !== 'lo') {
                            currentRx += iface.rx_bytes;
                            currentTx += iface.tx_bytes;
                        }
                    });
                    detectedIfaceName = 'Aggregate';
                }

                // Update UI with detected interface if element exists
                const ifaceLabel = document.getElementById('monitored-interface-label');
                if (ifaceLabel) ifaceLabel.textContent = detectedIfaceName;

                const now = Date.now();
                
                // Reset if interface changed or first run
                if (detectedIfaceName !== lastInterface) {
                    console.log(`Interface changed from ${lastInterface} to ${detectedIfaceName}. Resetting counters.`);
                    lastRx = currentRx;
                    lastTx = currentTx;
                    lastTime = now;
                    baseRx = currentRx;
                    baseTx = currentTx;
                    lastInterface = detectedIfaceName;
                    return;
                }

                const timeDiff = (now - lastTime) / 1000; // Seconds

                // Initialize lastRx/lastTx if 0 (first run or reset)
                if (lastRx === 0 && currentRx > 0) {
                    lastRx = currentRx;
                    lastTx = currentTx;
                    lastTime = now;
                    baseRx = currentRx;
                    baseTx = currentTx;
                    return;
                }

                if (timeDiff > 0) {
                    // Calculate speed in Mbps
                    let rxSpeed = 0;
                    let txSpeed = 0;
                    
                    if (currentRx >= lastRx) {
                        rxSpeed = Number(((currentRx - lastRx) * 8 / 1024 / 1024 / timeDiff).toFixed(2));
                    }
                    if (currentTx >= lastTx) {
                        txSpeed = Number(((currentTx - lastTx) * 8 / 1024 / 1024 / timeDiff).toFixed(2));
                    }
                    
                    // Sanity check for huge spikes
                    if (rxSpeed > 1000) rxSpeed = 0; 
                    if (txSpeed > 1000) txSpeed = 0;

                    // Map to Download/Upload based on Interface Type
                    // For LAN (br0/wlan0): RX = Upload (from client), TX = Download (to client)
                    // For WAN (eth0): RX = Download (from internet), TX = Upload (to internet)
                    
                    let downloadSpeed, uploadSpeed;
                    
                    if (isWanInterface) {
                        downloadSpeed = rxSpeed; // WAN: RX is Download (from Internet)
                        uploadSpeed = txSpeed;   // WAN: TX is Upload (to Internet)
                    } else {
                        downloadSpeed = txSpeed; // LAN: TX is Download (to Client)
                        uploadSpeed = rxSpeed;   // LAN: RX is Upload (from Client)
                    }

                    // Update Chart if enabled
                    if (chartsEnabled && bwChart) {
                        const label = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        bwChart.data.labels.push(label);
                        bwChart.data.labels.shift();

                        // Input (Download) -> Positive
                        bwChart.data.datasets[0].data.push(downloadSpeed);
                        bwChart.data.datasets[0].data.shift();
                        
                        // Output (Upload) -> Positive (Area Chart)
                        bwChart.data.datasets[1].data.push(uploadSpeed);
                        bwChart.data.datasets[1].data.shift();
                        
                        const maxVal = Math.max(
                            ...bwChart.data.datasets[0].data.map(v => Number(v) || 0),
                            ...bwChart.data.datasets[1].data.map(v => Number(v) || 0)
                        );
                        // Scale adjustment for Mbps
                        const raw = Math.max(1, maxVal * 1.15);
                        let step = 1;
                        if (raw <= 5) step = 1;
                        else if (raw <= 10) step = 2;
                        else if (raw <= 50) step = 10;
                        else if (raw <= 100) step = 20;
                        else step = 50;

                        const nice = Math.ceil(raw / step) * step;
                        bwChart.options.scales.y.max = nice;
                        // Min is always 0 for area chart
                        bwChart.options.scales.y.min = 0;

                        bwChart.update();
                        
                        updateBwStats(bwChart.data.datasets[0].data, bwChart.data.datasets[1].data);

                        let totalDownloadBytes = 0;
                        let totalUploadBytes = 0;

                        if (isWanInterface) {
                            if (currentRx >= baseRx) totalDownloadBytes = currentRx - baseRx;
                            if (currentTx >= baseTx) totalUploadBytes = currentTx - baseTx;
                        } else {
                            if (currentTx >= baseTx) totalDownloadBytes = currentTx - baseTx;
                            if (currentRx >= baseRx) totalUploadBytes = currentRx - baseRx;
                        }

                        const dlTotalEl = document.getElementById('rx-total');
                        const ulTotalEl = document.getElementById('tx-total');
                        if (dlTotalEl) dlTotalEl.textContent = formatTrafficAmount(totalDownloadBytes);
                        if (ulTotalEl) ulTotalEl.textContent = formatTrafficAmount(totalUploadBytes);
                    }
                    
                    // Update Text Fallback (always)
                    const bwText = document.getElementById('bw-text-fallback');
                    if (bwText) {
                        const rxMbps = parseFloat(rxSpeed).toFixed(2);
                        const txMbps = parseFloat(txSpeed).toFixed(2);
                        bwText.textContent = `DL: ${rxMbps} Mbps | UL: ${txMbps} Mbps`;
                    }
                }

                lastRx = currentRx;
                lastTx = currentTx;
                lastTime = now;
            } catch (e) {
                console.error("Chart error", e);
            }
        }

        function updateBwStats(rxData, txData) {
            // RX Data is positive
            const rxVals = rxData.map(v => parseFloat(v));
            const rxMin = Math.min(...rxVals);
            const rxMax = Math.max(...rxVals);
            const rxAvg = rxVals.reduce((a, b) => a + b, 0) / rxVals.length;
            const rxLast = rxVals[rxVals.length - 1];

            // TX Data is negative, convert to positive for stats
            const txVals = txData.map(v => Math.abs(parseFloat(v)));
            const txMin = Math.min(...txVals);
            const txMax = Math.max(...txVals);
            const txAvg = txVals.reduce((a, b) => a + b, 0) / txVals.length;
            const txLast = txVals[txVals.length - 1];

            // Helper to update DOM - Values are already in Mbps
            const set = (id, val) => {
                const el = document.getElementById(id);
                if(el) el.textContent = val.toFixed(2) + ' Mbps';
            };

            set('rx-min', rxMin);
            set('rx-max', rxMax);
            set('rx-avg', rxAvg);
            set('rx-last', rxLast);

            set('tx-min', txMin);
            set('tx-max', txMax);
            set('tx-avg', txAvg);
            set('tx-last', txLast);
        }

        async function loadSalesData(type='daily') {
            currentSalesType = type;
            // Update active button state
            const btns = document.querySelectorAll('#view-sales button.btn-sm');
            if(btns.length > 0) {
                 btns.forEach(b => {
                     // specific match or fallback
                     const btnText = b.textContent.toLowerCase();
                     const isMatch = (type === 'history' && btnText.includes('all')) || 
                                   (type !== 'history' && btnText === type);
                                   
                     if(isMatch) {
                         b.classList.add('btn-primary');
                         b.style.background = '';
                     } else {
                         b.classList.remove('btn-primary');
                         b.style.background = '#eee';
                     }
                 });
            }

            const tableHead = document.querySelector('#sales-table thead tr');
            const tbody = document.querySelector('#sales-table tbody');
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Loading...</td></tr>';

            try {
                // Pre-fetch device names if history mode to populate cache
                let deviceDataPromise = null;
                if (type === 'history') {
                    deviceDataPromise = loadSalesByDevice(type);
                }

                const res = await fetch('/api/admin/sales?type=' + type);
                if(res.status === 401) return location.reload();
                const data = await res.json();
                
                // Wait for device data if needed
                if (deviceDataPromise) {
                    await deviceDataPromise;
                }
                
                tbody.innerHTML = '';

                if (type === 'history') {
                    // History Mode: per coin insert log
                    tableHead.innerHTML = `
                        <th style="padding:10px;">ID</th>
                        <th style="padding:10px;">Time Stamp</th>
                        <th style="padding:10px;">User Device ID</th>
                        <th style="padding:10px;">Amount</th>
                        <th style="padding:10px;">Vendo</th>
                    `;

                    if (data.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">No transactions found</td></tr>';
                        // deviceDataPromise already called if history
                        return;
                    }

                    // Build lookup map from cache
                    const deviceMap = {};
                    if (window.salesByDeviceCache && Array.isArray(window.salesByDeviceCache)) {
                        window.salesByDeviceCache.forEach(d => {
                            if (d.source) deviceMap[d.source] = d.name || d.source;
                        });
                    }

                    data.forEach(d => {
                        const tr = document.createElement('tr');
                        const date = new Date(d.timestamp).toLocaleString();
                        const amount = Number(d.amount) || 0;
                        const sourceRaw = d.source || 'hardware';
                        const sourceName = deviceMap[sourceRaw] || sourceRaw;

                        tr.innerHTML = `
                            <td>${d.id}</td>
                            <td>${date}</td>
                            <td style="font-family:monospace;">${d.mac_address || 'Unknown'}</td>
                            <td style="font-weight:bold; color:var(--success);">₱${amount.toFixed(2)}</td>
                            <td style="font-family:monospace;">${sourceName}</td>
                        `;
                        tbody.appendChild(tr);
                    });

                    // Already called loadSalesByDevice(type) via deviceDataPromise
                } else {
                    // Aggregated Mode: Date | Amount
                    tableHead.innerHTML = `<th>Date</th><th>Amount</th>`;
                    
                    if (data.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px;">No sales data</td></tr>';
                        await loadSalesByDevice(type);
                        return;
                    }

                    data.forEach(d => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `<td>${d.label}</td><td style="font-weight:bold;">₱${d.value.toFixed(2)}</td>`;
                        tbody.appendChild(tr);
                    });

                    await loadSalesByDevice(type);
                }
            } catch (e) {
                console.error("Error loading sales:", e);
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Error loading data</td></tr>';
            }
        }

        async function loadSalesByDevice(type='daily') {
            const tbody = document.querySelector('#sales-by-device-table tbody');
            if (!tbody) return;

            try {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">Loading...</td></tr>';

                const res = await fetch('/api/admin/sales/by-device?type=' + type);
                if (res.status === 401) return location.reload();
                const rows = await res.json();

                tbody.innerHTML = '';
                window.salesByDeviceCache = Array.isArray(rows) ? rows : [];
                if (!Array.isArray(rows) || rows.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No device sales data</td></tr>';
                    return;
                }

                rows.forEach(r => {
                    const tr = document.createElement('tr');
                    const total = (Number(r.total) || 0).toFixed(2);
                    const daily = (Number(r.daily) || 0).toFixed(2);
                    const pending = (Number(r.pending) || 0).toFixed(2);
                    tr.innerHTML = `
                        <td>${r.name || r.source || '-'}</td>
                        <td style="font-weight:bold;">₱${total}</td>
                        <td>₱${daily}</td>
                        <td style="color:#e67e22; font-weight:600;">₱${pending}</td>
                        <td>
                            <button class="btn btn-sm" onclick="openSalesCoinsOutLogsModal('${r.source || ''}')">Sales Logs</button>
                        </td>
                        <td>
                            <button class="btn btn-sm" onclick="openSalesCoinsOutModal('${r.source || ''}')">Coins Out</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Error loading sales by device:", e);
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Error loading device sales</td></tr>';
            }
        }

        let salesCoinsOutSource = null;
        let salesCoinsOutPending = 0;

        function openSalesCoinsOutModal(source) {
            const modal = document.getElementById('sales-coinsout-modal');
            const nameEl = document.getElementById('sales-coinsout-device');
            const baseEl = document.getElementById('sales-coinsout-base');
            const percentEl = document.getElementById('sales-coinsout-percent');
            const shareEl = document.getElementById('sales-coinsout-share');
            const ownerEl = document.getElementById('sales-coinsout-owner');

            const rows = window.salesByDeviceCache || [];
            const row = rows.find(r => (r.source || '') === source) || null;

            const base = row ? Number(row.pending || 0) : 0;
            salesCoinsOutSource = source;
            salesCoinsOutPending = base;

            if (nameEl) nameEl.textContent = row ? (row.name || row.source || '-') : source || '-';
            if (baseEl) baseEl.textContent = `₱${base.toFixed(2)}`;

            if (percentEl) {
                if (!percentEl.value) percentEl.value = '20';
            }

            const pct = percentEl ? (Number(percentEl.value) || 0) : 0;
            const shareAmount = base * (pct / 100);
            const ownerAmount = base - shareAmount;

            if (shareEl) shareEl.textContent = `₱${shareAmount.toFixed(2)}`;
            if (ownerEl) ownerEl.textContent = `₱${ownerAmount.toFixed(2)}`;

            if (modal) modal.style.display = 'flex';
        }

        function closeSalesCoinsOutModal() {
            const modal = document.getElementById('sales-coinsout-modal');
            if (modal) modal.style.display = 'none';
        }

        function recalcSalesCoinsOutShare() {
            const base = salesCoinsOutPending || 0;
            const percentEl = document.getElementById('sales-coinsout-percent');
            const shareEl = document.getElementById('sales-coinsout-share');
            const ownerEl = document.getElementById('sales-coinsout-owner');

            let pct = percentEl ? Number(percentEl.value) : 0;
            if (!Number.isFinite(pct)) pct = 0;
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            if (percentEl) percentEl.value = pct.toString();

            const shareAmount = base * (pct / 100);
            const ownerAmount = base - shareAmount;

            if (shareEl) shareEl.textContent = `₱${shareAmount.toFixed(2)}`;
            if (ownerEl) ownerEl.textContent = `₱${ownerAmount.toFixed(2)}`;
        }

        async function openSalesCoinsOutLogsModal(source) {
            const modal = document.getElementById('sales-coinsout-logs-modal');
            const deviceEl = document.getElementById('sales-coinsout-logs-device');
            const listEl = document.getElementById('sales-coinsout-logs-list');
            if (!modal || !listEl) return;

            const rows = window.salesByDeviceCache || [];
            const row = rows.find(r => (r.source || '') === source) || null;
            if (deviceEl) deviceEl.textContent = row ? (row.name || row.source || '-') : source || '-';

            listEl.innerHTML = '<li>Loading...</li>';

            try {
                const res = await fetch('/api/admin/sales/coins-out/logs?source=' + encodeURIComponent(source));
                if (res.status === 401) return location.reload();
                const logs = await res.json();
                listEl.innerHTML = '';
                if (!Array.isArray(logs) || logs.length === 0) {
                    listEl.innerHTML = '<li>No Coins Out records</li>';
                } else {
                    logs.forEach(item => {
                        const li = document.createElement('li');
                        const ts = item.created_at ? new Date(item.created_at.replace(' ', 'T')).toLocaleString() : '';
                        const amount = Number(item.amount || 0).toFixed(2);
                        const base = item.base_amount != null ? Number(item.base_amount) : null;
                        const pct = item.partner_percent != null ? Number(item.partner_percent) : null;
                        let detail = '';
                        if (base != null && !Number.isNaN(base) && pct != null && !Number.isNaN(pct)) {
                            const share = base * (pct / 100);
                            detail = ` (from ₱${base.toFixed(2)}, ${pct.toFixed(0)}% = ₱${share.toFixed(2)} share)`;
                        }
                        li.textContent = `${ts} — ₱${amount}${detail}`;
                        listEl.appendChild(li);
                    });
                }
            } catch (e) {
                console.error('Coins Out logs load error', e);
                listEl.innerHTML = '<li>Error loading logs</li>';
            }

            modal.style.display = 'flex';
        }

        function closeSalesCoinsOutLogsModal() {
            const modal = document.getElementById('sales-coinsout-logs-modal');
            if (modal) modal.style.display = 'none';
        }

        async function performSalesCoinsOut() {
            if (!salesCoinsOutSource) {
                closeSalesCoinsOutModal();
                return;
            }
            try {
                const base = salesCoinsOutPending || 0;
                const percentEl = document.getElementById('sales-coinsout-percent');
                let pct = percentEl ? Number(percentEl.value) : 0;
                if (!Number.isFinite(pct)) pct = 0;
                if (pct < 0) pct = 0;
                if (pct > 100) pct = 100;
                const partnerShare = base * (pct / 100);
                const coinsOutAmount = base - partnerShare;

                const res = await fetch('/api/admin/sales/coins-out', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ source: salesCoinsOutSource, amount: coinsOutAmount, base: base, percent: pct })
                });
                if (res.status === 401) return location.reload();
                
                if (!res.ok) {
                    const text = await res.text();
                    try {
                        const json = JSON.parse(text);
                        alert('Coins Out failed: ' + (json.error || text));
                    } catch (e) {
                        alert('Coins Out failed: ' + text.substring(0, 100));
                    }
                    return;
                }

                const data = await res.json();
                if (data && data.success) {
                    closeSalesCoinsOutModal();
                    await loadSalesByDevice(currentSalesType || 'daily');
                } else {
                    alert('Coins Out failed');
                }
            } catch (e) {
                console.error('Coins Out error', e);
                alert('Coins Out error: ' + e.message);
            }
        }

        // --- Time & NTP Settings ---

        async function loadTimeSettings() {
            try {
                // Load Timezones first if empty
                const tzSelect = document.getElementById('timezone-select');
                if (tzSelect.options.length === 0) {
                    await loadTimezones();
                }

                const res = await fetch('/api/admin/system/time');
                const settings = await res.json();
                
                document.getElementById('time-sync-mode').value = settings.time_sync_mode || 'auto';
                document.getElementById('ntp-server').value = settings.ntp_server || 'pool.ntp.org';
                document.getElementById('timezone-mode').value = settings.timezone_mode || 'auto';
                document.getElementById('timezone-select').value = settings.timezone || 'Asia/Manila';
                
                if (settings.manual_datetime) {
                    document.getElementById('manual-datetime').value = settings.manual_datetime;
                }
                
                if (settings.current_system_time) {
                    startClock(settings.current_system_time);
                }

                toggleTimeInputs();
            } catch (e) {
                console.error("Error loading time settings", e);
            }
        }

        async function loadTimezones() {
            try {
                const res = await fetch('/api/admin/system/timezones');
                if (!res.ok) throw new Error('Failed to load timezones');
                
                const timezones = await res.json();
                if (!Array.isArray(timezones) || timezones.length === 0) throw new Error("Empty timezone list");

                const select = document.getElementById('timezone-select');
                select.innerHTML = '';
                
                timezones.forEach(tz => {
                    const opt = document.createElement('option');
                    opt.value = tz;
                    opt.textContent = tz;
                    select.appendChild(opt);
                });
            } catch (e) {
                console.error("Error loading timezones, using fallback", e);
                const select = document.getElementById('timezone-select');
                // Only populate fallback if empty
                if (select.options.length === 0) {
                    const fallbackTimezones = [
                        'Asia/Manila', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Shanghai', 
                        'America/New_York', 'Europe/London', 'UTC'
                    ];
                    select.innerHTML = '';
                    fallbackTimezones.forEach(tz => {
                        const opt = document.createElement('option');
                        opt.value = tz;
                        opt.textContent = tz; // + ' (Fallback)'
                        select.appendChild(opt);
                    });
                }
            }
        }

        function toggleTimeInputs() {
            const syncMode = document.getElementById('time-sync-mode').value;
            const tzMode = document.getElementById('timezone-mode').value;
            
            // Time Sync logic
            if (syncMode === 'auto') {
                document.getElementById('ntp-server-group').style.display = 'block';
                document.getElementById('manual-time-group').style.display = 'none';
            } else {
                document.getElementById('ntp-server-group').style.display = 'none';
                document.getElementById('manual-time-group').style.display = 'block';
            }

            // Timezone logic
            if (tzMode === 'auto') {
                document.getElementById('timezone-select-group').style.display = 'none';
            } else {
                document.getElementById('timezone-select-group').style.display = 'block';
            }
        }

        async function saveTimeSettings(e) {
            e.preventDefault();
            
            const data = {
                time_sync_mode: document.getElementById('time-sync-mode').value,
                ntp_server: document.getElementById('ntp-server').value.trim(),
                timezone_mode: document.getElementById('timezone-mode').value,
                timezone: document.getElementById('timezone-select').value,
                manual_datetime: document.getElementById('manual-datetime').value
            };
            
            try {
                const res = await fetch('/api/admin/system/time', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                
                if (res.status === 404) {
                    alert('Error: The Time Settings API was not found. Please RESTART the server to apply the latest updates.');
                    return;
                }

                const text = await res.text();
                
                if (res.ok) {
                    try {
                        // Attempt to parse JSON response
                        const json = text ? JSON.parse(text) : {};
                        alert('Time settings saved successfully. System time may update shortly.');
                        loadTimeSettings(); // Refresh to see updated time
                    } catch (parseErr) {
                        console.error('Invalid JSON response:', text);
                        alert('Settings saved, but server response was invalid.');
                    }
                } else {
                    try {
                        const err = JSON.parse(text);
                        alert('Error: ' + (err.error || text));
                    } catch (parseErr) {
                        alert('Server Error: ' + text);
                    }
                }
            } catch (e) {
                console.error(e);
                alert('Failed to save time settings: ' + e.message);
            }
        }

        async function loadSettingsData() {
            const res = await fetch('/api/admin/settings');
            const settings = await res.json();
            const container = document.getElementById('settings-container');
            container.innerHTML = '';
            
            // Helper to create form group
            const createGroup = (label, input) => {
                const div = document.createElement('div');
                // Removed explicit marginBottom, handled by grid gap
                div.innerHTML = `<label style="display:block; font-weight:600; margin-bottom:0px; line-height:1.1; font-size:0.85rem; color:#636e72;">${label}</label>`;
                div.appendChild(input);
                return div;
            };

            const createInput = (name, value, type='text', placeholder='') => {
                const i = document.createElement('input');
                i.id = name;
                i.name = name;
                i.value = value || '';
                i.type = type;
                i.placeholder = placeholder;
                i.autocomplete = 'off';
                i.style.width = '100%';
                i.style.padding = '3px 8px';
                i.style.border = '1px solid #dfe6e9';
                i.style.borderRadius = '4px';
                i.style.fontFamily = 'inherit';
                i.style.fontSize = '0.85rem';
                i.style.boxSizing = 'border-box';
                return i;
            };

            const createSelect = (name, value, options) => {
                const s = document.createElement('select');
                s.id = name;
                s.name = name;
                s.style.width = '100%';
                s.style.padding = '3px 8px';
                s.style.border = '1px solid #dfe6e9';
                s.style.borderRadius = '4px';
                s.style.fontFamily = 'inherit';
                s.style.fontSize = '0.85rem';
                s.style.background = '#fff';
                s.style.boxSizing = 'border-box';
                
                options.forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt;
                    o.textContent = opt;
                    if (opt === value) o.selected = true;
                    s.appendChild(o);
                });
                return s;
            };

            // 1. Vendo Selection Mode
            container.appendChild(createGroup('Vendo Selection Mode', createSelect('vendo_selection_mode', settings.vendo_selection_mode || 'auto', ['auto', 'manual'])));

            // 2. Coin Pin (Default 12)
            container.appendChild(createGroup('Coin Pin', createInput('coin_pin', settings.coin_pin || '12', 'number')));

            // 3. Coin Pin Edge (FALLING/RISING)
            container.appendChild(createGroup('Coin Pin Edge', createSelect('coin_pin_edge', settings.coin_pin_edge || 'RISING', ['FALLING', 'RISING'])));

            // 4. Bill Pin (Optional)
            container.appendChild(createGroup('Bill Pin (Optional)', createInput('bill_pin', settings.bill_pin || '19', 'number', 'GPIO Pin (Default 19)')));

            // 5. Bill Pin Edge (FALLING/RISING)
            container.appendChild(createGroup('Bill Pin Edge', createSelect('bill_pin_edge', settings.bill_pin_edge || 'FALLING', ['FALLING', 'RISING'])));

            // 6. Bill Multiplier (x 1)
            container.appendChild(createGroup('Bill Multiplier (x)', createInput('bill_multiplier', settings.bill_multiplier || '1', 'number')));

            // 7. Relay Pin (Default 11)
            container.appendChild(createGroup('Relay Pin', createInput('relay_pin', settings.relay_pin || '11', 'number')));

            // 8. Relay Pin Active (LOW/HIGH)
            container.appendChild(createGroup('Relay Pin Active', createSelect('relay_pin_active', settings.relay_pin_active || 'HIGH', ['LOW', 'HIGH'])));

            // 9. Ban Counter (10 SEC)
            const banCounterInput = createInput('ban_limit_counter', settings.ban_limit_counter || '10', 'number');
            const banCounterGroup = createGroup('Insert Attempts Ban', banCounterInput);
            container.appendChild(banCounterGroup);

            // 10. Ban Duration (1 MINUTE)
            const banDurationInput = createInput('ban_duration', settings.ban_duration || '1', 'number');
            const banDurationGroup = createGroup('Ban Duration (minutes)', banDurationInput);
            container.appendChild(banDurationGroup);

            // 11. Session Timeout (Minutes)
            const sessionTimeoutInput = createInput('session_timeout_minutes', (settings.session_timeout_minutes || '30'), 'number', 'Default 30');
            container.appendChild(createGroup('Session Timeout (minutes)', sessionTimeoutInput));

            const idleTimeoutInput = createInput('idle_timeout_seconds', (settings.idle_timeout_seconds || '120'), 'number', 'Default 120');
            container.appendChild(createGroup('Idle Timeout (seconds) [Pauses Session]', idleTimeoutInput));

            const keepaliveTimeoutInput = createInput('keepalive_timeout_seconds', (settings.keepalive_timeout_seconds || '300'), 'number', 'Default 300');
            container.appendChild(createGroup('Keepalive Timeout (seconds) [Pauses Session]', keepaliveTimeoutInput));
        }

        async function saveSettings(e) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = {};
            formData.forEach((value, key) => data[key] = value);

            // Validation
            const errors = [];
            const isPosInt = (val) => /^\d+$/.test(val) && parseInt(val) >= 0;

            // Check if we are saving Vendo Settings (indicated by presence of coin_pin)
            if ('coin_pin' in data) {
                if (!isPosInt(data.coin_pin)) errors.push("Coin Pin must be a valid positive number.");
                if (data.bill_pin && !isPosInt(data.bill_pin)) errors.push("Bill Pin must be a valid positive number.");
                if (!isPosInt(data.bill_multiplier) || parseInt(data.bill_multiplier) < 1) errors.push("Bill Multiplier must be at least 1.");
                if (!isPosInt(data.relay_pin)) errors.push("Relay Pin must be a valid positive number.");
                if (!isPosInt(data.ban_limit_counter)) errors.push("Insert Attempt Ban Counter must be a valid positive number.");
                if (!isPosInt(data.ban_duration)) errors.push("Ban Duration must be a valid positive number.");

                // Check for duplicate pins
                const pins = [data.coin_pin, data.bill_pin, data.relay_pin].filter(p => p && p.trim() !== '');
                const uniquePins = new Set(pins);
                if (pins.length !== uniquePins.size) {
                    errors.push("Duplicate GPIO pins detected. Coin, Bill, and Relay must use unique pins.");
                }
            }

            if (errors.length > 0) {
                alert("Validation Error:\n\n" + errors.join("\n"));
                return;
            }

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(data)
                });
                
                if (res.ok) {
                    alert('Configuration Saved');
                } else {
                    alert('Failed to save configuration');
                }
            } catch (err) {
                console.error("Save error:", err);
                alert('Error saving configuration');
            }
        }

        async function loadChatSettings() {
            try {
                const res = await fetch('/api/admin/settings');
                const settings = await res.json();
                
                // Match server logic: Enabled by default unless explicitly false
                const enabled = settings.chat_enabled !== 'false' && settings.chat_enabled !== false;
                
                const toggle = document.getElementById('chat-enabled-toggle');
                if (toggle) toggle.checked = enabled;
            } catch (e) {
                console.error("Chat settings load error", e);
            }
        }

        async function saveChatSettings(e) {
            if (e && e.type === 'submit') e.preventDefault();
            
            const toggle = document.getElementById('chat-enabled-toggle');
            const enabled = toggle ? toggle.checked : false;
            
            // Disable while saving
            if (toggle) toggle.disabled = true;

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ chat_enabled: enabled })
                });
                
                if (res.ok) {
                    console.log('Chat settings saved successfully');
                } else {
                    alert('Failed to save chat settings');
                    // Revert if failed
                    if (toggle) toggle.checked = !enabled;
                }
            } catch (e) {
                console.error("Chat settings save error", e);
                alert("Error saving chat settings");
                // Revert if failed
                if (toggle) toggle.checked = !enabled;
            } finally {
                if (toggle) toggle.disabled = false;
            }
        }

        async function loadPortalConfig() {
            try {
                const res = await fetch('/api/portal/config');
                const config = await res.json();
                
                document.getElementById('portal-container-width').value = config.container_max_width || 360;
                document.getElementById('portal-icon-size').value = config.icon_size || 36;
                document.getElementById('portal-status-container-size').value = config.status_icon_container_size || 38;
                document.getElementById('portal-banner-height').value = config.banner_height || 190;
                
                // Banner Settings
                document.getElementById('portal-use-default-banner').checked = config.use_default_banner || false;
                if (config.default_banner_file) {
                    document.getElementById('portal-default-banner-file').value = config.default_banner_file;
                }
                
                // Hide Voucher Code Setting
                const hideVoucherToggle = document.getElementById('portal-hide-voucher-code');
                if (hideVoucherToggle) {
                    hideVoucherToggle.checked = config.hide_voucher_code || false;
                }

                toggleBannerUpload();

            } catch (e) {
                console.error("Failed to load portal config", e);
            }
        }

        function toggleDrawer(cardId) {
            const card = document.getElementById(cardId);
            if (!card) return;
            
            card.classList.toggle('drawer-open');
            const content = card.querySelector('.drawer-content');
            if (card.classList.contains('drawer-open')) {
                content.style.maxHeight = content.scrollHeight + "px";
                // Allow dynamic height after transition
                setTimeout(() => {
                    if (card.classList.contains('drawer-open')) {
                        content.style.maxHeight = 'none';
                    }
                }, 300);
            } else {
                // Set fixed height first to allow transition
                content.style.maxHeight = content.scrollHeight + "px";
                setTimeout(() => {
                    content.style.maxHeight = null;
                }, 10);
            }
        }

        function toggleBannerUpload() {
            const useDefault = document.getElementById('portal-use-default-banner').checked;
            const uploadSection = document.getElementById('banner-upload-section');
            const selectorSection = document.getElementById('default-banner-selector');
            
            if (useDefault) {
                uploadSection.style.display = 'none';
                selectorSection.style.display = 'block';
            } else {
                uploadSection.style.display = 'block';
                selectorSection.style.display = 'none';
            }
        }

        async function savePortalConfig(event) {
            event.preventDefault();
            const containerWidth = document.getElementById('portal-container-width').value;
            const iconSize = document.getElementById('portal-icon-size').value;
            const statusContainerSize = document.getElementById('portal-status-container-size').value;
            const bannerHeight = document.getElementById('portal-banner-height').value;
            const useDefault = document.getElementById('portal-use-default-banner').checked;
            const defaultFile = document.getElementById('portal-default-banner-file').value;
            const hideVoucherCode = document.getElementById('portal-hide-voucher-code').checked;
            
            try {
                await fetch('/api/admin/portal-config', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        container_width: containerWidth,
                        icon_size: iconSize,
                        status_container_size: statusContainerSize,
                        banner_height: bannerHeight,
                        use_default_banner: useDefault,
                        default_banner_file: defaultFile,
                        hide_voucher_code: hideVoucherCode
                    })
                });
                alert('Portal config saved successfully');
            } catch (e) {
                console.error('Failed to save portal config:', e);
                alert('Failed to save portal config');
            }
        }

        async function uploadPortalBanner() {
            const fileInput = document.getElementById('portal-banner-upload');
            const file = fileInput.files[0];
            if (!file) return alert('Please select a banner image');
            
            // Limit file size to 2MB
            if (file.size > 2 * 1024 * 1024) return alert('File size must be less than 2MB');

            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Image = e.target.result;
                try {
                    const res = await fetch('/api/admin/upload-banner', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({
                            image: base64Image,
                            type: file.type
                        })
                    });
                    
                    if (res.ok) {
                        alert('Banner uploaded successfully');
                        fileInput.value = '';
                    } else {
                        alert('Failed to upload banner');
                    }
                } catch (e) {
                    console.error('Failed to upload banner:', e);
                    alert('Failed to upload banner');
                }
            };
            reader.readAsDataURL(file);
        }



        // --- Firewall / AdBlocker Logic ---
        async function loadFirewallRules() {
            try {
                const res = await fetch('/api/admin/firewall/rules');
                const rules = await res.json();
                const tbody = document.querySelector('#firewall-table tbody');
                tbody.innerHTML = '';
                
                if (rules.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">No active firewall rules.</td></tr>';
                    return;
                }

                rules.forEach(r => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight:bold;">${r.port}</td>
                        <td><span class="badge" style="background:#6c757d; color:white;">${r.protocol.toUpperCase()}</span></td>
                        <td>${r.comment || '-'}</td>
                        <td style="font-size:0.85rem; color:#666;">${new Date(r.created_at).toLocaleString()}</td>
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="deleteFirewallRule(${r.id})">Delete</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Error loading firewall rules", e);
            }
        }

        function showAddRuleModal() {
            document.getElementById('firewall-rule-modal').style.display = 'flex';
        }

        async function addFirewallRule() {
            const port = document.getElementById('fw-port').value;
            const protocol = document.getElementById('fw-protocol').value;
            const comment = document.getElementById('fw-comment').value;

            if (!port) {
                alert("Port is required");
                return;
            }

            try {
                const res = await fetch('/api/admin/firewall/rules', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ port, protocol, comment })
                });

                if (res.ok) {
                    document.getElementById('firewall-rule-modal').style.display = 'none';
                    document.getElementById('fw-port').value = '';
                    document.getElementById('fw-comment').value = '';
                    loadFirewallRules();
                    alert("Rule added successfully. Traffic on port " + port + " is now blocked.");
                } else {
                    const data = await res.json();
                    alert("Failed to add rule: " + (data.error || 'Unknown error'));
                }
            } catch (e) {
                console.error("Add Rule Error", e);
                alert("Error adding rule");
            }
        }

        async function deleteFirewallRule(id) {
            if (!await showConfirm("Are you sure you want to remove this rule?")) return;

            try {
                const res = await fetch(`/api/admin/firewall/rules/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    loadFirewallRules();
                } else {
                    alert("Failed to delete rule");
                }
            } catch (e) {
                console.error("Delete Rule Error", e);
            }
        }

        // Voucher Management Functions
        function generateRandomBatchId() {
            const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            let rand = '';
            for(let i=0; i<4; i++) {
                rand += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            const id = 'B' + Date.now().toString(36).toUpperCase() + rand;
            const el = document.getElementById('v-batch-id');
            if(el) el.value = id;
            return id;
        }

        function openVoucherModal() {
            generateRandomBatchId();
            document.getElementById('voucher-modal').style.display = 'flex';
        }

        function closeVoucherModal() {
            document.getElementById('voucher-modal').style.display = 'none';
        }

        function toggleCustomVoucher() {
            const isRandom = document.getElementById('v-random').checked;
            const customInput = document.getElementById('v-custom');
            customInput.disabled = isRandom;
            customInput.style.opacity = isRandom ? 0.7 : 1;
        }

        // --- Voucher Bulk Actions ---
        function toggleSelectAll(source) {
            const checkboxes = document.querySelectorAll('.voucher-select');
            checkboxes.forEach(cb => cb.checked = source.checked);
            updateDeleteButton();
        }

        function updateDeleteButton() {
            const checkboxes = document.querySelectorAll('.voucher-select:checked');
            const btn = document.getElementById('btn-delete-selected');
            if (checkboxes.length > 0) {
                btn.style.display = 'block';
                btn.textContent = `Delete Selected (${checkboxes.length})`;
            } else {
                btn.style.display = 'none';
            }
        }

        async function deleteSelectedVouchers() {
            const checkboxes = document.querySelectorAll('.voucher-select:checked');
            const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));
            
            if (ids.length === 0) return;
            
            if (!await showConfirm(`Are you sure you want to delete ${ids.length} voucher(s)?`, true)) return;

            try {
                const res = await fetch('/api/admin/vouchers', {
                    method: 'DELETE',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ ids })
                });
                
                if (res.ok) {
                    const data = await res.json();
                    alert(`Successfully deleted ${data.count} voucher(s).`);
                    loadVouchersData();
                    document.getElementById('select-all-vouchers').checked = false;
                    document.getElementById('btn-delete-selected').style.display = 'none';
                } else {
                    const errData = await res.json().catch(() => ({}));
                    alert(`Failed to delete vouchers: ${res.status} ${res.statusText} ${errData.error ? '- ' + errData.error : ''}`);
                }
            } catch (e) {
                console.error("Delete error", e);
                alert("Error deleting vouchers");
            }
        }

        async function loadVoucherBatches() {
            try {
                const res = await fetch('/api/admin/voucher-batches');
                if (res.status === 401) return;
                const batches = await res.json();
                const select = document.getElementById('voucher-batch-filter');
                if (select) {
                    const current = select.value;
                    select.innerHTML = '<option value="">All</option>';
                    batches.forEach(b => {
                        const option = document.createElement('option');
                        option.value = b.batch_id;
                        const label = `${b.batch_id} • ${b.plan_name || 'Plan'} • ${b.count} pcs • ₱${b.price || 0}`;
                        option.textContent = label;
                        select.appendChild(option);
                    });
                    if (current) {
                        select.value = current;
                    }
                }

                const tableBody = document.querySelector('#voucher-batches-table tbody');
                if (tableBody) {
                    tableBody.innerHTML = '';
                    if (batches.length === 0) {
                        const tr = document.createElement('tr');
                        tr.innerHTML = '<td colspan="6" style="padding:15px; text-align:center;">No voucher batches found</td>';
                        tableBody.appendChild(tr);
                    } else {
                        batches.forEach(b => {
                            const tr = document.createElement('tr');
                            const createdDate = b.created_at ? new Date(b.created_at) : null;
                            const createdStr = createdDate ? createdDate.toLocaleString() : '';
                            tr.innerHTML = `
                                <td style="padding:10px;">${b.batch_id}</td>
                                <td style="padding:10px;">${createdStr}</td>
                                <td style="padding:10px;">${b.plan_name || 'Plan'}</td>
                                <td style="padding:10px;">₱${b.price || 0}</td>
                                <td style="padding:10px;">${b.count}</td>
                                <td style="padding:10px; text-align:center;">
                                    <button class="btn btn-sm btn-primary" onclick="showBatchVoucherTicketsForId('${b.batch_id}')">Show / Print</button>
                                    <button class="btn btn-sm btn-secondary" style="margin-left:5px;" onclick="exportVoucherBatch('${b.batch_id}')">CSV</button>
                                    <button class="btn btn-sm btn-danger" style="margin-left:5px;" onclick="deleteVoucherBatch('${b.batch_id}')">Delete</button>
                                </td>
                            `;
                            tableBody.appendChild(tr);
                        });
                    }
                }
            } catch (e) {
                console.error("Voucher batch load error", e);
            }
        }

        async function exportVoucherBatch(batchId) {
            if (!batchId) return;
            window.location.href = '/api/admin/voucher-batches/' + encodeURIComponent(batchId) + '/export';
        }

        async function deleteVoucherBatch(batchId) {
            if (!batchId) return;
            if (!confirm(`Are you sure you want to delete Batch ${batchId}? This will delete all vouchers in this batch.`)) {
                return;
            }
            try {
                const res = await fetch('/api/admin/voucher-batches/' + encodeURIComponent(batchId), {
                    method: 'DELETE'
                });
                if (res.status === 401) return location.reload();
                if (!res.ok) {
                    const data = await res.json();
                    alert(data.error || 'Failed to delete batch');
                    return;
                }
                loadVoucherBatches();
                loadVouchersData(); // Refresh main list too
            } catch (e) {
                console.error('Delete batch error', e);
                alert('Failed to delete batch');
            }
        }

        async function loadVouchersData() {
            try {
                const showUsedEl = document.getElementById('voucher-show-used');
                const includeUsed = showUsedEl && showUsedEl.checked ? '1' : '0';
                const batchSelect = document.getElementById('voucher-batch-filter');
                const batchId = batchSelect ? encodeURIComponent(batchSelect.value) : '';

                const previouslySelected = new Set(
                    Array.from(document.querySelectorAll('.voucher-select:checked')).map(cb => parseInt(cb.value, 10))
                );
                const selectAllEl = document.getElementById('select-all-vouchers');
                const selectAllWasChecked = selectAllEl ? selectAllEl.checked : false;

                const res = await fetch('/api/admin/vouchers?includeUsed=' + includeUsed + '&batchId=' + batchId);
                if (res.status === 401) return location.reload();
                const vouchers = await res.json();
                const tbody = document.querySelector('#voucher-table tbody');
                tbody.innerHTML = '';
                vouchers.forEach(v => {
                    const tr = document.createElement('tr');
                    
                    const d = Math.floor(v.duration / 86400);
                    const h = Math.floor((v.duration % 86400) / 3600);
                    const m = Math.floor((v.duration % 3600) / 60);
                    const durationStr = `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m}m`;

                    const status = v.is_used ? 'Used' : 'Active';
                    tr.innerHTML = `
                        <td style="padding:10px; border-bottom:1px solid #f1f2f6;"><input type="checkbox" class="voucher-select" value="${v.id}" onclick="updateDeleteButton()"></td>
                        <td style="padding:10px; border-bottom:1px solid #f1f2f6;">${v.code}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f2f6;">${durationStr}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f2f6;">${v.plan_name || 'Standard'}</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f2f6;">₱${v.price || 0}.00</td>
                        <td style="padding:10px; border-bottom:1px solid #f1f2f6;">${status}</td>
                    `;
                    const checkbox = tr.querySelector('.voucher-select');
                    if (checkbox && previouslySelected.has(v.id)) {
                        checkbox.checked = true;
                    }
                    tbody.appendChild(tr);
                });

                if (selectAllEl) {
                    if (selectAllWasChecked) {
                        selectAllEl.checked = true;
                        const allCheckboxes = document.querySelectorAll('.voucher-select');
                        allCheckboxes.forEach(cb => cb.checked = true);
                    } else {
                        selectAllEl.checked = previouslySelected.size > 0 &&
                            vouchers.every(v => previouslySelected.has(v.id));
                    }
                }

                updateDeleteButton();
            } catch (e) {
                console.error("Voucher load error", e);
            }
        }

        async function openGeneratedVoucherModal(batchId, codes, options) {
            const modal = document.getElementById('voucher-generated-modal');
            const title = document.getElementById('voucher-generated-title');
            const body = document.getElementById('voucher-generated-body');
            if (!modal || !title || !body) return;
            const plan = options.plan_name || 'Standard';
            const price = options.price || 0;
            const durationMinutes = options.duration || 0;
            const d = Math.floor(durationMinutes / 1440);
            const h = Math.floor((durationMinutes % 1440) / 60);
            const m = durationMinutes % 60;
            const durationStr = `${d > 0 ? d + 'd ' : ''}${h > 0 ? h + 'h ' : ''}${m}m`;
            const ssidInput = document.getElementById('wifi-ssid');
            const ssid = ssidInput ? (ssidInput.value || 'NeoFi_Built-In_WiFi') : 'NeoFi_Built-In_WiFi';
            const downMbps = options.download_speed ? Math.round(options.download_speed / 1024) : 0;
            const upMbps = options.upload_speed ? Math.round(options.upload_speed / 1024) : 0;
            const loginUrl = window.location.origin + '/';
            const ipAddress = window.location.hostname;
            title.textContent = `Batch ${batchId}`;
            body.innerHTML = '';
            body.className = 'voucher-print-grid';
            codes.forEach(code => {
                const card = document.createElement('div');
                card.className = 'voucher-print-card';
                const qrId = `voucher-qr-${code}`;
                card.innerHTML = `
                    <div class="voucher-price-strip">
                        <div class="voucher-price-text">₱${price}</div>
                    </div>
                    <div class="voucher-main">
                        <div class="voucher-print-code">${code}</div>
                        <div class="voucher-meta-lines">
                            <div class="voucher-print-meta">Hotspot: ${ssid}</div>
                            <div class="voucher-print-meta">IP: ${ipAddress}</div>
                            <div class="voucher-print-meta">Plan: ${plan}</div>
                            <div class="voucher-print-meta">Duration: ${durationStr}</div>
                            <div class="voucher-print-meta">Speed: ${downMbps} Mbps / ${upMbps} Mbps</div>
                            <div class="voucher-print-meta">Login: ${loginUrl}</div>
                        </div>
                    </div>
                    <div class="voucher-qr-wrap">
                        <div class="voucher-print-qr" id="${qrId}"></div>
                    </div>
                `;
                body.appendChild(card);
                const qrContainer = card.querySelector('.voucher-print-qr');
                if (qrContainer && window.QRCode) {
                    new QRCode(qrContainer, {
                        text: code,
                        width: 56,
                        height: 56,
                        margin: 0
                    });
                }
            });
            modal.style.display = 'flex';
        }

        function printGeneratedVouchers() {
            if (document && document.body) {
                document.body.classList.add('voucher-printing');
            }
            window.print();
        }

        async function showBatchVoucherTickets() {
            try {
                const select = document.getElementById('voucher-batch-filter');
                if (!select || !select.value) {
                    alert('Please select a batch first.');
                    return;
                }
                const batchId = select.value;
                await showBatchVoucherTicketsForId(batchId);
            } catch (e) {
                console.error('Error loading batch vouchers for print', e);
                alert('Failed to load vouchers for this batch');
            }
        }

        async function showBatchVoucherTicketsForId(batchId) {
            try {
                const res = await fetch('/api/admin/vouchers?includeUsed=1&batchId=' + encodeURIComponent(batchId));
                if (res.status === 401) return location.reload();
                const vouchers = await res.json();
                if (!Array.isArray(vouchers) || vouchers.length === 0) {
                    alert('No vouchers found for this batch.');
                    return;
                }
                const first = vouchers[0];
                const options = {
                    plan_name: first.plan_name || 'Standard',
                    price: first.price || 0,
                    duration: Math.round((first.duration || 0) / 60),
                    download_speed: first.download_speed || 0,
                    upload_speed: first.upload_speed || 0
                };
                const codes = vouchers.map(v => v.code);
                openGeneratedVoucherModal(batchId, codes, options);
            } catch (e) {
                console.error('Error loading batch vouchers for print', e);
                alert('Failed to load vouchers for this batch');
            }
        }

        function closeGeneratedVoucherModal() {
            const modal = document.getElementById('voucher-generated-modal');
            if (modal) modal.style.display = 'none';
        }

        async function generateVouchers() {
            try {
                const options = {
                    batch_id: document.getElementById('v-batch-id').value,
                    count: parseInt(document.getElementById('v-qty').value),
                    duration: (parseInt(document.getElementById('v-days').value || 0) * 1440) + 
                              (parseInt(document.getElementById('v-hours').value || 0) * 60) + 
                              parseInt(document.getElementById('v-minutes').value || 0),
                    plan_name: document.getElementById('v-name').value || 'Standard',
                    price: parseFloat(document.getElementById('v-price').value) || 0,
                    download_speed: parseInt(document.getElementById('v-dl').value) * 1024, // Convert Mbps to kbps
                    upload_speed: parseInt(document.getElementById('v-ul').value) * 1024, // Convert Mbps to kbps
                    is_random: document.getElementById('v-random').checked,
                    prefix: document.getElementById('v-prefix').value,
                    length: parseInt(document.getElementById('v-length').value),
                    custom_code: document.getElementById('v-custom').value
                };

                const res = await fetch('/api/admin/vouchers/generate', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(options)
                });

                const data = await res.json();
                if (data.success) {
                    closeVoucherModal();
                    await loadVoucherBatches();
                    const batchSelect = document.getElementById('voucher-batch-filter');
                    if (batchSelect && data.batchId) {
                        batchSelect.value = data.batchId;
                    }
                    await loadVouchersData();
                } else {
                    alert(`Error: ${data.error}`);
                }
            } catch (e) {
                console.error("Voucher generation error", e);
                alert("Failed to generate vouchers");
            }
        }

        async function loadInterfaces() {
            try {
                const res = await fetch('/api/admin/network-interfaces');
                if (res.status === 401) return location.reload();
                const interfaces = await res.json();
                const tbody = document.querySelector('#interfaces-table tbody');
                tbody.innerHTML = '';
                
                if (interfaces.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">No interfaces found</td></tr>';
                    return;
                }

                interfaces.forEach(iface => {
                    if (iface.name === 'lo') return; // Hide loopback
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="font-weight:600; color:#2d3436;">${iface.name}</td>
                        <td>${iface.ip}</td>
                        <td style="font-family:monospace;">${iface.mac}</td>
                        <td>${iface.netmask}</td>
                        <td>${iface.family}</td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Interfaces load error", e);
            }
        }

        // Init
        checkAuth();

        // --- Pull to Refresh Logic (Touch & Mouse) ---
        const contentScroll = document.querySelector('.content-scroll');
        const ptr = document.getElementById('pull-to-refresh');
        const ptrIcon = ptr.querySelector('.ptr-icon');
        const ptrText = ptr.querySelector('.ptr-text');

        let startY = 0;
        let isPulling = false;
        let isRefreshing = false;

        const handleStart = (y) => {
            if (contentScroll.scrollTop === 0) {
                startY = y;
                isPulling = true;
            }
        };

        const handleMove = (y) => {
            if (!isPulling || isRefreshing) return;
            const diff = y - startY;

            if (diff > 0 && contentScroll.scrollTop === 0) {
                // Resistance
                const move = Math.min(diff * 0.5, 80);
                ptr.style.marginTop = `${move - 50}px`; // -50 is hidden
                
                if (move > 40) {
                    ptrText.textContent = 'Release to refresh';
                    ptrIcon.classList.add('rotate');
                } else {
                    ptrText.textContent = 'Pull to refresh';
                    ptrIcon.classList.remove('rotate');
                }
            } else {
                isPulling = false;
                ptr.style.marginTop = '-50px';
            }
        };

        const handleEnd = async () => {
            if (!isPulling || isRefreshing) return;
            isPulling = false;
            
            if (ptrIcon.classList.contains('rotate')) {
                isRefreshing = true;
                ptr.style.marginTop = '0px';
                ptrText.textContent = 'Reloading...';
                ptrIcon.classList.remove('rotate');
                ptrIcon.classList.add('spin');
                
                // Full page refresh as requested
                location.reload();
            } else {
                ptr.style.marginTop = '-50px';
            }
        };

        // Touch Events
        contentScroll.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientY), { passive: true });
        contentScroll.addEventListener('touchmove', (e) => handleMove(e.touches[0].clientY), { passive: true });
        contentScroll.addEventListener('touchend', handleEnd);

        // Mouse Events
        contentScroll.addEventListener('mousedown', (e) => handleStart(e.clientY));
        contentScroll.addEventListener('mousemove', (e) => {
            if(isPulling && e.buttons === 1) handleMove(e.clientY);
            else if(isPulling) { isPulling = false; ptr.style.marginTop = '-50px'; }
        });
        contentScroll.addEventListener('mouseup', handleEnd);
        contentScroll.addEventListener('mouseleave', () => {
            if(isPulling) { isPulling = false; ptr.style.marginTop = '-50px'; }
        });

        // --- ZeroTier Integration ---
        async function loadZeroTierStatus() {
            const badge = document.getElementById('zt-status-badge');
            const infoArea = document.getElementById('zt-info-area');
            const networksList = document.getElementById('zt-networks-list');
            
            if (!badge) return;

            try {
                const res = await fetch('/api/admin/network/zerotier');
                const data = await res.json();

                if (!data.installed) {
                    badge.style.background = '#d63031';
                    badge.textContent = 'Not Installed';
                    infoArea.style.display = 'none';
                    return;
                }

                // Update Status Badge
                if (data.online) {
                    badge.style.background = '#00b894';
                    badge.textContent = 'Online';
                } else {
                    badge.style.background = '#fdcb6e';
                    badge.textContent = 'Offline';
                }

                // Update Info Area
                infoArea.style.display = 'block';
                document.getElementById('zt-version').textContent = data.version || 'Unknown';
                document.getElementById('zt-device-id').textContent = data.deviceId || 'Unknown';
                document.getElementById('zt-status-text').textContent = data.online ? 'ONLINE' : 'OFFLINE';

                // Update Networks List
                networksList.innerHTML = '';
                if (data.networks && data.networks.length > 0) {
                    data.networks.forEach(net => {
                        const row = document.createElement('div');
                        row.style.background = '#f9f9f9';
                        row.style.padding = '10px';
                        row.style.borderRadius = '4px';
                        row.style.marginBottom = '8px';
                        row.style.border = '1px solid #eee';
                        row.style.display = 'flex';
                        row.style.justifyContent = 'space-between';
                        row.style.alignItems = 'center';
                        
                        row.innerHTML = `
                            <div>
                                <div style="font-weight:bold; color:#2d3436;">${net.name || net.id}</div>
                                <div style="font-size:0.8rem; color:#636e72;">
                                    ID: ${net.id} | Status: <span style="color:${net.status === 'OK' ? '#00b894' : '#d63031'}">${net.status}</span>
                                </div>
                                <div style="font-size:0.8rem; color:#636e72;">IP: ${net.ip || 'None'}</div>
                            </div>
                            <button class="btn btn-sm btn-danger" onclick="leaveZeroTier('${net.id}')">Leave</button>
                        `;
                        networksList.appendChild(row);
                    });
                } else {
                    networksList.innerHTML = '<div style="font-size:0.85rem; color:#b2bec3; text-align:center; padding:10px;">Not joined to any networks</div>';
                }

            } catch (e) {
                console.error("ZeroTier status error", e);
                badge.style.background = '#d63031';
                badge.textContent = 'Error';
            }
        }

        async function joinZeroTier() {
            const input = document.getElementById('zt-network-id');
            const networkId = input.value.trim();
            
            if (networkId.length !== 16) {
                alert("Invalid Network ID. It must be 16 characters.");
                return;
            }

            const btn = document.querySelector('button[onclick="joinZeroTier()"]');
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Joining...';

            try {
                const res = await fetch('/api/admin/network/zerotier/join', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ networkId })
                });

                if (res.ok) {
                    alert("Joined network! It may take a few seconds to appear.");
                    input.value = '';
                    loadZeroTierStatus();
                } else {
                    const err = await res.json();
                    alert("Failed to join: " + (err.error || "Unknown error"));
                }
            } catch (e) {
                alert("Error joining network");
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        async function leaveZeroTier(networkId) {
            if (!await showConfirm(`Are you sure you want to leave network ${networkId}?`, true)) return;

            try {
                 const res = await fetch('/api/admin/network/zerotier/leave', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ networkId })
                });

                if (res.ok) {
                    loadZeroTierStatus();
                } else {
                    alert("Failed to leave network");
                }
            } catch (e) {
                alert("Error leaving network");
            }
        }

        // --- Network Configuration ---
        // --- Walled Garden ---
        async function loadWalledGarden() {
            try {
                const res = await fetch('/api/admin/walled-garden');
                const list = await res.json();
                
                const tbody = document.querySelector('#wg-table tbody');
                tbody.innerHTML = '';
                
                if (list.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No entries found</td></tr>';
                    return;
                }

                list.forEach(item => {
                    const tr = document.createElement('tr');
                    let badgeClass = 'badge-secondary';
                    if (item.type === 'ACCEPT' || item.type === 'allow') badgeClass = 'badge-success';
                    if (item.type === 'DROP' || item.type === 'deny') badgeClass = 'badge-danger';
                    
                    tr.innerHTML = `
                        <td>${item.domain}</td>
                        <td><span class="badge ${badgeClass}">${item.type.toUpperCase()}</span></td>
                        <td>${item.address || '-'}</td>
                        <td>
                            <button class="btn btn-sm btn-danger" onclick="deleteWalledGarden(${item.id})">Delete</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Error loading walled garden:", e);
            }
        }

        async function addWalledGarden() {
            const domain = document.getElementById('wg-modal-domain').value.trim();
            const type = document.getElementById('wg-modal-type').value;
            
            if (!domain) return alert('Domain is required');
            
            try {
                const res = await fetch('/api/admin/walled-garden', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ domain, type })
                });
                
                if (res.ok) {
                    closeWalledGardenModal();
                    loadWalledGarden();
                } else {
                    const data = await res.json();
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                console.error("Error adding entry:", e);
                alert("Failed to add entry");
            }
        }

        function openWalledGardenModal() {
            document.getElementById('wg-modal-domain').value = '';
            document.getElementById('wg-modal-type').value = 'allow';
            document.getElementById('walled-garden-modal').style.display = 'flex';
        }

        function closeWalledGardenModal() {
            document.getElementById('walled-garden-modal').style.display = 'none';
        }

        async function deleteWalledGarden(id) {
            if (!confirm('Are you sure you want to delete this entry?')) return;
            
            try {
                const res = await fetch('/api/admin/walled-garden/' + id, {
                    method: 'DELETE'
                });
                
                if (res.ok) {
                    loadWalledGarden();
                } else {
                    alert('Failed to delete entry');
                }
            } catch (e) {
                console.error("Error deleting entry:", e);
            }
        }

        async function loadNetworkConfig() {
            updateWanStatus(); // Check status on load
            loadZeroTierStatus(); // Check ZeroTier status
            try {
                // Load Interfaces for Dropdown
                const resIfaces = await fetch('/api/admin/network-interfaces');
                const interfaces = await resIfaces.json();
                window.cachedInterfaces = interfaces;



                // Load Configured Bridges (Safe Load) - REMOVED redundant fetch
                // Bridges are loaded via loadBridges() later
                let bridges = []; 


                // --- Build Visual Interface Map ---
                visualInterfaceMap = {};
                let enxCounter = 1;
                
                // Sort by name to ensure consistent ordering for enx mapping
                interfaces.sort((a, b) => a.name.localeCompare(b.name));
                
                interfaces.forEach(iface => {
                    const name = iface.name;
                    if (name === 'end0') {
                        visualInterfaceMap[name] = 'eth0';
                    } else if (name.startsWith('enx')) {
                        visualInterfaceMap[name] = 'eth' + enxCounter++;
                    } else {
                        visualInterfaceMap[name] = name;
                    }
                });
                window.visualInterfaceMap = visualInterfaceMap;

                const select = document.getElementById('wan-interface');
                select.innerHTML = '<option value="" disabled>Select Interface</option>';
                
                const vlanSelect = document.getElementById('vlan-parent');
                vlanSelect.innerHTML = '<option value="" disabled selected>Select Parent Interface</option>';

                // 1. Add Physical Interfaces
                interfaces.forEach(iface => {
                    // Skip loopback
                    if (iface.name === 'lo') return;

                    const opt = document.createElement('option');
                    opt.value = iface.name;
                    // Use Visual Name
                    const visualName = visualInterfaceMap[iface.name] || iface.name;
                    opt.textContent = `${visualName} (${iface.mac || 'No MAC'})`;
                    select.appendChild(opt);
                    
                    // Also populate VLAN parent dropdown
                    const vlanOpt = opt.cloneNode(true);
                    vlanSelect.appendChild(vlanOpt);
                });
                
                const dualWan1Select = document.getElementById('dual-wan1-iface');
                const dualWan2Select = document.getElementById('dual-wan2-iface');
                if (dualWan1Select) populateInterfaceSelect(dualWan1Select, interfaces, visualInterfaceMap);
                if (dualWan2Select) populateInterfaceSelect(dualWan2Select, interfaces, visualInterfaceMap);

                // 2. Add VLAN Interfaces (to WAN dropdown only)
                if (vlans && vlans.length > 0) {
                     const group = document.createElement('optgroup');
                     group.label = "VLAN Interfaces";
                     
                     vlans.forEach(v => {
                         const parentVisual = visualInterfaceMap[v.parent] || v.parent;
                         const vlanName = `${parentVisual}.${v.vlanId}`;
                         const opt = document.createElement('option');
                         opt.value = `${v.parent}.${v.vlanId}`; // Keep real value
                         opt.textContent = `${vlanName} (VLAN ${v.vlanId})`;
                         group.appendChild(opt);
                     });
                     select.appendChild(group);
                }

                // Load Current Config
                const resConfig = await fetch('/api/admin/network/wan');
                if (resConfig.ok) {
                    const config = await resConfig.json();
                    
                    if (config.interface) {
                        let targetValue = config.interface;
                        
                        // Check if option with this value exists
                        let exists = Array.from(select.options).some(opt => opt.value === targetValue);

                        if (!exists) {
                            // Check if config matches a visual name (e.g. config 'eth0' vs real 'end0')
                            const realNameEntry = Object.entries(visualInterfaceMap).find(([real, visual]) => visual === config.interface);
                            if (realNameEntry) {
                                targetValue = realNameEntry[0]; // Use the real interface name
                                exists = true;
                            }
                        }

                        if (!exists) {
                            // Only add if truly missing (neither real name nor visual name match)
                            const opt = document.createElement('option');
                            opt.value = config.interface;
                            opt.textContent = config.interface;
                            select.appendChild(opt);
                        }
                        select.value = targetValue;
                    }
                    if (config.mode) document.getElementById('wan-mode').value = config.mode;
                    
                    // Dual WAN Config
                    if (config.dual_wan) {
                        const dw = config.dual_wan;
                        if(dw.strategy) document.getElementById('dual-strategy').value = dw.strategy;
                        
                        if(dw.wan1) {
                            if(dw.wan1.interface) document.getElementById('dual-wan1-iface').value = dw.wan1.interface;
                            if(dw.wan1.type) document.getElementById('dual-wan1-type').value = dw.wan1.type;
                            toggleDualWanFields('wan1');
                            if(dw.wan1.static) {
                                document.getElementById('dual-wan1-ip').value = dw.wan1.static.ip || '';
                                document.getElementById('dual-wan1-gateway').value = dw.wan1.static.gateway || '';
                                document.getElementById('dual-wan1-netmask').value = dw.wan1.static.netmask || '';
                                document.getElementById('dual-wan1-dns').value = dw.wan1.static.dns || '';
                            }
                            if(dw.wan1.pppoe) {
                                document.getElementById('dual-wan1-user').value = dw.wan1.pppoe.username || '';
                                document.getElementById('dual-wan1-pass').value = dw.wan1.pppoe.password || '';
                            }
                        }
                        
                        if(dw.wan2) {
                            if(dw.wan2.interface) document.getElementById('dual-wan2-iface').value = dw.wan2.interface;
                            if(dw.wan2.type) document.getElementById('dual-wan2-type').value = dw.wan2.type;
                            toggleDualWanFields('wan2');
                            if(dw.wan2.static) {
                                document.getElementById('dual-wan2-ip').value = dw.wan2.static.ip || '';
                                document.getElementById('dual-wan2-gateway').value = dw.wan2.static.gateway || '';
                                document.getElementById('dual-wan2-netmask').value = dw.wan2.static.netmask || '';
                                document.getElementById('dual-wan2-dns').value = dw.wan2.static.dns || '';
                            }
                            if(dw.wan2.pppoe) {
                                document.getElementById('dual-wan2-user').value = dw.wan2.pppoe.username || '';
                                document.getElementById('dual-wan2-pass').value = dw.wan2.pppoe.password || '';
                            }
                        }
                    }

                    // Multi WAN Config
                    if (config.multi_wan && Array.isArray(config.multi_wan)) {
                        const tbody = document.querySelector('#multi-wan-table tbody');
                        tbody.innerHTML = '';
                        config.multi_wan.forEach(wan => addMultiWanRow(wan));
                    }

                    // Static
                    if (config.static) {
                        document.getElementById('wan-ip').value = config.static.ip || '';
                        document.getElementById('wan-netmask').value = config.static.netmask || '';
                        document.getElementById('wan-gateway').value = config.static.gateway || '';
                        document.getElementById('wan-dns1').value = config.static.dns1 || '';
                        document.getElementById('wan-dns2').value = config.static.dns2 || '';
                    }

                    // PPPoE
                    if (config.pppoe) {
                        document.getElementById('pppoe-user').value = config.pppoe.username || '';
                        document.getElementById('pppoe-pass').value = config.pppoe.password || '';
                        document.getElementById('pppoe-dns1').value = config.pppoe.dns1 || '';
                        document.getElementById('pppoe-dns2').value = config.pppoe.dns2 || '';
                    }
                }
                
                toggleWanMode();

                loadBridges(); // Load Bridges

                // Populate Bridge Interface Checkboxes
                const bridgeInterfacesDiv = document.getElementById('bridge-interfaces');
                if (bridgeInterfacesDiv) {
                    bridgeInterfacesDiv.innerHTML = '';
                    interfaces.forEach(iface => {
                        // Skip loopback
                        if (iface.name === 'lo') return;
                        
                        const visualName = visualInterfaceMap[iface.name] || iface.name;
                        const wrapper = document.createElement('div');
                        wrapper.style.display = 'flex';
                        wrapper.style.alignItems = 'center';
                        wrapper.style.gap = '5px';
                        
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.value = iface.name;
                        checkbox.id = `br-iface-${iface.name}`;
                        checkbox.style.transform = 'scale(1.2)';
                        
                        const label = document.createElement('label');
                        label.htmlFor = `br-iface-${iface.name}`;
                        label.textContent = visualName;
                        label.style.fontSize = '0.9rem';
                        label.style.cursor = 'pointer';
                        
                        wrapper.appendChild(checkbox);
                        wrapper.appendChild(label);
                        bridgeInterfacesDiv.appendChild(wrapper);
                    });
                }
            } catch (e) {
                console.error("Network config load error", e);
            }
        }



        // --- Bridge Functions ---
        let editingBridgeName = null;

        async function loadBridges() {
            try {
                const res = await fetch('/api/admin/network/bridges');
                let bridges = await res.json();
                
                // Ensure default bridge br0 is listed
                const defaultBridge = bridges.find(b => b.name === 'br0');
                if (!defaultBridge) {
                    bridges.unshift({
                        name: 'br0',
                        interfaces: ['eth0'], // Assumed default
                        ip: '10.0.0.1',
                        netmask: '255.255.255.0',
                        stp: true
                    });
                }

                const tbody = document.querySelector('#bridge-table tbody');
                tbody.innerHTML = '';
                
                if (bridges.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px;">No bridges configured</td></tr>';
                    return;
                }

                bridges.forEach(b => {
                    const tr = document.createElement('tr');
                    // Handle interfaces list safely
                    const ifaceList = Array.isArray(b.interfaces) ? b.interfaces : [];
                    const members = ifaceList.map(i => visualInterfaceMap[i] || i).join(', ') || '-';
                    
                    let deleteBtn = `<button class="btn btn-sm btn-danger" onclick="removeBridge('${b.name}')">Delete</button>`;
                    let editBtn = `<button class="btn btn-sm btn-primary" style="margin-right:5px;" onclick='editBridge(${JSON.stringify(b)})'>Edit</button>`;

                    tr.innerHTML = `
                        <td style="font-weight:600;">${b.name}</td>
                        <td>${members}</td>
                        <td>${b.ip || '-'}</td>
                        <td>${b.netmask || '-'}</td>
                        <td>${b.stp ? 'Enabled' : 'Disabled'}</td>
                        <td>${editBtn}${deleteBtn}</td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Error loading Bridges", e);
            }
        }

        function openBridgeModal() {
            editingBridgeName = null;
            const titleEl = document.getElementById('bridge-modal-title');
            if(titleEl) titleEl.textContent = "Add Bridge";
            
            document.getElementById('bridge-name').value = 'br' + document.querySelectorAll('#bridge-table tbody tr').length;
            document.getElementById('bridge-name').disabled = false;
            document.getElementById('bridge-ip').value = '';
            document.getElementById('bridge-netmask').value = '255.255.255.0';
            document.getElementById('bridge-stp').checked = false;
            document.querySelectorAll('#bridge-interfaces input').forEach(cb => cb.checked = false);
            document.getElementById('bridge-modal').style.display = 'flex';
        }

        function editBridge(bridge) {
            editingBridgeName = bridge.name;
            const titleEl = document.getElementById('bridge-modal-title');
            if(titleEl) titleEl.textContent = "Edit Bridge";
            
            document.getElementById('bridge-name').value = bridge.name;
            document.getElementById('bridge-name').disabled = true; // Prevent renaming for simplicity
            document.getElementById('bridge-ip').value = bridge.ip || '';
            document.getElementById('bridge-netmask').value = bridge.netmask || '255.255.255.0';
            document.getElementById('bridge-stp').checked = !!bridge.stp;
            
            // Check interfaces
            document.querySelectorAll('#bridge-interfaces input').forEach(cb => {
                cb.checked = bridge.interfaces && bridge.interfaces.includes(cb.value);
            });
            
            document.getElementById('bridge-modal').style.display = 'flex';
        }

        async function saveBridge() {
            const bridge = {
                name: document.getElementById('bridge-name').value,
                ip: document.getElementById('bridge-ip').value,
                netmask: document.getElementById('bridge-netmask').value,
                stp: document.getElementById('bridge-stp').checked,
                interfaces: []
            };

            // Get selected interfaces
            const checkboxes = document.querySelectorAll('#bridge-interfaces input[type="checkbox"]:checked');
            bridge.interfaces = Array.from(checkboxes).map(cb => cb.value);

            if (!bridge.name) {
                alert("Bridge Name is required.");
                return;
            }

            try {
                let url = '/api/admin/network/bridges';
                let method = 'POST';
                
                if (editingBridgeName) {
                    url = `/api/admin/network/bridges/${editingBridgeName}`;
                    method = 'PUT';
                    // If we disabled name input, we don't need to check for name change here unless we want to allow it.
                    // For now, let's assume name is ID.
                }

                const res = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(bridge)
                });
                
                if (res.ok) {
                    alert(`Bridge ${editingBridgeName ? 'updated' : 'added'} successfully.`);
                    document.getElementById('bridge-modal').style.display = 'none';
                    loadBridges();
                } else {
                    const data = await res.json();
                    alert(`Failed to ${editingBridgeName ? 'update' : 'add'} Bridge: ` + (data.error || 'Unknown error'));
                }
            } catch (e) {
                console.error("Save Bridge error", e);
            }
        }

        async function removeBridge(name) {
            if(!await showConfirm("Are you sure you want to delete this Bridge?", true)) return;
            
            try {
                const res = await fetch(`/api/admin/network/bridges/${name}`, { method: 'DELETE' });
                if (res.ok) {
                    loadBridges();
                } else {
                    alert("Failed to delete Bridge.");
                }
            } catch (e) {
                console.error("Delete Bridge error", e);
            }
        }

        // Helper to populate interface dropdowns
        function populateInterfaceSelect(select, interfaces, visualMap) {
            const currentVal = select.value;
            select.innerHTML = '<option value="" disabled selected>Select Interface</option>';
            
            interfaces.forEach(iface => {
                if (iface.name === 'lo') return;
                const opt = document.createElement('option');
                opt.value = iface.name;
                const visualName = visualMap[iface.name] || iface.name;
                opt.textContent = `${visualName} (${iface.mac || 'No MAC'})`;
                select.appendChild(opt);
            });
            
            // If previous value exists in new options, re-select it
            if (currentVal) select.value = currentVal;
        }

        function toggleDualWanFields(wanPrefix) {
            const type = document.getElementById(`dual-${wanPrefix}-type`).value;
            const staticFields = document.getElementById(`dual-${wanPrefix}-static-fields`);
            const pppoeFields = document.getElementById(`dual-${wanPrefix}-pppoe-fields`);
            
            if (staticFields) staticFields.style.display = 'none';
            if (pppoeFields) pppoeFields.style.display = 'none';
            
            if (type === 'static' && staticFields) {
                staticFields.style.display = 'block';
            } else if (type === 'pppoe' && pppoeFields) {
                pppoeFields.style.display = 'block';
            }
        }

        function addMultiWanRow(data = null) {
            const tbody = document.querySelector('#multi-wan-table tbody');
            const tr = document.createElement('tr');
            
            tr.innerHTML = `
                <td>
                    <select class="login-input multi-wan-iface" style="margin:0; min-width:120px;"></select>
                </td>
                <td>
                    <select class="login-input multi-wan-type" style="margin:0; min-width:100px;" onchange="updateMultiWanDetails(this)">
                        <option value="dynamic">Dynamic</option>
                        <option value="static">Static</option>
                        <option value="pppoe">PPPoE</option>
                    </select>
                </td>
                <td>
                    <input type="number" class="login-input multi-wan-weight" value="1" min="1" style="margin:0; width:60px;">
                </td>
                <td class="multi-wan-details">
                    <!-- Dynamic Placeholder -->
                    <div class="mw-dynamic-group" style="color:#aaa;">Auto Config</div>
                    
                    <!-- Static Fields -->
                    <div class="mw-static-group" style="display:none; grid-template-columns: 1fr 1fr; gap:5px;">
                        <input placeholder="IP" class="login-input input-sm mw-ip" style="margin:0; font-size:0.8rem;">
                        <input placeholder="Gateway" class="login-input input-sm mw-gw" style="margin:0; font-size:0.8rem;">
                    </div>
                    
                    <!-- PPPoE Fields -->
                    <div class="mw-pppoe-group" style="display:none; grid-template-columns: 1fr 1fr; gap:5px;">
                        <input placeholder="User" class="login-input input-sm mw-user" style="margin:0; font-size:0.8rem;">
                        <input placeholder="Pass" type="password" class="login-input input-sm mw-pass" style="margin:0; font-size:0.8rem;">
                    </div>
                </td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="this.closest('tr').remove()">Remove</button>
                </td>
            `;
            
            tbody.appendChild(tr);
            
            // Populate interfaces
            const select = tr.querySelector('.multi-wan-iface');
            if (window.cachedInterfaces && visualInterfaceMap) {
                populateInterfaceSelect(select, window.cachedInterfaces, visualInterfaceMap);
            }
            
            if (data) {
                // Populate data if provided
                if(data.interface) select.value = data.interface;
                if(data.type) tr.querySelector('.multi-wan-type').value = data.type;
                if(data.weight) tr.querySelector('.multi-wan-weight').value = data.weight;
                
                // Populate fields (ALWAYS, regardless of current type, to restore persistence)
                const detailsTd = tr.querySelector('.multi-wan-details');
                if (data.static) {
                    detailsTd.querySelector('.mw-ip').value = data.static.ip || '';
                    detailsTd.querySelector('.mw-gw').value = data.static.gateway || '';
                }
                if (data.pppoe) {
                    detailsTd.querySelector('.mw-user').value = data.pppoe.username || '';
                    detailsTd.querySelector('.mw-pass').value = data.pppoe.password || '';
                }

                // Update visibility
                updateMultiWanDetails(tr.querySelector('.multi-wan-type'));
            }
        }

        function updateMultiWanDetails(select) {
            const td = select.closest('tr').querySelector('.multi-wan-details');
            const type = select.value;
            
            const dynGroup = td.querySelector('.mw-dynamic-group');
            const staticGroup = td.querySelector('.mw-static-group');
            const pppoeGroup = td.querySelector('.mw-pppoe-group');
            
            // Reset
            dynGroup.style.display = 'none';
            staticGroup.style.display = 'none';
            pppoeGroup.style.display = 'none';
            
            if (type === 'dynamic') {
                dynGroup.style.display = 'block';
            } else if (type === 'static') {
                staticGroup.style.display = 'grid';
            } else if (type === 'pppoe') {
                pppoeGroup.style.display = 'grid';
            }
        }



        function toggleWanMode() {
            const mode = document.getElementById('wan-mode').value;
            
            document.querySelectorAll('.wan-mode-section').forEach(el => el.style.display = 'none');
            const target = document.getElementById('mode-' + mode);
            if(target) target.style.display = 'block';

            // Hide main interface selector for multi-interface modes
            const ifaceGroup = document.getElementById('wan-interface-group');
            if (mode === 'dual_wan' || mode === 'multi_wan') {
                ifaceGroup.style.display = 'none';
            } else {
                ifaceGroup.style.display = 'block';
            }
        }

        async function updateWanStatus() {
            const statusEl = document.getElementById('wan-status');
            const textEl = document.getElementById('wan-status-text');
            if (!statusEl || !textEl) return;
            
            try {
                textEl.textContent = 'Checking...';
                statusEl.classList.remove('status-online', 'status-offline');
                
                const response = await fetch('/api/admin/network/status');
                const data = await response.json();
                
                if (data.online) {
                    statusEl.classList.add('status-online');
                    textEl.textContent = 'Online';
                } else {
                    statusEl.classList.add('status-offline');
                    textEl.textContent = 'Offline';
                }
            } catch (e) {
                console.error('Failed to check WAN status:', e);
                statusEl.classList.add('status-offline');
                textEl.textContent = 'Offline';
            }
        }

        async function saveNetworkConfig() {
            const mode = document.getElementById('wan-mode').value;
            const config = {
                interface: document.getElementById('wan-interface').value,
                mode: mode,
                static: {
                    ip: document.getElementById('wan-ip').value,
                    netmask: document.getElementById('wan-netmask').value,
                    gateway: document.getElementById('wan-gateway').value,
                    dns1: document.getElementById('wan-dns1').value,
                    dns2: document.getElementById('wan-dns2').value
                },
                pppoe: {
                    username: document.getElementById('pppoe-user').value,
                    password: document.getElementById('pppoe-pass').value,
                    dns1: document.getElementById('pppoe-dns1').value,
                    dns2: document.getElementById('pppoe-dns2').value
                }
            };

            // Collect Dual WAN Data
            if (mode === 'dual_wan') {
                config.dual_wan = {
                    strategy: document.getElementById('dual-strategy').value,
                    wan1: {
                        interface: document.getElementById('dual-wan1-iface').value,
                        type: document.getElementById('dual-wan1-type').value,
                        static: {
                            ip: document.getElementById('dual-wan1-ip').value,
                            gateway: document.getElementById('dual-wan1-gateway').value,
                            netmask: document.getElementById('dual-wan1-netmask').value,
                            dns: document.getElementById('dual-wan1-dns').value
                        },
                        pppoe: {
                            username: document.getElementById('dual-wan1-user').value,
                            password: document.getElementById('dual-wan1-pass').value
                        }
                    },
                    wan2: {
                        interface: document.getElementById('dual-wan2-iface').value,
                        type: document.getElementById('dual-wan2-type').value,
                        static: {
                            ip: document.getElementById('dual-wan2-ip').value,
                            gateway: document.getElementById('dual-wan2-gateway').value,
                            netmask: document.getElementById('dual-wan2-netmask').value,
                            dns: document.getElementById('dual-wan2-dns').value
                        },
                        pppoe: {
                            username: document.getElementById('dual-wan2-user').value,
                            password: document.getElementById('dual-wan2-pass').value
                        }
                    }
                };

                if (!config.dual_wan.wan1.interface || !config.dual_wan.wan2.interface) {
                    alert("Please select interfaces for both WAN 1 and WAN 2.");
                    return;
                }
                if (config.dual_wan.wan1.interface === config.dual_wan.wan2.interface) {
                    alert("WAN 1 and WAN 2 cannot use the same interface.");
                    return;
                }
            }

            // Collect Multi WAN Data
            if (mode === 'multi_wan') {
                const rows = document.querySelectorAll('#multi-wan-table tbody tr');
                config.multi_wan = Array.from(rows).map(tr => {
                    const type = tr.querySelector('.multi-wan-type').value;
                    const item = {
                        interface: tr.querySelector('.multi-wan-iface').value,
                        type: type,
                        weight: tr.querySelector('.multi-wan-weight').value
                    };
                    
                    // ALWAYS collect nested data to preserve persistence
                    // Static Data
                    const staticIp = tr.querySelector('.mw-ip').value;
                    const staticGw = tr.querySelector('.mw-gw').value;
                    if (staticIp || staticGw) {
                        item.static = {
                            ip: staticIp,
                            gateway: staticGw
                        };
                    }

                    // PPPoE Data
                    const pppoeUser = tr.querySelector('.mw-user').value;
                    const pppoePass = tr.querySelector('.mw-pass').value;
                    if (pppoeUser || pppoePass) {
                        item.pppoe = {
                            username: pppoeUser,
                            password: pppoePass
                        };
                    }

                    return item;
                });

                if (config.multi_wan.length < 2) {
                    alert("Please add at least 2 WAN interfaces for load balancing.");
                    return;
                }
                if (config.multi_wan.some(w => !w.interface)) {
                    alert("Please select an interface for all WAN entries.");
                    return;
                }
            }

            if (mode !== 'dual_wan' && mode !== 'multi_wan' && !config.interface) {
                alert("Please select a WAN interface.");
                return;
            }

            try {
                const res = await fetch('/api/admin/network/wan', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(config),
                    credentials: 'include'
                });
                
                if (res.ok) {
                    alert("Network configuration saved successfully.");
                } else {
                    alert("Failed to save configuration.");
                }
            } catch (e) {
                console.error("Save error", e);
                alert("Error saving configuration.");
            }
        }

        // --- Active Codes Management ---
        let editingCodeId = null;

        let idleCountdownInterval = null;
        let serverTimeOffset = 0; // Client Time - Server Time

        function updateIdleCell(cell) {
            // Adjust current time to match Server Time
            const now = Date.now() - serverTimeOffset;
            const lastTraffic = parseInt(cell.dataset.lastTraffic);
            const idleTimeout = parseInt(cell.dataset.idleTimeout);
            const isPaused = cell.dataset.isPaused === 'true';

            if (isNaN(lastTraffic) || isNaN(idleTimeout)) {
                cell.textContent = '-';
                return;
            }

            if (isPaused) {
                cell.textContent = 'Paused';
                cell.style.color = 'orange';
                return;
            }

            const elapsed = now - lastTraffic;
            const remaining = idleTimeout - elapsed; // Can be negative
            
            if (remaining <= 0) {
                // Show actual idle time when timed out
                const idleSeconds = Math.floor(elapsed / 1000);
                cell.textContent = `Idle: ${idleSeconds}s`;
                cell.style.color = '#c0392b'; // Darker red
                cell.style.fontWeight = 'bold';
            } else {
                // Show countdown
                const seconds = Math.floor(remaining / 1000);
                cell.textContent = `${seconds}s`;
                cell.style.color = seconds < 30 ? '#e74c3c' : 'inherit';
                cell.style.fontWeight = seconds < 30 ? 'bold' : 'normal';
            }
        }

        function startIdleCountdownUpdater() {
            if (idleCountdownInterval) return; // Already running
            
            idleCountdownInterval = setInterval(() => {
                const cells = document.querySelectorAll('.idle-countdown-cell');
                cells.forEach(updateIdleCell);
            }, 1000);
        }

        // Active Sessions Cache & Sort State
        let cachedActiveUsers = [];
        let currentActiveSort = { column: null, direction: 'asc' };

        async function loadActiveCodes() {
            try {
                const res = await fetch('/api/admin/devices');
                if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);
                
                // Sync Time with Server
                const serverTimeHeader = res.headers.get('x-server-time');
                if (serverTimeHeader) {
                    const serverTime = parseInt(serverTimeHeader);
                    if (!isNaN(serverTime)) {
                        // Calculate offset: ClientTime - ServerTime
                        try {
                            serverTimeOffset = Date.now() - serverTime;
                            console.log('Time Sync: Server Time', new Date(serverTime).toLocaleTimeString(), 'Offset:', serverTimeOffset, 'ms');
                        } catch(e) {
                            window.serverTimeOffset = Date.now() - serverTime;
                        }
                    }
                }

                const users = await res.json();
                
                if (!Array.isArray(users)) {
                    throw new Error("Invalid data format received");
                }

                // Cache the data
                cachedActiveUsers = users.filter(u => u.session_code || u.time_remaining > 0);
                
                renderActiveSessionsTable();

            } catch (e) {
                console.error("Error loading active codes", e);
                const tbody = document.querySelector('#active-codes-table tbody');
                if(tbody) tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:red;">Error loading data: ${e.message}</td></tr>`;
            }
        }

        function renderActiveSessionsTable() {
             const tbody = document.querySelector('#active-codes-table tbody');
             if (!tbody) return;
             tbody.innerHTML = '';

             const filterSelect = document.getElementById('active-codes-status-filter');
             const statusFilter = filterSelect ? filterSelect.value : 'all';

             let filteredUsers = [...cachedActiveUsers];

             // Apply Filter
             if (statusFilter === 'online') {
                 filteredUsers = filteredUsers.filter(u => u.is_connected && !u.is_paused);
             } else if (statusFilter === 'offline_paused') {
                 filteredUsers = filteredUsers.filter(u => !u.is_connected || u.is_paused);
             }

             // Apply Sort
             if (currentActiveSort.column) {
                 filteredUsers.sort((a, b) => {
                     let valA, valB;
                     
                     // Helper for string comparison
                     const str = (v) => (v || '').toString().toLowerCase();
                     // Helper for number comparison
                     const num = (v) => Number(v) || 0;
                     
                     switch (currentActiveSort.column) {
                         case 'code':
                             valA = str(a.last_voucher_code || a.user_code || a.session_code);
                             valB = str(b.last_voucher_code || b.user_code || b.session_code);
                             break;
                         case 'mac':
                             valA = str(a.mac_address);
                             valB = str(b.mac_address);
                             break;
                         case 'ip':
                             valA = str(a.ip_address);
                             valB = str(b.ip_address);
                             break;
                         case 'interface':
                             valA = str(a.interface);
                             valB = str(b.interface);
                             break;
                         case 'time':
                             valA = num(a.time_remaining);
                             valB = num(b.time_remaining);
                             break;
                         case 'coins':
                             valA = num(a.total_coins);
                             valB = num(b.total_coins);
                             break;
                         case 'traffic':
                             valA = num(a.total_data_down) + num(a.total_data_up);
                             valB = num(b.total_data_down) + num(b.total_data_up);
                             break;
                         case 'idle':
                             const parseDate = (d) => {
                                 if (!d) return 0;
                                 if (typeof d === 'string' && !d.endsWith('Z')) return new Date(d + 'Z').getTime();
                                 return new Date(d).getTime();
                             };
                             const getIdleTime = (u) => {
                                 const tTraffic = u.last_traffic_at ? parseDate(u.last_traffic_at) : 0;
                                 const tActive = u.last_active_at ? parseDate(u.last_active_at) : 0;
                                 return Math.max(tTraffic, tActive) || 0;
                             };
                             valA = getIdleTime(a);
                             valB = getIdleTime(b);
                             break;
                         case 'status':
                             const getStatusPriority = (u) => {
                                 if (u.is_paused) return 2;
                                 if (u.is_connected) return 1;
                                 return 0;
                             };
                             valA = getStatusPriority(a);
                             valB = getStatusPriority(b);
                             break;
                         default:
                             return 0;
                     }

                     if (valA < valB) return currentActiveSort.direction === 'asc' ? -1 : 1;
                     if (valA > valB) return currentActiveSort.direction === 'asc' ? 1 : -1;
                     return 0;
                 });
             }

             updateSortIndicators();

             if (filteredUsers.length === 0) {
                 tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:20px;">No active codes found</td></tr>';
                 return;
             }

             filteredUsers.forEach(u => {
                 const tr = document.createElement('tr');
                 tr.style.borderBottom = '1px solid #eee';
                 
                 const timeString = formatTime(u.time_remaining);
                 const iface = u.interface || '-';
                 const status = u.is_paused ? '<span style="color:orange">Paused</span>' : 
                                (u.is_connected ? '<span style="color:green">Connected</span>' : '<span style="color:gray">Disconnected</span>');

                 const parseDate = (d) => {
                     if (!d) return null;
                     if (typeof d === 'string' && !d.endsWith('Z')) return new Date(d + 'Z').getTime();
                     return new Date(d).getTime();
                 };
                 const tTraffic = u.last_traffic_at ? parseDate(u.last_traffic_at) : 0;
                 const tActive = u.last_active_at ? parseDate(u.last_active_at) : 0;
                 const lastTraffic = Math.max(tTraffic, tActive) || Date.now();
                 
                 const idleTimeoutMs = (u.effective_idle_timeout || 120) * 1000;
                 const idleCellId = `idle-cell-${u.id}`;

                 const dl = formatBytes(u.total_data_down || 0);
                 const ul = formatBytes(u.total_data_up || 0);
                 
                 const toMbps = (bytes) => ((bytes || 0) * 8 / 1000000).toFixed(2);
                 const dlSpeed = u.current_speed ? toMbps(u.current_speed.dl_speed) : '0.00';
                 const ulSpeed = u.current_speed ? toMbps(u.current_speed.ul_speed) : '0.00';

                 const totalCoins = Number(u.total_coins || 0);

                 tr.innerHTML = `
                     <td style="padding:10px; text-align:center;">
                         ${u.last_voucher_code ? `<span style="font-weight:bold; color:#007bff;">${u.last_voucher_code}</span>` : (u.user_code || u.session_code || '-')}
                     </td>
                     <td style="padding:10px; text-align:center;">${u.mac_address}</td>
                     <td style="padding:10px; text-align:center;">${(u.ip_address || '-').replace('::ffff:', '')}</td>
                     <td style="padding:10px; text-align:center;">${iface}</td>
                     <td style="padding:10px; text-align:center;">${timeString}</td>
                     <td style="padding:10px; text-align:center;">₱${totalCoins.toFixed(2)}</td>
                     <td style="padding:10px; text-align:center;">
                         <div style="font-size:0.85rem; white-space:nowrap;">
                             <span style="color:#2ecc71;">↓</span> ${dl} <span style="font-weight:bold; color:#27ae60;">(${dlSpeed} Mbps)</span>
                             &nbsp;&nbsp;
                             <span style="color:#3498db;">↑</span> ${ul} <span style="font-weight:bold; color:#2980b9;">(${ulSpeed} Mbps)</span>
                         </div>
                     </td>
                     <td style="padding:10px; text-align:center;" class="idle-countdown-cell" 
                         id="${idleCellId}"
                         data-last-traffic="${lastTraffic}" 
                         data-idle-timeout="${idleTimeoutMs}"
                         data-is-paused="${u.is_paused ? 'true' : 'false'}">
                         -
                     </td>
                     <td style="padding:10px; text-align:center;">${status}</td>
                     <td style="padding:10px; text-align:center;">
                         <div style="display:inline-flex; align-items:center; gap:6px; white-space:nowrap;">
                             <button class="btn btn-sm btn-primary" onclick="modifyCode('${u.id}', '${u.session_code || ''}', ${u.time_remaining}, ${u.download_speed || 5120}, ${u.upload_speed || 1024})">Edit</button>
                             <button class="btn btn-sm btn-danger" onclick="deleteCode('${u.id}')">Delete</button>
                         </div>
                     </td>
                 `;
                 tbody.appendChild(tr);

                 const cell = tr.querySelector(`#${idleCellId}`);
                 if (cell && typeof updateIdleCell === 'function') updateIdleCell(cell);
             });
             
             if (typeof startIdleCountdownUpdater === 'function') startIdleCountdownUpdater();
        }

        function sortActiveSessions(column) {
            if (currentActiveSort.column === column) {
                currentActiveSort.direction = currentActiveSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentActiveSort.column = column;
                currentActiveSort.direction = 'asc';
            }
            renderActiveSessionsTable();
        }

        function updateSortIndicators() {
            document.querySelectorAll('.sort-indicator').forEach(el => el.textContent = '');
            if (currentActiveSort.column) {
                const th = document.getElementById(`th-sort-${currentActiveSort.column}`);
                if (th) {
                    const indicator = th.querySelector('.sort-indicator');
                    if (indicator) indicator.textContent = currentActiveSort.direction === 'asc' ? ' ▲' : ' ▼';
                }
            }
        }

        function formatTime(seconds) {
            if (seconds <= 0) return 'Expired';
            const d = Math.floor(seconds / 86400);
            const h = Math.floor((seconds % 86400) / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            const pad = (v) => String(v).padStart(2, '0');
            if (d > 0) {
                return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
            }
            return `${pad(h)}:${pad(m)}:${pad(s)}`;
        }

        function modifyCode(id, code, time, dl, ul) {
            editingCodeId = id;
            document.getElementById('edit-code-input').value = code === 'null' ? '' : code;
            const totalSeconds = time || 0;
            const d = Math.floor(totalSeconds / 86400);
            const h = Math.floor((totalSeconds % 86400) / 3600);
            const m = Math.floor((totalSeconds % 3600) / 60);
            const s = totalSeconds % 60;
            document.getElementById('edit-days-input').value = d;
            document.getElementById('edit-hours-input').value = h;
            document.getElementById('edit-minutes-input').value = m;
            document.getElementById('edit-seconds-input').value = s;

            // Populate speeds (Kbps -> Mbps)
            const dlMbps = ((dl || 0) / 1024).toFixed(1);
            const ulMbps = ((ul || 0) / 1024).toFixed(1);
            document.getElementById('edit-download-speed').value = Number(dlMbps) || '';
            document.getElementById('edit-upload-speed').value = Number(ulMbps) || '';

            document.getElementById('active-code-modal').style.display = 'flex';
        }

        function closeActiveCodeModal() {
            document.getElementById('active-code-modal').style.display = 'none';
            editingCodeId = null;
        }

        async function saveActiveCode() {
            if (!editingCodeId) return;
            
            const code = document.getElementById('edit-code-input').value;
            const days = parseInt(document.getElementById('edit-days-input').value) || 0;
            const hours = parseInt(document.getElementById('edit-hours-input').value) || 0;
            const minutes = parseInt(document.getElementById('edit-minutes-input').value) || 0;
            const seconds = parseInt(document.getElementById('edit-seconds-input').value) || 0;
            const timeRemaining = (days * 86400) + (hours * 3600) + (minutes * 60) + seconds;

            const dlMbps = parseFloat(document.getElementById('edit-download-speed').value);
            const ulMbps = parseFloat(document.getElementById('edit-upload-speed').value);

            const payload = { 
                session_code: code, 
                time_remaining: timeRemaining 
            };

            if (!isNaN(dlMbps)) payload.download_speed = Math.floor(dlMbps * 1024);
            if (!isNaN(ulMbps)) payload.upload_speed = Math.floor(ulMbps * 1024);

            try {
                const res = await fetch(`/api/admin/devices/${editingCodeId}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    closeActiveCodeModal();
                    loadActiveCodes();
                    alert('Code updated successfully');
                } else {
                    alert('Failed to update code');
                }
            } catch (e) {
                console.error('Error updating code', e);
                alert('Error updating code');
            }
        }

        async function deleteCode(id) {
            if (!await showConfirm('Are you sure you want to delete this active session? The user will be disconnected.', true)) return;

            try {
                const res = await fetch(`/api/admin/devices/${id}`, {
                    method: 'DELETE'
                });

                if (res.ok) {
                    loadActiveCodes();
                } else {
                    alert('Failed to delete session');
                }
            } catch (e) {
                console.error('Error deleting session', e);
            }
        }

        // --- VLAN Logic ---
        async function loadVlans() {
            try {
                const res = await fetch('/api/admin/network/vlans', { credentials: 'include' });
                const vlans = await res.json();
                const tbody = document.querySelector('#vlan-table tbody');
                if (!tbody) return;

                tbody.innerHTML = '';
                if (!vlans || vlans.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:15px;">No VLANs configured</td></tr>';
                    return;
                }

                vlans.forEach(vlan => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td style="padding:10px;">${vlan.id || '-'}</td>
                        <td style="padding:10px;">${vlan.parent}.${vlan.vlanId}</td>
                        <td style="padding:10px;">${vlan.mac || 'Auto'}</td>
                        <td style="padding:10px;">${vlan.vlanId}</td>
                        <td style="padding:10px;">
                            <button class="btn btn-sm btn-danger" onclick="deleteVlan('${vlan.id}')">Delete</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            } catch (e) {
                console.error("Error loading VLANs:", e);
            }
        }

        async function openVlanModal() {
            // Populate parent interfaces
            try {
                const res = await fetch('/api/admin/network-interfaces', { credentials: 'include' });
                const interfaces = await res.json();
                const select = document.getElementById('vlan-parent');
                select.innerHTML = '';
                
                // Filter out existing VLANs or loopbacks if needed
                interfaces.forEach(iface => {
                     // Basic filtering: avoid lo, avoid existing vlans if possible
                     if (iface.name !== 'lo' && !iface.name.includes('.')) {
                         const opt = document.createElement('option');
                         opt.value = iface.name;
                         opt.textContent = iface.name;
                         select.appendChild(opt);
                     }
                });
            } catch(e) {
                console.error("Failed to load interfaces for VLAN modal", e);
                alert("Could not load interfaces");
                return;
            }

            // Reset fields
            document.getElementById('vlan-id').value = '';
            document.getElementById('vlan-auto-mac').checked = true;
            document.getElementById('vlan-mac').value = '';
            toggleVlanMacInput();

            document.getElementById('vlan-modal').style.display = 'flex';
        }

        function toggleVlanMacInput() {
            const isAuto = document.getElementById('vlan-auto-mac').checked;
            document.getElementById('vlan-mac').disabled = isAuto;
            if (isAuto) {
                document.getElementById('vlan-mac').placeholder = "Auto Generated";
            } else {
                document.getElementById('vlan-mac').placeholder = "00:11:22:33:44:55";
            }
        }

        async function saveVlan() {
            const parent = document.getElementById('vlan-parent').value;
            const vlanId = document.getElementById('vlan-id').value;
            const autoMac = document.getElementById('vlan-auto-mac').checked;
            const mac = document.getElementById('vlan-mac').value;

            if (!parent || !vlanId) {
                alert("Parent Interface and VLAN ID are required");
                return;
            }

            if (!autoMac && !mac) {
                alert("Please enter a MAC address or select Auto Generate");
                return;
            }

            const payload = {
                parent,
                vlanId: parseInt(vlanId),
                autoMac,
                mac: autoMac ? null : mac
            };

            try {
                const res = await fetch('/api/admin/network/vlans', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    credentials: 'include'
                });

                if (res.ok) {
                    document.getElementById('vlan-modal').style.display = 'none';
                    loadVlans();
                    alert("VLAN created successfully");
                } else {
                    const err = await res.json();
                    alert("Error creating VLAN: " + (err.error || err.message));
                }
            } catch (e) {
                console.error("VLAN save error:", e);
                alert("Failed to save VLAN");
            }
        }

        async function deleteVlan(id) {
            if (!confirm("Are you sure you want to delete this VLAN?")) return;

            try {
                const res = await fetch(`/api/admin/network/vlans/${id}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });

                if (res.ok) {
                    loadVlans();
                } else {
                    alert("Failed to delete VLAN");
                }
            } catch (e) {
                console.error("VLAN delete error:", e);
            }
        }

        /* DHCP Server Logic */
        async function loadDhcp() {
            try {
                const res = await fetch('/api/admin/network/dhcp', { credentials: 'include' });
                const dhcp = await res.json();
                
                // Set bitmask
                document.getElementById('dhcp-bitmask').value = dhcp.bitmask || 19;
                
                // Populate servers table
                const tbody = document.getElementById('dhcp-table-body');
                tbody.innerHTML = '';
                
                if (!dhcp.servers || dhcp.servers.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:15px;">No DHCP servers configured</td></tr>';
                } else {
                    dhcp.servers.forEach(s => {
                        const tr = document.createElement('tr');
                        tr.innerHTML = `
                            <td style="padding:10px;">${s.interface}</td>
                            <td style="padding:10px;">${s.subnet}</td>
                            <td style="padding:10px;">${s.pool_start} - ${s.pool_end}</td>
                            <td style="padding:10px;">${s.netmask}</td>
                            <td style="padding:10px;">${s.lease || '12h'}</td>
                            <td style="padding:10px;">${dhcp.dns1}, ${dhcp.dns2}</td>
                            <td style="padding:10px;">
                                <button class="btn btn-sm btn-danger" onclick="removeDhcpServer('${s.interface}')">Delete</button>
                            </td>
                        `;
                        tbody.appendChild(tr);
                    });
                }
                

                
            } catch (e) {
                console.error("Error loading DHCP:", e);
            }
        }

        async function saveDhcpSettings() {
            const bitmask = parseInt(document.getElementById('dhcp-bitmask').value);
            try {
                const res = await fetch('/api/admin/network/dhcp/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bitmask }),
                    credentials: 'include'
                });
                if (res.ok) {
                    alert("DHCP Settings saved");
                    loadDhcp();
                } else {
                    alert("Failed to save DHCP settings");
                }
            } catch (e) {
                console.error(e);
                alert("Error saving settings");
            }
        }

        async function openDhcpModal() {
            // Load interfaces for selection
            try {
                const res = await fetch('/api/admin/network-interfaces', { credentials: 'include' });
                const interfaces = await res.json();
                const select = document.getElementById('dhcp-interface-select');
                select.innerHTML = '';
                
                select.onchange = calculateNextDhcpSlot;

                const added = new Set();
                interfaces.forEach(iface => {
                    const name = iface.name;
                    // Filter unusable interfaces
                    if (name === 'lo') return;
                    if (name.startsWith('zt')) return; // ZeroTier
                    if (name.startsWith('tun')) return; // VPN Tunnels
                    if (name.startsWith('tap')) return; // VPN Taps
                    if (name.startsWith('docker')) return; // Docker
                    if (name.startsWith('veth')) return; // Docker/Container virtual eth
                    if (name.includes('ifb')) return; // Intermediate Functional Block
                    
                    if (added.has(name)) return;
                    added.add(name);

                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    select.appendChild(opt);
                });
                
                // Trigger calculation for first interface
                if (select.options.length > 0) {
                   calculateNextDhcpSlot();
                }
                
                document.getElementById('dhcp-modal').style.display = 'flex';
            } catch (e) {
                console.error("Error loading interfaces:", e);
                alert("Could not load interfaces");
            }
        }
        
        async function calculateNextDhcpSlot() {
             const iface = document.getElementById('dhcp-interface-select').value;
             if (!iface) return;
             
             document.getElementById('dhcp-calc-info').innerHTML = 'Calculating...';
             
             try {
                 const res = await fetch(`/api/admin/network/dhcp/next-slot?interface=${iface}`, { credentials: 'include' });
                 const data = await res.json();
                 
                 if (data.error) {
                     document.getElementById('dhcp-calc-info').innerHTML = `<span style="color:red">${data.error}</span>`;
                     return;
                 }
                 
                 document.getElementById('dhcp-calc-info').innerHTML = `
                    <div style="color:#2ecc71; font-weight:bold;">Auto-Calculated Subnet:</div>
                    <div>Subnet: ${data.subnet}</div>
                    <div>Netmask: ${data.netmask}</div>
                    <div>Range: ${data.pool_start} - ${data.pool_end}</div>
                    <div>Gateway: ${data.gateway}</div>
                 `;
             } catch (e) {
                 document.getElementById('dhcp-calc-info').textContent = "Error calculating slot";
             }
        }

        async function addDhcpServer() {
            const iface = document.getElementById('dhcp-interface-select').value;
            const dns1 = document.getElementById('dhcp-dns1').value;
            const dns2 = document.getElementById('dhcp-dns2').value;
            
            if (!iface) return;
            
            try {
                const res = await fetch('/api/admin/network/dhcp/servers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ interface: iface, dns1, dns2 }),
                    credentials: 'include'
                });
                
                if (res.ok) {
                    document.getElementById('dhcp-modal').style.display = 'none';
                    loadDhcp();
                    alert("DHCP Server added successfully");
                } else {
                    const err = await res.json();
                    alert("Error: " + (err.error || err.message));
                }
            } catch (e) {
                console.error(e);
                alert("Failed to add DHCP server");
            }
        }

        async function removeDhcpServer(iface) {
            if (!confirm(`Are you sure you want to remove DHCP server for ${iface}?`)) return;
            
            try {
                 const res = await fetch(`/api/admin/network/dhcp/servers/${iface}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
                
                if (res.ok) {
                    loadDhcp();
                } else {
                    alert("Failed to remove DHCP server");
                }
            } catch (e) {
                console.error(e);
            }
        }
    

// --- END BLOCK ---


        // --- Forgot Password Logic Removed (Moved to forgot.html) ---

    

// --- END BLOCK ---


        async function loadPppoeServerConfig() {
            try {
                // Fetch interfaces first
                const ifRes = await fetch('/api/admin/network-interfaces');
                const interfaces = await ifRes.json();
                const ifSelect = document.getElementById('pppoe-server-iface');
                ifSelect.innerHTML = '<option value="br0">br0 (Default)</option>';
                interfaces.forEach(iface => {
                    if (iface.name !== 'lo' && iface.name !== 'br0') {
                        const opt = document.createElement('option');
                        opt.value = iface.name;
                        opt.textContent = `${iface.name} (${iface.ip || 'No IP'})`;
                        ifSelect.appendChild(opt);
                    }
                });

                const res = await fetch('/api/admin/pppoe/config');
                const config = await res.json();
                
                if (config.enabled !== undefined) {
                    document.getElementById('pppoe-server-enabled').checked = config.enabled;
                    document.getElementById('pppoe-server-iface').value = config.interface || 'br0';
                    document.getElementById('pppoe-server-local-ip').value = config.local_ip || '10.10.10.1';
                    document.getElementById('pppoe-server-remote-start').value = config.remote_start || '10.10.10.2';
                    document.getElementById('pppoe-server-count').value = config.remote_count || 50;
                    document.getElementById('pppoe-server-dns1').value = config.dns1 || '8.8.8.8';
                    document.getElementById('pppoe-server-dns2').value = config.dns2 || '8.8.4.4';
                }
            } catch (e) {
                console.error("Error loading PPPoE config:", e);
            }
            loadPppoeProfiles();
            loadPppoeUsers();
        }

        async function savePppoeServerConfig() {
            const config = {
                enabled: document.getElementById('pppoe-server-enabled').checked,
                interface: document.getElementById('pppoe-server-iface').value,
                local_ip: document.getElementById('pppoe-server-local-ip').value,
                remote_start: document.getElementById('pppoe-server-remote-start').value,
                remote_count: parseInt(document.getElementById('pppoe-server-count').value),
                dns1: document.getElementById('pppoe-server-dns1').value,
                dns2: document.getElementById('pppoe-server-dns2').value
            };

            try {
                const res = await fetch('/api/admin/pppoe/config', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(config)
                });
                const data = await res.json();
                if (data.success) {
                    alert('PPPoE Server configuration saved and server restarted (if enabled).');
                } else {
                    alert('Failed to save configuration: ' + data.error);
                }
            } catch (e) {
                alert('Error saving configuration');
            }
        }

        // --- Profile Management ---
        async function loadPppoeProfiles() {
            try {
                const res = await fetch('/api/admin/pppoe/profiles');
                const profiles = await res.json();
                const container = document.getElementById('pppoe-profiles-list');
                if (!container) return; // Guard clause in case element is missing
                container.innerHTML = '';

                if (profiles.length === 0) {
                    container.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px; color:#666;">No profiles found</td></tr>';
                    return;
                }

                profiles.forEach(p => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid #eee';

                    // Convert Kbps to Mbps for display
                    const upMbps = p.rate_limit_up ? (p.rate_limit_up / 1024) : 0;
                    const downMbps = p.rate_limit_down ? (p.rate_limit_down / 1024) : 0;
                    
                    tr.innerHTML = `
                        <td style="padding: 12px 15px;">
                            <div style="font-weight:600;">${p.name}</div>
                        </td>
                        <td style="padding: 12px 15px; color:#666;">
                            ↑ ${upMbps} Mbps / ↓ ${downMbps} Mbps
                        </td>
                        <td style="padding: 12px 15px; text-align: center;">
                            <div style="display:flex; gap:5px; justify-content: center;">
                                <button class="btn btn-sm btn-primary" onclick='openPppoeProfileModal(${JSON.stringify(p)})'>Edit</button>
                                <button class="btn btn-sm btn-danger" onclick="deletePppoeProfile(${p.id})">Delete</button>
                            </div>
                        </td>
                    `;
                    container.appendChild(tr);
                });
            } catch (e) {
                console.error("Error loading profiles:", e);
            }
        }

        function openPppoeProfileModal(profile = null) {
            const modal = document.getElementById('pppoe-profile-modal');
            const title = document.getElementById('pppoe-profile-modal-title');
            
            if (profile) {
                title.textContent = 'Edit Profile';
                document.getElementById('pppoe-profile-id').value = profile.id;
                document.getElementById('pppoe-profile-name').value = profile.name;
                // Convert Kbps to Mbps for input
                document.getElementById('pppoe-profile-rate-up').value = profile.rate_limit_up ? (profile.rate_limit_up / 1024) : '';
                document.getElementById('pppoe-profile-rate-down').value = profile.rate_limit_down ? (profile.rate_limit_down / 1024) : '';
            } else {
                title.textContent = 'Add Profile';
                document.getElementById('pppoe-profile-id').value = '';
                document.getElementById('pppoe-profile-name').value = '';
                document.getElementById('pppoe-profile-rate-up').value = '';
                document.getElementById('pppoe-profile-rate-down').value = '';
            }
            modal.style.display = 'flex';
        }

        function closePppoeProfileModal() {
            document.getElementById('pppoe-profile-modal').style.display = 'none';
        }

        async function savePppoeProfile() {
            const id = document.getElementById('pppoe-profile-id').value;
            // Get Mbps input and convert to Kbps for storage
            const upMbps = parseFloat(document.getElementById('pppoe-profile-rate-up').value) || 0;
            const downMbps = parseFloat(document.getElementById('pppoe-profile-rate-down').value) || 0;

            const profile = {
                name: document.getElementById('pppoe-profile-name').value,
                rate_limit_up: Math.floor(upMbps * 1024),
                rate_limit_down: Math.floor(downMbps * 1024)
            };

            if (!profile.name) return alert('Profile Name is required');

            try {
                const url = id ? `/api/admin/pppoe/profiles/${id}` : '/api/admin/pppoe/profiles';
                const method = id ? 'PUT' : 'POST';
                
                const res = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(profile)
                });
                const data = await res.json();

                if (data.success) {
                    closePppoeProfileModal();
                    loadPppoeProfiles();
                    // Reload users to update profile names if needed
                    loadPppoeUsers();
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                alert('Error saving profile');
            }
        }

        async function deletePppoeProfile(id) {
            if (!await showConfirm('Delete this profile? Users assigned to this profile will be set to No Profile.', true)) return;
            try {
                const res = await fetch(`/api/admin/pppoe/profiles/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    loadPppoeProfiles();
                    loadPppoeUsers();
                } else {
                    alert('Failed to delete profile');
                }
            } catch (e) {
                alert('Error deleting profile');
            }
        }

        // --- User Management ---
        async function loadPppoeUsers() {
            try {
                const res = await fetch('/api/admin/pppoe/users');
                const users = await res.json();
                
                const allContainer = document.getElementById('pppoe-users-all-list');
                const onlineContainer = document.getElementById('pppoe-users-online-list');
                const offlineContainer = document.getElementById('pppoe-users-offline-list');
                
                if (allContainer) allContainer.innerHTML = '';
                if (onlineContainer) onlineContainer.innerHTML = '';
                if (offlineContainer) offlineContainer.innerHTML = '';

                // Helper to create user card (kept for legacy/status lists if used)
                const createUserCard = (u, mode, isOnline) => {
                    const div = document.createElement('div');
                    
                    const expDate = u.expiration_date ? new Date(u.expiration_date).toLocaleDateString() : 'Never';
                    const profileName = u.profile_name || 'No Profile';

                    if (mode === 'status') {
                        // NEW CARD DESIGN FOR STATUS
                        div.className = 'card mb-2 shadow-sm';
                        const statusColor = isOnline ? '#00b894' : '#e74c3c'; 
                        const bgColor = isOnline ? '#e6fff2' : '#fff5f5';
                        
                        div.style.borderLeft = `5px solid ${statusColor}`;
                        div.style.background = bgColor;
                        div.style.marginBottom = '10px';
                        div.style.borderRadius = '5px';
                        div.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';

                        const currentIp = u.current_ip || 'N/A';
                        const macAddr = u.mac_address || '';

                        div.innerHTML = `
                            <div style="padding: 15px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                    <div>
                                        <h5 style="margin:0; font-weight:600; font-size:1.1em; color:#2d3436;">
                                            <i class="fas fa-user-circle" style="margin-right:8px; color:#0984e3;"></i>${u.username}
                                        </h5>
                                        <div style="font-size:0.85em; color:#636e72; margin-top:4px;">
                                            <i class="fas fa-tag" style="margin-right:5px;"></i> ${profileName}
                                        </div>
                                    </div>
                                    <div style="text-align:right;">
                                        <span class="badge ${isOnline ? 'bg-success' : 'bg-danger'}" style="padding: 5px 10px;">
                                            ${isOnline ? 'Active' : 'Expired'}
                                        </span>
                                        ${isOnline ? `<div style="font-size:0.85em; font-weight:bold; color:#00b894; margin-top:5px;"><i class="fas fa-network-wired" style="margin-right:5px;"></i> ${currentIp}</div>` : ''}
                                    </div>
                                </div>
                                <div style="border-top:1px solid rgba(0,0,0,0.05); padding-top:8px; margin-top:8px; display:flex; justify-content:space-between; font-size:0.85em; color:#636e72;">
                                    <div>
                                        <i class="fas fa-clock" style="margin-right:5px;"></i> Expires: <strong>${expDate}</strong>
                                    </div>
                                    <div>
                                        ${macAddr ? `<i class="fas fa-laptop" style="margin-right:5px;"></i> ${macAddr}` : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                    return div;
                };

                let onlineCount = 0;
                let offlineCount = 0;

                users.forEach(u => {
                    // 1. Populate All Users List (Table)
                    if (allContainer) {
                        const tr = document.createElement('tr');
                        const expDate = u.expiration_date ? new Date(u.expiration_date).toLocaleDateString() : 'Never';
                        const profileName = u.profile_name || 'No Profile';
                        const statusBadge = u.is_active 
                            ? '<span class="badge bg-success">Enabled</span>' 
                            : '<span class="badge bg-secondary">Disabled</span>';
                        
                        tr.innerHTML = `
                            <td style="padding: 12px 15px;">${u.username}</td>
                            <td style="padding: 12px 15px;">${u.password || ''}</td>
                            <td style="padding: 12px 15px;">${profileName}</td>
                            <td style="padding: 12px 15px;">${expDate}</td>
                            <td style="padding: 12px 15px;">${statusBadge}</td>
                            <td style="padding: 12px 15px; text-align: center;">
                                <div style="display:flex; gap:5px; justify-content: center;">
                                    <button class="btn btn-sm btn-primary" onclick='openPppoeUserModal(${JSON.stringify(u)})' title="Edit"><i class="fas fa-edit"></i></button>
                                    <button class="btn btn-sm btn-danger" onclick="deletePppoeUser(${u.id})" title="Delete"><i class="fas fa-trash"></i></button>
                                </div>
                            </td>
                        `;
                        allContainer.appendChild(tr);
                    }

                    // 2. Populate Status Lists
                    const now = new Date();
                    const isExpired = u.expiration_date && new Date(u.expiration_date) < now;
                    const isOnline = u.is_active && !isExpired;

                    if (isOnline) {
                        if (onlineContainer) onlineContainer.appendChild(createUserCard(u, 'status', true));
                        onlineCount++;
                    } else {
                        if (offlineContainer) offlineContainer.appendChild(createUserCard(u, 'status', false));
                        offlineCount++;
                    }
                });

                if (allContainer && users.length === 0) allContainer.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:#999;">No users found</td></tr>';
                if (onlineContainer && onlineCount === 0) onlineContainer.innerHTML = '<div style="color:#999; font-style:italic;">No active connections</div>';
                if (offlineContainer && offlineCount === 0) offlineContainer.innerHTML = '<div style="color:#999; font-style:italic;">No offline connections</div>';

            } catch (e) {
                console.error("Error loading PPPoE users:", e);
            }
        }

        async function openPppoeUserModal(user = null) {
            const modal = document.getElementById('pppoe-user-modal');
            const title = document.getElementById('pppoe-modal-title');
            
            // Populate Profiles Dropdown
            try {
                const res = await fetch('/api/admin/pppoe/profiles');
                const profiles = await res.json();
                const pSelect = document.getElementById('pppoe-modal-profile');
                pSelect.innerHTML = '<option value="">No Profile (Unlimited)</option>';
                profiles.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    const upMbps = p.rate_limit_up ? (p.rate_limit_up / 1024) : 0;
                    const downMbps = p.rate_limit_down ? (p.rate_limit_down / 1024) : 0;
                    opt.textContent = `${p.name} (↑${upMbps}M/↓${downMbps}M)`;
                    pSelect.appendChild(opt);
                });
            } catch (e) {
                console.error("Error loading profiles for modal", e);
            }

            if (user) {
                title.textContent = 'Edit PPPoE User';
                document.getElementById('pppoe-user-id').value = user.id;
                document.getElementById('pppoe-modal-user').value = user.username;
                document.getElementById('pppoe-modal-pass').value = user.password;
                document.getElementById('pppoe-modal-profile').value = user.profile_id || '';
                document.getElementById('pppoe-modal-expiry').value = user.expiration_date ? new Date(user.expiration_date).toISOString().split('T')[0] : '';
                document.getElementById('pppoe-modal-active').value = user.is_active;
            } else {
                title.textContent = 'Add PPPoE User';
                document.getElementById('pppoe-user-id').value = '';
                document.getElementById('pppoe-modal-user').value = '';
                document.getElementById('pppoe-modal-pass').value = '';
                document.getElementById('pppoe-modal-profile').value = '';
                document.getElementById('pppoe-modal-expiry').value = '';
                document.getElementById('pppoe-modal-active').value = '1';
            }
            modal.style.display = 'flex';
        }

        function closePppoeUserModal() {
            document.getElementById('pppoe-user-modal').style.display = 'none';
        }

        async function savePppoeUser() {
            const id = document.getElementById('pppoe-user-id').value;
            const user = {
                username: document.getElementById('pppoe-modal-user').value,
                password: document.getElementById('pppoe-modal-pass').value,
                profile_id: document.getElementById('pppoe-modal-profile').value || null,
                expiration_date: document.getElementById('pppoe-modal-expiry').value || null,
                is_active: parseInt(document.getElementById('pppoe-modal-active').value)
            };

            if (!user.username || !user.password) {
                alert('Username and Password are required');
                return;
            }

            try {
                const url = id ? `/api/admin/pppoe/users/${id}` : '/api/admin/pppoe/users';
                const method = id ? 'PUT' : 'POST';
                
                const res = await fetch(url, {
                    method: method,
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(user)
                });
                const data = await res.json();

                if (data.success) {
                    closePppoeUserModal();
                    loadPppoeUsers();
                } else {
                    alert('Error: ' + data.error);
                }
            } catch (e) {
                alert('Error saving user');
            }
        }

        async function deletePppoeUser(id) {
            if (!await showConfirm('Are you sure you want to delete this user?', true)) return;
            try {
                const res = await fetch(`/api/admin/pppoe/users/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    loadPppoeUsers();
                } else {
                    alert('Failed to delete user');
                }
            } catch (e) {
                alert('Error deleting user');
            }
        }
    

// --- END BLOCK ---


