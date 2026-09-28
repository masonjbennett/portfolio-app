// The rolling pairwise correlation (portfolio_app.py 1441-1458): two assets and a window, and the
// correlation of their daily returns over each trailing window, drawn as one line on a fixed -1 to +1
// scale. The high, the low and the latest value are labelled on the line itself.
//
// The app's two selectboxes open on the first and second assets and its slider on 60 (1444-1448); the
// same choices open here. Two identical assets give the app's st.info (1458) in the chart's place.
import { useId, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import ChartFrame from "../../components/ChartFrame.tsx";
import SegControl from "../../components/SegControl.tsx";
import { axisProps, DASH, gridProps, tooltipProps } from "../../charts/theme.ts";
import { pointLabel } from "../../charts/labels.ts";
import { ReadableTip } from "../../charts/ReadableTip.tsx";
import { format } from "../../format.ts";
import { tokens } from "../../styles/tokens.ts";
import type { Analysis } from "../../types.ts";
import { DEFAULT_WINDOW, defaultPair, rollSubtitle, rollTitle, rollView, WINDOWS, type RollView, type RollWindow } from "./model.ts";

const HEIGHT = 380; // the app's style_chart(fig_rc, height=380) (1455)
// The app draws the line in COLORS["secondary"] (1453), its blue, which the brand maps to navy.
const LINE = tokens.color.navy;

const WINDOW_OPTIONS = WINDOWS.map((w) => ({ value: String(w) as `${RollWindow}`, label: `${w} days` }));
const TICKS = [-1, -0.5, 0, 0.5, 1];

export default function Rolling({ analysis }: { analysis: Analysis }) {
  const { tickers } = analysis;
  const [pickA, pickB] = defaultPair(tickers);
  const [selA, setA] = useState(pickA);
  const [selB, setB] = useState(pickB);
  const [win, setWin] = useState<RollWindow>(DEFAULT_WINDOW);
  // A new analysis may no longer hold the assets chosen before it; fall back to the app's defaults.
  const a = tickers.includes(selA) ? selA : pickA;
  const b = tickers.includes(selB) ? selB : pickB;
  const state = rollView(analysis, a, b, win);
  const id = useId();

  return (
    <div className="corr-roll">
      <div className="corr-controls">
        <label className="corr-field" htmlFor={`${id}-a`}>
          <span>Asset A</span>
          <select id={`${id}-a`} value={a} onChange={(e) => setA(e.target.value)}>
            {tickers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="corr-field" htmlFor={`${id}-b`}>
          <span>Asset B</span>
          <select id={`${id}-b`} value={b} onChange={(e) => setB(e.target.value)}>
            {tickers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="corr-field">
          <span id={`${id}-w`}>Window</span>
          <SegControl
            options={WINDOW_OPTIONS}
            value={String(win) as `${RollWindow}`}
            onChange={(v) => setWin(Number(v) as RollWindow)}
            ariaLabel="Rolling window, in trading days"
          />
        </div>
      </div>
      <ChartFrame
        title={state.status === "ready" ? rollTitle(state.value) : `${win}-day rolling correlation`}
        subtitle={state.status === "ready" ? rollSubtitle(state.value) : undefined}
        state={state}
        height={HEIGHT}
      >
        {(v) => <RollChart v={v} />}
      </ChartFrame>
    </div>
  );
}

function RollChart({ v }: { v: RollView }) {
  return (
    <LineChart
      responsive
      style={{ width: "100%", height: HEIGHT }}
      data={v.points}
      margin={{ top: 22, right: 88, bottom: 8, left: 0 }}
      accessibilityLayer
    >
      <CartesianGrid {...gridProps} />
      <XAxis dataKey="date" {...axisProps} minTickGap={48} tickFormatter={(d: string) => d.slice(0, 7)} />
      <YAxis {...axisProps} domain={[-1, 1]} ticks={TICKS} width={44} tickFormatter={(x: number) => format(x, "num2")} />
      <ReferenceLine y={0} stroke={tokens.color.hairline} strokeDasharray={DASH.reference} />
      <Tooltip
        {...tooltipProps("x")}
        content={ReadableTip}
        formatter={(x) => [format(typeof x === "number" ? x : null, "num3"), "Correlation"]}
        labelFormatter={(d) => format(String(d), "date")}
      />
      <Line type="linear" dataKey="r" stroke={LINE} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
      {v.marks.map((m) => (
        <ReferenceDot
          key={m.date}
          x={m.date}
          y={m.r}
          r={3}
          fill={LINE}
          stroke={tokens.color.paper}
          label={pointLabel(m.text, tokens.color.ink, m.side)}
        />
      ))}
    </LineChart>
  );
}
