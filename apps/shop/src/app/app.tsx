import { FormEvent, useEffect, useRef, useState } from 'react';
import './app.css';

const MENU_ITEMS = ['About', 'Settings', 'Help'];
const localhostHostnames = new Set(['localhost', '127.0.0.1']);
const inferredApiOrigin = localhostHostnames.has(window.location.hostname)
  ? 'http://localhost:3333'
  : `${window.location.protocol}//${window.location.hostname}:3333`;
const apiOrigin = (import.meta.env.VITE_API_BASE_URL?.trim() || inferredApiOrigin).replace(
  /\/$/,
  '',
);

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiOrigin}${normalizedPath}`;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type IngestSummary = {
  dataset_id: string;
  platform: string;
  entity_name: string;
  source_summary?: string | null;
  review_count: number;
  average_rating: number | null;
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
    {
      role: 'assistant',
      text: 'Paste reviews (or an Amazon/Google URL) on the left, click "Set context", then ask questions here.',
    },
  ]);

  useEffect(() => {
    if (showLoginPage) {
      return;
    }
    const chatHistoryElement = chatHistoryRef.current;
    if (!chatHistoryElement) {
      return;
    }
    chatHistoryElement.scrollTop = chatHistoryElement.scrollHeight;
  }, [messages, showLoginPage]);

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
        {
          role: 'assistant',
          text: 'Authenticated successfully. You can now set context and chat.',
        },
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
        {
          role: 'assistant',
          text:
            payload.data.source_summary ??
            `Context set with ${payload.data.review_count} reviews for ${payload.data.entity_name}.`,
        },
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

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setChatInput('');
    if (!bearerToken) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Please login first.',
        },
      ]);
      return;
    }
    if (!datasetId) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Please set context first by providing reviews text/CSV or a review URL, then click "Set context".',
        },
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
        {
          role: 'assistant',
          text: `${payload.data.answer}${evidenceSuffix}`,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text:
            error instanceof Error
              ? `Chat failed: ${error.message}`
              : 'Chat failed due to an unexpected error.',
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-logo" aria-hidden="true">
            ORM
          </div>
          <h1 className="brand">Online Reputation Management</h1>
        </div>
        <nav className="topbar-menu" aria-label="Top menu">
          <button
            className="menu-pill"
            type="button"
            onClick={() => {
              if (bearerToken) {
                handleLogout();
                return;
              }
              setShowLoginPage(true);
            }}
          >
            {bearerToken ? 'Logout' : 'Login'}
          </button>
          {MENU_ITEMS.map((item) => (
            <button key={item} className="menu-pill" type="button">
              {item}
            </button>
          ))}
        </nav>
      </header>

      <div className="workspace">
        {showLoginPage ? (
          <main className="login-page">
            <section className="login-card" aria-label="Login page">
              <h2>Login</h2>
              <p>Enter auth key to get a bearer token.</p>
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
            <section className="context-pane" aria-label="Review context">
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
              <div className="chat-title">ReviewLens AI</div>
              <div className="chat-history" ref={chatHistoryRef}>
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`chat-bubble ${message.role}`}>
                    {message.text}
                  </div>
                ))}
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
                  {chatBusy ? 'Asking...' : 'Send'}
                </button>
              </form>
            </section>
          </main>
        )}
      </div>
      <footer className="version-footer">
        Front v{frontVersion} | Chat-AI v{chatVersion}
      </footer>
    </div>
  );
}

export default App;
