import React from 'react';

/**
 * Keeps one broken view from blanking the whole page: shows what failed and a way out instead.
 * Give it a `resetKey` (the open view) so moving to another view tries again.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error, info) {
    console.error('View failed to render', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="panel crash" role="alert">
        <div className="panel-body">
          <p className="kicker">Signal lost</p>
          <h2>This page hit an error</h2>
          <p className="note">The rest of the app still works: switch to another view, or reload the page. If it keeps happening, the link in the address bar holds your setup, so you can share it in a bug report.</p>
          <pre className="crash-detail">{String(error && error.message || error)}</pre>
          <div className="seg">
            <button type="button" className="ghost small" onClick={() => this.setState({ error: null })}>Try again</button>
            <button type="button" className="ghost small" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </section>
    );
  }
}
