import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * BookingErrorBoundary — keeps a failure inside the booking flow from blanking
 * the whole page. A step that fails to render shows a recoverable message
 * instead of a dark screen, and clears as soon as the customer moves on
 * (the parent gives it a keyed instance per step).
 */
export default class BookingErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[booking] step failed to render', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Something went wrong on this step</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Please try again. Your details are still saved.
            </p>
            <p className="text-[10px] font-mono text-red-300/80 mt-2 break-words">
              {String(this.state.error?.message || this.state.error)}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-3 text-xs font-semibold text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted/50 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}