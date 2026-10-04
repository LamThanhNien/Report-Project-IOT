import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { createClientProject, deleteClientProject, listClientProjects, updateClientProject, listClientDevices } from "../../../services/clientApi";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Card } from "../../../components/ui/Card";
import { Modal } from "../../../components/ui/Modal";
import { ErrorState } from "../../../components/ui/ErrorState";
import { useAuth } from "../../../contexts/AuthContext";
import { canManageProjects, canViewDevices } from "../../../lib/permissions";
import type { TenantProjectSummary } from "../../../types";
import { Plus, Boxes } from "lucide-react";
import { TenantPageSkeleton } from "../../../components/ui/TenantUi";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { ProjectSearchAndFilters, type ProjectFilter, type ProjectSortOption } from "./ProjectSearchAndFilters";
import { ProjectCard } from "./ProjectCard";
import { ProjectListRow } from "./ProjectListRow";
import { PaginationBar } from "./ProjectPaginationBar";
import { usePagination } from "./useProjectPagination";
import type { ProjectOverview } from "./projectUtils";

export function ProjectsList() {
  const { t } = useTranslation(["projects", "common", "nav"]);
  const { user } = useAuth();
  const canManage = canManageProjects(user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projectsQ = useQuery({ queryKey: ["client-projects"], queryFn: listClientProjects });
  const devicesQ = useQuery({ queryKey: ["client-devices"], queryFn: () => listClientDevices(), enabled: canViewDevices(user), refetchInterval: 15_000 });
  const [deleteTarget, setDeleteTarget] = useState<TenantProjectSummary | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [sortBy, setSortBy] = useState<ProjectSortOption>("updated");
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">("aifom_projectslist_view", "grid", "local");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TenantProjectSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const save = useMutation({
    mutationFn: () => editing
      ? updateClientProject(editing.id, { name: name.trim(), description: description.trim() || null })
      : createClientProject({ name: name.trim(), description: description.trim() || null }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["client-projects"] });
      qc.invalidateQueries({ queryKey: ["client-project-detail", project.id] });
      setOpen(false);
      if (!editing) navigate("/client/workspace/" + project.id + "/home");
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => { if (!canManage) throw new Error("Read-only account"); return deleteClientProject(id); },
    onSuccess: () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ["client-projects"] }); qc.invalidateQueries({ queryKey: ["client-devices"] }); },
  });
  function showEditor(project: TenantProjectSummary | null) {
    setEditing(project); setName(project?.name ?? ""); setDescription(project?.description ?? "");
    save.reset(); setOpen(true);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (canManage && name.trim()) save.mutate();
  }
  const projects = useMemo<ProjectOverview[]>(() => {
    const counts = new Map<string, { total: number; online: number }>();
    for (const device of devicesQ.data ?? []) {
      if (!device.project_id || device.status === "deleted") continue;
      const count = counts.get(device.project_id) ?? { total: 0, online: 0 };
      count.total++; if (device.status === "online") count.online++;
      counts.set(device.project_id, count);
    }
    return (projectsQ.data ?? []).map((project) => ({ ...project,
      device_count: devicesQ.isSuccess ? counts.get(project.id)?.total ?? 0 : undefined,
      online_count: devicesQ.isSuccess ? counts.get(project.id)?.online ?? 0 : undefined,
    }));
  }, [projectsQ.data, devicesQ.data, devicesQ.isSuccess]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return projects.filter((project) => {
      if (term && !`${project.name} ${project.description ?? ""}`.toLocaleLowerCase().includes(term)) return false;
      if (filter === "active") return (project.online_count ?? 0) > 0;
      if (filter === "draft") return project.device_count === 0;
      if (filter === "recent") return Date.now() - Date.parse(project.updated_at) < 7 * 24 * 60 * 60 * 1000;
      return true;
    }).sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : sortBy === "devices" ? (b.device_count ?? 0) - (a.device_count ?? 0) : Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }, [projects, search, filter, sortBy]);
  const pageSize = 9;
  const { page, setPage, totalPages, pagedItems } = usePagination(filtered, pageSize, [search, filter, sortBy]);
  function chooseDelete(project: ProjectOverview) { if (canManage) { remove.reset(); setDeleteTarget(project); } }
  return <div className="flex min-h-full flex-col space-y-5">
    <PageHeader title={t("projects:title", "Quản lý Dự án")} subtitle={t("projects:workspace_description")} actions={canManage && <button type="button" className="btn-primary h-9 px-3.5 text-xs font-semibold shadow-sm" onClick={() => showEditor(null)}><Plus className="h-4 w-4" />{t("projects:create_project", "Tạo dự án")}</button>} />
    {devicesQ.isError && <ErrorState message={t("projects:device_counts_error", "Không tải được trạng thái thiết bị. Bạn vẫn có thể mở dự án.")} onRetry={() => devicesQ.refetch()} />}
    {projectsQ.isError ? <ErrorState message={projectsQ.error.message} onRetry={() => projectsQ.refetch()} /> : projectsQ.isLoading ? <TenantPageSkeleton cards={3} /> : projects.length === 0 ? <Card className="border-2 border-dashed border-slate-200 bg-white/60 dark:border-border-subtle dark:bg-surface/60">
      <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-12 text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-lg dark:from-brand-500 dark:to-brand-600"><Boxes className="h-8 w-8" /></div><h2 className="text-xl font-bold text-slate-900 dark:text-text-primary">{t("projects:no_projects")}</h2><p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-text-muted">{t("projects:workspace_description")}</p>{canManage && <button type="button" className="btn-primary mt-6" onClick={() => showEditor(null)}><Plus className="h-4 w-4" />{t("projects:create_project")}</button>}</div>
    </Card> : <>
      <ProjectSearchAndFilters search={search} onSearchChange={setSearch} filter={filter} onFilterChange={setFilter} sortBy={sortBy} onSortChange={setSortBy} totalCount={projects.length} filteredCount={filtered.length} viewMode={viewMode} onViewModeChange={setViewMode} />
      {filtered.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center shadow-sm dark:border-border-subtle dark:bg-surface"><p className="text-sm text-slate-600 dark:text-text-muted">{t("projects:no_match", "Không có dự án nào khớp với tìm kiếm hoặc bộ lọc.")}</p><button type="button" className="btn-ghost mt-3 text-xs text-brand-600" onClick={() => { setSearch(""); setFilter("all"); setSortBy("updated"); }}>{t("projects:clear_filters", "Xóa bộ lọc")}</button></div> : viewMode === "list" ? <Card>
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-4 rounded-t-xl border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs font-semibold text-slate-500 dark:border-border-subtle dark:bg-surface-elevated dark:text-text-muted md:grid"><span>{t("projects:project_name")}</span><span>{t("projects:fields.status", "Trạng thái")}</span><span>{t("projects:fields.devices", "Thiết bị")} / Online</span><span>{t("projects:description")}</span><span>{t("projects:col_actions", "Thao tác")}</span></div>
        <div className="divide-y divide-slate-100 dark:divide-border-subtle">{pagedItems.map((project) => <ProjectListRow key={project.id} project={project} isViewer={!canManage} onDelete={chooseDelete} onEdit={showEditor} />)}</div>
      </Card> : <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{pagedItems.map((project) => <ProjectCard key={project.id} project={project} isViewer={!canManage} onDelete={chooseDelete} onEdit={showEditor} />)}</div>}
      <PaginationBar page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={pageSize} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
    </>}
    {canManage && <Modal open={open} onClose={() => setOpen(false)} title={editing ? t("projects:edit_project", "Sửa dự án") : t("projects:create_project", "Tạo dự án")} footer={<><button type="button" className="btn-secondary text-xs" onClick={() => setOpen(false)}>{t("common:actions.cancel", "Hủy")}</button><button className="btn-primary text-xs" type="submit" form="project-workspace-editor" disabled={save.isPending || !name.trim()}>{t("projects:save_changes", "Lưu thay đổi")}</button></>}>
      <form id="project-workspace-editor" onSubmit={submit} className="space-y-4">
        <label className="block text-sm">{t("projects:project_name", "Tên dự án")}<input aria-label={t("projects:project_name", "Tên dự án")} className="input mt-1" required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block text-sm">{t("projects:description", "Mô tả")}<textarea className="input mt-1" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {save.isError && <p role="alert" className="text-sm text-rose-500">{save.error.message}</p>}
      </form>
    </Modal>}
    {canManage && <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title={t("projects:delete_title", "Xóa dự án")} size="sm" footer={<><button type="button" className="btn-secondary text-xs" onClick={() => setDeleteTarget(null)}>{t("common:actions.cancel", "Hủy")}</button><button type="button" className="btn-danger text-xs" disabled={remove.isPending} onClick={() => deleteTarget && remove.mutate(deleteTarget.id)}>{t("common:actions.delete", "Xóa")}</button></>}>
      <p className="text-sm text-slate-600 dark:text-text-muted">{t("projects:confirm_delete_named", 'Xóa dự án "{{name}}"? Hành động này không thể hoàn tác.', { name: deleteTarget?.name })}</p>{remove.isError && <p role="alert" className="mt-3 text-sm text-rose-500">{remove.error.message}</p>}
    </Modal>}
  </div>;
}
