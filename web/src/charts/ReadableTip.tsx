// Recharts' own hover box, with every row readable on paper. Its default content writes each row in
// the series' colour (entry.color, over any itemStyle), so a Tangency row is bronze text at 12px: 3.6:1
// on paper, under WCAG AA's 4.5:1. This passes each row's colour through labelFill (./contrast.ts)
// and draws the default box otherwise unchanged. Pass it as <Tooltip content={ReadableTip} />.
import type { ReactNode } from "react";
import { DefaultTooltipContent, type TooltipContentProps } from "recharts";
import { labelFill } from "./contrast.ts";

export function ReadableTip(props: TooltipContentProps): ReactNode {
  const payload = props.payload?.map((e) => (typeof e.color === "string" ? { ...e, color: labelFill(e.color) } : e));
  return <DefaultTooltipContent {...props} payload={payload} />;
}
