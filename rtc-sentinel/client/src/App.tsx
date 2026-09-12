import { useEffect, useState, type FormEvent } from 'react';
import {
  predictQuality,
  type MlQualityPrediction,
  type PublicUser,
} from './authApi';
import { useAuth, type Authentication } from './useAuth';
import { useWebRtcCall } from './useWebRtcCall';

const duration = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const milliseconds = (value: number | null) =>
  value === null ? '—' : `${value.toFixed(0)} ms`;
const titleCase = (value: string) =>
  `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

function passwordValidationMessage(password: string): string {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  const missing: string[] = [];
  if (!/[A-Z]/.test(password)) missing.push('an uppercase letter');
  if (!/[a-z]/.test(password)) missing.push('a lowercase letter');
  if (!/[0-9]/.test(password)) missing.push('a number');
  if (missing.length === 0) return '';
  const requirements =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
  return `Password must include ${requirements}.`;
}

function RttChart({ values }: { values: Array<number | null> }) {
  const samples = values.filter((value): value is number => value !== null);
  if (samples.length < 2)
    return <p className="chart-empty">Collecting RTT history…</p>;
  const maximum = Math.max(...samples, 1);
  const points = samples
    .map(
      (value, index) =>
        `${(index / (samples.length - 1)) * 320},${76 - (value / maximum) * 64}`,
    )
    .join(' ');
  return (
    <svg
      className="rtt-chart"
      viewBox="0 0 320 80"
      role="img"
      aria-label="Recent round trip time"
    >
      <title>Recent round trip time</title>
      <polyline points={points} />
    </svg>
  );
}

function AuthenticationPanel({
  auth,
  onGuest,
}: {
  auth: Authentication;
  onGuest(): void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password'));
    if (mode === 'register') {
      const validationMessage = passwordValidationMessage(password);
      if (validationMessage) {
        setError(validationMessage);
        setSubmitting(false);
        return;
      }
    }
    try {
      if (mode === 'register') {
        await auth.register({
          name: String(data.get('name')),
          email: String(data.get('email')),
          password,
        });
      } else {
        await auth.login({
          email: String(data.get('email')),
          password,
        });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Authentication could not be completed.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const changeMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
  };

  return (
    <main className="shell auth-shell">
      <section className="auth-layout">
        <div className="auth-introduction">
          <p className="eyebrow">WebRTC quality intelligence</p>
          <h1>RTC Sentinel</h1>
          <p className="intro">
            Secure peer-to-peer voice calling with live network measurements and
            explainable quality predictions.
          </p>
          <div className="feature-list" aria-label="Application features">
            <span>Encrypted WebRTC audio</span>
            <span>Live QoS monitoring</span>
            <span>ML quality estimates</span>
          </div>
        </div>
        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="Authentication">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => changeMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => changeMode('register')}
            >
              Create account
            </button>
          </div>
          <div className="auth-copy">
            <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
            <p>
              {mode === 'login'
                ? 'Sign in to start or join a protected call.'
                : 'Your password is securely hashed before it is stored.'}
            </p>
          </div>
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === 'register' && (
              <label>
                Name
                <input
                  name="name"
                  autoComplete="name"
                  minLength={2}
                  maxLength={100}
                  required
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                minLength={8}
                maxLength={128}
                required
                placeholder="••••••••"
              />
            </label>
            {mode === 'register' && (
              <p className="password-hint">
                Use at least 8 characters with uppercase, lowercase, and a
                number.
              </p>
            )}
            {error && (
              <p role="alert" className="error auth-error">
                {error}
              </p>
            )}
            <button className="primary" disabled={submitting}>
              {submitting
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>
          <div className="guest-access">
            <span>or</span>
            <button type="button" onClick={onGuest}>
              Join a call as guest
            </button>
            <p>No account is needed to join an existing room.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function CallWorkspace({
  user,
  accessToken,
  guest = false,
  onExit,
}: {
  user: PublicUser | null;
  accessToken: string;
  guest?: boolean;
  onExit(): void;
}) {
  const call = useWebRtcCall(accessToken, guest);
  const [roomInput, setRoomInput] = useState('');
  const [mlPrediction, setMlPrediction] = useState<MlQualityPrediction | null>(
    null,
  );
  const [mlPending, setMlPending] = useState(false);
  const [mlError, setMlError] = useState(false);
  const active =
    call.status !== 'idle' &&
    call.status !== 'ended' &&
    call.status !== 'error';

  useEffect(() => {
    const metric = call.qosMetric;
    if (guest) {
      setMlPrediction(null);
      setMlError(false);
      setMlPending(false);
      return;
    }
    if (!metric || metric.rtt === null || metric.jitter === null) {
      setMlPrediction(null);
      setMlError(false);
      return;
    }
    let current = true;
    setMlPending(true);
    setMlError(false);
    void predictQuality(accessToken, {
      rtt: metric.rtt,
      jitter: metric.jitter,
      packetLoss: metric.packetLoss,
      bitrate: metric.bitrate,
      audioLevel: metric.audioLevel ?? undefined,
    })
      .then((prediction) => {
        if (current) setMlPrediction(prediction);
      })
      .catch(() => {
        if (current) setMlError(true);
      })
      .finally(() => {
        if (current) setMlPending(false);
      });
    return () => {
      current = false;
    };
  }, [accessToken, call.qosMetric, guest]);

  const signOut = () => {
    if (active) call.endCall();
    onExit();
  };

  return (
    <main className="shell">
      <section className="call-card">
        <header className="user-bar">
          <div>
            <span>{guest ? 'Anonymous participant' : 'Signed in as'}</span>
            <strong>{guest ? 'Guest' : user?.name}</strong>
            <small>{guest ? 'Join-only access' : user?.email}</small>
          </div>
          <button className="quiet" onClick={signOut}>
            {guest ? 'Exit guest mode' : 'Sign out'}
          </button>
        </header>
        <p className="eyebrow">WebRTC voice calling</p>
        <h1>RTC Sentinel</h1>
        <p className="intro">
          {guest
            ? 'Join an existing peer-to-peer call without creating an account.'
            : 'Private peer-to-peer audio with authenticated real-time signaling.'}
        </p>
        {!active ? (
          <div className="actions">
            {!guest && (
              <button
                className="primary"
                onClick={() => void call.createCall()}
              >
                Create Call
              </button>
            )}
            {guest && (
              <p className="guest-notice">
                Ask the host for their six-character room ID. Sign in if you
                want to create your own call.
              </p>
            )}
            <div className="join-row">
              <label htmlFor="room">Room ID</label>
              <input
                id="room"
                maxLength={6}
                placeholder="ABC123"
                value={roomInput}
                onChange={(event) =>
                  setRoomInput(event.target.value.toUpperCase())
                }
              />
              <button
                disabled={roomInput.trim().length !== 6}
                onClick={() => void call.joinCall(roomInput)}
              >
                Join Call
              </button>
            </div>
          </div>
        ) : (
          <div className="session">
            <div className="room-line">
              <span>Room</span>
              <strong>{call.roomId}</strong>
              <button
                className="quiet"
                onClick={() => void navigator.clipboard.writeText(call.roomId)}
              >
                Copy Room ID
              </button>
            </div>
            <div className="status-grid">
              <div>
                <span>Microphone</span>
                <strong>{call.muted ? 'MUTED' : 'ON'}</strong>
              </div>
              <div>
                <span>Call Status</span>
                <strong data-status={call.status}>{call.statusLabel}</strong>
              </div>
              <div>
                <span>Network Path</span>
                <strong>{call.candidateType.toUpperCase()}</strong>
              </div>
            </div>
            <section className="qos-panel" aria-label="Call quality metrics">
              <div className="qos-heading">
                <div>
                  <span>Live QoS monitoring</span>
                  <h2>{duration(call.durationSeconds)}</h2>
                </div>
                <span className="live-indicator">● 3s samples</span>
              </div>
              <div className="quality-grid">
                <div className="quality-summary">
                  <div>
                    <span>Rule-based quality</span>
                    <strong data-quality={call.quality.quality.toLowerCase()}>
                      {call.quality.quality}
                    </strong>
                  </div>
                  <p>
                    {call.quality.score === null
                      ? 'Waiting for a complete sample'
                      : `Score ${call.quality.score}/100 · Limited by ${call.quality.limitingFactors.join(', ')}`}
                  </p>
                </div>
                <div className="ml-summary">
                  <div>
                    <span>ML prediction</span>
                    <strong data-quality={mlPrediction?.quality ?? 'unknown'}>
                      {guest
                        ? 'Sign in required'
                        : mlPending && !mlPrediction
                          ? 'Analyzing…'
                          : mlError
                            ? 'Unavailable'
                            : mlPrediction
                              ? titleCase(mlPrediction.quality)
                              : 'Waiting'}
                    </strong>
                  </div>
                  <p>
                    {guest
                      ? 'Guest mode does not call the protected ML API.'
                      : mlPrediction
                        ? `${Math.round(mlPrediction.confidence * 100)}% model confidence`
                        : 'Uses all five live measurements to estimate the most likely quality class.'}
                  </p>
                </div>
              </div>
              <p className="ml-explanation">
                {guest
                  ? 'The local rule score remains available. Sign in to enable server-side ML predictions.'
                  : 'The rule score applies fixed thresholds. The ML prediction compares the current measurements with learned examples; confidence means how certain the model is, not the percentage quality of the call.'}
              </p>
              <div className="metric-grid">
                <div>
                  <span>Round Trip Time</span>
                  <strong>{milliseconds(call.qosMetric?.rtt ?? null)}</strong>
                </div>
                <div>
                  <span>Jitter</span>
                  <strong>
                    {milliseconds(call.qosMetric?.jitter ?? null)}
                  </strong>
                </div>
                <div>
                  <span>Packet Loss</span>
                  <strong>
                    {call.qosMetric
                      ? `${call.qosMetric.packetLoss.toFixed(2)}%`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Bitrate</span>
                  <strong>
                    {call.qosMetric
                      ? `${(call.qosMetric.bitrate / 1000).toFixed(1)} kbps`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Packets</span>
                  <strong>
                    {call.qosMetric
                      ? `${call.qosMetric.packetsSent} ↑ ${call.qosMetric.packetsReceived} ↓`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Audio Level</span>
                  <strong>
                    {call.qosMetric?.audioLevel == null
                      ? '—'
                      : `${Math.round(call.qosMetric.audioLevel * 100)}%`}
                  </strong>
                </div>
                <div className="wide">
                  <span>Codec</span>
                  <strong>{call.qosMetric?.codec ?? 'Discovering'}</strong>
                </div>
              </div>
              <div className="chart">
                <span>RTT history</span>
                <RttChart
                  values={call.qosHistory.map((metric) => metric.rtt)}
                />
              </div>
            </section>
            <div className="controls">
              <button onClick={call.toggleMute}>
                {call.muted ? 'Unmute' : 'Mute'}
              </button>
              <button className="danger" onClick={call.endCall}>
                End Call
              </button>
            </div>
          </div>
        )}
        {call.error && (
          <p role="alert" className="error">
            {call.error}
          </p>
        )}
        <audio ref={call.remoteAudioRef} autoPlay />
      </section>
    </main>
  );
}

export function App() {
  const auth = useAuth();
  const [guest, setGuest] = useState(false);
  if (auth.loading) {
    return (
      <main className="shell">
        <section className="loading-card" aria-live="polite">
          <span className="loading-dot">●</span>
          Restoring your secure session…
        </section>
      </main>
    );
  }
  if (!auth.user && !guest)
    return <AuthenticationPanel auth={auth} onGuest={() => setGuest(true)} />;
  return (
    <CallWorkspace
      user={auth.user}
      accessToken={guest ? '' : auth.accessToken}
      guest={guest && !auth.user}
      onExit={guest ? () => setGuest(false) : auth.logout}
    />
  );
}
