import { useState } from "react";
import { getApiKey, setApiKey } from "../../api";
import { Button } from "./Button";

/** Modal shown when server requires auth and we don't have a valid key. */
export function AuthGate({ onSuccess }: { onSuccess: () => void }) {
  const [key, setKey] = useState(getApiKey());
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="auth-overlay">
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          setSubmitting(true);
          setApiKey(key.trim());
          onSuccess();
        }}
      >
        <div className="auth-card__head">
          <span className="sidebar__brand-mark">F</span>
          <h2>Faro Research 登录</h2>
        </div>
        <p>
          服务端启用了 <code>FARO_AUTH_REQUIRED</code>。粘贴你的 API key
          (从管理员处获得; 形如 <code>fr-xxx...</code>)。
        </p>
        <input
          type="password"
          autoFocus
          required
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="fr-..."
        />
        <Button
          type="submit"
          variant="primary"
          disabled={!key.trim() || submitting}
        >
          {submitting ? "验证中..." : "登录"}
        </Button>
        <p className="auth-card__hint">
          API key 仅存在你浏览器的 localStorage; 不会上传到第三方。
        </p>
      </form>
    </div>
  );
}
