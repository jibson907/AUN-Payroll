import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Layout from './components/Layout';
import { Spinner } from './components/ui';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import History from './pages/History';
import RunDetail from './pages/RunDetail';
import Employees from './pages/Employees';
import AuditLog from './pages/AuditLog';
import Settings from './pages/Settings';

function Protected({ children, adminOnly }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><Spinner dark /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/upload" element={<Protected><Upload /></Protected>} />
      <Route path="/history" element={<Protected><History /></Protected>} />
      <Route path="/history/:id" element={<Protected><RunDetail /></Protected>} />
      <Route path="/employees" element={<Protected><Employees /></Protected>} />
      <Route path="/audit" element={<Protected><AuditLog /></Protected>} />
      {/* all roles: non-admins only see "Change Password" (admin cards are also enforced server-side) */}
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
