import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './login.css';

/**
 * Wrap your app in this. Logged-out users see the login screen,
 * logged-in users see your app.
 *
 *   <AuthProvider><AuthGate><App /></AuthGate></AuthProvider>
 */
export default function AuthGate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="login-wrap"><p className="login-muted">Loading…</p></div>;
  return user ? children : <LoginScreen />;
}

function LoginScreen() {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg({ type: '', text: '' });
    try {
      if (mode === 'signup') {
        const { data, error } = await signUpWithEmail(email, password, name || email.split('@')[0]);
        if (error) throw error;
        // if "Confirm email" is on in Supabase, there is no session until the link is clicked
        if (!data.session) setMsg({ type: 'ok', text: 'Account created. Check your email and click the confirmation link, then sign in.' });
      } else {
        const { error } = await signInWithEmail(email, password);
        if (error) throw error;
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">S</div>
        <h1>StudyTrack</h1>
        <p className="login-muted">{mode === 'signin' ? 'Welcome back. Sign in to continue.' : 'Create your account.'}</p>

        {mode === 'signup' && (
          <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        )}
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
               required autoComplete="email" />
        <input type="password" placeholder="Password (min 6 characters)" value={password}
               onChange={(e) => setPassword(e.target.value)} required minLength={6}
               autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />

        <button type="submit" className="login-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        {msg.text && <p className={msg.type === 'error' ? 'login-error' : 'login-ok'}>{msg.text}</p>}

        {/* Works only after you enable Google in Supabase (Authentication -> Providers). Delete this button if you skip Google. */}
        <button type="button" className="login-ghost" onClick={signInWithGoogle}>Continue with Google</button>

        <button type="button" className="login-link"
                onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg({ type: '', text: '' }); }}>
          {mode === 'signin' ? "New here? Create an account" : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  );
}
