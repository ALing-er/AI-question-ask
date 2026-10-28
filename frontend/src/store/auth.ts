import { create } from 'zustand'
import { getStoredUser, getToken, setStoredUser, setToken } from '../api'
import type { UserInfo } from '../types'

interface AuthState {
  token: string | null
  user: UserInfo | null
  setSession: (token: string, user: UserInfo) => void
  setUser: (user: UserInfo) => void
  logout: () => void
}

export const useAuth = create<AuthState>((set) => ({
  token: getToken(),
  user: getStoredUser(),
  setSession: (token, user) => {
    setToken(token)
    setStoredUser(user)
    set({ token, user })
  },
  setUser: (user) => {
    setStoredUser(user)
    set({ user })
  },
  logout: () => {
    setToken(null)
    setStoredUser(null)
    set({ token: null, user: null })
  },
}))
