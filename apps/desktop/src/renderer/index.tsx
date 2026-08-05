import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// nothing previously caught a render-time crash in App — one throw meant a blank/black window with no
// error message and no way back short of a force-quit. This is the single most likely thing standing
// between "something broke" and "the app just doesn't come up," so it gets a real fallback UI.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('AllieMinate renderer crashed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', gap: 14, padding: 40, textAlign: 'center', color: '#f4f4f5',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>AllieMinate hit an error and couldn't load</div>
        <div style={{ fontSize: 12, opacity: 0.6, maxWidth: 480, fontFamily: 'ui-monospace, monospace' }}>
          {this.state.error.message}
        </div>
        <button
          onClick={() => location.reload()}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', background: '#3a5fe0', color: '#fff',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
