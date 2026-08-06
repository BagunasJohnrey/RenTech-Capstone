import Login from '../components/Login';
import { useAuth } from '../hooks/useAuth';

// Route-level container for the authentication screen.
// Assembles the presentational <Login /> with the auth data layer (SoC).
export default function LoginPage() {
  const { login, verifyMfa } = useAuth();

  // Login owns its own validation/error UI; we just wire the auth calls and
  // let failures propagate so <Login /> can display them. If login returns
  // requiresMfa, <Login /> handles the TOTP challenge UI internally.
  const handleLogin = (email, password) => login(email, password);

  return <Login onLogin={handleLogin} onVerifyMfa={verifyMfa} />;
}
