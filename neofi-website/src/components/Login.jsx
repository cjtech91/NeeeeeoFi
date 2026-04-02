import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, AlertCircle } from 'lucide-react';
import logo from '../assets/neofi_nb.png';

const Login = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const sent = query.get('sent');
  const verified = query.get('verified');
  const reset = query.get('reset');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setInfo('');
    setNeedsVerification(false);

    try {
      // Use PHP API for Login
      const response = await fetch('./api/index.php?endpoint=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      
      const data = await response.json();

      if (data.success && data.user) {
        onLogin(data.user);
        navigate('/dashboard');
      } else {
        setError(data.message || 'Invalid email or password');
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(true);
        }
      }
    } catch (err) {
      console.error(err);
      setError('Connection failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/20 rounded-full blur-[100px]" />

      <div className="max-w-md w-full relative z-10">
        <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-700 p-8 transform transition-all hover:scale-[1.01]">
          <div className="text-center mb-8">
            <img src={logo} alt="Peso Wifi" className="h-16 w-auto mx-auto mb-4" />
            <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-slate-400">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {sent === '1' && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center text-emerald-300 text-sm">
                Please check your email for the verification link before logging in.
              </div>
            )}
            {verified === '1' && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center text-emerald-300 text-sm">
                Email verified successfully. You can now log in.
              </div>
            )}
            {reset === '1' && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center text-emerald-300 text-sm">
                Password updated. You can now log in.
              </div>
            )}
            {info && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center text-emerald-300 text-sm">
                {info}
              </div>
            )}
            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-3 flex items-center text-rose-400 text-sm">
                <AlertCircle className="h-4 w-4 mr-2" />
                {error}
              </div>
            )}
            {needsVerification && (
              <button
                type="button"
                onClick={async () => {
                  setIsLoading(true);
                  setError('');
                  setInfo('');
                  try {
                    const response = await fetch('./api/index.php?endpoint=resend-verification', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ email })
                    });
                    const data = await response.json();
                    setInfo(data.message || 'Verification email sent.');
                  } catch (e) {
                    console.error(e);
                    setError('Failed to send verification email.');
                  } finally {
                    setIsLoading(false);
                  }
                }}
                className="w-full flex justify-center items-center py-3 px-4 border border-slate-700 rounded-xl shadow-sm text-sm font-medium text-white bg-slate-800 hover:bg-slate-700 focus:outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isLoading || !email}
              >
                Resend verification email
              </button>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-400">
                  Remember me
                </label>
              </div>
              <div className="text-sm">
                <Link to="/forgot-password" className="font-medium text-blue-400 hover:text-blue-300">
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Sign In <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-400">
              Don&apos;t have an account?{' '}
              <Link to="/signup" className="font-medium text-blue-400 hover:text-blue-300 transition-colors">
                Sign up
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
