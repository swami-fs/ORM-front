import { FormEvent, useEffect, useRef, useState } from 'react';
import './app.css';

const MENU_ITEMS = [
  { label: 'Settings', icon: '⚙️' },
  { label: 'About', icon: 'ℹ️' },
  { label: 'Help', icon: '❓' },
];
const localhostHostnames = new Set(['localhost', '127.0.0.1']);
const inferredApiOrigin = localhostHostnames.has(window.location.hostname)
  ? 'http://localhost:3333'
  : window.location.origin;
const apiOrigin = (import.meta.env.VITE_API_BASE_URL?.trim() || inferredApiOrigin).replace(
  /\/$/,
  '',
);

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiOrigin}${normalizedPath}`;
}

function normalizeMessageText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n');
}

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
};

type IngestSummary = {
  dataset_id: string;
  platform: string;
  entity_name: string;
  source_summary?: string | null;
  review_count: number;
  rating_count?: number;
  average_rating: number | null;
  first_review_date?: string | null;
  last_review_date?: string | null;
};

type IngestContextApiResponse = {
  success: boolean;
  data?: IngestSummary;
  error?: string;
};

type ChatApiResponse = {
  success: boolean;
  data?: {
    decision: 'answer' | 'decline';
    answer: string;
    evidence_review_ids: string[];
  };
  error?: string;
};

type AuthenticateApiResponse = {
  success: boolean;
  data?: {
    bearerToken: string;
  };
  error?: string;
};

type VersionsApiResponse = {
  success: boolean;
  data?: {
    frontVersion: string;
    chatVersion: string;
  };
  error?: string;
};

function createChatMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return {
    role,
    text: normalizeMessageText(text),
    timestamp: new Date().toISOString(),
  };
}

function formatLocalTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export function App() {
  const [showLoginPage, setShowLoginPage] = useState(true);
  const [authKey, setAuthKey] = useState('');
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [reviewsInput, setReviewsInput] = useState('');
  const [bearerToken, setBearerToken] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextSummary, setContextSummary] = useState<IngestSummary | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [frontVersion, setFrontVersion] = useState('unknown');
  const [chatVersion, setChatVersion] = useState('unknown');
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createChatMessage(
      'assistant',
      'Paste reviews (or an Amazon/Google URL) on the left, click "Set context", then ask questions here.',
    ),
  ]);
  const normalizedAverageRating =
    typeof contextSummary?.average_rating === 'number' && Number.isFinite(contextSummary.average_rating)
      ? Math.max(0, Math.min(5, contextSummary.average_rating))
      : null;
  const averageRatingPercent = normalizedAverageRating ? (normalizedAverageRating / 5) * 100 : 0;
  const ratingCount =
    typeof contextSummary?.rating_count === 'number' ? contextSummary.rating_count : null;
  const ratingCoveragePercent =
    contextSummary && contextSummary.review_count > 0 && ratingCount !== null
      ? Math.round((ratingCount / contextSummary.review_count) * 100)
      : null;
  const contextSourceType = reviewsInput.trim().startsWith('http') ? 'URL' : 'Text / CSV';

  useEffect(() => {
    if (showLoginPage) {
      return;
    }
    const chatHistoryElement = chatHistoryRef.current;
    if (!chatHistoryElement) {
      return;
    }
    chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
  }, [messages, showLoginPage, chatBusy]);

  useEffect(() => {
    const loadVersions = async () => {
      try {
        const response = await fetch(apiUrl('/api/reviewlens/versions'));
        const payload = (await response.json()) as VersionsApiResponse;
        if (!response.ok || !payload.success || !payload.data) {
          return;
        }
        setFrontVersion(payload.data.frontVersion);
        setChatVersion(payload.data.chatVersion);
      } catch {
        // Keep "unknown" defaults
      }
    };
    void loadVersions();
  }, []);

  const handleAuthenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedAuthKey = authKey.trim();
    if (!trimmedAuthKey) {
      setAuthError('Please enter auth key.');
      return;
    }
    setAuthenticating(true);
    setAuthError(null);
    try {
      const response = await fetch(apiUrl('/api/reviewlens/authenticate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey: trimmedAuthKey }),
      });
      const payload = (await response.json()) as AuthenticateApiResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Authentication failed');
      }
      setBearerToken(payload.data.bearerToken);
      setShowLoginPage(false);
      setMessages((prev) => [
        ...prev,
        createChatMessage('assistant', 'Authenticated successfully. You can now set context and chat.'),
      ]);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleLogout = () => {
    setBearerToken('');
    setDatasetId(null);
    setContextSummary(null);
    setShowLoginPage(true);
    setAuthKey('');
    setAuthError(null);
  };

  const handleSetContext = async () => {
    const trimmed = reviewsInput.trim();
    if (!bearerToken) {
      setContextError('Please login first.');
      return;
    }
    if (!trimmed) {
      setContextError('Please provide reviews text/CSV or an Amazon/Google URL before setting context.');
      return;
    }

    setIngesting(true);
    setContextError(null);
    setContextSummary(null);
    try {
      const response = await fetch(apiUrl('/api/reviewlens/ingest-context'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewsText: trimmed,
          bearerToken,
        }),
      });
      const payload = (await response.json()) as IngestContextApiResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Failed to ingest reviews');
      }
      setContextSummary(payload.data);
      setDatasetId(payload.data.dataset_id);
      setMessages((prev) => [
        ...prev,
        createChatMessage(
          'assistant',
          payload.data.source_summary ??
            `Context set with ${payload.data.review_count} reviews for ${payload.data.entity_name}.`,
        ),
      ]);
    } catch (error) {
      setContextError(
        error instanceof Error
          ? `Unable to set context: ${error.message}`
          : 'Unable to set context.',
      );
    } finally {
      setIngesting(false);
    }
  };

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) {
      return;
    }

    setMessages((prev) => [...prev, createChatMessage('user', trimmed)]);
    setChatInput('');
    if (!bearerToken) {
      setMessages((prev) => [
        ...prev,
        createChatMessage('assistant', 'Please login first.'),
      ]);
      return;
    }
    if (!datasetId) {
      setMessages((prev) => [
        ...prev,
        createChatMessage(
          'assistant',
          'Please set context first by providing reviews text/CSV or a review URL, then click "Set context".',
        ),
      ]);
      return;
    }

    setChatBusy(true);
    try {
      const response = await fetch(apiUrl('/api/reviewlens/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId,
          question: trimmed,
          bearerToken,
        }),
      });
      const payload = (await response.json()) as ChatApiResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Failed to get answer');
      }
      const evidenceSuffix =
        payload.data.evidence_review_ids.length > 0
          ? `\n\nEvidence: ${payload.data.evidence_review_ids.join(', ')}`
          : '';
      setMessages((prev) => [
        ...prev,
        createChatMessage('assistant', `${payload.data.answer}${evidenceSuffix}`),
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        createChatMessage(
          'assistant',
          error instanceof Error
            ? `Chat failed: ${error.message}`
            : 'Chat failed due to an unexpected error.',
        ),
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="layout">
      <div className="shell">
        <aside className="sidebar">
          <div className="brand-wrap">
            <div className="brand-logo" aria-hidden="true">
              ORM
            </div>
            <h1 className="brand">Online Reputation Management</h1>
          </div>
          <nav className="side-menu" aria-label="Left menu">
            {MENU_ITEMS.map((item) => (
              <button key={item.label} className="menu-item" type="button" aria-label={item.label}>
                <span className="menu-icon" aria-hidden="true">
                  {item.icon}
                </span>
              </button>
            ))}
            <button
              className="menu-item"
              type="button"
              aria-label={bearerToken ? 'Logout' : 'Login'}
              onClick={() => {
                if (bearerToken) {
                  handleLogout();
                  return;
                }
                setShowLoginPage(true);
              }}
            >
              <span className="menu-icon" aria-hidden="true">
                {bearerToken ? '🚪' : '🔐'}
              </span>
            </button>
          </nav>
        </aside>

        <div className="workspace">
          {showLoginPage ? (
            <main className="login-page">
              <section className="login-card" aria-label="Login page">
                <h2>Welcome back</h2>
                <p>Enter your auth key to continue to ReviewLens AI.</p>
                <form onSubmit={(event) => void handleAuthenticate(event)} className="login-form">
                  <label className="context-label" htmlFor="authKeyInput">
                    Auth Key
                  </label>
                  <input
                    id="authKeyInput"
                    className="context-input"
                    value={authKey}
                    onChange={(event) => setAuthKey(event.target.value)}
                    placeholder="Enter auth key"
                  />
                  <button className="load-btn login-btn" type="submit" disabled={authenticating}>
                    {authenticating ? 'Authenticating...' : 'Login'}
                  </button>
                </form>
                {authError && <p className="error-note">{authError}</p>}
              </section>
            </main>
          ) : (
            <main className="main-pane">
              <div className="main-content">
                <div className="left-column">
                  <div className="app-header">
                    <div className="brand-wrap-main">
                      <div className="brand-logo-main" aria-hidden="true">
                        ORM
                      </div>
                      <h1 className="brand-main">Online Reputation Management</h1>
                    </div>
                  </div>

                  <section className="context-pane" aria-label="Review context">
                    <div className="section-header">
                      <h2>Context</h2>
                      <p>Paste reviews text/CSV or a supported review URL to set active context.</p>
                    </div>
                    <div className="context-form context-form-row">
                      <textarea
                        id="reviewsInput"
                        className="reviews-textbox"
                        value={reviewsInput}
                        onChange={(event) => setReviewsInput(event.target.value)}
                        placeholder={
                          'Enter Amazon or Google URL (e.g., https://www.amazon.com/dp/B0EXAMPLE12 or https://maps.app.goo.gl/exampleBusinessLink), or paste reviews in raw text / CSV format'
                        }
                      />
                      <button
                        className="load-btn"
                        type="button"
                        onClick={() => void handleSetContext()}
                        disabled={ingesting}
                      >
                        {ingesting ? 'Setting context...' : 'Set context'}
                      </button>
                    </div>
                    {contextError && <p className="error-note">{contextError}</p>}
                    {contextSummary && (
                      <p className="status-note">
                        Context active: {contextSummary.review_count} reviews, dataset id{' '}
                        <code>{contextSummary.dataset_id}</code>
                      </p>
                    )}
                  </section>

                <section className="chat-pane" aria-label="Chat window">
                  <div className="chat-title">
                    <h2>ReviewLens AI</h2>
                    <p>Ask focused questions about the active context.</p>
                  </div>
                  <div className="chat-history" ref={chatHistoryRef}>
                    {messages.map((message, index) => (
                      <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
                        <span className="bubble-role">
                          {message.role === 'user' ? 'You' : 'Assistant'}
                          <span className="bubble-meta"> · {formatLocalTimestamp(message.timestamp)}</span>
                        </span>
                        <span className="bubble-text">{message.text}</span>
                      </div>
                    ))}
                    {chatBusy && (
                      <div className="chat-bubble assistant thinking-bubble" aria-live="polite">
                        <span className="bubble-role">
                          Assistant
                          <span className="bubble-meta"> · {formatLocalTimestamp(new Date().toISOString())}</span>
                        </span>
                        <span className="thinking-row">
                          Thinking
                          <span className="thinking-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                  <form className="chat-input-row" onSubmit={(event) => void handleSendMessage(event)}>
                    <label className="sr-only" htmlFor="chatInput">
                      Chat message
                    </label>
                    <input
                      id="chatInput"
                      className="chat-input"
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Ask about the context reviews..."
                      disabled={chatBusy}
                    />
                    <button className="send-btn" type="submit" disabled={chatBusy}>
                      Send
                    </button>
                  </form>
                </section>
              </div>

              <aside className="analytics-pane" aria-label="Context analytics">
                <div className="analytics-header">
                  <h2>Analytics</h2>
                  <p>Snapshot from the currently active context.</p>
                </div>

                {contextSummary ? (
                  <div className="analytics-content">
                    <div className="analytics-card">
                      <h3>Overview</h3>
                      <dl className="analytics-list">
                        <div>
                          <dt>Entity</dt>
                          <dd>{contextSummary.entity_name || 'Unknown'}</dd>
                        </div>
                        <div>
                          <dt>Platform</dt>
                          <dd>{contextSummary.platform || 'Not specified'}</dd>
                        </div>
                        <div>
                          <dt>Source type</dt>
                          <dd>{contextSourceType}</dd>
                        </div>
                        <div>
                          <dt>Total reviews</dt>
                          <dd>{contextSummary.review_count}</dd>
                        </div>
                        {contextSummary.first_review_date && contextSummary.last_review_date && (
                          <div>
                            <dt>Date range</dt>
                            <dd>
                              {contextSummary.first_review_date} - {contextSummary.last_review_date}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    <div className="analytics-card">
                      <h3>Ratings</h3>
                      <div className="rating-value">
                        {normalizedAverageRating !== null
                          ? `${normalizedAverageRating.toFixed(1)} / 5`
                          : 'No rating data'}
                      </div>
                      <div className="rating-track" aria-hidden="true">
                        <div className="rating-fill" style={{ width: `${averageRatingPercent}%` }} />
                      </div>
                      <div className="rating-meta">
                        {ratingCount !== null
                          ? `${ratingCount} rated reviews${ratingCoveragePercent !== null ? ` (${ratingCoveragePercent}% coverage)` : ''}`
                          : 'Rating count unavailable'}
                      </div>
                    </div>

                    <div className="analytics-card">
                      <h3>Demographics</h3>
                      <p className="analytics-muted">
                        Gender/age split is not available in current ingest response.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="analytics-empty">
                    Set context first to see platform, review volume, rating trend, and demographic placeholders.
                  </div>
                )}
              </aside>
            </div>
            </main>
          )}
        </div>
      </div>
      <footer className="version-footer">
        Swami Krishnamoorthy's Demo Project |Front v{frontVersion} | Chat-AI v{chatVersion}
      </footer>
    </div>
  );
}

export default App;
