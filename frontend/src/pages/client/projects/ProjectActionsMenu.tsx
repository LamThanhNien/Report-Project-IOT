import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Check, Copy, LayoutDashboard, MoreVertical, Pencil, Trash2 } from "lucide-react";

export function ProjectActionsMenu({ projectId, projectName, onDelete, onEdit }: {
  projectId: string; projectName: string; onDelete: () => void; onEdit: () => void;
}) {
  const { t } = useTranslation(["projects", "common"]);
  const ref = useRef<HTMLDetailsElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && ref.current?.open) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  function close() { if (ref.current) ref.current.open = false; }
  const itemClass = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-slate-100 dark:hover:bg-surface-elevated";
  return <details ref={ref} className="relative shrink-0" onToggle={() => { if (ref.current?.open) { setCopied(false); setCopyFailed(false); } }}>
    <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-surface-elevated [&::-webkit-details-marker]:hidden" aria-label={t("projects:actions_for", "Thao tác cho {{name}}", { name: projectName })}><MoreVertical className="h-4 w-4" /></summary>
    <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-lg dark:border-border-subtle dark:bg-surface dark:text-text-secondary">
      <Link className={itemClass} to={`/client/workspace/${projectId}/home`} onClick={close}><LayoutDashboard className="h-4 w-4" />{t("projects:open_dashboard", "Mở dashboard")}</Link>
      <button type="button" className={itemClass} onClick={() => { close(); onEdit(); }}><Pencil className="h-4 w-4" />{t("common:actions.edit", "Sửa")}</button>
      <button type="button" className={itemClass} onClick={async () => { try { await navigator.clipboard.writeText(projectId); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } }}>{copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}{t(copied ? "projects:copied_id" : "projects:copy_id", copied ? "Đã sao chép ID" : "Sao chép ID dự án")}</button>
      {copyFailed && <p role="alert" className="px-3 py-1 text-xs text-rose-500">{t("projects:copy_failed", "Không thể sao chép ID")}</p>}
      <div className="my-1 border-t border-slate-100 dark:border-border-subtle" />
      <button type="button" className={itemClass + " text-rose-600 dark:text-rose-400"} onClick={() => { close(); onDelete(); }}><Trash2 className="h-4 w-4" />{t("common:actions.delete", "Xóa")}</button>
    </div>
  </details>;
}
