import { useParams } from "react-router-dom";

export function useProjectScope() {
  const { projectId } = useParams<{ projectId: string }>();
  const isWorkspace = !!projectId;

  return {
    isWorkspace,
    projectId: projectId || null,
    resolveLink: (path: string) => {
      if (!isWorkspace) {
        return `/client${path}`;
      }
      return `/client/workspace/${projectId}${path}`;
    },
  };
}
