/** Appearance settings — also written to localStorage so they apply
 *  before the API call returns (no flash). */

import { useEffect } from "react";
import { Field, Section } from "../Field";
import { cn } from "../../../lib/cn";

const THEMES = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟系统" },
] as const;

const FONT_SIZES = [
  { id: -1, label: "紧凑" },
  { id: 0, label: "默认" },
  { id: 1, label: "宽松" },
] as const;

export function AppearanceSection({
  settings, onUpdate,
}: {
  settings: Record<string, any>;
  onUpdate: (k: string, v: any) => void;
}) {
  const theme = settings["ui.theme"] || "light";
  const fontSize = settings["ui.font_size"] ?? 0;

  // Apply immediately to <html data-theme> + style font-size
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.fontSize = `${14 + fontSize}px`;
  }, [theme, fontSize]);

  return (
    <>
      <Section title="主题">
        <Field label="">
          <div className="settings-radios">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={cn("settings-radio", theme === t.id && "active")}
                onClick={() => onUpdate("ui.theme", t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="字号">
        <Field label="">
          <div className="settings-radios">
            {FONT_SIZES.map((f) => (
              <button
                key={f.id}
                className={cn("settings-radio", fontSize === f.id && "active")}
                onClick={() => onUpdate("ui.font_size", f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="侧栏宽度" hint="单位 px。范围 200-400。">
        <Field label="">
          <input
            type="number"
            min={200} max={400} step={10}
            className="settings-input settings-input--num"
            value={settings["ui.sidebar_width"] ?? 260}
            onChange={(e) => {
              const v = parseInt(e.target.value) || 260;
              onUpdate("ui.sidebar_width", v);
              document.documentElement.style.setProperty("--sidebar-w", `${v}px`);
            }}
          />
        </Field>
      </Section>

      <Section title="语言" hint="目前只有中文。英文版本规划中。">
        <Field label="">
          <div className="settings-radios">
            <button className="settings-radio active">中文</button>
            <button className="settings-radio" disabled style={{ opacity: 0.4 }}>English (规划中)</button>
          </div>
        </Field>
      </Section>
    </>
  );
}
