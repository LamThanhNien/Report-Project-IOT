import { useRef } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Search, Palette } from "lucide-react";
import { cn } from "../../../../lib/cn";
import type { WidgetDefinition, WidgetDraft, WidgetEditorField } from "../../types";

export function ColorPickerField({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const { t } = useTranslation(["projects", "common"]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex items-center gap-3 mt-1.5">
      <input
        type="color"
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition dark:border-border-subtle dark:bg-surface dark:text-text-primary shadow-sm"
      >
        <Palette className="h-3.5 w-3.5 text-slate-500" />
        <span>{t("projects:editor.ui.choose_color", "Chọn màu")}</span>
      </button>
      <div className="flex items-center gap-2">
        <span
          className="h-5 w-5 rounded-full border border-slate-200 dark:border-border-subtle shadow-inner transition-all duration-300"
          style={{ backgroundColor: value, boxShadow: `0 0 8px ${value}44` }}
        />
        <span className="font-mono text-xs font-bold text-slate-500 uppercase tracking-wider">{value}</span>
      </div>
    </div>
  );
}

interface Props {
  definition: WidgetDefinition;
  draft: WidgetDraft;
  search: string;
  onSearchChange: (value: string) => void;
  onFieldChange: (scope: "config" | "layout" | "binding", key: string, value: unknown) => void;
  availableTypes: WidgetDefinition[];
  onSelectType: (widgetType: string) => void;
}

interface WidgetFieldSectionsProps {
  fields: WidgetEditorField[];
  draft: WidgetDraft;
  onFieldChange: Props["onFieldChange"];
  definition?: WidgetDefinition;
}

const CATEGORY_LABELS = {
  control: "Điều khiển",
  display: "Hiển thị",
  chart: "Biểu đồ",
  status: "Trạng thái / OTA / TinyML",
  utility: "Bố cục / Tiện ích",
} as const;

function fieldValue(draft: WidgetDraft, field: WidgetEditorField): unknown {
  return draft[field.scope]?.[field.key];
}

export function getVisibleWidgetEditorFields(definition: WidgetDefinition, draft: WidgetDraft): WidgetEditorField[] {
  const fields = definition.editorFields.filter((field) => !field.visible || field.visible(draft));
  if (draft.widget_type !== "multi_telemetry_chart") return fields;

  const channels = Array.isArray(draft.binding?.channels) ? draft.binding.channels.map(String) : [];
  const channelColorFields: WidgetEditorField[] = channels.map((channel) => ({
    key: `color_${channel}`,
    label: `Channel ${channel} color`,
    labelKey: "projects:editor.ui.dynamic.channel_color",
    kind: "color",
    scope: "config",
    section: "Display",
    description: "Choose the color used for this telemetry channel.",
    descriptionKey: "projects:editor.ui.dynamic.channel_color_desc",
  }));

  return [...fields, ...channelColorFields];
}

function renderField(
  field: WidgetEditorField,
  draft: WidgetDraft,
  onFieldChange: Props["onFieldChange"],
  definition: WidgetDefinition | undefined,
  t: TFunction,
) {
  const value = fieldValue(draft, field);
  const inputClass = "input mt-1";
  const placeholder = field.placeholderKey
    ? t(field.placeholderKey, field.placeholder ?? "")
    : field.placeholder;

  let displayValue = String(value ?? "");
  if (field.kind === "color") {
    let fallback = "#2563eb";
    if (field.key.startsWith("color_ch_")) {
      const chan = field.key.replace("color_", "");
      const bound = Array.isArray(draft.binding?.channels) ? draft.binding.channels : ["ch_v1", "ch_v2"];
      const idx = bound.indexOf(chan);
      const CHART_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e"];
      fallback = CHART_COLORS[Math.max(0, idx) % CHART_COLORS.length];
    } else {
      fallback = String(definition?.defaultConfig?.[field.key] || "#2563eb");
    }
    displayValue = String(value || fallback);
  }

  if (field.kind === "textarea") {
    return (
      <textarea
        rows={3}
        className={`${inputClass} h-auto py-2`}
        value={displayValue}
        placeholder={placeholder}
        onChange={(event) => onFieldChange(field.scope, field.key, event.target.value)}
      />
    );
  }
  if (field.kind === "select") {
    return (
      <select
        className={inputClass}
        value={displayValue}
        onChange={(event) => onFieldChange(field.scope, field.key, event.target.value)}
      >
        <option value="">{t("projects:editor.ui.select", "Select")}</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {t(
              option.labelKey ?? `projects:editor.ui.option.${field.key}.${option.value}`,
              option.label,
            )}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "boolean") {
    const isChecked = value === true || String(value) === "true";
    return (
      <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-600 dark:text-text-secondary">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(event) => onFieldChange(field.scope, field.key, event.target.checked)}
        />
        <span>
          {t(
            field.descriptionKey ?? `projects:editor.ui.field_desc.${field.key}`,
            field.description ?? field.label,
          )}
        </span>
      </label>
    );
  }
  if (field.kind === "color") {
    return (
      <ColorPickerField
        value={displayValue}
        onChange={(nextValue) => onFieldChange(field.scope, field.key, nextValue)}
      />
    );
  }
  return (
    <input
      type={field.kind === "number" || field.kind === "range" ? "number" : "text"}
      className={inputClass}
      value={String(value ?? "")}
      placeholder={placeholder}
      min={field.min}
      max={field.max}
      step={field.step}
      onChange={(event) => {
        const nextValue = field.kind === "number" || field.kind === "range"
          ? (event.target.value === "" ? "" : Number(event.target.value))
          : event.target.value;
        onFieldChange(field.scope, field.key, nextValue);
      }}
    />
  );
}

export function WidgetTypeSelector({
  definition,
  search,
  onSearchChange,
  availableTypes,
  onSelectType,
}: Omit<Props, "draft" | "onFieldChange">) {
  const { t } = useTranslation(["projects", "common"]);
  const grouped = availableTypes.reduce<Record<string, WidgetDefinition[]>>((acc, item) => {
    acc[item.category] ??= [];
    acc[item.category].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label-xs mb-1">{t("projects:editor.ui.search_widget_type", "Tìm loại widget")}</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("projects:editor.ui.search_widget_placeholder", "Tìm kiếm loại widget...")}
          />
        </div>
      </label>
      <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 dark:border-border-subtle dark:bg-surface/40">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {t(`projects:editor.ui.category.${category}`, CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS])}
            </p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {items.map((item) => {
                const Icon = item.icon;
                const selected = item.id === definition.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "rounded-2xl border px-3 py-3 text-left transition",
                      selected
                        ? "border-brand-500 bg-white shadow-sm dark:bg-app"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-border-subtle dark:bg-app",
                    )}
                    onClick={() => onSelectType(item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <span className={cn("mt-0.5 rounded-xl p-2", selected ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-500 dark:bg-surface-elevated dark:text-text-secondary")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900 dark:text-text-primary">{t(`projects:widget_registry.${item.id}.label`, item.label)}</span>
                        <span className="mt-1 block text-xs text-slate-500 dark:text-text-muted">{t(`projects:widget_registry.${item.id}.description`, item.description || "")}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-border-subtle dark:bg-app">
        <p className="text-sm font-semibold text-slate-900 dark:text-text-primary">{t(`projects:widget_registry.${definition.id}.label`, definition.label)}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-text-muted">{t(`projects:widget_registry.${definition.id}.description`, definition.description || "")}</p>
      </div>
    </div>
  );
}

export function WidgetFieldSections({ fields, draft, onFieldChange, definition }: WidgetFieldSectionsProps) {
  const { t } = useTranslation(["projects", "common"]);
  const sections = Array.from(new Set(fields.map((field) => field.section)));

  return (
    <>
      {sections.map((section) => (
        <div key={section} className="space-y-4 pt-2">
          {sections.length > 1 && (
             <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 border-b border-slate-100 pb-2 mb-4 dark:border-border-subtle">{t(`projects:editor.ui.section.${section}`, section)}</p>
          )}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {fields.filter((field) => field.section === section).map((field) => (
              <label key={`${field.scope}.${field.key}`} className={field.kind === "textarea" ? "md:col-span-2" : ""}>
                <span className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">
                  {t(field.labelKey ?? `projects:editor.ui.field.${field.key}`, field.label)}
                </span>
                {renderField(field, draft, onFieldChange, definition, t)}
                {field.description && field.kind !== "boolean" && (
                  <span className="mt-1 block text-xs text-slate-500">
                    {t(
                      field.descriptionKey ?? `projects:editor.ui.field_desc.${field.key}`,
                      field.description,
                    )}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export function WidgetConfigEditor({
  definition,
  draft,
  search,
  onSearchChange,
  onFieldChange,
  availableTypes,
  onSelectType,
}: Props) {
  const fields = getVisibleWidgetEditorFields(definition, draft);

  return (
    <div className="space-y-5">
      <WidgetTypeSelector
        definition={definition}
        search={search}
        onSearchChange={onSearchChange}
        availableTypes={availableTypes}
        onSelectType={onSelectType}
      />
      <WidgetFieldSections fields={fields} draft={draft} onFieldChange={onFieldChange} definition={definition} />
    </div>
  );
}
