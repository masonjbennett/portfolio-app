// One note beside the three portfolios: the figures a review like this prints are in-sample, and where
// to read what happened when the weights were chosen first and held afterwards. Inside the page the words
// "The walk-forward test" open the Walk-forward tab on the published test, replayed from the weights it
// held, and the method card on masonjbennett.com stays one click further, from that tab. Rendered on its
// own, outside the page, the words link to the method card instead, so they always go somewhere.
import { useContext } from "react";
import { PUBLISHED_URL } from "../content/published.ts";
import { TabContext } from "../state/useWorkbench.ts";

export default function FittedNote({ className }: { className: string }) {
  const page = useContext(TabContext);
  const test = page ? (
    <button
      type="button"
      className="text-button"
      title="Open the published test, replayed, in the Walk-forward tab"
      onClick={() => page.setTab("walkforward", "published", true)}
    >
      The walk-forward test
    </button>
  ) : (
    <a href={PUBLISHED_URL}>The walk-forward test</a>
  );
  return (
    <p className={className} data-note="in-sample">
      Portfolio reviews like this one print in-sample figures: GMV and Tangency are scored on the same prices their weights were
      chosen with. {test} checked what happened next, choosing weights on earlier prices and holding them over later ones.
    </p>
  );
}
