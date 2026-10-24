import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Scissors, Lock, Mail, Phone, Loader2, ArrowLeft, CheckCircle2, AlertCircle, UserCircle } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

export default function AcceptStaffInvite() {
  const { token } = useParams();
  const [phase, setPhase] = useState('loading'); // loading | form | existing_account | otp | error | success
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Validate token on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    base44.functions.invoke('validateStaffInvite', { token })
      .then(async res => {
        if (cancelled) return;
        setInvite(res.data);
        setPhone(res.data.phone || '');

        if (res.data.existing_account) {
          // Check if already authenticated with matching email — auto-link
          try {
            const isAuth = await base44.auth.isAuthenticated();
            if (isAuth) {
              const me = await base44.auth.me();
              if (me && me.email === res.data.email) {
                await base44.functions.invoke('acceptStaffInvite', { token, link_existing: true, phone: res.data.phone || '' });
                if (cancelled) return;
                setPhase('success');
                setTimeout(() => { window.location.href = '/admin/dashboard'; }, 1500);
                return;
              }
            }
          } catch { /* not authenticated — show sign-in form */ }
          if (cancelled) return;
          setPhase('existing_account');
        } else {
          setPhase('form');
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Invalid invitation link.');
        setPhase('error');
      });

    return () => { cancelled = true; };
  }, [token]);

  // ── Create account: register → link TeamMember → show OTP ────────────────
  const handleCreate = async (e) => {
    e?.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);
    try {
      await base44.auth.register({ email: invite.email, password });
      // The invite is accepted only after the email is verified (see handleVerify).
      setPhase('otp');
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to create account.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Link existing account: login → link TeamMember → redirect ────────────
  const handleLinkExisting = async (e) => {
    e?.preventDefault();
    setError('');
    if (!password) { setError('Please enter your password.'); return; }

    setLoading(true);
    try {
      // 1. Authenticate with existing credentials
      await base44.auth.loginViaEmailPassword(invite.email, password);

      // 2. Link the authenticated User to the TeamMember
      await base44.functions.invoke('acceptStaffInvite', { token, link_existing: true, phone });

      // 3. Redirect to dashboard
      setPhase('success');
      setTimeout(() => { window.location.href = '/admin/dashboard'; }, 1500);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Invalid credentials. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP → set token → redirect to dashboard ───────────────────────
  const handleVerify = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await base44.auth.verifyOtp({ email: invite.email, otpCode });
      if (result?.access_token) {
        base44.auth.setToken(result.access_token);
      }
      await base44.functions.invoke('acceptStaffInvite', { token, link_existing: true, phone });
      setPhase('success');
      setTimeout(() => { window.location.href = '/admin/dashboard'; }, 1500);
    } catch (err) {
      setError(err.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    try {
      await base44.auth.resendOtp(invite.email);
    } catch (err) {
      setError(err.message || 'Failed to resend code.');
    }
  };

  // ── Loading state ────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // ── Error state (invalid/expired/used token) ─────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Invitation Unavailable</h1>
            <p className="text-muted-foreground text-sm mt-2">{error}</p>
          </div>
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-primary font-medium hover:underline">
            <ArrowLeft className="w-4 h-4" /> Go to login
          </Link>
        </div>
      </div>
    );
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Account Activated!</h1>
            <p className="text-muted-foreground text-sm mt-2">Redirecting you to your dashboard…</p>
          </div>
          <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // ── OTP verification ─────────────────────────────────────────────────────
  if (phase === 'otp') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-6">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Mail className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Verify Your Email</h1>
            <p className="text-muted-foreground text-sm">We sent a 6-digit code to {invite?.email}</p>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3 text-center">
              {error}
            </div>
          )}

          <div className="flex justify-center">
            <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode} autoFocus>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <button
            onClick={handleVerify}
            disabled={loading || otpCode.length < 6}
            className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors hover:bg-primary/90"
          >
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Verifying…</> : 'Verify & Continue'}
          </button>

          <p className="text-center text-sm text-muted-foreground">
            Didn't receive the code?{' '}
            <button onClick={handleResendOtp} className="text-primary font-medium hover:underline">
              Resend
            </button>
          </p>
        </div>
      </div>
    );
  }

  const roleLabel = invite?.role === 'admin' ? 'Admin' : invite?.role === 'owner' ? 'Owner' : 'Barber';

  // ── Pre-filled info card (shared by both forms) ───────────────────────────
  const InfoCard = () => (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Name</span>
        <span className="text-sm font-medium text-foreground">{invite?.name}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Email</span>
        <span className="text-sm font-medium text-foreground truncate ml-3">{invite?.email}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Role</span>
        <span className="text-sm font-medium text-primary">{roleLabel}</span>
      </div>
    </div>
  );

  // ── Existing account detected: sign in to link ───────────────────────────
  if (phase === 'existing_account') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-6">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <UserCircle className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">Account Already Exists</h1>
            <p className="text-muted-foreground text-sm">
              An account already exists for this email. Sign in to link your existing account and accept this staff invitation.
            </p>
          </div>

          <InfoCard />

          {error && (
            <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          <form onSubmit={handleLinkExisting} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-input border border-border rounded-xl pl-10 pr-3 h-11 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors hover:bg-primary/90"
            >
              {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Linking…</> : 'Sign In to Link Account'}
            </button>
          </form>

          <div className="text-center">
            <Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── New account: password setup form ─────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-sm w-full space-y-6">
        {/* Brand + heading */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Scissors className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">Join Cut Deluxe</h1>
          <p className="text-muted-foreground text-sm">
            You've been invited to join the Cut Deluxe team. Set up your account to continue.
          </p>
        </div>

        <InfoCard />

        {error && (
          <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="w-full bg-input border border-border rounded-xl pl-10 pr-3 h-11 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="w-full bg-input border border-border rounded-xl pl-10 pr-3 h-11 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Phone Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="04xx xxx xxx"
                className="w-full bg-input border border-border rounded-xl pl-10 pr-3 h-11 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-colors hover:bg-primary/90"
          >
            {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Creating…</> : 'Create Staff Account'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}