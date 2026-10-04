import { useParams } from "react-router-dom";
import { ClientAlerts } from "../projects/ClientAlerts";

export function WorkspaceAlerts() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ClientAlerts scopedProjectId={projectId} />;
}
