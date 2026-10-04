import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock, Cpu, Wifi } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";
import { formatRelative } from "../../../lib/formatters";
import type { ProjectOverview } from "./projectUtils";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { getInitials, getLogoGradient, getProjectStatus } from "./projectUtils";
import { prefetchRoute } from "../../../app/routePrefetch";

interface Props {
  project: ProjectOverview;
  isViewer: boolean;
  onDelete: (project: ProjectOverview) => void;
  onEdit: (project: ProjectOverview) => void;
}

export function ProjectCard({ project, isViewer, onDelete, onEdit }: Props) {
  const { t } = useTranslation(["projects", "common"]);
  const status = getProjectStatus(project, t);
  const projectPath = `/client/workspace/${project.id}/home`;
  const initials = getInitials(project.name);
  const logoGradient = getLogoGradient(project.id);

  return (
    <Card className="group relative flex h-full flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pt-4">
        {/* Logo block */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-bold text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10 select-none",
            logoGradient,
          )}
        >
          {initials}
        </div>

        {/* Name + Status */}
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base font-semibold transition-colors duration-150 group-hover:text-brand-600 dark:group-hover:text-brand-400">
            <Link to={projectPath} onMouseEnter={() => prefetchRoute(projectPath)} onFocus={() => prefetchRoute(projectPath)}>{project.name}</Link>
          </CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
            <span className={status.textColor}>{status.label}</span>
          </div>
        </div>

        {!isViewer && (
          <ProjectActionsMenu
            projectId={project.id}
            projectName={project.name}
            onDelete={() => onDelete(project)}
            onEdit={() => onEdit(project)}
          />
        )}
      </CardHeader>

      <CardBody className="flex flex-1 flex-col">
        {/* Description */}
        <div className="mb-2">
          <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px] mb-0.5">
            {t("projects:fields.description", "Mô tả")}
          </span>
          <p className="min-h-[2.5rem] line-clamp-2 text-sm text-slate-600 dark:text-text-muted">
            {project.description || t("projects:no_description", "Không có mô tả")}
          </p>
        </div>

        {/* Device totals and project metadata */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 py-2.5 my-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">
              {t("projects:fields.devices", "Thiết bị")}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Cpu className="h-3.5 w-3.5 text-slate-400 dark:text-text-muted" />
              {project.device_count ?? "—"} {t("projects:device_unit", "thiết bị")}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">
              {t("projects:fields.online", "Online")}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Wifi className="h-3.5 w-3.5 text-slate-400 dark:text-text-muted" />
              {project.online_count ?? "—"} {t("projects:online_unit", "online")}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">
              {t("projects:fields.status", "Trạng thái")}
            </span>
            <span className={cn("inline-flex items-center gap-1.5 font-medium", status.textColor)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
              {status.label}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">
              {t("projects:fields.updated_at", "Cập nhật")}
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Clock className="h-3.5 w-3.5 text-slate-400 dark:text-text-muted" />
              {formatRelative(project.updated_at)}
            </span>
          </div>
        </div>

        <Link
          className="btn-primary mt-auto w-full flex items-center justify-center gap-1 shadow-sm hover:shadow"
          to={projectPath}
          onMouseEnter={() => prefetchRoute(projectPath)}
          onFocus={() => prefetchRoute(projectPath)}
        >
          <span>{t("projects:open_dashboard", "Mở dashboard →")}</span>
        </Link>
      </CardBody>
    </Card>
  );
}


