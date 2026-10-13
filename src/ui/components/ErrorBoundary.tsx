import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReset: () => void;
}

interface State {
  error: Error | null;
}

/** Catches unexpected UI errors so a bug never wipes the screen without explanation. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('EasyBeat Studio crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <h1>Something went wrong</h1>
          <p>
            EasyBeat hit an unexpected error. Your project was auto-saved a moment ago, so going back to the home
            screen and reopening it is usually enough.
          </p>
          <pre>{this.state.error.message}</pre>
          <button
            className="btn primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset();
            }}
          >
            Back to home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
