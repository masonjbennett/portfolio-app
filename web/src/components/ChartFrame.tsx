// A chart's frame: a title that states the finding, an optional subtitle, and the chart's own
// loading, empty and error states. It fails closed: the chart is drawn only from a "ready" value, and
// a throw while drawing replaces the whole chart with the named error line, so a half-drawn chart
// never reaches the page. (In the app one st.stop() or exception ends the script, and every chart
// after it on the page goes with it.)
//
// A chart may carry one control of its own in the head, under the subtitle (the starting amount on a
// growth chart): it sits outside the drawing's boundary, so a chart that fails to draw keeps it.
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { ChartFrameProps } from "../types.ts";
import "./ChartFrame.css";

const DEFAULT_HEIGHT = 320;

type Props<T> = ChartFrameProps<T> & {
  /** A control that acts on this chart, drawn in the head under the subtitle. */
  control?: ReactNode;
};

type NoteKind = "loading" | "empty" | "error";
const NOTE_ROLE: Record<NoteKind, "status" | "alert" | undefined> = { loading: "status", empty: undefined, error: "alert" };

// Exported for App's loading line while a tab's chunk arrives, so it reads like a chart's own.
export function ChartNote({ height, kind, children }: { height: number; kind: NoteKind; children: ReactNode }) {
  return (
    <p className={`chart-note chart-note--${kind}`} style={{ minHeight: height }} role={NOTE_ROLE[kind]}>
      <span>{children}</span>
    </p>
  );
}

function Failed({ name, message, height }: { name: string; message: string; height: number }) {
  return (
    <ChartNote height={height} kind="error">
      Chart not drawn: <span className="chart-note-name">{name}</span> failed. {message}
    </ChartNote>
  );
}

// Calls the draw function inside the boundary below, so a throw from it is caught there and not in
// ChartFrame's own render, above the boundary.
function Plot<T>({ draw, value }: { draw: (value: T) => ReactNode; value: T }) {
  return <>{draw(value)}</>;
}

interface DrawProps {
  title: string;
  height: number;
  value: unknown;
  children: ReactNode;
}

class Draw extends Component<DrawProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`chart "${this.props.title}" failed to draw:`, error, info.componentStack);
  }

  // A new value is a new chart: try drawing again.
  componentDidUpdate(prev: DrawProps) {
    if (this.state.error && prev.value !== this.props.value) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (error) return <Failed name="the drawing" message={error.message} height={this.props.height} />;
    return this.props.children;
  }
}

export default function ChartFrame<T>({ title, state, children, subtitle, height = DEFAULT_HEIGHT, control }: Props<T>) {
  let body: ReactNode;
  switch (state.status) {
    case "loading":
      body = <ChartNote height={height} kind="loading">Loading</ChartNote>;
      break;
    case "empty":
      body = <ChartNote height={height} kind="empty">{state.reason}</ChartNote>;
      break;
    case "error":
      body = <Failed name={state.name} message={state.message} height={height} />;
      break;
    case "ready":
      body = (
        <Draw title={title} height={height} value={state.value}>
          <Plot draw={children} value={state.value} />
        </Draw>
      );
      break;
  }
  return (
    <figure className="chart-frame" aria-busy={state.status === "loading" || undefined}>
      <figcaption className="chart-head">
        <h3 className="chart-title">{title}</h3>
        {subtitle ? <p className="chart-sub">{subtitle}</p> : null}
        {control ? <div className="chart-control">{control}</div> : null}
      </figcaption>
      <div className="chart-body">{body}</div>
    </figure>
  );
}
