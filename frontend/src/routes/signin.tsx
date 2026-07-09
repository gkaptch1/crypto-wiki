import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { signIn, signUp, useAuth } from '../lib/auth-client';

export const Route = createFileRoute('/signin')({
  component: SignInPage,
});

function SignInPage() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  if (isSignedIn) {
    return (
      <div className="max-w-md mx-auto text-center space-y-3">
        <p>You are signed in.</p>
        <button className="text-blue-700 underline" onClick={() => navigate({ to: '/' })}>
          Back to the wiki
        </button>
      </div>
    );
  }

  const social = (provider: 'google' | 'github') =>
    signIn
      .social({ provider, callbackURL: window.location.origin })
      .then((res) => {
        if (res.error) setError(res.error.message ?? `${provider} sign-in failed`);
      });

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-1">Sign in</h1>
        <p className="text-sm text-gray-600">
          Reading the wiki needs no account. Sign in to manage macro sets — and, if you have been
          invited, to edit definitions.
        </p>
      </div>

      <div className="space-y-2">
        <button
          className="w-full border border-gray-300 rounded px-4 py-2.5 text-sm font-medium hover:border-black"
          onClick={() => social('google')}
        >
          Continue with Google
        </button>
        <button
          className="w-full border border-gray-300 rounded px-4 py-2.5 text-sm font-medium hover:border-black"
          onClick={() => social('github')}
        >
          Continue with GitHub
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {import.meta.env.DEV && <DevPasswordForm onError={setError} />}
    </div>
  );
}

// Dev-only fallback for machines without OAuth credentials; the backend only
// accepts it when AUTH_PASSWORD_SIGNIN=1 (never set in production).
function DevPasswordForm({ onError }: { onError: (msg: string | null) => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onError(null);
    const res =
      mode === 'sign-in'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name });
    setBusy(false);
    if (res.error) onError(res.error.message ?? 'Authentication failed');
    else navigate({ to: '/' });
  };

  return (
    <form
      className="border border-dashed border-amber-400 bg-amber-50 rounded-lg p-4 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-amber-900">Dev sign-in (password)</h2>
        <button
          type="button"
          className="text-xs text-amber-800 underline"
          onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
        >
          {mode === 'sign-in' ? 'need an account?' : 'have an account?'}
        </button>
      </div>
      {mode === 'sign-up' && (
        <input
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      )}
      <input
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
        type="email"
        placeholder="you@example.edu"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
        type="password"
        placeholder="Password (min 8 chars)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={8}
      />
      <button
        type="submit"
        disabled={busy}
        className="bg-amber-900 text-white rounded px-4 py-1.5 text-sm disabled:opacity-50"
      >
        {mode === 'sign-in' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}
