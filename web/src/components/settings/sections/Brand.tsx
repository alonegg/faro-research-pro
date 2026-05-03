import { Field, Section, Switch } from "../Field";

export function BrandSection({
  settings, onUpdate,
}: {
  settings: Record<string, any>;
  onUpdate: (k: string, v: any) => void;
}) {
  return (
    <>
      <Section title="项目身份" hint="出现在 PDF 封面、页眉、页脚。">
        <Field label="项目名">
          <input
            type="text"
            className="settings-input"
            value={settings["brand.project_name"] || ""}
            onChange={(e) => onUpdate("brand.project_name", e.target.value)}
          />
        </Field>
        <Field label="Slogan">
          <input
            type="text"
            className="settings-input"
            value={settings["brand.tagline"] || ""}
            onChange={(e) => onUpdate("brand.tagline", e.target.value)}
          />
        </Field>
        <Field label="项目 URL">
          <input
            type="url"
            className="settings-input"
            value={settings["brand.project_url"] || ""}
            onChange={(e) => onUpdate("brand.project_url", e.target.value)}
          />
        </Field>
        <Field label="作者 / 机构">
          <input
            type="text"
            className="settings-input"
            value={settings["brand.author"] || ""}
            onChange={(e) => onUpdate("brand.author", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="配色">
        <Field label="主色">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              className="settings-input--color"
              value={settings["brand.accent_color"] || "#7a3cf3"}
              onChange={(e) => onUpdate("brand.accent_color", e.target.value)}
            />
            <input
              type="text"
              className="settings-input"
              style={{ width: 100 }}
              value={settings["brand.accent_color"] || ""}
              onChange={(e) => onUpdate("brand.accent_color", e.target.value)}
            />
          </div>
        </Field>
        <Field label="深色">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              className="settings-input--color"
              value={settings["brand.accent_dark"] || "#6028d9"}
              onChange={(e) => onUpdate("brand.accent_dark", e.target.value)}
            />
            <input
              type="text"
              className="settings-input"
              style={{ width: 100 }}
              value={settings["brand.accent_dark"] || ""}
              onChange={(e) => onUpdate("brand.accent_dark", e.target.value)}
            />
          </div>
        </Field>
      </Section>

      <Section title="水印">
        <Field label="PDF 加 [机密] 水印">
          <Switch
            checked={!!settings["brand.confidential"]}
            onChange={(v) => onUpdate("brand.confidential", v)}
          />
        </Field>
      </Section>
    </>
  );
}
