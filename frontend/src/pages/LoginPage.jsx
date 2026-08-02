import Login from '../components/Login';
import { useAuth } from '../hooks/useAuth';

// Route-level container for the authentication screen.
// Assembles the presentational <Login /> with the auth data layer (SoC).
export default function LoginPage() {
  const { login } = useAuth();

  // Login owns its own validation/error UI; we just wire the auth call and
  // let failures propagate so <Login /> can display them.
  const handleLogin = (email, password) => login(email, password);

  return <Login onLogin={handleLogin} />;
}
