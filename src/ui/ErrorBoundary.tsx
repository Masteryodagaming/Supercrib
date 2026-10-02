import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Catches render errors so a blank screen becomes a readable stack dump.
 * Does not alter game rules.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    console.error('SUPERCRIB ErrorBoundary', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const stack = error.stack || String(error);
    const componentStack = info?.componentStack ?? '';

    return (
      <div
        className="error-boundary"
        role="alert"
        style={{
          minHeight: '100vh',
          padding: '1.25rem',
          background: '#1a0a0a',
          color: '#f5d0d0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '13px',
          lineHeight: 1.45,
          overflow: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <h1 style={{ color: '#ff8a8a', marginTop: 0, fontSize: '1.25rem' }}>
          SUPERCRIB crashed
        </h1>
        <p style={{ marginBottom: '0.75rem' }}>
          <strong>{error.name}:</strong> {error.message}
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#0d0505',
            border: '1px solid #5a2020',
            borderRadius: 8,
            padding: '0.85rem',
            margin: '0 0 1rem',
          }}
        >
          {stack}
        </pre>
        {componentStack ? (
          <>
            <h2 style={{ fontSize: '1rem', color: '#ffb0b0' }}>Component stack</h2>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: '#0d0505',
                border: '1px solid #5a2020',
                borderRadius: 8,
                padding: '0.85rem',
                margin: 0,
              }}
            >
              {componentStack}
            </pre>
          </>
        ) : null}
        <button
          type="button"
          style={{
            marginTop: '1.25rem',
            padding: '0.65rem 1rem',
            borderRadius: 8,
            border: '1px solid #8a4040',
            background: '#3a1515',
            color: '#ffe0e0',
            cursor: 'pointer',
          }}
          onClick={() => {
            this.setState({ error: null, info: null });
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
