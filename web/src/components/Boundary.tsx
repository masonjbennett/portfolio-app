// An error boundary around one card. A throw while the card renders replaces THAT card with one quiet
// line naming it; the rail, the band and every other card keep rendering.
//
// The app has no equivalent. A failed optimisation calls st.stop() (portfolio_app.py 1483, 1727),
// which ends the script run: every later element of the page, including the tabs after the one that
// failed, is never drawn. Here the failure stays inside the card that failed.
//
// It fails closed: the page shows the card's name and nothing else. The error's message and stack go
// to the console, never the page; a message can quote upstream data, and a stack is not something to
// print for a reader. React 18 has no hook for this, hence a class.
//
// Limits: a boundary catches what its CHILDREN throw while rendering. It does not catch event
// handlers, timers or rejected promises, and it does not catch a throw in the component that renders
// it, so fed data is read inside the boundary's children, never in the parent's own render.
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { BoundaryProps } from "../types.ts";
import "./Boundary.css";

interface State {
  /** Its own flag because `throw null` is legal: keyed on the error, a falsy throw would not stick. */
  failed: boolean;
  /** The resetKey this state belongs to. */
  key: unknown;
}

export default class Boundary extends Component<BoundaryProps, State> {
  state: State = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  // A new resetKey clears the failure in the same render, so the card tries again with no flash of
  // the fallback. The same key keeps the fallback: re-rendering with the input that threw would throw.
  static getDerivedStateFromProps(props: BoundaryProps, state: State): Partial<State> | null {
    return Object.is(props.resetKey, state.key) ? null : { failed: false, key: props.resetKey };
  }

  // Never silent: React logs the error too, but without the card's name, and the name says where to look.
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[boundary] ${this.props.name} threw while rendering and was replaced by one line`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p className="boundary" role="status">
        {this.props.name} could not be shown.
      </p>
    );
  }
}
