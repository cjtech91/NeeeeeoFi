import React, { useRef, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './components/Home';
import Login from './components/Login';
import Signup from './components/Signup';
import Dashboard from './components/Dashboard';
import ForgotPassword from './components/ForgotPassword';

function App() {
  // Initialize user from localStorage if available
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('neofi_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [sessionChecked, setSessionChecked] = useState(false);

  // Default Admin Credentials
  const [adminProfile, setAdminProfile] = useState({
    name: 'Admin User',
    email: 'smileradiosantafe@gmail.com',
    password: 'Hope@7777',
    role: 'admin'
  });

  // Users List (In-memory storage for demo)
  const [users, setUsers] = useState([]);

  // Centralized Devices State
  const [devices, setDevices] = useState([]);
  const lastDevicesSigRef = useRef('');

  // Load licenses AND users from PHP API
  React.useEffect(() => {
    if (!user) return undefined;
    const signatureForLicenses = (items) => {
      if (!Array.isArray(items)) return '';
      return items
        .map((l) => {
          const key = String(l.license || '');
          const machineId = String(l.machineId || '');
          const status = String(l.status || '');
          const owner = String(l.owner || '');
          const ownerName = String(l.ownerName || '');
          const ownerEmail = String(l.ownerEmail || '');
          const ownerId = String(l.ownerId || '');
          const expiry = String(l.expiry || '');
          const name = String(l.name || '');
          const last = String(l.lastHeartbeatAt || l.activatedAt || l.createdAt || '');
          return [key, machineId, status, owner, ownerName, ownerEmail, ownerId, expiry, name, last].join('|');
        })
        .join('||');
    };

    const applyLicensesIfChanged = (items) => {
      const sig = signatureForLicenses(items);
      if (sig && sig === lastDevicesSigRef.current) return;
      lastDevicesSigRef.current = sig;
      setDevices(items);
    };

    // 1. Fetch Licenses (support both old and new API formats)
    const fetchLicenses = async () => {
      try {
        const res = await fetch('./api/index.php?endpoint=list', { credentials: 'include' });
        if (res.status === 401 || res.status === 403) {
          setUser(null);
          localStorage.removeItem('neofi_user');
          return;
        }
        const data = await res.json();
        if (data && Array.isArray(data.licenses)) {
          applyLicensesIfChanged(data.licenses);
          return;
        }
      } catch (e) { void e; }

      try {
        const res = await fetch('./api/index.php?endpoint=licenses', { credentials: 'include' });
        if (res.status === 401 || res.status === 403) {
          setUser(null);
          localStorage.removeItem('neofi_user');
          return;
        }
        const data = await res.json();
        if (Array.isArray(data)) applyLicensesIfChanged(data);
      } catch (err) {
        console.log('API not reachable', err);
      }
    };

    fetchLicenses();
    const refreshId = setInterval(fetchLicenses, 60000);

    // 2. Fetch Users
    if (user.role === 'admin') {
      fetch('./api/index.php?endpoint=users', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setUsers(data);
        })
        .catch(err => console.log('Users API error', err));
    } else {
      setUsers([]);
    }
      
    return () => clearInterval(refreshId);
  }, [user]);

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!user) {
        if (!cancelled) setSessionChecked(true);
        return;
      }
      try {
        const res = await fetch('./api/index.php?endpoint=me', { credentials: 'include' });
        if (res.status === 200) {
          const data = await res.json().catch(() => null);
          if (data && data.success && data.user) {
            const current = user || {};
            const incoming = data.user || {};
            const same =
              String(current.id || '') === String(incoming.id || '') &&
              String(current.email || '') === String(incoming.email || '') &&
              String(current.role || '') === String(incoming.role || '') &&
              String(current.name || '') === String(incoming.name || '');
            if (!same && !cancelled) {
              setUser(incoming);
              localStorage.setItem('neofi_user', JSON.stringify(incoming));
            }
          }
        } else {
          if (!cancelled) {
            setUser(null);
            localStorage.removeItem('neofi_user');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setUser(null);
          localStorage.removeItem('neofi_user');
        }
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem('neofi_user', JSON.stringify(userData));
    setSessionChecked(true);
  };

  const handleLogout = () => {
    try {
      fetch('./api/index.php?endpoint=logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    } catch (e) { void e; }
    setUser(null);
    localStorage.removeItem('neofi_user');
  };

  return (
    <Router>
      <div className="min-h-screen bg-slate-900 text-white font-sans selection:bg-blue-500 selection:text-white">
        <Navbar isLoggedIn={!!user} onLogout={handleLogout} />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route 
            path="/login" 
            element={!user && sessionChecked ? (
              <Login 
                onLogin={handleLogin} 
                adminProfile={adminProfile}
                users={users}
              />
            ) : (sessionChecked ? <Navigate to="/dashboard" /> : null)} 
          />
          <Route
            path="/forgot-password"
            element={!user && sessionChecked ? <ForgotPassword /> : (sessionChecked ? <Navigate to="/dashboard" /> : null)}
          />
          <Route 
            path="/signup" 
            element={!user && sessionChecked ? <Signup /> : (sessionChecked ? <Navigate to="/dashboard" /> : null)} 
          />
          <Route 
            path="/dashboard" 
            element={user && sessionChecked ? (
              <Dashboard 
                user={user} 
                adminProfile={adminProfile} 
                setAdminProfile={setAdminProfile}
                devices={devices}
                setDevices={setDevices}
                users={users} // Pass users list for transfer functionality
              />
            ) : (sessionChecked ? <Navigate to="/login" /> : null)} 
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
