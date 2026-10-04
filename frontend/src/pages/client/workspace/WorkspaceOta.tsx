import { useParams } from "react-router-dom";
import { ClientOta } from "../projects/ClientOta";

export function WorkspaceOta() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ClientOta scopedProjectId={projectId} />;
}
