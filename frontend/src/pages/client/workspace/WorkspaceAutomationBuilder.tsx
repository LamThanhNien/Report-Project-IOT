import { useParams } from "react-router-dom";
import ClientAutomationBuilder from "../projects/ClientAutomationBuilder";

export default function WorkspaceAutomationBuilder({ readOnly = false }: { readOnly?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  return <ClientAutomationBuilder scopedProjectId={projectId} readOnly={readOnly} />;
}
