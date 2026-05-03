/** Reusable form-field shells used by all settings sections. */

import type { ReactNode } from "react";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{title}</h2>
      {hint && <p className="settings-section__hint">{hint}</p>}
      <div className="settings-section__body">{children}</div>
    </section>
  );
}

export function Field({
  label, hint, children,
}: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <label className="settings-field__label">
        {label}
        {hint && <span className="settings-field__hint">{hint}</span>}
      </label>
      <div className="settings-field__control">{children}</div>
    </div>
  );
}

export function ReadOnly({ value, mono }: { value: string | number | boolean; mono?: boolean }) {
  const display = typeof value === "boolean" ? (value ? "✓ 是" : "✗ 否") : String(value || "—");
  return (
    <span className={mono ? "settings-readonly settings-readonly--mono" : "settings-readonly"}>
      {display}
    </span>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? "switch--on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      style={{ padding: "0", background: "none" }}
    >
      <span className="switch__track">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}
