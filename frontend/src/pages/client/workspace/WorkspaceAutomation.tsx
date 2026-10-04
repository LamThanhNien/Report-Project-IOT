import { useParams } from "react-router-dom";
import { ClientAutomation } from "../projects/ClientAutomation";

export function WorkspaceAutomation() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ClientAutomation scopedProjectId={projectId} />;
}
