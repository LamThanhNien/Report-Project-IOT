import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FeatureProvider, useFeature } from "./FeatureContext";
import { getClientFeatures } from "../services/clientApi";
vi.mock("../services/clientApi");
function Probe() { const { hasFeature } = useFeature(); return <div>{hasFeature("device_management") ? "Feature allowed" : "Feature denied"}</div>; }
beforeEach(() => { vi.clearAllMocks(); });
it.each(["tenant_engineer", "platform_engineer", "unknown"])("does not fetch or grant tenant features for unsupported role %s", role => {
  render(<FeatureProvider role={role}><Probe /></FeatureProvider>);
  expect(screen.getByText("Feature denied")).toBeInTheDocument();
  expect(getClientFeatures).not.toHaveBeenCalled();
});
