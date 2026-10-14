// Where the page says why there is nothing to show, or that what is shown is out of date: above the chapter
// row, on every chapter, so the reader never meets a blank or an unmarked stale figure. It took this job over
// from the front-page band, which the Overview replaced; with an analysis on screen and nothing wrong it
// renders nothing at all.
import type { Analysis, LoadState } from "../types.ts";
import "./Status.css";

export interface StatusProps {
  analysis: LoadState<Analysis>;
  /** The last request's failure, when it failed: its message is the app's. */
  failure: { message: string } | null;
}

export default function Status({ analysis, failure }: StatusProps) {
  if (analysis.status === "ready") {
    return failure ? (
      <p className="status-alert" role="alert">
        Not updated: {failure.message} The figures below are still for the previous settings.
      </p>
    ) : null;
  }
  if (failure) {
    return (
      <p className="status-alert" role="alert">
        The analysis could not be built. {failure.message}
      </p>
    );
  }
  if (analysis.status === "error") {
    return (
      <p className="status-alert" role="alert">
        {analysis.name} failed: {analysis.message}
      </p>
    );
  }
  return (
    <p className="status-wait" role="status">
      {analysis.status === "empty" ? analysis.reason : "Loading prices."}
    </p>
  );
}
