import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthProvider } from './hooks/useAuth'
import { ToastProvider } from './components/Toast'
import RentechApp from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RentechApp />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
)