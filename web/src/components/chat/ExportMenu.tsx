import { toast } from "sonner";
import { api } from "../../api";
import { Button } from "../ui/Button";

export function ExportMenu({ sessionId }: { sessionId: string | null }) {
  if (!sessionId) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          toast.promise(api.download(sessionId, "md"), {
            loading: "正在导出 Markdown…",
            success: "已下载 Markdown",
            error: (e) => `导出失败: ${e}`,
          })
        }
      >
        下载 Markdown
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          toast.promise(api.download(sessionId, "pdf"), {
            loading: "正在生成品牌 PDF…",
            success: "已下载 PDF",
            error: (e) => `导出失败: ${e}`,
          })
        }
      >
        下载 PDF
      </Button>
    </div>
  );
}
