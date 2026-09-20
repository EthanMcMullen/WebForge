"use client";

const refreshPresets = [
  { label: "15 min", value: "15" },
  { label: "Hourly", value: "60" },
  { label: "Every 6h", value: "360" },
  { label: "Daily", value: "1440" },
  { label: "Weekly", value: "10080" },
];

export function RefreshScheduleEditor({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const automatic = value !== "";
  return <div className="refresh-schedule-editor">
    <div className="input-label">Refresh mode<span>Manual runs never happen without your click</span></div>
    <div className="refresh-mode-options" role="group" aria-label="Refresh mode">
      <button type="button" className={!automatic ? "active" : ""} onClick={() => onChange("")}><strong>Manual</strong><small>Refresh only when requested</small></button>
      <button type="button" className={automatic ? "active" : ""} onClick={() => onChange(value || "60")}><strong>Automatic</strong><small>Run on a repeating schedule</small></button>
    </div>
    {automatic && <div className="refresh-automatic-options">
      <div className="refresh-presets" aria-label="Refresh interval presets">
        {refreshPresets.map((preset) => <button type="button" key={preset.value} className={value === preset.value ? "active" : ""} onClick={() => onChange(preset.value)}>{preset.label}</button>)}
      </div>
      <label className="input-label" htmlFor={id}>Custom interval<span>Minutes, minimum 15</span></label>
      <input id={id} className="text-input interval-input" type="number" min="15" max="525600" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>}
  </div>;
}
