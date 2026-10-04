import { useParams } from "react-router-dom";
import { ProjectEditor } from "../projects/ProjectEditor";
import { useTranslation } from "react-i18next";

export function WorkspaceHome() {
  const { t } = useTranslation(["projects", "common"]);
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return <div className="p-4 text-xs text-rose-500">{t("invalid_project", "Mã dự án không hợp lệ.")}</div>;
  }

  return (
    <div className="space-y-4">

      <ProjectEditor overrideProjectId={projectId} />
    </div>
  );
}
