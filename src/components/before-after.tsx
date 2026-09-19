"use client";

import { useCallback, useRef, useState } from "react";

const filledApis = [
  { name: "Espresso prices", status: "Ready", dot: "ready", meta: "Ready · 48 records" },
  { name: "Hackathon directory", status: "Ready", dot: "ready", meta: "Ready · 86 records" },
  { name: "Ramen menu monitor", status: "Partial data", dot: "partial", meta: "Partial data · 412 records" },
  { name: "GPU watch", status: "Discovering", dot: "queued", meta: "Discovering · 0 records" },
];

const runBars = [
  { h: 38, c: "moss" },
  { h: 55, c: "moss" },
  { h: 44, c: "moss" },
  { h: 70, c: "moss" },
  { h: 62, c: "ochre" },
  { h: 88, c: "moss" },
  { h: 76, c: "moss" },
  { h: 95, c: "moss" },
  { h: 82, c: "moss" },
  { h: 100, c: "accent" },
];

const trendPoints = "0,26 15,24 30,25 45,20 60,21 75,15 90,16 105,10 120,12";

function DashboardMock({ filled }: { filled: boolean }) {
  return (
    <div className="compare-dash">
      <div className="dashboard-stats compare-dash-stats" aria-hidden="true">
        <div className="stat-card"><span>APIs</span><strong>{filled ? "12" : "0"}</strong><small>{filled ? "9 ready" : "none yet"}</small></div>
        <div className="stat-card"><span>Records stored</span><strong>{filled ? "1,284" : "0"}</strong><small>{filled ? "+212 this week" : "Nothing stored"}</small></div>
        <div className="stat-card"><span>Runs active</span><strong>{filled ? "2" : "0"}</strong><small>{filled ? "Updating now" : "Idle"}</small></div>
      </div>

      <div className="panel compare-analytics" aria-hidden="true">
        <div className="dashboard-heading">
          <div><p className="section-kicker">Analytics</p><h2>Last 10 runs</h2></div>
          <div className="analytics-legend">
            <span><i className="legend-dot moss" />Ready</span>
            <span><i className="legend-dot ochre" />Partial</span>
            <span><i className="legend-dot accent" />Latest</span>
          </div>
        </div>
        <div className="analytics-body">
          <svg className="analytics-bars" viewBox="0 0 200 110" role="img" aria-label="Records saved per run">
            {[0, 1, 2, 3].map((line) => (
              <line key={line} x1="0" x2="200" y1={12 + line * 26} y2={12 + line * 26} className="analytics-gridline" />
            ))}
            {runBars.map((bar, i) => (
              <rect
                key={i}
                x={6 + i * 19.5}
                y={104 - bar.h}
                width="13"
                height={bar.h}
                rx="2"
                className={filled ? `bar-${bar.c}` : "bar-empty"}
              />
            ))}
          </svg>
          <div className="analytics-side">
            <div className="analytics-delta"><span>Avg price · 7d</span><strong>{filled ? "$412.30" : "—"}</strong></div>
            <svg className="analytics-spark" viewBox="0 0 120 32" role="img" aria-label="Price trend">
              <polyline points={trendPoints} className={filled ? "spark-line" : "spark-empty"} />
              {filled && <circle cx="120" cy="12" r="2.5" className="spark-dot" />}
            </svg>
            <div className="analytics-mix">
              <span><i className="legend-dot moss" />{filled ? "8 ready" : "—"}</span>
              <span><i className="legend-dot ochre" />{filled ? "1 partial" : "—"}</span>
              <span><i className="legend-dot kiln" />{filled ? "1 failed" : "—"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid compare-dash-grid" aria-hidden="true">
        <div className="dashboard-panel panel">
          <div className="dashboard-heading"><div><p className="section-kicker">Recent</p><h2>Latest APIs</h2></div></div>
          {filled ? (
            <div className="activity-list">
              {filledApis.map((job) => (
                <div key={job.name} className="activity-item">
                  <span className={`activity-dot ${job.dot}`} />
                  <span><strong>{job.name}</strong><small>{job.meta}</small></span>
                </div>
              ))}
            </div>
          ) : (
            <div className="activity-list">
              {["a", "b", "c", "d"].map((key) => (
                <div key={key} className="activity-item">
                  <span className="activity-dot skel-dot" />
                  <span className="skel-lines"><span className="skel-line wide" /><span className="skel-line" /></span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-panel panel">
          <div className="dashboard-heading"><div><p className="section-kicker">Data</p><h2>Records</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Price</th><th>Availability</th></tr></thead>
              <tbody>
                {(filled
                  ? [
                    ["Espresso machine, entry", "$449.00", "In stock"],
                    ["Mechanical keyboard, 75%", "$129.00", "Low stock"],
                    ["4K monitor, 27 in", "$329.99", "Out of stock"],
                    ["Golden Delicious, 3 lb bag", "$3.49", "In stock"],
                  ]
                  : [
                    ["—", "—", "—"],
                    ["—", "—", "—"],
                    ["—", "—", "—"],
                    ["—", "—", "—"],
                  ]
                ).map((row, i) => (
                  <tr key={i} className={filled ? undefined : "skel-row"}>
                    <td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BeforeAfter() {
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = useCallback((clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, Math.round(pct))));
  }, []);

  return (
    <section className="panel compare" aria-label="Before and after WebForge">
      <div className="compare-head">
        <div>
          <p className="section-kicker">Before / after</p>
          <h2>Drag the line. Watch the dashboard fill.</h2>
          <p>Same dashboard on both sides — left is empty, right is filled after a run.</p>
        </div>
        <span className="status-pill sample">GET /records</span>
      </div>

      <div
        ref={stageRef}
        className={"compare-stage" + (dragging ? " dragging" : "")}
        tabIndex={0}
        role="slider"
        aria-label="Reveal before or after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pos}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); setPos((p) => Math.max(0, p - 4)); }
          else if (event.key === "ArrowRight") { event.preventDefault(); setPos((p) => Math.min(100, p + 4)); }
          else if (event.key === "Home") { event.preventDefault(); setPos(0); }
          else if (event.key === "End") { event.preventDefault(); setPos(100); }
        }}
        onPointerDown={(event) => {
          setDragging(true);
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          updateFromClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging) updateFromClientX(event.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        {/* BEFORE — same dashboard, empty */}
        <div className="compare-layer compare-before">
          <div className="compare-tag compare-tag-before">Before — empty</div>
          <DashboardMock filled={false} />
        </div>

        {/* AFTER — same dashboard, filled */}
        <div className="compare-layer compare-after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
          <div className="compare-tag compare-tag-after">After — filled</div>
          <DashboardMock filled />
        </div>

        {/* Divider handle */}
        <div className="compare-divider" style={{ left: `${pos}%` }} aria-hidden="true">
          <span className="compare-handle">⇔</span>
        </div>
      </div>
    </section>
  );
}
