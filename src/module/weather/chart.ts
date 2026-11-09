/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import { localize } from "../util";
import { getWeatherEffects, weatherRegion } from "./conditions";
import type { WeatherRegion } from "./conditions";

/**
 * The weather chart: temperature across and humidity up, each from -6 to +6 (0 is normal, each step
 * one severity), shaded by the conditions each point creates at the current wind. Used by the GM's
 * weather panel and a caster's Control Weather panel in place of two sliders.
 */

export interface ChartOptions {
  temperature: number;
  humidity: number;
  wind: number;
  /** Highest severity that can be picked (a caster's limit); 7 for the GM */
  max: number;
  /** The scene's weather now, marked when it differs from the pick (the caster's panel) */
  current?: { temperature: number; humidity: number } | null;
  /** Shown but not editable (players viewing the GM's panel) */
  readonly?: boolean;
}

const N = 13;
const MIN = -6;
const SIZE = 420;
const M = { l: 42, t: 10, r: 10, b: 40 };
const CELL = (SIZE - M.l - M.r) / N;
const NS = "http://www.w3.org/2000/svg";

/** Fill for each region: a colour, or a stripe pattern where snow and storm overlap */
const REGION_FILL: Record<WeatherRegion, { color: string; opacity: number; pattern?: string }> = {
  thundersnow: { color: "--pf1s-wx-storm", opacity: 1, pattern: "pf1s-wx-thundersnow" },
  snowstorm: { color: "--pf1s-wx-snow", opacity: 1, pattern: "pf1s-wx-snowstorm" },
  lightning: { color: "--pf1s-wx-storm", opacity: 0.62 },
  storm: { color: "--pf1s-wx-storm", opacity: 0.42 },
  flood: { color: "--pf1s-wx-flood", opacity: 0.42 },
  snow: { color: "--pf1s-wx-snow", opacity: 0.5 },
  rain: { color: "--pf1s-wx-wet", opacity: 0.38 },
  arid: { color: "--pf1s-wx-arid", opacity: 0.38 },
};

const xOf = (t: number) => M.l + (t - MIN) * CELL;
const yOf = (h: number) => M.t + (6 - h) * CELL;
const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/**
 * Draws the chart into a host element and calls back when a point is picked.
 *
 * @param host - The element to draw into (its contents are replaced)
 * @param opts - The point, wind and limit
 * @param onPick - Called with the picked temperature and humidity
 */
export const drawWeatherChart = (
  host: HTMLElement,
  opts: ChartOptions,
  onPick: (temperature: number, humidity: number) => void,
): void => {
  const style = getComputedStyle(host);
  const color = (v: string) => style.getPropertyValue(v).trim() || "#888";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("class", "pf1s-weather-chart");
  svg.setAttribute("tabindex", "0");
  svg.setAttribute("role", "application");
  svg.setAttribute("aria-label", localize("Weather.ChartLabel"));
  const el = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.appendChild(n);
    return n;
  };

  // Snow with a storm: storm stripes over the snow colour, so both read at once
  const defs = el("defs", {});
  for (const [id, opacity] of [
    ["pf1s-wx-snowstorm", 0.55],
    ["pf1s-wx-thundersnow", 0.85],
  ] as const) {
    const p = el(
      "pattern",
      { id, width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      defs,
    );
    el("rect", { width: 8, height: 8, fill: color("--pf1s-wx-snow"), "fill-opacity": 0.75 }, p);
    el(
      "rect",
      { width: 3.5, height: 8, fill: color("--pf1s-wx-storm"), "fill-opacity": opacity },
      p,
    );
  }

  const regionAt = (t: number, h: number) =>
    weatherRegion(getWeatherEffects({ temperature: t, humidity: h, wind: opts.wind }));
  const regions: (WeatherRegion | null)[][] = [];
  for (let h = MIN; h <= 6; h++) {
    regions[h - MIN] = [];
    for (let t = MIN; t <= 6; t++) regions[h - MIN][t - MIN] = regionAt(t, h);
  }
  const at = (t: number, h: number) => regions[h - MIN][t - MIN];
  const allowed = (t: number, h: number) =>
    Math.abs(t) + 1 <= opts.max && Math.abs(h) + 1 <= opts.max;

  // Cells: a temperature tint, the region fill, and a veil over cells beyond the limit
  for (let h = MIN; h <= 6; h++) {
    for (let t = MIN; t <= 6; t++) {
      const x = xOf(t);
      const y = yOf(h);
      el("rect", { x, y, width: CELL, height: CELL, fill: color("--pf1s-wx-cell") });
      if (t !== 0) {
        el("rect", {
          x,
          y,
          width: CELL,
          height: CELL,
          fill: color(t < 0 ? "--pf1s-wx-cold" : "--pf1s-wx-heat"),
          "fill-opacity": (0.08 + (0.32 * Math.abs(t)) / 6).toFixed(2),
        });
      }
      const r = at(t, h);
      if (r) {
        const f = REGION_FILL[r];
        el("rect", {
          x: x + 1,
          y: y + 1,
          width: CELL - 2,
          height: CELL - 2,
          rx: 3,
          fill: f.pattern ? `url(#${f.pattern})` : color(f.color),
          "fill-opacity": f.opacity,
        });
      }
      if (!allowed(t, h))
        el("rect", {
          x,
          y,
          width: CELL,
          height: CELL,
          fill: color("--pf1s-wx-veil"),
          "fill-opacity": 0.72,
        });
    }
  }

  // Region borders and the normal axes
  const edges = el("g", {
    stroke: color("--pf1s-wx-ink"),
    "stroke-opacity": 0.5,
    "stroke-width": 1.2,
  });
  for (let h = MIN; h <= 6; h++) {
    for (let t = MIN; t <= 6; t++) {
      if (t < 6 && at(t + 1, h) !== at(t, h))
        el("line", { x1: xOf(t + 1), y1: yOf(h), x2: xOf(t + 1), y2: yOf(h) + CELL }, edges);
      if (h > MIN && at(t, h - 1) !== at(t, h))
        el("line", { x1: xOf(t), y1: yOf(h) + CELL, x2: xOf(t) + CELL, y2: yOf(h) + CELL }, edges);
    }
  }
  el("rect", {
    x: M.l,
    y: M.t,
    width: N * CELL,
    height: N * CELL,
    fill: "none",
    stroke: color("--pf1s-wx-line"),
  });
  const mid = (v: number) => v + CELL / 2;
  el("line", {
    x1: mid(xOf(0)),
    y1: M.t,
    x2: mid(xOf(0)),
    y2: M.t + N * CELL,
    stroke: color("--pf1s-wx-muted"),
    "stroke-opacity": 0.4,
    "stroke-dasharray": "2 3",
  });
  el("line", {
    x1: M.l,
    y1: mid(yOf(0)),
    x2: M.l + N * CELL,
    y2: mid(yOf(0)),
    stroke: color("--pf1s-wx-muted"),
    "stroke-opacity": 0.4,
    "stroke-dasharray": "2 3",
  });

  // Region names at each region's centre
  const sums: Partial<Record<WeatherRegion, [number, number, number]>> = {};
  for (let h = MIN; h <= 6; h++) {
    for (let t = MIN; t <= 6; t++) {
      const r = at(t, h);
      if (!r) continue;
      const s = (sums[r] ??= [0, 0, 0]);
      s[0] += t;
      s[1] += h;
      s[2]++;
    }
  }
  for (const [r, [st, sh, n]] of Object.entries(sums) as [
    WeatherRegion,
    [number, number, number],
  ][]) {
    const label = el("text", {
      x: mid(xOf(st / n)),
      y: mid(yOf(sh / n)) + 4,
      "text-anchor": "middle",
      class: "pf1s-wx-region",
      fill: color("--pf1s-wx-ink"),
      stroke: color("--pf1s-wx-cell"),
    });
    label.textContent = localize(`Weather.Region.${r}`);
  }

  // Ticks and axis names
  for (let v = MIN; v <= 6; v++) {
    el("text", {
      x: mid(xOf(v)),
      y: M.t + N * CELL + 12,
      "text-anchor": "middle",
      class: "pf1s-wx-tick",
      fill: color("--pf1s-wx-muted"),
    }).textContent = signed(v);
    el("text", {
      x: M.l - 6,
      y: mid(yOf(v)) + 3,
      "text-anchor": "end",
      class: "pf1s-wx-tick",
      fill: color("--pf1s-wx-muted"),
    }).textContent = signed(v);
  }
  const axis = (text: string, attrs: Record<string, string | number>) =>
    (el("text", { class: "pf1s-wx-axis", fill: color("--pf1s-wx-muted"), ...attrs }).textContent =
      text);
  axis(`◀ ${localize("Weather.Cold")}`, { x: M.l, y: SIZE - 8 });
  axis(localize("Weather.Temperature"), {
    x: M.l + (N * CELL) / 2,
    y: SIZE - 8,
    "text-anchor": "middle",
  });
  axis(`${localize("Weather.Heat")} ▶`, { x: M.l + N * CELL, y: SIZE - 8, "text-anchor": "end" });
  const cy = M.t + (N * CELL) / 2;
  axis(
    `${localize("Weather.Aridity")} ◀ ${localize("Weather.Humidity")} ▶ ${localize("Weather.Precipitation")}`,
    {
      x: 11,
      y: cy,
      "text-anchor": "middle",
      transform: `rotate(-90 11 ${cy})`,
    },
  );

  // The scene's weather now (when the pick differs) and the picked point
  const cur = opts.current;
  if (cur && (cur.temperature !== opts.temperature || cur.humidity !== opts.humidity)) {
    el("rect", {
      x: xOf(cur.temperature) + 3,
      y: yOf(cur.humidity) + 3,
      width: CELL - 6,
      height: CELL - 6,
      rx: 4,
      fill: "none",
      stroke: color("--pf1s-wx-ink"),
      "stroke-width": 1.5,
      "stroke-dasharray": "3 2",
    });
  }
  const marker = el("g", {});
  const place = (t: number, h: number) => {
    marker.replaceChildren();
    el(
      "circle",
      {
        cx: mid(xOf(t)),
        cy: mid(yOf(h)),
        r: CELL * 0.36,
        fill: "none",
        stroke: color("--pf1s-wx-ink"),
        "stroke-width": 2.5,
      },
      marker,
    );
    el(
      "circle",
      { cx: mid(xOf(t)), cy: mid(yOf(h)), r: 3.5, fill: color("--pf1s-wx-ink") },
      marker,
    );
  };
  place(opts.temperature, opts.humidity);

  if (opts.readonly) {
    svg.setAttribute("aria-readonly", "true");
    svg.classList.add("readonly");
    host.replaceChildren(svg);
    return;
  }

  // Picking: drag moves the marker, releasing picks; arrow keys step
  let pick = { t: opts.temperature, h: opts.humidity };
  const cellAt = (ev: PointerEvent) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    const t = Math.floor((p.x - M.l) / CELL) + MIN;
    const h = 6 - Math.floor((p.y - M.t) / CELL);
    return t >= MIN && t <= 6 && h >= MIN && h <= 6 && allowed(t, h) ? { t, h } : null;
  };
  let dragging = false;
  svg.addEventListener("pointerdown", (ev) => {
    const c = cellAt(ev);
    if (!c) return;
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    pick = c;
    place(c.t, c.h);
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const c = cellAt(ev);
    if (c && (c.t !== pick.t || c.h !== pick.h)) {
      pick = c;
      place(c.t, c.h);
    }
  });
  svg.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    if (pick.t !== opts.temperature || pick.h !== opts.humidity) onPick(pick.t, pick.h);
  });
  svg.addEventListener("keydown", (ev) => {
    const d = (
      { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<
        string,
        number[]
      >
    )[ev.key];
    if (!d) return;
    ev.preventDefault();
    const t = Math.max(MIN, Math.min(6, pick.t + d[0]));
    const h = Math.max(MIN, Math.min(6, pick.h + d[1]));
    if (!allowed(t, h)) return;
    onPick(t, h);
  });

  host.replaceChildren(svg);
};

/**
 * Wires a panel's chart: draws it into [data-weather-chart] and, on a pick, writes the hidden
 * temperature and humidity inputs and submits the form as a slider change would.
 *
 * @param root - The window element
 * @param opts - The chart's options
 */
export const mountWeatherChart = (root: HTMLElement, opts: ChartOptions): void => {
  const host = root.querySelector<HTMLElement>("[data-weather-chart]");
  if (!host) return;
  drawWeatherChart(host, opts, (t, h) => {
    const temp = root.querySelector<HTMLInputElement>('input[name="temperature"]');
    const hum = root.querySelector<HTMLInputElement>('input[name="humidity"]');
    if (!temp || !hum) return;
    temp.value = String(t);
    hum.value = String(h);
    hum.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
