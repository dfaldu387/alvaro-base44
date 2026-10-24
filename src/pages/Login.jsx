import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Scissors, Loader2, Eye, EyeOff, ArrowLeft, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const EASE = [0.32, 0.72, 0, 1];

const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await base44.auth.loginViaEmailPassword(email, password);
      try {
        const me = await base44.auth.me();
        if (me?.role === 'admin') {
          window.location.href = '/admin';
        } else if (me?.role === 'user') {
          const members = await base44.entities.TeamMember.filter({ user_id: me.id });
          if (members.length > 0 && members[0].status === 'Active') {
            if (members[0].invite_status !== 'active') {
              base44.entities.TeamMember.update(members[0].id, { invite_status: 'active' });
            }
            window.location.href = '/admin';
          } else {
            setError('Your account is not active. Please contact the owner.');
          }
        } else {
          window.location.href = '/';
        }
      } catch {
        window.location.href = '/admin';
      }
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    'h-12 rounded-xl border-white/[0.08] bg-white/[0.03] text-foreground placeholder:text-muted-foreground/40 ' +
    'shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)] transition-[box-shadow,border-color] duration-500 ' +
    'focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/30';

  return (
    <div className="min-h-[100dvh] bg-background text-foreground lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden overflow-hidden border-r border-white/[0.06] p-14 lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary/[0.18] blur-[140px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 left-1/3 h-[28rem] w-[28rem] rounded-full bg-primary/[0.08] blur-[140px]"
        />

        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="relative flex h-full flex-col justify-between"
        >
          <motion.div variants={rise} className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Scissors className="h-4 w-4 text-primary" strokeWidth={1.5} />
            </span>
            <span className="text-[13px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Cut Deluxe
            </span>
          </motion.div>

          <div className="max-w-md">
            <motion.span
              variants={rise}
              className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
              Staff access
            </motion.span>
            <motion.h2
              variants={rise}
              className="mt-7 font-heading text-[2.9rem] font-bold leading-[1.08] tracking-tight text-foreground"
            >
              The day, already
              <br />
              planned.
            </motion.h2>
            <motion.p
              variants={rise}
              className="mt-6 max-w-sm text-[15px] leading-relaxed text-muted-foreground"
            >
              Bookings, routes, reminders and payments — organised before you pick up the clippers.
            </motion.p>
          </div>

          <motion.p variants={rise} className="text-xs text-muted-foreground/60">
            Mobile barbering across Sydney
          </motion.p>
        </motion.div>
      </aside>

      {/* Form */}
      <main className="flex min-h-[100dvh] items-center justify-center px-4 py-12 sm:px-10 lg:min-h-0">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="w-full max-w-[400px]"
        >
          {/* Mobile brand */}
          <motion.div variants={rise} className="mb-9 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
              <Scissors className="h-4 w-4 text-primary" strokeWidth={1.5} />
            </span>
            <span className="font-heading text-xl font-bold tracking-tight">Cut Deluxe</span>
          </motion.div>

          <motion.div variants={rise} className="mb-7">
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-foreground">Sign in</h1>
            <p className="mt-2 text-sm text-muted-foreground">Access your dashboard.</p>
          </motion.div>

          {/* Double-bezel card: outer shell + inner core */}
          <motion.div
            variants={rise}
            className="rounded-[1.75rem] border border-white/[0.07] bg-white/[0.02] p-1.5"
          >
            <div className="rounded-[calc(1.75rem-0.375rem)] border border-white/[0.05] bg-card/70 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] sm:p-7">
              <form onSubmit={handleLogin} className="space-y-5" noValidate>
                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  >
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email" className="text-[13px] font-medium text-foreground/75">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@cutdeluxe.com.au"
                    className={fieldClass}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="password" className="text-[13px] font-medium text-foreground/75">
                      Password
                    </Label>
                    <Link
                      to="/forgot-password"
                      className="text-[13px] text-muted-foreground underline-offset-4 transition-colors duration-300 hover:text-foreground hover:underline"
                    >
                      Forgot?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className={`${fieldClass} pr-12`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-1 top-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors duration-300 hover:bg-white/[0.06] hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                      ) : (
                        <Eye className="h-4 w-4" strokeWidth={1.5} />
                      )}
                    </button>
                  </div>
                </div>

                {/* Pill CTA with nested icon */}
                <button
                  type="submit"
                  disabled={loading}
                  className="group relative inline-flex h-12 w-full items-center justify-center rounded-full bg-foreground pl-6 pr-2 text-[15px] font-semibold text-background transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
                >
                  <span className="flex-1 text-center">{loading ? 'Signing in' : 'Sign in'}</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/10 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:scale-105">
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                    ) : (
                      <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </span>
                </button>
              </form>
            </div>
          </motion.div>

          <motion.div variants={rise} className="mt-8 flex flex-col gap-3">
            <Link
              to="/"
              className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground"
            >
              <ArrowLeft
                className="h-3.5 w-3.5 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-x-0.5"
                strokeWidth={1.5}
              />
              Back to booking
            </Link>
            <p className="text-xs leading-relaxed text-muted-foreground/60">
              Customers don&apos;t need an account — bookings are made from the website.
            </p>
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
