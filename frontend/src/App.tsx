import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import RequireAuth from "./components/RequireAuth";
import { SkeletonCard } from "./components/Skeleton";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { useTaskNotifications } from "./hooks/useTaskNotifications";
import Login from "./pages/Login";

// Login renders before the auth/router chunk completes, so it stays eager.
// Everything else lazy-loads — keeps initial bundle small and pushes recharts /
// react-simple-maps into separate chunks that only download for the pages
// that use them.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Agents = lazy(() => import("./pages/Agents"));
const Availability = lazy(() => import("./pages/Availability"));
const AvailabilityMatrix = lazy(() => import("./pages/AvailabilityMatrix"));
const Tasks = lazy(() => import("./pages/Tasks"));
const TaskDetail = lazy(() => import("./pages/TaskDetail"));
const TaskGroup = lazy(() => import("./pages/TaskGroup"));
const Targets = lazy(() => import("./pages/Targets"));
const TargetDetail = lazy(() => import("./pages/TargetDetail"));
const Schedules = lazy(() => import("./pages/Schedules"));
const Users = lazy(() => import("./pages/Users"));
const Audit = lazy(() => import("./pages/Audit"));
const PublicStatus = lazy(() => import("./pages/PublicStatus"));
const PublicTargetsAdmin = lazy(() => import("./pages/PublicTargetsAdmin"));

function PageFallback() {
  return (
    <div className="min-h-screen bg-slate-950 p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <SkeletonCard className="h-12" />
        <SkeletonCard className="h-64" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* Becomes visible only when focused via Tab. Lets keyboard/screen-
            reader users jump past the NavBar to the page content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[300] focus:rounded focus:bg-slate-100 focus:px-3 focus:py-2 focus:text-sm focus:text-slate-900 focus:shadow"
        >
          Skip to content
        </a>
        <div id="main">
          <RoutesWithBoundary />
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

// Inner component so we can read `location` from the router and use it as the
// ErrorBoundary's resetKey — a crash on /tasks shouldn't keep showing the
// fallback after the user navigates to /agents.
function NotificationsRunner() {
  const { user } = useAuth();
  useTaskNotifications(!!user);
  return null;
}

function RoutesWithBoundary() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <GlobalShortcuts />
      <NotificationsRunner />
      <Suspense fallback={<PageFallback />}>
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/status" element={<PublicStatus />} />
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <Dashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/agents"
              element={
                <RequireAuth>
                  <Agents />
                </RequireAuth>
              }
            />
            <Route
              path="/availability"
              element={
                <RequireAuth>
                  <Availability />
                </RequireAuth>
              }
            />
            <Route
              path="/availability/:groupId"
              element={
                <RequireAuth>
                  <AvailabilityMatrix />
                </RequireAuth>
              }
            />
            <Route
              path="/tasks"
              element={
                <RequireAuth>
                  <Tasks />
                </RequireAuth>
              }
            />
            <Route
              path="/tasks/:taskId"
              element={
                <RequireAuth>
                  <TaskDetail />
                </RequireAuth>
              }
            />
            <Route
              path="/groups/:groupId"
              element={
                <RequireAuth>
                  <TaskGroup />
                </RequireAuth>
              }
            />
            <Route
              path="/targets"
              element={
                <RequireAuth>
                  <Targets />
                </RequireAuth>
              }
            />
            <Route
              path="/schedules"
              element={
                <RequireAuth>
                  <Schedules />
                </RequireAuth>
              }
            />
            <Route
              path="/targets/:target"
              element={
                <RequireAuth>
                  <TargetDetail />
                </RequireAuth>
              }
            />
            <Route
              path="/users"
              element={
                <RequireAuth requireRole="admin">
                  <Users />
                </RequireAuth>
              }
            />
            <Route
              path="/audit"
              element={
                <RequireAuth requireRole="admin">
                  <Audit />
                </RequireAuth>
              }
            />
            <Route
              path="/admin/public-targets"
              element={
                <RequireAuth requireRole="admin">
                  <PublicTargetsAdmin />
                </RequireAuth>
              }
            />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
