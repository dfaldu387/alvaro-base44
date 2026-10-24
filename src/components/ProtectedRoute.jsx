import { useEffect, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const DefaultFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);

const AccessDenied = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-zinc-50">
    <div className="max-w-sm w-full text-center space-y-4 p-6">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-zinc-900">Access Denied</h1>
      <p className="text-sm text-zinc-500">Your account is not linked to an active team member. Please contact the owner.</p>
      <button
        onClick={() => base44.auth.logout(window.location.origin)}
        className="text-sm font-semibold text-[#5E42F3] hover:underline"
      >
        Log out
      </button>
    </div>
  </div>
);

export default function ProtectedRoute({ fallback = <DefaultFallback />, unauthenticatedElement, allowedRoles }) {
  const { user, isAuthenticated, isLoadingAuth, authChecked, authError, checkUserAuth } = useAuth();
  const [teamMember, setTeamMember] = useState(null);
  const [checkingTeamMember, setCheckingTeamMember] = useState(false);

  useEffect(() => {
    if (!authChecked && !isLoadingAuth) {
      checkUserAuth();
    }
  }, [authChecked, isLoadingAuth, checkUserAuth]);

  // Fetch the linked TeamMember for barber-role users
  useEffect(() => {
    if (isAuthenticated && user?.role === 'user' && !teamMember && !checkingTeamMember) {
      setCheckingTeamMember(true);
      base44.entities.TeamMember.filter({ user_id: user.id })
        .then(members => {
          setTeamMember(members[0] || null);
          setCheckingTeamMember(false);
        })
        .catch(() => {
          setTeamMember(null);
          setCheckingTeamMember(false);
        });
    }
  }, [isAuthenticated, user, teamMember, checkingTeamMember]);

  if (isLoadingAuth || !authChecked) {
    return fallback;
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    }
    return unauthenticatedElement;
  }

  if (!isAuthenticated) {
    return unauthenticatedElement;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  // Barber access check: must have an active TeamMember linked to this user
  if (user?.role === 'user') {
    if (checkingTeamMember) return fallback;
    if (!teamMember || teamMember.status !== 'Active') {
      return <AccessDenied />;
    }
  }

  return <Outlet />;
}