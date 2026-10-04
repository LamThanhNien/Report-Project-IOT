import { createContext, useContext } from "react";

const DragPerformanceContext = createContext(false);

export const DragPerformanceProvider = DragPerformanceContext.Provider;

export function useDragPerformanceMode(): boolean {
  return useContext(DragPerformanceContext);
}
