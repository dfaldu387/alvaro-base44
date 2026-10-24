import { lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';

// Public pages (eager — needed for first paint)
import Home from '@/pages/Home';
import Book from '@/pages/Book';
import ClientStatus from '@/pages/ClientStatus';
import AcceptStaffInvite from '@/pages/AcceptStaffInvite';

// Legal pages (lazy — rarely visited, no need in the first-paint bundle)
const Terms = lazy(() => import('@/pages/Terms'));
const Privacy = lazy(() => import('@/pages/Privacy'));

// Auth pages (eager — needed for login flow)
import Login from '@/pages/Login';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';

// Admin pages (lazy — keeps admin code out of the public bundle)
const Dashboard = lazy(() => import('@/pages/admin/Dashboard'));
const Reminders = lazy(() => import('@/pages/Reminders'));
const Messages = lazy(() => import('@/pages/admin/Messages'));
const Reports = lazy(() => import('@/pages/admin/Reports'));
const Requests = lazy(() => import('@/pages/admin/Requests'));
const Schedule = lazy(() => import('@/pages/admin/Schedule'));
const DemandSettings = lazy(() => import('@/pages/admin/DemandSettings'));
const Settings = lazy(() => import('@/pages/admin/Settings'));
const MessagingAutomation = lazy(() => import('@/pages/admin/MessagingAutomation'));
const Services = lazy(() => import('@/pages/admin/Services'));
const AdminPayments = lazy(() => import('@/pages/admin/AdminPayments'));
const AdminRoute = lazy(() => import('@/pages/admin/AdminRoute'));
const BookingRules = lazy(() => import('@/pages/admin/BookingRules'));
const ServiceCoverage = lazy(() => import('@/pages/admin/ServiceCoverage'));
const BookingAvailability = lazy(() => import('@/pages/admin/BookingAvailability'));
const TeamMembers = lazy(() => import('@/pages/admin/TeamMembers'));
const StaffPermissions = lazy(() => import('@/pages/admin/StaffPermissions'));
const SchedulingBot = lazy(() => import('@/pages/admin/SchedulingBot'));
const AdminSidebarLayout = lazy(() => import('@/components/admin/AdminSidebarLayout'));
const Clients = lazy(() => import('@/pages/Clients'));
const DepositRules = lazy(() => import('@/pages/admin/DepositRules'));
const AuditLog = lazy(() => import('@/pages/admin/AuditLog'));

const PageFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-background">
    <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
  </div>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  return (
    <Suspense fallback={<PageFallback />}>
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<Home />} />
      <Route path="/book" element={<Book />} />
      <Route path="/status" element={<ClientStatus />} />
      <Route path="/status/:token" element={<ClientStatus />} />
      <Route path="/staff/invite/:token" element={<AcceptStaffInvite />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />

      {/* Auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Protected admin routes */}
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} allowedRoles={['admin', 'user']} />}>
        <Route element={<AdminSidebarLayout />}>
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<Dashboard />} />
          {/* One reminders destination: the pipeline, the campaigns and their history are tabs there. */}
          <Route path="/admin/reminders" element={<Reminders />} />
          <Route path="/admin/workflow" element={<Navigate to="/admin/reminders?tab=pipeline" replace />} />
          <Route path="/admin/clients" element={<Clients />} />
          <Route path="/admin/schedule" element={<Schedule />} />
          <Route path="/admin/route" element={<AdminRoute />} />
          <Route path="/admin/requests" element={<Requests />} />
          <Route path="/admin/services" element={<Services />} />
          <Route path="/admin/messages" element={<Messages />} />
          <Route path="/admin/campaign" element={<Navigate to="/admin/reminders?tab=campaigns" replace />} />
          <Route path="/admin/reports" element={<Reports />} />
          {/* Settings is the hub; each configuration page keeps its own address under it. */}
          <Route path="/admin/settings" element={<Settings />} />
          <Route path="/admin/settings/general" element={<DemandSettings />} />
          <Route path="/admin/automation" element={<Navigate to="/admin/settings/messaging" replace />} />
          <Route path="/admin/booking-rules" element={<BookingRules />} />
          <Route path="/admin/deposit-rules" element={<DepositRules />} />
          {/* Booking requests and their states are handled inside the Calendar's Booking
              Requests drawer now. Needs Review is a filter there, not a page, so both old
              addresses land on that drawer with the filter already chosen. */}
          <Route path="/admin/review-queue" element={<Navigate to="/admin/schedule?requests=open&filter=needs_review" replace />} />
          <Route path="/admin/needs-review" element={<Navigate to="/admin/schedule?requests=open&filter=needs_review" replace />} />
          <Route path="/admin/service-coverage" element={<ServiceCoverage />} />
          <Route path="/admin/booking-availability" element={<BookingAvailability />} />
          <Route path="/admin/team-members" element={<TeamMembers />} />
          <Route path="/admin/staff-permissions" element={<StaffPermissions />} />
          <Route path="/admin/scheduling-bot" element={<SchedulingBot />} />
          {/* VIP clients are opened from the Clients page. */}
          <Route path="/admin/vip" element={<Navigate to="/admin/clients?vip=1" replace />} />
          <Route path="/admin/payments" element={<AdminPayments />} />
          <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} allowedRoles={['admin']} />}>
            {/* Sending modes and automation health stay admin-only, exactly as before. */}
            <Route path="/admin/settings/messaging" element={<MessagingAutomation />} />
            <Route path="/admin/audit" element={<AuditLog />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App