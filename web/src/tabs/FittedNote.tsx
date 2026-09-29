// One note beside the three portfolios: the figures a review like this prints are in-sample, and where
// to read what happened when the weights were chosen first and held afterwards. The link goes to the
// method card on masonjbennett.com, the one place the out-of-sample result is published.
import { PUBLISHED_URL } from "../content/published.ts";

export default function FittedNote({ className }: { className: string }) {
  return (
    <p className={className} data-note="in-sample">
      Portfolio reviews like this one print in-sample figures: GMV and Tangency are scored on the same prices their weights were
      chosen with. <a href={PUBLISHED_URL}>The walk-forward test</a> checked what happened next, choosing weights on earlier
      prices and holding them over later ones.
    </p>
  );
}
