import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Wifi, CheckCircle, RefreshCw, X, Key, User, Settings, LayoutDashboard, ShieldCheck, Search, ArrowRightLeft, Download, Upload, FileText, Trash2, Monitor } from 'lucide-react';

const Dashboard = ({ user, adminProfile, setAdminProfile, devices, setDevices, users = [] }) => {
  const licenseListRef = useRef(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [searchTerm, setSearchTerm] = useState('');
  
  // If user is not admin, they can only see licenses owned by them (matching email or name)
  // For simplicity, we'll match by 'owner' name vs user.name
  const isAdmin = user.role === 'admin';
  const matchesOwnerId = (ownerId) => {
    const oid = String(ownerId || '').trim();
    const uid = String(user.id || '').trim();
    if (!oid || !uid) return false;
    return oid === uid;
  };
  const matchesOwner = (ownerValue) => {
    const o = String(ownerValue || '').toLowerCase();
    if (!o) return false;
    const a = String(user.name || '').toLowerCase();
    const b = String(user.email || '').toLowerCase();
    return o === a || o === b;
  };
  const userDevices = isAdmin ? devices : devices.filter(d => matchesOwnerId(d.ownerId) || matchesOwner(d.owner) || matchesOwner(d.ownerEmail) || matchesOwner(d.ownerName));
  const canRevokeDevice = (device) => {
    if (!device) return false;
    const isOnline = device.status === 'active';
    if (!isOnline) return false;
    if (isAdmin) return true;
    return matchesOwnerId(device.ownerId) || matchesOwner(device.owner) || matchesOwner(device.ownerEmail) || matchesOwner(device.ownerName);
  };

  const [newDevice, setNewDevice] = useState({ qty: 1 });
  const [generatedLicenses, setGeneratedLicenses] = useState([]);
  const [subVendoGen, setSubVendoGen] = useState({ qty: 1 });
  const [generatedSubVendoKeys, setGeneratedSubVendoKeys] = useState([]);
  const [subVendoKeys, setSubVendoKeys] = useState([]);
  const [subVendoUserKeys, setSubVendoUserKeys] = useState([]);
  const [subVendoLoading, setSubVendoLoading] = useState(false);
  const [subVendoErr, setSubVendoErr] = useState('');
  const lastSubVendoSigRef = useRef('');
  const lastSubVendoUserSigRef = useRef('');
  const [transferLogItems, setTransferLogItems] = useState([]);
  const [transferLogLoading, setTransferLogLoading] = useState(false);
  const [transferLogErr, setTransferLogErr] = useState('');
  const lastTransferLogSigRef = useRef('');
  const [actionModal, setActionModal] = useState({
    open: false,
    mode: null,
    licenseKey: '',
    deviceId: null,
    currentOwner: '',
    inputValue: '',
    error: '',
    isSubmitting: false
  });
  const [messageModal, setMessageModal] = useState({ open: false, title: '', message: '' });
  const [downloads, setDownloads] = useState([]);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadsErr, setDownloadsErr] = useState('');
  const lastDownloadsSigRef = useRef('');
  const [uploadFile, setUploadFile] = useState(null);
  const uploadDescRef = useRef('');
  const uploadDescInputRef = useRef(null);
  const uploadCategoryRef = useRef('general');
  const uploadCategoryInputRef = useRef(null);
  const [uploadSubmitting, setUploadSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [devicesUsedGroups, setDevicesUsedGroups] = useState([]);
  const [devicesUsedRows, setDevicesUsedRows] = useState([]);
  const [devicesUsedLoading, setDevicesUsedLoading] = useState(false);
  const [devicesUsedErr, setDevicesUsedErr] = useState('');
  const lastDevicesUsedSigRef = useRef('');

  const formatLastSeen = (device) => {
    const raw = device.lastHeartbeatAt || device.activatedAt || device.createdAt;
    if (!raw) return '--';
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return String(raw);
    return new Date(t).toLocaleString();
  };
  const onlineStatus = (obj) => {
    if (String(obj.status || '') !== 'active') return 'offline';
    const preferred = obj.lastGatewayActiveAt || obj.lastHeartbeatAt || '';
    const t = Date.parse(String(preferred));
    if (!Number.isNaN(t) && (Date.now() - t) <= 70000) return 'online';
    return 'offline';
  };

  const fetchSubVendoKeys = useCallback(async () => {
    setSubVendoErr('');
    if (subVendoKeys.length === 0) setSubVendoLoading(true);
    try {
      const res = await fetch('./api/index.php?endpoint=subvendo-list', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setSubVendoErr('Session expired. Please log in again.');
        return;
      }
      const data = await res.json();
      if (data && Array.isArray(data.licenses)) {
        const sig = data.licenses
          .map((k) => {
            const key = String(k.license || '');
            const machineId = String(k.machineId || '');
            const status = String(k.status || '');
            const owner = String(k.owner || '');
            const expiry = String(k.expiry || '');
            const name = String(k.name || '');
            const last = String(k.lastHeartbeatAt || k.activatedAt || k.createdAt || '');
            return [key, machineId, status, owner, expiry, name, last].join('|');
          })
          .join('||');
        if (!sig || sig !== lastSubVendoSigRef.current) {
          lastSubVendoSigRef.current = sig;
          setSubVendoKeys(data.licenses);
        }
      } else {
        setSubVendoErr('Failed to load Sub Vendo keys');
      }
    } catch (e) {
      console.error(e);
      setSubVendoErr('Failed to load Sub Vendo keys');
    } finally {
      setSubVendoLoading(false);
    }
  }, [subVendoKeys.length]);

  const fetchDownloads = useCallback(async () => {
    setDownloadsErr('');
    if (downloads.length === 0) setDownloadsLoading(true);
    try {
      const res = await fetch('./api/index.php?endpoint=downloads-list', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setDownloadsErr('Unauthorized');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const files = (data && Array.isArray(data.files)) ? data.files : [];
      const sig = files.map((f) => [f.id, f.category, f.name, f.size, f.uploadedAt, f.downloads].map((v) => String(v || '')).join('|')).join('||');
      if (sig !== lastDownloadsSigRef.current) {
        lastDownloadsSigRef.current = sig;
        setDownloads(files);
      }
    } catch (e) {
      console.error(e);
      setDownloadsErr('Failed to load downloads');
    } finally {
      setDownloadsLoading(false);
    }
  }, [downloads.length]);

  const fetchDevicesUsed = useCallback(async () => {
    if (!isAdmin) return;
    setDevicesUsedErr('');
    if (devicesUsedRows.length === 0) setDevicesUsedLoading(true);
    try {
      const res = await fetch('./api/index.php?endpoint=devices-used', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setDevicesUsedErr('Unauthorized');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const groups = (data && Array.isArray(data.groups)) ? data.groups : [];
      const rows = (data && Array.isArray(data.devices)) ? data.devices : [];
      const sig = groups
        .map((g) => [g.device_model, g.app_version, g.total, g.active, g.expired, g.revoked].map((v) => String(v ?? '')).join('|'))
        .join('||') + '::' +
        rows.slice(0, 200)
          .map((r) => [r.machineId, r.license, r.device_model, r.app_version, r.status, r.lastHeartbeatAt].map((v) => String(v ?? '')).join('|'))
          .join('||');
      if (sig !== lastDevicesUsedSigRef.current) {
        lastDevicesUsedSigRef.current = sig;
        setDevicesUsedGroups(groups);
        setDevicesUsedRows(rows);
      }
    } catch (e) {
      console.error(e);
      setDevicesUsedErr('Failed to load devices');
    } finally {
      setDevicesUsedLoading(false);
    }
  }, [isAdmin, devicesUsedRows.length]);

  useEffect(() => {
    if (activeTab !== 'subvendo' && activeTab !== 'users') return;
    if (isAdmin) {
      fetchSubVendoKeys();
      const id = setInterval(fetchSubVendoKeys, 60000);
      return () => clearInterval(id);
    }
    return undefined;
  }, [activeTab, isAdmin, fetchSubVendoKeys]);

  useEffect(() => {
    if (activeTab !== 'downloads') return undefined;
    fetchDownloads();
    const id = setInterval(fetchDownloads, 60000);
    return () => clearInterval(id);
  }, [activeTab, fetchDownloads]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    if (activeTab !== 'devices') return undefined;
    fetchDevicesUsed();
    const id = setInterval(fetchDevicesUsed, 60000);
    return () => clearInterval(id);
  }, [activeTab, isAdmin, fetchDevicesUsed]);

  const fetchTransferLog = useCallback(async () => {
    if (!isAdmin) return;
    setTransferLogErr('');
    if (transferLogItems.length === 0) setTransferLogLoading(true);
    try {
      const res = await fetch('./api/index.php?endpoint=transfer-log', { credentials: 'include' });
      const data = await res.json();
      if (data && Array.isArray(data.items)) {
        const sig = data.items
          .map((x) => [x.type, x.license, x.fromOwner, x.toOwner, x.by, x.at].map((v) => String(v || '')).join('|'))
          .join('||');
        if (!sig || sig !== lastTransferLogSigRef.current) {
          lastTransferLogSigRef.current = sig;
          setTransferLogItems(data.items);
        }
      } else {
        setTransferLogErr('Failed to load transfer history');
      }
    } catch (e) {
      console.error(e);
      setTransferLogErr('Failed to load transfer history');
    } finally {
      setTransferLogLoading(false);
    }
  }, [isAdmin, transferLogItems.length]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    if (activeTab !== 'history') return undefined;
    fetchTransferLog();
    const id = setInterval(fetchTransferLog, 60000);
    return () => clearInterval(id);
  }, [activeTab, isAdmin, fetchTransferLog]);

  const fetchSubVendoUserKeys = useCallback(async () => {
    setSubVendoErr('');
    if (subVendoUserKeys.length === 0) setSubVendoLoading(true);
    try {
      const res = await fetch('./api/index.php?endpoint=subvendo-mylist', { credentials: 'include' });
      if (res.status === 401 || res.status === 403) {
        setSubVendoErr('Session expired. Please log in again.');
        return;
      }
      const data = await res.json();
      if (data && Array.isArray(data.licenses)) {
        const sig = data.licenses
          .map((k) => {
            const key = String(k.license || '');
            const machineId = String(k.machineId || '');
            const status = String(k.status || '');
            const owner = String(k.owner || '');
            const expiry = String(k.expiry || '');
            const name = String(k.name || '');
            const last = String(k.lastHeartbeatAt || k.activatedAt || k.createdAt || '');
            return [key, machineId, status, owner, expiry, name, last].join('|');
          })
          .join('||');
        if (!sig || sig !== lastSubVendoUserSigRef.current) {
          lastSubVendoUserSigRef.current = sig;
          setSubVendoUserKeys(data.licenses);
        }
      } else {
        setSubVendoErr('Failed to load Sub Vendo licenses');
      }
    } catch (e) {
      console.error(e);
      setSubVendoErr('Failed to load Sub Vendo licenses');
    } finally {
      setSubVendoLoading(false);
    }
  }, [subVendoUserKeys.length]);

  useEffect(() => {
    if (activeTab !== 'subvendo') return undefined;
    if (isAdmin) return undefined;
    fetchSubVendoUserKeys();
    const id = setInterval(fetchSubVendoUserKeys, 60000);
    return () => clearInterval(id);
  }, [activeTab, isAdmin, fetchSubVendoUserKeys]);

  useEffect(() => {
    if (generatedLicenses.length > 0 && activeTab === 'list' && licenseListRef.current) {
      licenseListRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [generatedLicenses, activeTab]);

  const handleGenerateLicense = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch('./api/index.php?endpoint=generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          qty: newDevice.qty,
          duration: 120, // 10 years in months (approx)
          owner: user.name
        })
      });

      const data = await response.json();

      if (data.success && Array.isArray(data.licenses)) {
        setDevices([...data.licenses, ...devices]);
        setGeneratedLicenses(data.licenses);
        setNewDevice({ qty: 1 });
        alert(`Success! Generated ${data.licenses.length} licenses.`);
        setActiveTab('list'); // Switch to list tab
      } else {
        alert('Error: ' + (data.message || 'Failed to generate'));
      }
    } catch (error) {
      console.error('API Error:', error);
      alert('Failed to connect to API. Make sure you are running on XAMPP.');
    }
  };

  const handleGenerateSubVendoKeys = async (e) => {
    e.preventDefault();

    try {
      const response = await fetch('./api/index.php?endpoint=subvendo-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          qty: subVendoGen.qty,
          duration: 'lifetime',
          owner: user.name
        })
      });

      const data = await response.json();

      if (data.success && Array.isArray(data.licenses)) {
        setGeneratedSubVendoKeys(data.licenses);
        setSubVendoGen({ qty: 1 });
        alert(`Success! Generated ${data.licenses.length} Sub Vendo keys.`);
      } else {
        alert('Error: ' + (data.message || 'Failed to generate'));
      }
    } catch (error) {
      console.error('API Error:', error);
      alert('Failed to connect to API.');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('License key copied to clipboard!');
  };

  const showMessage = (title, message) => {
    setMessageModal({ open: true, title, message });
  };

  const closeMessage = () => {
    setMessageModal({ open: false, title: '', message: '' });
  };

  const closeActionModal = () => {
    setActionModal({
      open: false,
      mode: null,
      licenseKey: '',
      deviceId: null,
      currentOwner: '',
      inputValue: '',
      error: '',
      isSubmitting: false
    });
  };

  const openLicenseRevokeModal = (device) => {
    if (!canRevokeDevice(device)) return;
    const key = device && device.license ? String(device.license) : '';
    if (!key) return;
    setActionModal({
      open: true,
      mode: 'license_revoke',
      licenseKey: key,
      deviceId: device.id,
      currentOwner: device.ownerName || device.owner || '',
      inputValue: '',
      error: '',
      isSubmitting: false
    });
  };

  const openLicenseTransferModal = (device) => {
    if (!isAdmin) return;
    const key = device && device.license ? String(device.license) : '';
    if (!key) return;
    setActionModal({
      open: true,
      mode: 'license_transfer',
      licenseKey: key,
      deviceId: device.id,
      currentOwner: device.ownerName || device.owner || '',
      inputValue: '',
      error: '',
      isSubmitting: false
    });
  };

  const openSubVendoRevokeModal = (k) => {
    const owner = String(k.owner || '').toLowerCase();
    const a = String(user.name || '').toLowerCase();
    const b = String(user.email || '').toLowerCase();
    const allowed = (k.status === 'active') && (isAdmin || owner === a || owner === b);
    if (!allowed) return;
    setActionModal({
      open: true,
      mode: 'subvendo_revoke',
      licenseKey: String(k.license || ''),
      deviceId: null,
      currentOwner: String(k.owner || ''),
      inputValue: '',
      error: '',
      isSubmitting: false
    });
  };

  const openSubVendoTransferModal = (k) => {
    if (!isAdmin) return;
    setActionModal({
      open: true,
      mode: 'subvendo_transfer',
      licenseKey: String(k.license || ''),
      deviceId: null,
      currentOwner: String(k.owner || ''),
      inputValue: '',
      error: '',
      isSubmitting: false
    });
  };

  const openSubVendoUnassignModal = (k) => {
    if (!isAdmin) return;
    setActionModal({
      open: true,
      mode: 'subvendo_unassign',
      licenseKey: String(k.license || ''),
      deviceId: null,
      currentOwner: String(k.owner || ''),
      inputValue: '',
      error: '',
      isSubmitting: false
    });
  };

  const handleRevokeLicense = (device) => {
    openLicenseRevokeModal(device);
  };

  const openTransferModal = (device) => {
    openLicenseTransferModal(device);
  };

  const confirmActionModal = async (e) => {
    if (e) e.preventDefault();
    if (!actionModal.open || actionModal.isSubmitting) return;

    const mode = actionModal.mode;
    const licenseKey = String(actionModal.licenseKey || '').trim();
    if (!licenseKey) return;

    setActionModal((prev) => ({ ...prev, isSubmitting: true, error: '' }));

    try {
      if (mode === 'license_revoke') {
        const reason = String(actionModal.inputValue || '').trim();
        const response = await fetch('./api/index.php?endpoint=revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ key: licenseKey, reason })
        });
        const data = await response.json();
        if (data.success) {
          const updated = devices.map(d => {
            if (d.id === actionModal.deviceId) {
              return { ...d, status: 'revoked', machineId: null, revokedReason: reason || null, revokedAt: new Date().toISOString() };
            }
            return d;
          });
          setDevices(updated);
          closeActionModal();
          showMessage('Success', 'License revoked successfully.');
          return;
        }
        setActionModal((prev) => ({ ...prev, isSubmitting: false, error: data.message || 'Revoke failed' }));
        return;
      }

      if (mode === 'license_transfer') {
        const newOwner = String(actionModal.inputValue || '').trim();
        if (!newOwner) {
          setActionModal((prev) => ({ ...prev, isSubmitting: false, error: 'Please enter the new owner.' }));
          return;
        }
        const response = await fetch('./api/index.php?endpoint=transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ licenseKey, newOwner })
        });
        const data = await response.json();
        if (data.success) {
          const serverLicense = data.license || null;
          const updatedDevices = devices.map(d => {
            if (d.id === actionModal.deviceId) {
              if (serverLicense && serverLicense.license === d.license) {
                return { ...d, ...serverLicense };
              }
              return { ...d, owner: newOwner };
            }
            return d;
          });
          setDevices(updatedDevices);
          closeActionModal();
          showMessage('Success', 'License transferred successfully.');
          return;
        }
        setActionModal((prev) => ({ ...prev, isSubmitting: false, error: data.message || 'Transfer failed' }));
        return;
      }

      if (mode === 'subvendo_revoke') {
        const reason = String(actionModal.inputValue || '').trim();
        const response = await fetch('./api/index.php?endpoint=subvendo-revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ key: licenseKey, reason })
        });
        const data = await response.json();
        if (data.success) {
          closeActionModal();
          if (isAdmin) fetchSubVendoKeys();
          else fetchSubVendoUserKeys();
          showMessage('Success', 'Sub Vendo key revoked successfully.');
          return;
        }
        setActionModal((prev) => ({ ...prev, isSubmitting: false, error: data.message || 'Revoke failed' }));
        return;
      }

      if (mode === 'subvendo_transfer') {
        const newOwner = String(actionModal.inputValue || '').trim();
        if (!newOwner) {
          setActionModal((prev) => ({ ...prev, isSubmitting: false, error: 'Please enter the new owner.' }));
          return;
        }
        const response = await fetch('./api/index.php?endpoint=subvendo-transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ key: licenseKey, newOwner })
        });
        const data = await response.json();
        if (data.success) {
          const serverKey = data.license || null;
          closeActionModal();
          if (isAdmin) {
            if (serverKey && serverKey.license) {
              setSubVendoKeys((prev) => prev.map((k) => (k.license === serverKey.license ? { ...k, ...serverKey } : k)));
            } else {
              fetchSubVendoKeys();
            }
          }
          showMessage('Success', 'Sub Vendo key transferred successfully.');
          return;
        }
        setActionModal((prev) => ({ ...prev, isSubmitting: false, error: data.message || 'Transfer failed' }));
        return;
      }

      if (mode === 'subvendo_unassign') {
        const response = await fetch('./api/index.php?endpoint=subvendo-unassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ key: licenseKey })
        });
        const data = await response.json();
        if (data.success) {
          closeActionModal();
          fetchSubVendoKeys();
          showMessage('Success', 'Sub Vendo key unassigned successfully.');
          return;
        }
        setActionModal((prev) => ({ ...prev, isSubmitting: false, error: data.message || 'Unassign failed' }));
        return;
      }

      setActionModal((prev) => ({ ...prev, isSubmitting: false, error: 'Unknown action' }));
    } catch (err) {
      console.error(err);
      setActionModal((prev) => ({ ...prev, isSubmitting: false, error: 'API Error. Please try again.' }));
    }
  };

  // Tab Content Components
  const OverviewTab = () => {
    const [sort, setSort] = useState({ key: null, dir: 'asc' });

    const toggleSort = (key) => {
      setSort((prev) => {
        if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
        return { key, dir: 'asc' };
      });
    };

    const sortIndicator = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const statusRank = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'active') return 0;
      if (v === 'generated') return 1;
      if (v === 'revoked') return 2;
      if (v === 'expired') return 3;
      return 4;
    };

    const sortedUserDevices = (() => {
      const baseDevices = isAdmin ? devices : userDevices;
      if (!sort.key) return baseDevices;

      const dir = sort.dir === 'asc' ? 1 : -1;
      const withIdx = baseDevices.map((item, idx) => ({ item, idx }));

      const getTs = (raw) => {
        const t = Date.parse(String(raw || ''));
        return Number.isNaN(t) ? 0 : t;
      };
      const getExpiryTs = (d) => getTs(d.expiry);
      const getLastSeenTs = (d) => getTs(d.lastHeartbeatAt || d.activatedAt || d.createdAt);
      const getStr = (v) => String(v || '').toLowerCase();

      withIdx.sort((a, b) => {
        const A = a.item;
        const B = b.item;
        let cmp = 0;

        if (sort.key === 'machineId') {
          cmp = (getStr(A.machineId) + '|' + getStr(A.name)).localeCompare((getStr(B.machineId) + '|' + getStr(B.name)), undefined, { numeric: true });
        } else if (sort.key === 'license') {
          cmp = getStr(A.license).localeCompare(getStr(B.license), undefined, { numeric: true });
        } else if (sort.key === 'owner') {
          const ao = getStr(A.ownerName || A.owner);
          const bo = getStr(B.ownerName || B.owner);
          cmp = (ao + '|' + getStr(A.name)).localeCompare((bo + '|' + getStr(B.name)), undefined, { numeric: true });
        } else if (sort.key === 'status') {
          cmp = statusRank(A.status) - statusRank(B.status);
        } else if (sort.key === 'lastSeen') {
          cmp = getLastSeenTs(A) - getLastSeenTs(B);
        } else if (sort.key === 'expiry') {
          cmp = getExpiryTs(A) - getExpiryTs(B);
        }

        if (cmp === 0) return a.idx - b.idx;
        return cmp * dir;
      });

      return withIdx.map((x) => x.item);
    })();

    return (
      <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Total Licenses</p>
              <p className="text-3xl font-bold text-white mt-1">{userDevices.length}</p>
            </div>
            <div className="bg-blue-500/20 p-3 rounded-lg">
              <Key className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Used Licenses</p>
              <p className="text-3xl font-bold text-emerald-400 mt-1">
                {userDevices.filter(d => d.status === 'active').length}
              </p>
            </div>
            <div className="bg-emerald-500/20 p-3 rounded-lg">
              <Wifi className="h-6 w-6 text-emerald-400" />
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Unused Licenses</p>
              <p className="text-3xl font-bold text-indigo-400 mt-1">
                {userDevices.filter(d => d.status === 'generated').length}
              </p>
            </div>
            <div className="bg-indigo-500/20 p-3 rounded-lg">
              <ShieldCheck className="h-6 w-6 text-indigo-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity / Device List */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">
            {isAdmin ? 'Recent Activations' : 'My Licenses'}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">
                  <button type="button" onClick={() => toggleSort('machineId')} className="text-left hover:text-white transition-colors">
                    Device / Machine ID{sortIndicator('machineId')}
                  </button>
                </th>
                <th className="px-6 py-4 font-medium">
                  <button type="button" onClick={() => toggleSort('license')} className="text-left hover:text-white transition-colors">
                    License Key{sortIndicator('license')}
                  </button>
                </th>
                {isAdmin && (
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('owner')} className="text-left hover:text-white transition-colors">
                      Owner{sortIndicator('owner')}
                    </button>
                  </th>
                )}
                <th className="px-6 py-4 font-medium">
                  <button type="button" onClick={() => toggleSort('status')} className="text-left hover:text-white transition-colors">
                    Status{sortIndicator('status')}
                  </button>
                </th>
                <th className="px-6 py-4 font-medium">
                  <button type="button" onClick={() => toggleSort('lastSeen')} className="text-left hover:text-white transition-colors">
                    Last Seen{sortIndicator('lastSeen')}
                  </button>
                </th>
                <th className="px-6 py-4 font-medium text-right">
                  <button type="button" onClick={() => toggleSort('expiry')} className="text-left hover:text-white transition-colors">
                    Expiry{sortIndicator('expiry')}
                  </button>
                </th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {sortedUserDevices.map((device) => (
                <tr key={device.id} className="hover:bg-slate-700/50">
                  <td className="px-6 py-4">
                    <div className="text-white font-medium">{device.name}</div>
                    <div className="text-slate-400 text-xs font-mono">{device.machineId || 'Pending'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-2">
                       <code className="text-blue-400 font-mono text-sm font-bold">{device.license}</code>
                       <button onClick={() => copyToClipboard(device.license)} className="text-slate-500 hover:text-white">
                         <RefreshCw className="h-3 w-3" />
                       </button>
                    </div>
                  </td>
                {isAdmin && <td className="px-6 py-4 text-slate-300">{device.ownerName || device.owner}</td>}
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      device.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 
                      device.status === 'generated' ? 'bg-blue-500/10 text-blue-400' :
                      device.status === 'revoked' ? 'bg-rose-500/10 text-rose-400' :
                      'bg-rose-500/10 text-rose-400'
                    }`}>
                      {device.status === 'active' ? 'Active' : 
                       device.status === 'generated' ? 'Ready' : 
                       device.status === 'revoked' ? 'Revoked' : 'Expired'}
                    </span>
                    {device.machineId && (
                      <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        onlineStatus(device) === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-300'
                      }`}>
                        {onlineStatus(device) === 'online' ? 'Online' : 'Offline'}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-slate-400 text-sm">{formatLastSeen(device)}</td>
                  <td className="px-6 py-4 text-right text-slate-400 text-sm">{device.expiry}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-3">
                      {canRevokeDevice(device) && (
                        <button
                          onClick={() => handleRevokeLicense(device)}
                          className="text-rose-400 hover:text-rose-300 transition-colors"
                          title="Revoke License"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                      {isAdmin && (
                        <button 
                          onClick={() => openTransferModal(device)}
                          className="text-blue-400 hover:text-blue-300 transition-colors"
                          title="Transfer License"
                        >
                          <ArrowRightLeft className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {userDevices.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-6 py-8 text-center text-slate-500">
                    No licenses found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    );
  };

  const DownloadsTab = () => {
    const doUpload = async () => {
      if (!isAdmin) return;
      if (!uploadFile) {
        showMessage('Error', 'Please choose a file to upload.');
        return;
      }
      if (uploadSubmitting) return;
      setUploadSubmitting(true);
      setUploadProgress(0);
      try {
        const desc = String(uploadDescRef.current || '').trim();
        const category = String(uploadCategoryRef.current || '').trim() || 'general';
        const useChunked = uploadFile.size >= 1024 * 1024;

        if (!useChunked) {
          const fd = new FormData();
          fd.append('file', uploadFile);
          if (desc) fd.append('description', desc);
          fd.append('category', category);

          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', './api/index.php?endpoint=downloads-upload', true);
            xhr.withCredentials = true;
            xhr.timeout = 10 * 60 * 1000;

            xhr.upload.onprogress = (evt) => {
              if (!evt.lengthComputable) return;
              const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
              setUploadProgress(pct);
            };

            xhr.onload = () => {
              const raw = String(xhr.responseText || '');
              let data = {};
              try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
              if (xhr.status >= 200 && xhr.status < 300 && data && data.success) {
                resolve();
                return;
              }
              const msg = (data && data.message) ? data.message : (raw || `Upload failed (HTTP ${xhr.status})`);
              reject(new Error(msg));
            };
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.ontimeout = () => reject(new Error('Upload timed out. Your connection may be slow or the file is large.'));

            xhr.send(fd);
          });
        } else {
          const initRes = await fetch('./api/index.php?endpoint=downloads-upload-init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              name: uploadFile.name,
              size: uploadFile.size,
              description: desc,
              category
            })
          });
          const initData = await initRes.json().catch(() => ({}));
          if (!initRes.ok || !initData.success || !initData.uploadId) {
            throw new Error(initData.message || 'Upload init failed');
          }

          const uploadId = String(initData.uploadId);
          const chunkSize = 512 * 1024;
          let offset = 0;

          while (offset < uploadFile.size) {
            const chunk = uploadFile.slice(offset, offset + chunkSize);
            const res = await fetch(`./api/index.php?endpoint=downloads-upload-chunk&uploadId=${encodeURIComponent(uploadId)}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-Upload-Offset': String(offset)
              },
              credentials: 'include',
              body: chunk
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409 && data && typeof data.expectedOffset === 'number') {
              offset = data.expectedOffset;
              continue;
            }
            if (!res.ok || !data.success) {
              throw new Error((data && data.message) ? data.message : 'Chunk upload failed');
            }
            offset += chunk.size;
            setUploadProgress(Math.max(0, Math.min(100, Math.round((offset / uploadFile.size) * 100))));
          }

          const finRes = await fetch('./api/index.php?endpoint=downloads-upload-finish', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ uploadId })
          });
          const finData = await finRes.json().catch(() => ({}));
          if (!finRes.ok || !finData.success) {
            throw new Error(finData.message || 'Upload finalize failed');
          }
        }

        setUploadFile(null);
        uploadDescRef.current = '';
        if (uploadDescInputRef.current) uploadDescInputRef.current.value = '';
        uploadCategoryRef.current = 'general';
        if (uploadCategoryInputRef.current) uploadCategoryInputRef.current.value = 'general';
        setUploadProgress(100);
        await fetchDownloads();
        showMessage('Success', 'File uploaded successfully.');
      } catch (e) {
        console.error(e);
        showMessage('Error', String(e && e.message ? e.message : 'Upload failed'));
      } finally {
        setUploadSubmitting(false);
      }
    };

    const doDelete = async (id) => {
      if (!isAdmin) return;
      if (!window.confirm('Delete this file?')) return;
      try {
        const res = await fetch('./api/index.php?endpoint=downloads-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          showMessage('Error', data.message || 'Delete failed');
          return;
        }
        await fetchDownloads();
        showMessage('Success', 'Deleted');
      } catch (e) {
        console.error(e);
        showMessage('Error', 'Delete failed');
      }
    };

    const downloadUrl = (id) => `./api/index.php?endpoint=downloads-download&id=${encodeURIComponent(String(id))}`;
    const filesNeofi = downloads.filter((f) => String(f.category || 'general') === 'neofi_update');
    const filesSubVendo = downloads.filter((f) => String(f.category || 'general') === 'subvendo_firmware');
    const filesOther = downloads.filter((f) => !['neofi_update', 'subvendo_firmware'].includes(String(f.category || 'general')));

    return (
      <div className="space-y-8">
        {isAdmin && (
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
            <h2 className="text-xl font-bold text-white flex items-center">
              <Upload className="h-5 w-5 mr-2 text-emerald-400" />
              Upload File
            </h2>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-300 mb-2">File</label>
                <input
                  type="file"
                  onChange={(e) => setUploadFile((e.target.files && e.target.files[0]) || null)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white"
                />
                {uploadFile ? (
                  <div className="text-slate-400 text-xs mt-2">
                    Selected: <span className="text-slate-200">{uploadFile.name}</span> ({(uploadFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </div>
                ) : null}
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                <input
                  type="text"
                  ref={uploadDescInputRef}
                  onChange={(e) => { uploadDescRef.current = e.target.value; }}
                  placeholder="Optional"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-slate-300 mb-2">Category</label>
                <select
                  ref={uploadCategoryInputRef}
                  defaultValue="general"
                  onChange={(e) => { uploadCategoryRef.current = e.target.value; }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white"
                >
                  <option value="neofi_update">NeoFi Update</option>
                  <option value="subvendo_firmware">Sub Vendo Firmware</option>
                  <option value="general">Other</option>
                </select>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={doUpload}
                type="button"
                disabled={uploadSubmitting}
                className={`bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors flex items-center ${
                  uploadSubmitting ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <Upload className={`h-4 w-4 mr-2 ${uploadSubmitting ? 'animate-pulse' : ''}`} />
                {uploadSubmitting ? 'Uploading...' : 'Upload'}
              </button>
            </div>
            {uploadSubmitting && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                  <span>Progress</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-2 bg-emerald-500" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center">
              <FileText className="h-5 w-5 mr-2 text-blue-400" />
              Downloads
            </h2>
            <button
              onClick={fetchDownloads}
              className="text-slate-400 hover:text-white flex items-center"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${downloadsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {downloadsErr && (
            <div className="p-6 text-rose-300 text-sm">{downloadsErr}</div>
          )}

          {!downloadsErr && (
            <div className="p-6 space-y-8">
              {[
                { title: 'NeoFi Updates', files: filesNeofi },
                { title: 'Sub Vendo Firmware', files: filesSubVendo },
                { title: 'Other Files', files: filesOther }
              ].map((sec) => (
                <div key={sec.title} className="bg-slate-900/30 rounded-xl border border-slate-700 overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
                    <div className="text-white font-semibold">{sec.title}</div>
                    <div className="text-slate-500 text-xs">{sec.files.length} file(s)</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-700">
                      <thead className="bg-slate-900/40">
                        <tr>
                          <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">File</th>
                          <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Uploaded</th>
                          <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Downloads</th>
                          <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700">
                        {sec.files.map((f) => (
                          <tr key={f.id} className="hover:bg-slate-700/30 transition-colors">
                            <td className="px-5 py-4">
                              <div className="text-white font-medium">{f.name}</div>
                              {f.description ? (
                                <div className="text-slate-400 text-xs mt-1">{f.description}</div>
                              ) : null}
                              <div className="text-slate-500 text-xs mt-1">
                                {(Number(f.size || 0) / (1024 * 1024)).toFixed(2)} MB
                              </div>
                            </td>
                            <td className="px-5 py-4 text-slate-300 text-sm">
                              {f.uploadedAt ? new Date(f.uploadedAt).toLocaleString() : '--'}
                            </td>
                            <td className="px-5 py-4 text-slate-300 text-sm">{Number(f.downloads || 0)}</td>
                            <td className="px-5 py-4 text-right">
                              <div className="inline-flex items-center gap-3">
                                <a
                                  href={downloadUrl(f.id)}
                                  className="text-blue-400 hover:text-blue-300 inline-flex items-center"
                                  title="Download"
                                >
                                  <Download className="h-4 w-4" />
                                </a>
                                {isAdmin && (
                                  <button
                                    onClick={() => doDelete(f.id)}
                                    className="text-rose-400 hover:text-rose-300 inline-flex items-center"
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {sec.files.length === 0 && (
                          <tr>
                            <td className="px-5 py-6 text-center text-slate-400" colSpan={4}>
                              No files.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const DevicesTab = () => {
    const formatIso = (raw) => {
      if (!raw) return '--';
      const t = Date.parse(String(raw));
      if (Number.isNaN(t)) return String(raw);
      return new Date(t).toLocaleString();
    };

    return (
      <div className="space-y-6">
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center">
              <Monitor className="h-5 w-5 mr-2 text-indigo-400" />
              Devices Used
            </h2>
            <button
              onClick={fetchDevicesUsed}
              className="text-slate-400 hover:text-white flex items-center"
              title="Refresh"
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${devicesUsedLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {devicesUsedErr && (
            <div className="p-6 text-rose-300 text-sm">{devicesUsedErr}</div>
          )}

          {!devicesUsedErr && (
            <div className="p-6 space-y-8">
              <div className="bg-slate-900/30 rounded-xl border border-slate-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
                  <div className="text-white font-semibold">By Model & Version</div>
                  <div className="text-slate-500 text-xs">{devicesUsedGroups.length} group(s)</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-700">
                    <thead className="bg-slate-900/40">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Device Model</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">NeoFi Version</th>
                        <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Total</th>
                        <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Active</th>
                        <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Expired</th>
                        <th className="px-5 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">Revoked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {devicesUsedGroups.map((g) => (
                        <tr key={`${g.device_model}::${g.app_version}`} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-5 py-4 text-white">{g.device_model || 'Unknown'}</td>
                          <td className="px-5 py-4 text-slate-300">{g.app_version || '-'}</td>
                          <td className="px-5 py-4 text-right text-white font-semibold">{Number(g.total || 0)}</td>
                          <td className="px-5 py-4 text-right text-emerald-300">{Number(g.active || 0)}</td>
                          <td className="px-5 py-4 text-right text-amber-300">{Number(g.expired || 0)}</td>
                          <td className="px-5 py-4 text-right text-rose-300">{Number(g.revoked || 0)}</td>
                        </tr>
                      ))}
                      {devicesUsedGroups.length === 0 && (
                        <tr>
                          <td className="px-5 py-6 text-center text-slate-400" colSpan={6}>No devices found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-900/30 rounded-xl border border-slate-700 overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
                  <div className="text-white font-semibold">Active Machines</div>
                  <div className="text-slate-500 text-xs">{devicesUsedRows.length} device(s)</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-700">
                    <thead className="bg-slate-900/40">
                      <tr>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Machine ID</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Device Model</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">NeoFi Version</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">License</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Owner</th>
                        <th className="px-5 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {devicesUsedRows.map((r) => (
                        <tr key={r.machineId} className="hover:bg-slate-700/30 transition-colors">
                          <td className="px-5 py-4 text-white font-mono">{r.machineId}</td>
                          <td className="px-5 py-4 text-slate-200">{r.device_model || 'Unknown'}</td>
                          <td className="px-5 py-4 text-slate-300">{r.app_version || '-'}</td>
                          <td className="px-5 py-4 text-blue-300 font-mono">{r.license || '--'}</td>
                          <td className="px-5 py-4 text-slate-300">{r.owner || '--'}</td>
                          <td className="px-5 py-4 text-slate-300">{formatIso(r.lastHeartbeatAt || r.activatedAt)}</td>
                        </tr>
                      ))}
                      {devicesUsedRows.length === 0 && (
                        <tr>
                          <td className="px-5 py-6 text-center text-slate-400" colSpan={6}>No devices found.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderLicenseGenerateTab = () => {
    return (
    <div className="max-w-2xl mx-auto">
      {/* Generation Form */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8">
        <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
          <ShieldCheck className="h-6 w-6 mr-3 text-blue-400" />
          Generate License Key
        </h2>
        <p className="text-slate-400 text-sm mb-6">
          Generate unique license keys. These keys will be bound to the first device that activates them.
        </p>

        <form onSubmit={handleGenerateLicense} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Quantity</label>
            <input
              type="number"
              min="1"
              required
              value={newDevice.qty}
              onChange={(e) => setNewDevice({...newDevice, qty: e.target.value})}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-600"
              placeholder="Number of keys to generate"
            />
          </div>

          <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
            <p className="text-sm text-slate-400">
              <span className="text-white font-medium">Note:</span> All licenses are automatically valid for 10 years from the date of activation.
            </p>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-blue-500/20 mt-4 text-lg"
          >
            Generate License Keys
          </button>
        </form>
      </div>

      {/* Sub Vendo Generator */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 mt-6">
        <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
          <ShieldCheck className="h-6 w-6 mr-3 text-rose-400" />
          Generate Sub Vendo Keys
        </h2>
        <p className="text-slate-400 text-sm mb-6">
          Generates 10-character keys (SV + 8 alphanumeric). These are used for NeoFi Sub Vendo activation.
        </p>

        <form onSubmit={handleGenerateSubVendoKeys} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Quantity</label>
            <input
              type="number"
              min="1"
              required
              value={subVendoGen.qty}
              onChange={(e) => setSubVendoGen({ ...subVendoGen, qty: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-rose-500 placeholder-slate-600"
              placeholder="Number of keys to generate"
            />
          </div>

          <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
            <p className="text-sm text-slate-400">
              <span className="text-white font-medium">Format:</span> SVXXXXXXXX (10 chars)
            </p>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-700 hover:to-orange-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-rose-500/20 mt-4 text-lg"
          >
            Generate Sub Vendo Keys
          </button>
        </form>

        {generatedSubVendoKeys.length > 0 && (
          <div className="mt-6">
            <div className="text-sm font-medium text-slate-300 mb-2">Generated Keys</div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4 space-y-2">
              {generatedSubVendoKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-4">
                  <code className="text-rose-400 font-mono text-sm font-bold">{k.license}</code>
                  <button
                    onClick={() => copyToClipboard(k.license)}
                    className="text-slate-400 hover:text-white transition-colors text-sm"
                  >
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
  };

  const SubVendoKeysTab = () => {
    const [filterStatus, setFilterStatus] = useState('all');
    const [sort, setSort] = useState({ key: null, dir: 'asc' });

    const toggleSort = (key) => {
      setSort((prev) => {
        if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
        return { key, dir: 'asc' };
      });
    };

    const sortIndicator = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const statusRank = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'active') return 0;
      if (v === 'generated') return 1;
      if (v === 'revoked') return 2;
      if (v === 'expired') return 3;
      return 4;
    };

    const filtered = subVendoKeys.filter((k) => {
      const matchesSearch = String(k.license || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(k.machineId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(k.owner || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(k.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (filterStatus === 'all') return true;
      if (filterStatus === 'generated') return k.status === 'generated';
      if (filterStatus === 'active') return k.status === 'active';
      if (filterStatus === 'revoked') return k.status === 'revoked';
      if (filterStatus === 'expired') return k.status !== 'active' && k.status !== 'generated' && k.status !== 'revoked';
      return true;
    });

    const sorted = useMemo(() => {
      if (!sort.key) return filtered;
      const dir = sort.dir === 'asc' ? 1 : -1;
      const withIdx = filtered.map((item, idx) => ({ item, idx }));

      const getTs = (raw) => {
        const t = Date.parse(String(raw || ''));
        return Number.isNaN(t) ? 0 : t;
      };

      const getExpiryTs = (k) => getTs(k.expiry);
      const getLastSeenTs = (k) => getTs(k.lastHeartbeatAt || k.activatedAt || k.createdAt);

      const getStr = (v) => String(v || '').toLowerCase();

      withIdx.sort((a, b) => {
        const A = a.item;
        const B = b.item;
        let cmp = 0;

        if (sort.key === 'machineId') cmp = getStr(A.machineId).localeCompare(getStr(B.machineId), undefined, { numeric: true });
        else if (sort.key === 'license') cmp = getStr(A.license).localeCompare(getStr(B.license), undefined, { numeric: true });
        else if (sort.key === 'owner') cmp = (getStr(A.owner) + '|' + getStr(A.name)).localeCompare((getStr(B.owner) + '|' + getStr(B.name)), undefined, { numeric: true });
        else if (sort.key === 'expiry') cmp = getExpiryTs(A) - getExpiryTs(B);
        else if (sort.key === 'status') cmp = statusRank(A.status) - statusRank(B.status);
        else if (sort.key === 'lastSeen') cmp = getLastSeenTs(A) - getLastSeenTs(B);

        if (cmp === 0) return a.idx - b.idx;
        return cmp * dir;
      });

      return withIdx.map((x) => x.item);
    }, [filtered, sort]);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total Licenses</p>
                <p className="text-3xl font-bold text-white mt-1">{subVendoKeys.length}</p>
              </div>
              <div className="bg-blue-500/20 p-3 rounded-lg">
                <Key className="h-6 w-6 text-blue-400" />
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Used Licenses</p>
                <p className="text-3xl font-bold text-emerald-400 mt-1">
                  {subVendoKeys.filter(k => k.status === 'active').length}
                </p>
              </div>
              <div className="bg-emerald-500/20 p-3 rounded-lg">
                <Wifi className="h-6 w-6 text-emerald-400" />
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Unused Licenses</p>
                <p className="text-3xl font-bold text-indigo-400 mt-1">
                  {subVendoKeys.filter(k => k.status === 'generated').length}
                </p>
              </div>
              <div className="bg-indigo-500/20 p-3 rounded-lg">
                <ShieldCheck className="h-6 w-6 text-indigo-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                All
              </button>
              <button
                onClick={() => setFilterStatus('generated')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'generated' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Unused
              </button>
              <button
                onClick={() => setFilterStatus('active')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Active
              </button>
              <button
                onClick={() => setFilterStatus('revoked')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'revoked' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Revoked
              </button>
              <button
                onClick={() => setFilterStatus('expired')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'expired' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-white'}`}
              >
                Expired
              </button>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-auto">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search keys..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 w-full md:w-64"
                />
              </div>
            </div>
          </div>

          {subVendoErr && (
            <div className="px-6 py-3 text-rose-300 text-sm border-b border-slate-700">
              {subVendoErr}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('machineId')} className="text-left hover:text-white transition-colors">
                      Machine ID{sortIndicator('machineId')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('license')} className="text-left hover:text-white transition-colors">
                      Sub Vendo Key{sortIndicator('license')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('owner')} className="text-left hover:text-white transition-colors">
                      Owner / Device{sortIndicator('owner')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('expiry')} className="text-left hover:text-white transition-colors">
                      Expiry{sortIndicator('expiry')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('status')} className="text-left hover:text-white transition-colors">
                      Status{sortIndicator('status')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('lastSeen')} className="text-left hover:text-white transition-colors">
                      Last Seen{sortIndicator('lastSeen')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {subVendoLoading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : sorted.length > 0 ? (
                  sorted.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 text-slate-300 font-mono text-xs">{k.machineId || 'Pending'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="text-rose-400 font-mono text-sm font-bold">{k.license}</div>
                          <button onClick={() => copyToClipboard(k.license)} className="text-slate-500 hover:text-white">
                            Copy
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-white text-sm font-medium">{k.ownerName || k.owner || 'Admin User'}</div>
                        <div className="text-slate-500 text-xs">{k.name || 'Unassigned Sub Vendo'}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{k.expiry || '--'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          k.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : k.status === 'generated'
                            ? 'bg-blue-500/10 text-blue-400'
                            : k.status === 'revoked'
                            ? 'bg-rose-500/10 text-rose-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {k.status === 'active' ? 'Active' :
                           k.status === 'generated' ? 'Ready' :
                           k.status === 'revoked' ? 'Revoked' : 'Expired'}
                        </span>
                        {k.machineId && (
                          <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            onlineStatus(k) === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-300'
                          }`}>
                            {onlineStatus(k) === 'online' ? 'Online' : 'Offline'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-300 text-sm">
                        <div>{formatLastSeen(k)}</div>
                        {isAdmin && (k.lastHeartbeatIp || k.lastGatewayActiveAt) && (
                          <div className="text-slate-500 text-xs">
                            {k.lastHeartbeatIp ? `IP: ${k.lastHeartbeatIp}` : ''}
                            {k.lastHeartbeatIp && k.lastGatewayActiveAt ? ' • ' : ''}
                            {k.lastGatewayActiveAt ? `GW: ${k.lastGatewayActiveAt}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-3">
                          {k.status === 'active' && (
                            <button
                              onClick={() => openSubVendoRevokeModal(k)}
                              className="text-rose-400 hover:text-rose-300 transition-colors"
                              title="Revoke Key"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                          {(k.status === 'revoked' || k.status === 'expired') && (
                            <button
                              onClick={() => openSubVendoUnassignModal(k)}
                              className="text-slate-300 hover:text-white transition-colors"
                              title="Unassign / Reset"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => openSubVendoTransferModal(k)}
                            className="text-blue-400 hover:text-blue-300 transition-colors"
                            title="Transfer License"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                      No keys found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const MySubVendoTab = () => {
    const [filterStatus, setFilterStatus] = useState('all');
    const [sort, setSort] = useState({ key: null, dir: 'asc' });

    const toggleSort = (key) => {
      setSort((prev) => {
        if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
        return { key, dir: 'asc' };
      });
    };

    const sortIndicator = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const statusRank = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'active') return 0;
      if (v === 'generated') return 1;
      if (v === 'revoked') return 2;
      if (v === 'expired') return 3;
      return 4;
    };

    const filtered = subVendoUserKeys.filter((k) => {
      const matchesSearch =
        String(k.license || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(k.machineId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(k.owner || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(k.name || '').toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      if (filterStatus === 'all') return true;
      if (filterStatus === 'generated') return k.status === 'generated';
      if (filterStatus === 'active') return k.status === 'active';
      if (filterStatus === 'revoked') return k.status === 'revoked';
      if (filterStatus === 'expired') return k.status !== 'active' && k.status !== 'generated' && k.status !== 'revoked';
      return true;
    });

    const sorted = useMemo(() => {
      if (!sort.key) return filtered;
      const dir = sort.dir === 'asc' ? 1 : -1;
      const withIdx = filtered.map((item, idx) => ({ item, idx }));

      const getTs = (raw) => {
        const t = Date.parse(String(raw || ''));
        return Number.isNaN(t) ? 0 : t;
      };
      const getExpiryTs = (k) => getTs(k.expiry);
      const getLastSeenTs = (k) => getTs(k.lastHeartbeatAt || k.activatedAt || k.createdAt);
      const getStr = (v) => String(v || '').toLowerCase();

      withIdx.sort((a, b) => {
        const A = a.item;
        const B = b.item;
        let cmp = 0;

        if (sort.key === 'machineId') cmp = getStr(A.machineId).localeCompare(getStr(B.machineId), undefined, { numeric: true });
        else if (sort.key === 'license') cmp = getStr(A.license).localeCompare(getStr(B.license), undefined, { numeric: true });
        else if (sort.key === 'status') cmp = statusRank(A.status) - statusRank(B.status);
        else if (sort.key === 'lastSeen') cmp = getLastSeenTs(A) - getLastSeenTs(B);
        else if (sort.key === 'expiry') cmp = getExpiryTs(A) - getExpiryTs(B);

        if (cmp === 0) return a.idx - b.idx;
        return cmp * dir;
      });

      return withIdx.map((x) => x.item);
    }, [filtered, sort]);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Total Licenses</p>
                <p className="text-3xl font-bold text-white mt-1">{subVendoUserKeys.length}</p>
              </div>
              <div className="bg-blue-500/20 p-3 rounded-lg">
                <Key className="h-6 w-6 text-blue-400" />
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Used Licenses</p>
                <p className="text-3xl font-bold text-emerald-400 mt-1">
                  {subVendoUserKeys.filter(k => k.status === 'active').length}
                </p>
              </div>
              <div className="bg-emerald-500/20 p-3 rounded-lg">
                <Wifi className="h-6 w-6 text-emerald-400" />
              </div>
            </div>
          </div>
          <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Unused Licenses</p>
                <p className="text-3xl font-bold text-indigo-400 mt-1">
                  {subVendoUserKeys.filter(k => k.status === 'generated').length}
                </p>
              </div>
              <div className="bg-indigo-500/20 p-3 rounded-lg">
                <ShieldCheck className="h-6 w-6 text-indigo-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                All
              </button>
              <button
                onClick={() => setFilterStatus('active')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                Active
              </button>
              <button
                onClick={() => setFilterStatus('revoked')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'revoked' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                Revoked
              </button>
              <button
                onClick={() => setFilterStatus('expired')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'expired' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                Expired
              </button>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative w-full md:w-auto">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search keys..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 w-full md:w-64"
                />
              </div>
            </div>
          </div>

          {subVendoErr && (
            <div className="px-6 py-3 text-rose-300 text-sm border-b border-slate-700">
              {subVendoErr}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('machineId')} className="text-left hover:text-white transition-colors">
                      Machine ID{sortIndicator('machineId')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('license')} className="text-left hover:text-white transition-colors">
                      Sub Vendo Key{sortIndicator('license')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('status')} className="text-left hover:text-white transition-colors">
                      Status{sortIndicator('status')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('lastSeen')} className="text-left hover:text-white transition-colors">
                      Last Seen{sortIndicator('lastSeen')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('expiry')} className="text-left hover:text-white transition-colors">
                      Expiry{sortIndicator('expiry')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {subVendoLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : sorted.length > 0 ? (
                  sorted.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 text-slate-300 font-mono text-xs">{k.machineId || 'Pending'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="text-rose-400 font-mono text-sm font-bold">{k.license}</div>
                          <button onClick={() => copyToClipboard(k.license)} className="text-slate-500 hover:text-white">
                            Copy
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          k.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : k.status === 'generated'
                            ? 'bg-blue-500/10 text-blue-400'
                            : k.status === 'revoked'
                            ? 'bg-rose-500/10 text-rose-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {k.status === 'active' ? 'Active' :
                           k.status === 'generated' ? 'Ready' :
                           k.status === 'revoked' ? 'Revoked' : 'Expired'}
                        </span>
                        {k.machineId && (
                          <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            onlineStatus(k) === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-300'
                          }`}>
                            {onlineStatus(k) === 'online' ? 'Online' : 'Offline'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{formatLastSeen(k)}</td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{k.expiry || '--'}</td>
                      <td className="px-6 py-4 text-right">
                        {k.status === 'active' && (
                          <button
                            onClick={() => openSubVendoRevokeModal(k)}
                            className="text-rose-400 hover:text-rose-300 transition-colors"
                            title="Revoke Key"
                            type="button"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                      No keys found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const LicenseListTab = () => {
    const [filterStatus, setFilterStatus] = useState('all');
    const [sort, setSort] = useState({ key: null, dir: 'asc' });

    const toggleSort = (key) => {
      setSort((prev) => {
        if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
        return { key, dir: 'asc' };
      });
    };

    const sortIndicator = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const statusRank = (s) => {
      const v = String(s || '').toLowerCase();
      if (v === 'active') return 0;
      if (v === 'generated') return 1;
      if (v === 'revoked') return 2;
      if (v === 'expired') return 3;
      return 4;
    };

    const filteredDevices = devices.filter(device => {
        // Search Filter
        const matchesSearch = 
            (device.machineId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            device.license.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (device.ownerName || device.owner || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (device.name || '').toLowerCase().includes(searchTerm.toLowerCase());

        // Status Filter
        if (!matchesSearch) return false;
        
        if (filterStatus === 'all') return true;
        if (filterStatus === 'active') return device.status === 'active';
        if (filterStatus === 'generated') return device.status === 'generated';
        if (filterStatus === 'expired') return device.status !== 'active' && device.status !== 'generated';
        
        return true;
    });

    const sortedDevices = useMemo(() => {
      if (!sort.key) return filteredDevices;
      const dir = sort.dir === 'asc' ? 1 : -1;
      const withIdx = filteredDevices.map((item, idx) => ({ item, idx }));

      const getTs = (raw) => {
        const t = Date.parse(String(raw || ''));
        return Number.isNaN(t) ? 0 : t;
      };
      const getExpiryTs = (d) => getTs(d.expiry);
      const getLastSeenTs = (d) => getTs(d.lastHeartbeatAt || d.activatedAt || d.createdAt);
      const getStr = (v) => String(v || '').toLowerCase();

      withIdx.sort((a, b) => {
        const A = a.item;
        const B = b.item;
        let cmp = 0;

        if (sort.key === 'machineId') cmp = getStr(A.machineId).localeCompare(getStr(B.machineId), undefined, { numeric: true });
        else if (sort.key === 'license') cmp = getStr(A.license).localeCompare(getStr(B.license), undefined, { numeric: true });
        else if (sort.key === 'owner') cmp = (getStr(A.owner) + '|' + getStr(A.name)).localeCompare((getStr(B.owner) + '|' + getStr(B.name)), undefined, { numeric: true });
        else if (sort.key === 'status') cmp = statusRank(A.status) - statusRank(B.status);
        else if (sort.key === 'lastSeen') cmp = getLastSeenTs(A) - getLastSeenTs(B);
        else if (sort.key === 'expiry') cmp = getExpiryTs(A) - getExpiryTs(B);

        if (cmp === 0) return a.idx - b.idx;
        return cmp * dir;
      });

      return withIdx.map((x) => x.item);
    }, [filteredDevices, sort]);

    return (
      <div className="space-y-6" ref={licenseListRef}>
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
                <button 
                    onClick={() => setFilterStatus('all')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                    All
                </button>
                <button 
                    onClick={() => setFilterStatus('generated')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'generated' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'text-slate-400 hover:text-white'}`}
                >
                    Unused
                </button>
                <button 
                    onClick={() => setFilterStatus('active')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'text-slate-400 hover:text-white'}`}
                >
                    Active
                </button>
                <button 
                    onClick={() => setFilterStatus('expired')}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterStatus === 'expired' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-white'}`}
                >
                    Inactive
                </button>
            </div>

            <div className="relative w-full md:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Search licenses..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 w-full md:w-64"
              />
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('machineId')} className="text-left hover:text-white transition-colors">
                      Machine ID{sortIndicator('machineId')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('license')} className="text-left hover:text-white transition-colors">
                      License Key{sortIndicator('license')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('owner')} className="text-left hover:text-white transition-colors">
                      Owner / Device{sortIndicator('owner')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('expiry')} className="text-left hover:text-white transition-colors">
                      Expiry{sortIndicator('expiry')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('status')} className="text-left hover:text-white transition-colors">
                      Status{sortIndicator('status')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('lastSeen')} className="text-left hover:text-white transition-colors">
                      Last Seen{sortIndicator('lastSeen')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {sortedDevices.length > 0 ? (
                  sortedDevices.map((device) => (
                    <tr key={device.id} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 text-slate-300 font-mono text-xs">{device.machineId || 'Pending'}</td>
                      <td className="px-6 py-4">
                        <div className="text-blue-400 font-mono text-sm font-bold">{device.license}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-white text-sm font-medium">{device.ownerName || device.owner}</div>
                        <div className="text-slate-500 text-xs">{device.name}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{device.expiry}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          device.status === 'active' 
                            ? 'bg-emerald-500/10 text-emerald-400' 
                            : device.status === 'generated'
                            ? 'bg-blue-500/10 text-blue-400'
                            : device.status === 'revoked'
                            ? 'bg-rose-500/10 text-rose-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}>
                          {device.status === 'active' ? 'Active' : 
                           device.status === 'generated' ? 'Ready' : 
                           device.status === 'revoked' ? 'Revoked' : 'Expired'}
                        </span>
                        {device.machineId && (
                          <span className={`ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            onlineStatus(device) === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-300'
                          }`}>
                            {onlineStatus(device) === 'online' ? 'Online' : 'Offline'}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-300 text-sm">
                        <div>{formatLastSeen(device)}</div>
                        {isAdmin && (device.lastHeartbeatIp || device.lastGatewayActiveAt) && (
                          <div className="text-slate-500 text-xs">
                            {device.lastHeartbeatIp ? `IP: ${device.lastHeartbeatIp}` : ''}
                            {device.lastHeartbeatIp && device.lastGatewayActiveAt ? ' • ' : ''}
                            {device.lastGatewayActiveAt ? `GW: ${device.lastGatewayActiveAt}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-3">
                          {canRevokeDevice(device) && (
                            <button
                              onClick={() => handleRevokeLicense(device)}
                              className="text-rose-400 hover:text-rose-300 transition-colors"
                              title="Revoke License"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                          {isAdmin && (
                            <button 
                              onClick={() => openTransferModal(device)}
                              className="text-blue-400 hover:text-blue-300 transition-colors"
                              title="Transfer License"
                            >
                              <ArrowRightLeft className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                      No licenses found matching your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const UserListTab = () => {
    const matchUser = (owner, u) => {
      const o = String(owner || '').toLowerCase();
      if (!o) return false;
      const a = String(u.name || '').toLowerCase();
      const b = String(u.email || '').toLowerCase();
      return o === a || o === b;
    };

    const matchUserId = (ownerId, u) => {
      const oid = String(ownerId || '').trim();
      const uid = String(u.id || '').trim();
      if (!oid || !uid) return false;
      return oid === uid;
    };

    const mainCountFor = (u) => devices.filter((d) => matchUserId(d.ownerId, u) || matchUser(d.owner, u) || matchUser(d.ownerEmail, u) || matchUser(d.ownerName, u)).length;
    const subVendoCountFor = (u) => subVendoKeys.filter((k) => matchUserId(k.ownerId, u) || matchUser(k.owner, u) || matchUser(k.ownerEmail, u) || matchUser(k.ownerName, u)).length;

    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white">Registered Users & Admins</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs">
              <tr>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Email</th>
                <th className="px-6 py-4 font-medium">Role</th>
                <th className="px-6 py-4 font-medium text-right">Main Licenses</th>
                <th className="px-6 py-4 font-medium text-right">Sub Vendo Licenses</th>
                <th className="px-6 py-4 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {users.length > 0 ? (
                users.map((u, idx) => {
                  const main = mainCountFor(u);
                  const sub = subVendoCountFor(u);
                  return (
                    <tr key={idx} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 text-white font-medium">{u.name}</td>
                      <td className="px-6 py-4 text-slate-300">{u.email}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          u.role === 'admin'
                            ? 'bg-purple-500/10 text-purple-400'
                            : 'bg-blue-500/10 text-blue-400'
                        }`}>
                          {u.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-300">{main}</td>
                      <td className="px-6 py-4 text-right text-slate-300">{sub}</td>
                      <td className="px-6 py-4 text-right text-slate-300">{main + sub}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                    No registered users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const TransferHistoryTab = () => {
    const [filterType, setFilterType] = useState('all');
    const [sort, setSort] = useState({ key: 'at', dir: 'desc' });

    const toggleSort = (key) => {
      setSort((prev) => {
        if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
        return { key, dir: 'asc' };
      });
    };

    const sortIndicator = (key) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const getStr = (v) => String(v || '').toLowerCase();
    const getTs = (raw) => {
      const t = Date.parse(String(raw || ''));
      return Number.isNaN(t) ? 0 : t;
    };

    const filtered = transferLogItems.filter((x) => {
      if (filterType !== 'all' && String(x.type || '') !== filterType) return false;
      const q = searchTerm.toLowerCase();
      if (!q) return true;
      return (
        getStr(x.license).includes(q) ||
        getStr(x.fromOwner).includes(q) ||
        getStr(x.fromOwnerName).includes(q) ||
        getStr(x.toOwner).includes(q) ||
        getStr(x.toOwnerName).includes(q) ||
        getStr(x.by).includes(q)
      );
    });

    const sorted = useMemo(() => {
      const dir = sort.dir === 'asc' ? 1 : -1;
      const withIdx = filtered.map((item, idx) => ({ item, idx }));
      withIdx.sort((a, b) => {
        const A = a.item;
        const B = b.item;
        let cmp = 0;
        if (sort.key === 'type') cmp = getStr(A.type).localeCompare(getStr(B.type));
        else if (sort.key === 'license') cmp = getStr(A.license).localeCompare(getStr(B.license), undefined, { numeric: true });
        else if (sort.key === 'from') cmp = (getStr(A.fromOwnerName) + '|' + getStr(A.fromOwner)).localeCompare(getStr(B.fromOwnerName) + '|' + getStr(B.fromOwner), undefined, { numeric: true });
        else if (sort.key === 'to') cmp = (getStr(A.toOwnerName) + '|' + getStr(A.toOwner)).localeCompare(getStr(B.toOwnerName) + '|' + getStr(B.toOwner), undefined, { numeric: true });
        else if (sort.key === 'by') cmp = getStr(A.by).localeCompare(getStr(B.by), undefined, { numeric: true });
        else if (sort.key === 'at') cmp = getTs(A.at) - getTs(B.at);
        if (cmp === 0) return a.idx - b.idx;
        return cmp * dir;
      });
      return withIdx.map((x) => x.item);
    }, [filtered, sort]);

    return (
      <div className="space-y-6">
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto pb-2 md:pb-0">
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                All
              </button>
              <button
                onClick={() => setFilterType('main')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'main' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                Main
              </button>
              <button
                onClick={() => setFilterType('subvendo')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filterType === 'subvendo' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'text-slate-400 hover:text-white'}`}
                type="button"
              >
                Sub Vendo
              </button>
            </div>

            <div className="relative w-full md:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search history..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500 w-full md:w-64"
              />
            </div>
          </div>

          {transferLogErr && (
            <div className="px-6 py-3 text-rose-300 text-sm border-b border-slate-700">
              {transferLogErr}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-900/50 text-slate-400 uppercase text-xs">
                <tr>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('type')} className="text-left hover:text-white transition-colors">
                      Type{sortIndicator('type')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('license')} className="text-left hover:text-white transition-colors">
                      License{sortIndicator('license')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('from')} className="text-left hover:text-white transition-colors">
                      From{sortIndicator('from')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('to')} className="text-left hover:text-white transition-colors">
                      To{sortIndicator('to')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('by')} className="text-left hover:text-white transition-colors">
                      By{sortIndicator('by')}
                    </button>
                  </th>
                  <th className="px-6 py-4 font-medium">
                    <button type="button" onClick={() => toggleSort('at')} className="text-left hover:text-white transition-colors">
                      Time{sortIndicator('at')}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {transferLogLoading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : sorted.length > 0 ? (
                  sorted.map((x) => (
                    <tr key={x.id} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-6 py-4 text-slate-300 text-sm">{x.type === 'subvendo' ? 'Sub Vendo' : 'Main'}</td>
                      <td className="px-6 py-4 text-slate-300 font-mono text-xs">{x.license}</td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{x.fromOwnerName || x.fromOwner || '--'}</td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{x.toOwnerName || x.toOwner || '--'}</td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{x.by || '--'}</td>
                      <td className="px-6 py-4 text-slate-300 text-sm">{x.at ? new Date(x.at).toLocaleString() : '--'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                      No transfer history found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const SettingsTab = () => {
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [newAdmin, setNewAdmin] = useState({ name: '', email: '', password: '' });

    const handleCreateAdmin = async (e) => {
        e.preventDefault();
        try {
            const response = await fetch('./api/index.php?endpoint=create_admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(newAdmin)
            });
            const data = await response.json();
            if (data.success) {
                alert('Admin account created successfully!');
                setIsCreateModalOpen(false);
                setNewAdmin({ name: '', email: '', password: '' });
                window.location.reload(); 
            } else {
                alert('Error: ' + data.message);
            }
        } catch (error) {
            console.error(error);
            alert('Failed to connect to API');
        }
    };

    return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
          <Settings className="h-6 w-6 mr-3 text-slate-400" />
          {isAdmin ? 'Admin Account Settings' : 'My Account Settings'}
        </h2>
        
        <form onSubmit={(e) => {
          e.preventDefault();
          alert('Profile updated successfully!');
        }} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Name</label>
              <input
                type="text"
                required
                // Read-only for now unless we implement user update logic in App.jsx
                value={isAdmin ? adminProfile.name : user.name}
                onChange={(e) => isAdmin ? setAdminProfile({...adminProfile, name: e.target.value}) : null}
                readOnly={!isAdmin}
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
              <input
                type="email"
                required
                value={isAdmin ? adminProfile.email : user.email}
                onChange={(e) => isAdmin ? setAdminProfile({...adminProfile, email: e.target.value}) : null}
                readOnly={!isAdmin}
                className={`w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'opacity-70 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Current Password</label>
            <input
              type="password"
              value="********"
              disabled
              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-3 text-slate-500 cursor-not-allowed"
            />
          </div>

          {isAdmin && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">New Password</label>
                <input
                  type="text"
                  required
                  value={adminProfile.password}
                  onChange={(e) => setAdminProfile({...adminProfile, password: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-slate-500 mt-2">Make sure to use a strong password for admin security.</p>
              </div>

              <div className="pt-4 border-t border-slate-700 flex justify-end">
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-3 rounded-lg transition-colors flex items-center"
                >
                  <CheckCircle className="h-5 w-5 mr-2" />
                  Save Changes
                </button>
              </div>
            </>
          )}
        </form>
      </div>

      {/* Admin Creation Section - Only for Admins */}
      {isAdmin && (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-8">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center">
                <ShieldCheck className="h-6 w-6 mr-3 text-purple-400" />
                Create New Admin Account
            </h2>
            <button
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-purple-600 hover:bg-purple-700 text-white font-medium px-4 py-2 rounded-lg transition-colors"
            >
                Create Admin
            </button>
        </div>
        <p className="text-slate-400 text-sm">
            Add new administrators who can manage licenses and users. They will have full access to the dashboard.
        </p>
      </div>
      )}

      {/* Create Admin Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-xl font-bold text-white flex items-center">
                <ShieldCheck className="h-5 w-5 mr-2 text-blue-400" />
                Create New Admin
              </h3>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Admin Name</label>
                <input 
                    type="text" 
                    required
                    value={newAdmin.name}
                    onChange={(e) => setNewAdmin({...newAdmin, name: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Admin Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                <input 
                    type="email" 
                    required
                    value={newAdmin.email}
                    onChange={(e) => setNewAdmin({...newAdmin, email: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="admin@neofi.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
                <input 
                    type="password" 
                    required
                    value={newAdmin.password}
                    onChange={(e) => setNewAdmin({...newAdmin, password: e.target.value})}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Strong Password"
                />
              </div>

              <div className="pt-2 flex space-x-3">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  Create Admin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">
          {isAdmin ? 'Peso Wifi Admin Panel' : 'User Dashboard'}
        </h1>
        <p className="text-slate-400 mt-1">
          {isAdmin ? 'System Management & License Control' : 'Manage your Peso Wifi licenses'}
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex space-x-1 bg-slate-800/50 p-1 rounded-xl mb-8 border border-slate-700/50 w-full md:w-auto inline-flex">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'overview' 
              ? 'bg-blue-600 text-white shadow-lg' 
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <LayoutDashboard className="h-4 w-4 mr-2" />
          Overview
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('generate')}
            className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'generate' 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <ShieldCheck className="h-4 w-4 mr-2" />
            Generate
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab('list')}
            className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'list' 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Key className="h-4 w-4 mr-2" />
            License List
          </button>
        )}
        <button
          onClick={() => setActiveTab('subvendo')}
          className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'subvendo'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <Wifi className="h-4 w-4 mr-2" />
          {isAdmin ? 'Sub Vendo Keys' : 'Sub Vendo'}
        </button>
        <button
          onClick={() => setActiveTab('downloads')}
          className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'downloads'
              ? 'bg-blue-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <Download className="h-4 w-4 mr-2" />
          Files
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('devices')}
            className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'devices'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <Monitor className="h-4 w-4 mr-2" />
            Devices
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'users' 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <User className="h-4 w-4 mr-2" />
            Users
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            <LayoutDashboard className="h-4 w-4 mr-2" />
            History
          </button>
        )}
        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'settings' 
              ? 'bg-blue-600 text-white shadow-lg' 
              : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </button>
      </div>

      {/* Tab Content */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'generate' && isAdmin && renderLicenseGenerateTab()}
        {activeTab === 'list' && isAdmin && <LicenseListTab />}
        {activeTab === 'subvendo' && (isAdmin ? <SubVendoKeysTab /> : <MySubVendoTab />)}
        {activeTab === 'downloads' && <DownloadsTab />}
        {activeTab === 'devices' && isAdmin && <DevicesTab />}
        {activeTab === 'users' && isAdmin && <UserListTab />}
        {activeTab === 'history' && isAdmin && <TransferHistoryTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </div>

      {actionModal.open && (() => {
        const mode = actionModal.mode;
        const isTransfer = mode === 'license_transfer' || mode === 'subvendo_transfer';
        const isRevoke = mode === 'license_revoke' || mode === 'subvendo_revoke';
        const isUnassign = mode === 'subvendo_unassign';

        const title = isTransfer
          ? 'Transfer License'
          : isRevoke
          ? 'Revoke License'
          : isUnassign
          ? 'Unassign License'
          : 'Confirm';

        const icon = isTransfer ? <ArrowRightLeft className="h-5 w-5 mr-2 text-blue-400" /> : <X className="h-5 w-5 mr-2 text-rose-400" />;
        const confirmText = isTransfer ? 'Confirm Transfer' : isRevoke ? 'Confirm Revoke' : isUnassign ? 'Confirm Unassign' : 'Confirm';
        const confirmClass = isTransfer ? 'bg-blue-600 hover:bg-blue-700' : 'bg-rose-600 hover:bg-rose-700';

        const description = isTransfer
          ? `You are about to transfer this license from ${actionModal.currentOwner || 'current owner'} to another user.`
          : isRevoke
          ? `You are about to revoke ${actionModal.licenseKey}. This will remove it from the device on next validation.`
          : isUnassign
          ? `You are about to unassign ${actionModal.licenseKey}. This will make it reusable.`
          : '';

        const needsInput = isTransfer || isRevoke;
        const inputLabel = isTransfer ? "New Owner's Name / Email" : 'Reason (optional)';
        const inputPlaceholder = isTransfer ? 'Enter name or email...' : 'Enter reason...';

        return (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-xl font-bold text-white flex items-center">
                  {icon}
                  {title}
                </h3>
                <button
                  onClick={() => { if (!actionModal.isSubmitting) closeActionModal(); }}
                  className="text-slate-400 hover:text-white"
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <p className="text-slate-400 text-sm mb-6">{description}</p>

              <form onSubmit={confirmActionModal} className="space-y-4">
                {needsInput && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{inputLabel}</label>
                    <div className="relative">
                      {isTransfer ? (
                        <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
                      ) : null}
                      <input
                        type="text"
                        value={actionModal.inputValue}
                        onChange={(e) => setActionModal((prev) => ({ ...prev, inputValue: e.target.value }))}
                        list={isTransfer ? 'users-list' : undefined}
                        className={`w-full bg-slate-900 border border-slate-700 rounded-lg ${isTransfer ? 'pl-10 pr-4' : 'px-4'} py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500`}
                        placeholder={inputPlaceholder}
                      />
                      {isTransfer && (
                        <datalist id="users-list">
                          {users.map((u, idx) => (
                            <option key={`${idx}-name`} value={u.name} />
                          ))}
                          {users.map((u, idx) => (
                            <option key={`${idx}-email`} value={u.email} />
                          ))}
                          <option value={adminProfile.name} />
                        </datalist>
                      )}
                    </div>
                  </div>
                )}

                {actionModal.error && (
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 text-rose-300 text-sm">
                    {actionModal.error}
                  </div>
                )}

                <div className="pt-2 flex space-x-3">
                  <button
                    type="button"
                    onClick={closeActionModal}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={actionModal.isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`flex-1 ${confirmClass} text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                    disabled={actionModal.isSubmitting}
                  >
                    {actionModal.isSubmitting ? 'Please wait...' : confirmText}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {messageModal.open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-8 w-full max-w-md shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-white">{messageModal.title}</h3>
              <button onClick={closeMessage} className="text-slate-400 hover:text-white" type="button">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-slate-300 text-sm mb-6">{messageModal.message}</p>
            <button
              onClick={closeMessage}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors"
              type="button"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
