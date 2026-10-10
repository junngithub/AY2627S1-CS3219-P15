/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the route table for the D2 pages (sign-in, suppliers,
 *        profile, admin), and the guard around the signed-in half.
 * Reviewed by Ngooi Jun Sen.
 */

import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { RequireAuth } from './auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { AuthLayout } from './components/layout/AuthLayout';
import { ProfilePage } from './pages/ProfilePage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminSuppliersPage } from './pages/AdminSuppliersPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminLayout } from './components/layout/AdminLayout';
import { NewSupplierPage } from './pages/NewSupplierPage';
import { SupplierDetailPage } from './pages/SupplierDetailPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { PagePlaceholder } from './pages/PagePlaceholder';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SignUpPage } from './pages/SignUpPage';
import { VerifyEmailLinkPage } from './pages/VerifyEmailLinkPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

export function App() {
  const { user } = useAuth();

  /**
   * Admin F2.2.1 wants a non-admin to be unable to tell the admin pages exist.
   * Registering the routes only for admins means /admin/users falls through to
   * the not-found page for everyone else, so it looks like a URL that was never
   * a route. Two things this does not do:
   * the admin page code still ships in the bundle (a dynamic import would fix
   * that), and the server still serves the page to anyone who asks, which needs
   * the token in a cookie.
   */
  const isAdmin = user?.isAdmin === true;

  return (
    <Routes>
      {/* Signed-out pages: centered card layout */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        {/* TODO(user-service): the path the verification email links to,
            with ?token=. Whoever writes the email template must use it. */}
        <Route path="/verify-email/confirm" element={<VerifyEmailLinkPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      {/* Admin: its own shell, still behind the session guard */}
      <Route element={<RequireAuth />}>
        {isAdmin ? (
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/suppliers" element={<AdminSuppliersPage />} />
            <Route
              path="/admin/escalations"
              element={<PagePlaceholder title="Escalation review" requirements="UI FR18" />}
            />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/ratings" element={<PagePlaceholder title="Rating lookup" requirements="UI FR19" />} />
          </Route>
        ) : null}
      </Route>

      {/* Signed-in pages: nav bar shell, behind the session guard */}
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/suppliers" replace />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/suppliers/new" element={<NewSupplierPage />} />
          <Route path="/suppliers/:supplierId" element={<SupplierDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/account-status" element={<PagePlaceholder title="Account status" requirements="UI FR13" />} />

          {/*
            Admin pages have their own shell (UI FR15.1.2), so they sit
            outside AppShell rather than inside it. Still registered only for
            admins, so /admin is a not-found page for everyone else.
          */}
          <Route path="*" element={<PagePlaceholder title="Page not found" requirements="nothing" />} />
        </Route>
      </Route>
    </Routes>
  );
}
