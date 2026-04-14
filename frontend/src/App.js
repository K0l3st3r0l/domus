import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import CalendarPage from './pages/CalendarPage';
import MenuPage from './pages/MenuPage';
import ShoppingPage from './pages/ShoppingPage';
import FinancesPage from './pages/FinancesPage';
import FamilyPage from './pages/FamilyPage';
import ProfilePage from './pages/ProfilePage';
import SetupPage from './pages/SetupPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import CreditsPage from './pages/CreditsPage';
import SchoolSyncPage from './pages/SchoolSyncPage';
import SchoolSchedulePage from './pages/SchoolSchedulePage';

function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function PublicRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return !isAuthenticated ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="shopping" element={<ShoppingPage />} />
        <Route path="finances" element={<FinancesPage />} />
        <Route path="family" element={<FamilyPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="credits" element={<CreditsPage />} />
        <Route path="school-sync" element={<SchoolSyncPage />} />
        <Route path="school-schedule" element={<SchoolSchedulePage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false} />
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
