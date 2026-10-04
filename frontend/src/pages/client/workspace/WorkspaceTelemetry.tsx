import { useParams } from "react-router-dom";
import { ClientTelemetry } from "../projects/ClientTelemetry";

export function WorkspaceTelemetry() {
  const { projectId } = useParams<{ projectId: string }>();
  return <ClientTelemetry scopedProjectId={projectId} />;
}
