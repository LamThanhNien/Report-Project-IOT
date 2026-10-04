import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Edit2, Loader2, Trash2, UserPlus } from "lucide-react";
import {
  createClientUser,
  deleteClientUser,
  listClientUsers,
  updateClientUser,
} from "../../../services/clientApi";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { DataTable } from "../../../components/ui/DataTable";
import { Modal } from "../../../components/ui/Modal";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { TenantBanner, TenantLoadingState } from "../../../components/ui/TenantUi";
import { useAuth } from "../../../contexts/AuthContext";
import { useFeature } from "../../../contexts/FeatureContext";
import { formatRelative } from "../../../lib/formatters";
import {
  DEPENDENT_VIEW_PERMISSIONS,
  VIEWER_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_LABELS,
  ROLE_PERMISSION_PRESETS,
  VIEWER_ROLE,
  canManageMembers as hasMembersManagePermission,
  effectivePermissions,
  hasPermission,
  isOwner,
  type PermissionKey,
} from "../../../lib/permissions";
import type { Column } from "../../../components/ui/DataTable";
import type { TenantUser } from "../../../types";
import { FeatureGate } from "./FeatureGate";

type FormMode = "create" | "edit";
type MemberForm = {
  email: string;
  password: string;
  full_name: string;
  role: string;
  permissions: string[];
};

function defaultForm(): MemberForm {
  return {
    email: "",
    password: "",
    full_name: "",
    role: VIEWER_ROLE,
    permissions: [...ROLE_PERMISSION_PRESETS[VIEWER_ROLE]],
  };
}

function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length > 0 && email.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanApiError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/^\d{3}\s+/, "")
      .replace(/^(password|email|role|permissions):\s*/i, "")
      .replace(/^Value error,\s*/i, "")
      .trim() || "You do not have permission to perform this action."
  );
}

function normalizePermissions(permissions: string[]): string[] {
  return Array.from(new Set(permissions)).sort();
}

function samePermissions(a: string[], b: string[]): boolean {
  const left = normalizePermissions(a);
  const right = normalizePermissions(b);
  return left.length === right.length && left.every((permission, index) => permission === right[index]);
}

function togglePermission(current: string[], permission: PermissionKey, checked: boolean): string[] {
  const next = new Set(current);
  if (checked) {
    next.add(permission);
    const requiredView = DEPENDENT_VIEW_PERMISSIONS[permission];
    if (requiredView) next.add(requiredView);
  } else {
    next.delete(permission);
    Object.entries(DEPENDENT_VIEW_PERMISSIONS).forEach(([managePermission, viewPermission]) => {
      if (viewPermission === permission) next.delete(managePermission);
    });
  }
  return normalizePermissions([...next]);
}

function permissionSummary(user: TenantUser, t: (key: string, fallback: string, options?: Record<string, unknown>) => string): string {
  if (isOwner(user)) return t("users:permission_summary.full_access", "Full access");
  const permissions = effectivePermissions(user);
  if (user.role === VIEWER_ROLE && samePermissions(permissions, ROLE_PERMISSION_PRESETS[VIEWER_ROLE])) {
    return t("users:permission_summary.view_only", "View only");
  }
  return t("users:permission_summary.custom_access", `Custom access (${permissions.length} permissions)`, { count: permissions.length });
}

export function ClientUsers() {
  const { t } = useTranslation(["users", "common"]);
  const { hasFeature, featuresReady } = useFeature();
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<FormMode>("create");
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [form, setForm] = useState<MemberForm>(() => defaultForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [memberToDelete, setMemberToDelete] = useState<TenantUser | null>(null);

  const roleOptions = useMemo(() => [
    { value: VIEWER_ROLE, label: t("users:roles.viewer", ROLE_LABELS[VIEWER_ROLE]) },
  ], [t]);

  const passwordRules = useMemo(() => [
    { label: t("users:form.rule_min_8", "At least 8 characters"), test: (value: string) => value.length >= 8 },
    { label: t("users:form.rule_max_128", "No more than 128 characters"), test: (value: string) => value.length <= 128 },
    { label: t("users:form.rule_uppercase", "At least one uppercase letter"), test: (value: string) => /[A-Z]/.test(value) },
    { label: t("users:form.rule_lowercase", "At least one lowercase letter"), test: (value: string) => /[a-z]/.test(value) },
    { label: t("users:form.rule_number", "At least one number"), test: (value: string) => /\d/.test(value) },
  ], [t]);

  const passwordValidationErrors = useMemo(() => {
    return passwordRules.filter((rule) => !rule.test(form.password)).map((rule) => rule.label);
  }, [passwordRules, form.password]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["client-users"],
    queryFn: listClientUsers,
  });

  const canViewMembers = isOwner(currentUser) || hasPermission(currentUser, "members.view");
  const canManageMembers = isOwner(currentUser) || hasMembersManagePermission(currentUser);
  const emailValid = isValidEmail(form.email);
  const roleValid = roleOptions.some((role) => role.value === form.role);
  const formPermissions = useMemo(() => normalizePermissions(form.permissions), [form.permissions]);

  function getRoleLabel(role: string): string {
    if (role === "tenant_owner") return t("users:roles.tenant_owner", "Tenant Owner");
    if (role === VIEWER_ROLE) return t("users:roles.viewer", "Viewer");
    return ROLE_LABELS[role] ?? role;
  }

  const createMut = useMutation({
    mutationFn: () =>
      createClientUser({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
        role: form.role,
        permissions: formPermissions,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["client-users"] });
      setModalOpen(false);
      setForm(defaultForm());
      setFormError(null);
      setBanner({ type: "success", message: t("users:banners.created_success", "Sub-user created successfully.") });
    },
    onError: (e) => setFormError(cleanApiError(e)),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      if (!editingUser) throw new Error("No member selected");
      return updateClientUser(editingUser.id, {
        full_name: form.full_name.trim() || null,
        role: form.role,
        permissions: formPermissions,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["client-users"] });
      setModalOpen(false);
      setEditingUser(null);
      setForm(defaultForm());
      setFormError(null);
      setBanner({ type: "success", message: t("users:banners.updated_success", "Sub-user updated successfully.") });
    },
    onError: (e) => setFormError(cleanApiError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: deleteClientUser,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["client-users"] });
      setMemberToDelete(null);
      setBanner({ type: "success", message: t("users:banners.deleted_success", "Sub-user removed.") });
    },
    onError: (e) => setBanner({ type: "error", message: cleanApiError(e) }),
  });

  const submitting = createMut.isPending || updateMut.isPending;
  const canSubmit =
    roleValid &&
    formPermissions.length > 0 &&
    !submitting &&
    (mode === "edit" ||
      (form.email.trim().length > 0 &&
        emailValid &&
        form.password.length > 0 &&
        passwordValidationErrors.length === 0));

  function openCreateModal() {
    setMode("create");
    setEditingUser(null);
    setForm(defaultForm());
    setFormError(null);
    setBanner(null);
    setModalOpen(true);
  }

  function openEditModal(user: TenantUser) {
    if (user.role !== VIEWER_ROLE) return;
    setMode("edit");
    setEditingUser(user);
    setForm({
      email: user.email,
      password: "",
      full_name: user.full_name ?? "",
      role: user.role,
      permissions: normalizePermissions(effectivePermissions(user)),
    });
    setFormError(null);
    setBanner(null);
    setModalOpen(true);
  }

  function applyRole(role: string) {
    setForm((current) => ({
      ...current,
      role,
      permissions: [...(ROLE_PERMISSION_PRESETS[role] ?? ROLE_PERMISSION_PRESETS[VIEWER_ROLE])],
    }));
  }

  function submitForm() {
    setFormError(null);
    if (!canSubmit) return;
    if (mode === "create") createMut.mutate();
    else updateMut.mutate();
  }

  if (!featuresReady) {
    return <TenantLoadingState label={t("common:loading", "Đang tải...")} />;
  }
  if (!hasFeature("user_management")) return <FeatureGate featureName="user_management" />;

  if (!canViewMembers) {
    return (
      <>
        <PageHeader
          title={t("users:no_permission_title", "Permission Denied")}
          subtitle={t("users:no_permission_desc", "You do not have permission to view this page.")}
        />
        <div className="card p-6 text-sm text-slate-600 dark:text-text-muted">
          {t("users:no_permission_desc", "You do not have permission to view this page.")}
        </div>
      </>
    );
  }

  const columns: Column<TenantUser>[] = [
    {
      key: "email",
      header: t("users:col.email", "Email"),
      sortable: true,
      render: (u) => <div className="font-medium text-sm">{u.email}</div>,
      sortValue: (u) => u.email,
    },
    {
      key: "full_name",
      header: t("users:col.full_name", "Full name"),
      render: (u) => <span>{u.full_name || "-"}</span>,
      sortValue: (u) => u.full_name ?? "",
    },
    {
      key: "role",
      header: t("users:col.role", "Role"),
      render: (u) => (
        <StatusBadge
          tone={u.role === "tenant_owner" ? "info" : "neutral"}
          label={getRoleLabel(u.role)}
        />
      ),
    },
    {
      key: "is_active",
      header: t("users:col.status", "Status"),
      render: (u) => (
        <StatusBadge
          tone={u.is_active ? "success" : "danger"}
          label={u.is_active ? t("users:status.active", "Active") : t("users:status.inactive", "Inactive")}
        />
      ),
    },
    {
      key: "permissions",
      header: t("users:col.permissions", "Permissions"),
      render: (u) => <span className="text-xs text-slate-500">{permissionSummary(u, t)}</span>,
      sortValue: (u) => permissionSummary(u, t),
    },
    {
      key: "created_at",
      header: t("users:col.created", "Created"),
      render: (u) => <span className="text-xs text-slate-500">{formatRelative(u.created_at)}</span>,
    },
    ...(canManageMembers
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (u: TenantUser) => {
              const currentRow = u.id === currentUser?.id;
              const ownerRow = isOwner(u);
              const canEdit = u.role === VIEWER_ROLE;
              const canRemove = !currentRow && u.role === VIEWER_ROLE;

              return (
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canEdit) openEditModal(u);
                    }}
                    disabled={!canEdit || submitting}
                    title={ownerRow ? "Owner permissions cannot be edited" : t("users:edit_user", "Edit sub-user")}
                    className="btn-ghost h-7 w-7 p-0 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canRemove) setMemberToDelete(u);
                    }}
                    disabled={!canRemove || deleteMut.isPending}
                    title={currentRow ? "You cannot remove yourself" : ownerRow ? "Owner accounts cannot be removed here" : t("users:remove_user", "Remove sub-user")}
                    className="btn-ghost h-7 w-7 p-0 text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            },
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t("users:title", "Sub-user Management")}
        subtitle={t("users:subtitle", "Create and manage simple sub-user access for this tenant.")}
        actions={
          canManageMembers ? (
            <button onClick={openCreateModal} className="btn-primary">
              <UserPlus className="h-4 w-4" /> {t("users:add_user", "Add sub-user")}
            </button>
          ) : undefined
        }
      />

      {banner && (
        <TenantBanner tone={banner.type === "success" ? "success" : "error"} className="mb-4">
          {banner.message}
        </TenantBanner>
      )}

      <DataTable
        data={data?.filter((member) => member.role === "tenant_owner" || member.role === VIEWER_ROLE)}
        columns={columns}
        loading={isLoading}
        error={error ? String(error) : null}
        onRetry={refetch}
        rowKey={(u) => u.id}
        emptyTitle={t("users:empty.title", "No sub-users yet")}
        emptyDescription={t("users:empty.description", "Add a sub-user to let another person access this tenant.")}
      />

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!submitting) setModalOpen(false);
        }}
        title={mode === "create" ? t("users:add_user", "Add sub-user") : t("users:edit_user", "Edit sub-user")}
        size="lg"
        footer={
          <>
            <button onClick={() => setModalOpen(false)} className="btn-secondary" disabled={submitting}>
              {t("users:actions.cancel", "Cancel")}
            </button>
            <button onClick={submitForm} disabled={!canSubmit} className="btn-primary">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("users:actions.saving", "Saving...")}
                </>
              ) : mode === "create" ? (
                t("users:actions.create", "Create sub-user")
              ) : (
                t("users:actions.save", "Save changes")
              )}
            </button>
          </>
        }
      >
        {formError && (
          <div className="mb-3 rounded bg-rose-50 p-2 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-400">
            {formError}
          </div>
        )}
        <div className="space-y-4">
          {mode === "create" && (
            <>
              <div>
                <label htmlFor="member-email" className="mb-1 block text-xs font-medium text-slate-700 dark:text-text-secondary">{t("users:form.email_label", "Email *")}</label>
                <input
                  id="member-email"
                  type="email"
                  className="input"
                  value={form.email}
                  disabled={submitting}
                  onChange={(e) => {
                    setFormError(null);
                    setForm((current) => ({ ...current, email: e.target.value }));
                  }}
                />
                {form.email.trim() && !emailValid && (
                  <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{t("users:form.invalid_email", "Enter a valid email address.")}</div>
                )}
              </div>
              <div>
                <label htmlFor="member-password" className="mb-1 block text-xs font-medium text-slate-700 dark:text-text-secondary">{t("users:form.password_label", "Password *")}</label>
                <input
                  id="member-password"
                  type="password"
                  className="input"
                  value={form.password}
                  disabled={submitting}
                  onChange={(e) => {
                    setFormError(null);
                    setForm((current) => ({ ...current, password: e.target.value }));
                  }}
                />
                <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-text-muted">
                  {passwordRules.map((rule) => {
                    const passed = rule.test(form.password);
                    return (
                      <li key={rule.label} className={passed ? "text-emerald-600 dark:text-emerald-400" : undefined}>
                        {passed ? "OK" : "-"} {rule.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}

          <div>
            <label htmlFor="member-full-name" className="mb-1 block text-xs font-medium text-slate-700 dark:text-text-secondary">{t("users:form.full_name_label", "Full name")}</label>
            <input
              id="member-full-name"
              type="text"
              className="input"
              value={form.full_name}
              disabled={submitting}
              onChange={(e) => setForm((current) => ({ ...current, full_name: e.target.value }))}
            />
          </div>

          <div>
            <label htmlFor="member-role" className="mb-1 block text-xs font-medium text-slate-700 dark:text-text-secondary">{t("users:form.role_label", "Role")}</label>
            <select id="member-role" className="input" value={form.role} disabled={submitting} onChange={(e) => applyRole(e.target.value)}>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {t("users:form.role_preset_hint", "Viewer accounts have read-only access. You can select read permissions below.")}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-700 dark:text-text-secondary">{t("users:form.permissions_label", "Permissions")}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {PERMISSION_GROUPS.map((group) => ({ ...group, permissions: group.permissions.filter((permission) => VIEWER_PERMISSIONS.includes(permission.key)) })).filter((group) => group.permissions.length > 0).map((group) => (
                <div key={group.id} className="rounded-md border border-slate-200 p-3 dark:border-border-subtle">
                  <div className="mb-2 text-sm font-medium text-slate-800 dark:text-text-primary">{group.label}</div>
                  <div className="space-y-2">
                    {group.permissions.map((permission) => (
                      <label key={permission.key} className="flex items-center gap-2 text-sm text-slate-600 dark:text-text-muted">
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(permission.key)}
                          disabled={submitting}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              permissions: togglePermission(
                                current.permissions,
                                permission.key as PermissionKey,
                                event.target.checked,
                              ),
                            }))
                          }
                        />
                        <span>{permission.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!memberToDelete}
        title={t("users:confirm_remove.title", "Remove sub-user")}
        description={
          memberToDelete ? (
            <span>
              {t("users:confirm_remove.description", "Remove {{email}} from this tenant? This account will no longer be able to access the tenant portal.", { email: memberToDelete.email })}
            </span>
          ) : null
        }
        confirmLabel={t("users:actions.remove", "Remove")}
        cancelLabel={t("users:actions.cancel", "Cancel")}
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => {
          if (memberToDelete) deleteMut.mutate(memberToDelete.id);
        }}
        onCancel={() => {
          if (!deleteMut.isPending) setMemberToDelete(null);
        }}
      />
    </>
  );
}
