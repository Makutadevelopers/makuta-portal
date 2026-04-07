import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import AppRouter from './router';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </AuthProvider>
  );
}
