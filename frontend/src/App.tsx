import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AdminPage from './pages/AdminPage'
import ChatPage from './pages/ChatPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import { useAuth } from './store/auth'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token)
  const location = useLocation()
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user)
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()

  // 任何接口返回 401，统一踢回登录页
  useEffect(() => {
    const onUnauthorized = () => {
      logout()
      navigate('/login', { replace: true })
    }
    window.addEventListener('aiqa:unauthorized', onUnauthorized)
    return () => window.removeEventListener('aiqa:unauthorized', onUnauthorized)
  }, [logout, navigate])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
