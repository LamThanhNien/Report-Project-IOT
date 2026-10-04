import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, Cpu, Wifi } from "lucide-react";
import { cn } from "../../../lib/cn";
import { formatRelative } from "../../../lib/formatters";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { getInitials, getLogoGradient, getProjectStatus, type ProjectOverview } from "./projectUtils";
import { prefetchRoute } from "../../../app/routePrefetch";

export function ProjectListRow({ project, isViewer, onDelete, onEdit }: {
  project: ProjectOverview; isViewer: boolean;
  onDelete: (project: ProjectOverview) => void; onEdit: (project: ProjectOverview) => void;
}) {
  const { t } = useTranslation(["projects", "common"]);
  const status = getProjectStatus(project, t);
  const path = `/client/workspace/${project.id}/home`;
  return <div className="group grid grid-cols-1 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50/70 dark:hover:bg-surface-elevated/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:gap-4">
    <div className="flex min-w-0 items-center gap-3">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm", getLogoGradient(project.id))}>{getInitials(project.name)}</div>
      <div className="min-w-0"><Link to={path} onMouseEnter={() => prefetchRoute(path)} onFocus={() => prefetchRoute(path)} className="block truncate text-sm font-semibold text-slate-900 group-hover:text-brand-600 dark:text-text-primary dark:group-hover:text-brand-400">{project.name}</Link><p className="mt-0.5 truncate text-[11px] text-slate-400">{project.id}</p></div>
    </div>
    <div><span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium", status.badgeBg)}><span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} /><span className={status.textColor}>{status.label}</span></span></div>
    <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-text-secondary"><span className="inline-flex items-center gap-1" title={t("projects:fields.devices", "Thiết bị")}><Cpu className="h-3.5 w-3.5" />{project.device_count ?? "—"}</span><span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title="Online"><Wifi className="h-3.5 w-3.5" />{project.online_count ?? "—"}</span></div>
    <div className="min-w-0"><p className="truncate text-xs text-slate-500 dark:text-text-muted">{project.description || t("projects:no_description", "Không có mô tả")}</p><p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400"><Clock className="h-3 w-3" />{formatRelative(project.updated_at)}</p></div>
    <div className="flex items-center justify-end gap-1.5"><Link to={path} onMouseEnter={() => prefetchRoute(path)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/30">{t("common:actions.open", "Mở")}<ArrowRight className="h-3 w-3" /></Link>{!isViewer && <ProjectActionsMenu projectId={project.id} projectName={project.name} onDelete={() => onDelete(project)} onEdit={() => onEdit(project)} />}</div>
  </div>;
}
