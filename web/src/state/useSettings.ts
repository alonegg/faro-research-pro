/** Hook for the Settings modal: fetches editable settings + read-only
 *  status snapshot, provides updater functions with optimistic local state. */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type SettingsStatus } from "../api";

export function useSettings(open: boolean) {
  const [settings, setSettings] = useState<Record<string, any> | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Load on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([api.getSettings(), api.getSettingsStatus()])
      .then(([s, st]) => {
        if (cancelled) return;
        setSettings(s);
        setStatus(st as SettingsStatus);
      })
      .catch((e) => toast.error(`加载设置失败: ${e}`))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open]);

  const update = useCallback(async (key: string, value: any) => {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
    try {
      const updated = await api.patchSettings({ [key]: value });
      setSettings(updated);
    } catch (e) {
      toast.error(`保存失败: ${e}`);
      // refetch to roll back
      api.getSettings().then(setSettings).catch(() => {});
    }
  }, []);

  const updateMemory = useCallback(async (soul: string, rules: string) => {
    try {
      const r = await api.updateMemory(soul, rules);
      setStatus((prev) => prev ? { ...prev, memory: { ...prev.memory, ...r } } : prev);
      toast.success("已保存 Memory");
    } catch (e) {
      toast.error(`保存 Memory 失败: ${e}`);
    }
  }, []);

  const test = useCallback(async (kind: "llm_main" | "llm_small" | "tushare" | "fd_ai") => {
    const id = toast.loading(`测试 ${kind}…`);
    try {
      const r = await api.testConnection(kind);
      toast.dismiss(id);
      if (r.ok) {
        toast.success(`✓ ${kind} 通了 (${r.latency_ms.toFixed(0)} ms): ${r.detail}`);
      } else {
        toast.error(`✗ ${kind} 失败: ${r.detail}`);
      }
    } catch (e) {
      toast.dismiss(id);
      toast.error(`测试失败: ${e}`);
    }
  }, []);

  return { settings, status, loading, update, updateMemory, test };
}
