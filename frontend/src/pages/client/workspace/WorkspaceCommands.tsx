import { useParams } from "react-router-dom";
import ClientCommandCenter from "../projects/ClientCommandCenter";

export function WorkspaceCommands() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ClientCommandCenter scopedProjectId={projectId} />;
}
