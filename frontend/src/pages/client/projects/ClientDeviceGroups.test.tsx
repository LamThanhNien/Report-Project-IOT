import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClientDeviceGroups from "./ClientDeviceGroups";
import { deviceGroupApi, type DeviceGroup } from "../../../services/deviceGroupApi";

// Mock the APIs and contexts
vi.mock("../../../services/deviceGroupApi", () => ({
  deviceGroupApi: {
    listDeviceGroups: vi.fn(),
    listGroupDevices: vi.fn(),
    createDeviceGroup: vi.fn(),
    updateDeviceGroup: vi.fn(),
    deleteDeviceGroup: vi.fn(),
    addMembers: vi.fn(),
    removeMembers: vi.fn(),
  },
}));
vi.mock("../../../services/clientApi", () => ({
  listClientDevices: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      tenant_id: "tenant-1",
      role: "tenant_owner",
      permissions: []
    }
  }),
}));
vi.mock("../../../contexts/FeatureContext", () => ({
  useFeature: () => ({ featuresReady: true, hasFeature: () => true }),
}));

const MOCK_GROUPS: DeviceGroup[] = [
  {
    id: "group-1",
    name: "Hanoi Lab",
    description: "Esp32 test bench in Hanoi office",
    device_count: 5,
    status: "active",
    group_type: "manual",
    tags: ["lab", "hanoi"],
    tenant_id: "tenant-1",
    created_at: "2026-06-20T08:00:00Z",
    updated_at: "2026-06-20T08:00:00Z",
    metadata: {},
  },
  {
    id: "group-2",
    name: "HCM Office",
    description: "Production devices in HCM City",
    device_count: 0,
    status: "active",
    group_type: "manual",
    tags: ["prod", "hcm"],
    tenant_id: "tenant-1",
    created_at: "2026-06-21T09:00:00Z",
    updated_at: "2026-06-21T09:00:00Z",
    metadata: {},
  }
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ClientDeviceGroups />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ClientDeviceGroups page actions dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deviceGroupApi.listDeviceGroups).mockResolvedValue({
      items: MOCK_GROUPS,
      total: MOCK_GROUPS.length,
    });
    vi.mocked(deviceGroupApi.listGroupDevices).mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  it("renders the table rows and shows only one actions dropdown button per row", async () => {
    console.log("TESTDEBUG: test 1 start");
    renderPage();

    expect(await screen.findByText("Hanoi Lab")).toBeInTheDocument();
    expect(screen.getByText("HCM Office")).toBeInTheDocument();

    // The old individual action buttons (like Xem chi tiết nhóm, Gửi lệnh tới nhóm, Tạo OTA cho nhóm, Sửa nhóm, Xóa nhóm) should NOT be present in the document
    expect(screen.queryByRole("button", { name: "Xem chi tiết nhóm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gửi lệnh tới nhóm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tạo OTA cho nhóm/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa nhóm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa nhóm" })).not.toBeInTheDocument();

    // The kebab menu items should also NOT be visible by default
    expect(screen.queryByRole("menuitem", { name: "Xem chi tiết" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Gửi lệnh" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Tạo OTA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Chỉnh sửa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Xóa nhóm" })).not.toBeInTheDocument();

    // But the kebab action button should be visible (one for each row)
    const actionButtons = screen.getAllByRole("button", { name: "Open device group actions" });
    expect(actionButtons).toHaveLength(2);
    console.log("TESTDEBUG: test 1 finished successfully");
  });

  it("opens the actions menu with correct Vietnamese labels when clicking the kebab button", async () => {
    console.log("TESTDEBUG: test 2 start");
    renderPage();

    expect(await screen.findByText("Hanoi Lab")).toBeInTheDocument();

    const actionButtons = screen.getAllByRole("button", { name: "Open device group actions" });
    
    // Open menu for the first row
    fireEvent.click(actionButtons[0]);

    // Check menu items and labels
    expect(screen.getByRole("menuitem", { name: "Xem chi tiết" })).toBeInTheDocument();
    
    const sendBtn = screen.getByRole("menuitem", { name: "Gửi lệnh" });
    expect(sendBtn).toBeInTheDocument();
    expect(sendBtn).not.toBeDisabled(); // group-1 has 5 devices and commands.send permission is mock-enabled

    const otaBtn = screen.getByRole("menuitem", { name: "Tạo OTA" });
    expect(otaBtn).toBeInTheDocument();
    expect(otaBtn).not.toBeDisabled();

    expect(screen.getByRole("menuitem", { name: "Chỉnh sửa" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Xóa nhóm" })).toBeInTheDocument();
    console.log("TESTDEBUG: test 2 finished successfully");
  });

  it("disables Send command and Create OTA for empty groups", async () => {
    console.log("TESTDEBUG: test 3 start");
    renderPage();

    expect(await screen.findByText("HCM Office")).toBeInTheDocument();

    const actionButtons = screen.getAllByRole("button", { name: "Open device group actions" });
    
    // Open menu for the second row (HCM Office which has 0 devices)
    fireEvent.click(actionButtons[1]);

    const sendBtn = screen.getByRole("menuitem", { name: "Gửi lệnh" });
    expect(sendBtn).toBeDisabled();

    const otaBtn = screen.getByRole("menuitem", { name: "Tạo OTA" });
    expect(otaBtn).toBeDisabled();
    console.log("TESTDEBUG: test 3 finished successfully");
  });

  it("triggers view action and opens details modal", async () => {
    console.log("TESTDEBUG: test 4 start");
    renderPage();

    console.log("TESTDEBUG: test 4 looking for Hanoi Lab");
    const element = await screen.findByText("Hanoi Lab");
    console.log("TESTDEBUG: test 4 found Hanoi Lab");
    expect(element).toBeInTheDocument();

    const actionButtons = screen.getAllByRole("button", { name: "Open device group actions" });
    console.log("TESTDEBUG: test 4 clicking first action button");
    fireEvent.click(actionButtons[0]);

    console.log("TESTDEBUG: test 4 clicking Xem chi tiết");
    // Click Xem chi tiết
    fireEvent.click(screen.getByRole("menuitem", { name: "Xem chi tiết" }));

    console.log("TESTDEBUG: test 4 waiting for listGroupDevices mock call");
    // Verify detail modal calls listGroupDevices and opens modal (it has group name as title)
    await waitFor(() => {
      expect(deviceGroupApi.listGroupDevices).toHaveBeenCalledWith("group-1");
    });
    
    console.log("TESTDEBUG: test 4 waiting for heading Hanoi Lab");
    // Wait for the modal elements. GroupDetailModal displays group info
    const headings = screen.getAllByRole("heading", { name: "Hanoi Lab" });
    expect(headings.length).toBe(2);
    console.log("TESTDEBUG: test 4 finished successfully");
  });

  it("triggers edit action and opens edit modal", async () => {
    console.log("TESTDEBUG: test 5 start");
    renderPage();

    console.log("TESTDEBUG: test 5 looking for Hanoi Lab");
    const element = await screen.findByText("Hanoi Lab");
    console.log("TESTDEBUG: test 5 found Hanoi Lab");
    expect(element).toBeInTheDocument();

    const actionButtons = screen.getAllByRole("button", { name: "Open device group actions" });
    console.log("TESTDEBUG: test 5 clicking first action button");
    fireEvent.click(actionButtons[0]);

    console.log("TESTDEBUG: test 5 clicking Chỉnh sửa");
    // Click Chỉnh sửa
    fireEvent.click(screen.getByRole("menuitem", { name: "Chỉnh sửa" }));

    console.log("TESTDEBUG: test 5 verifying edit modal heading");
    // Verify DeviceGroupFormModal is shown with input containing existing group name
    expect(screen.getByRole("heading", { name: "Sửa nhóm thiết bị" })).toBeInTheDocument();
    
    console.log("TESTDEBUG: test 5 verifying input value");
    // Using findByLabelText/getByLabelText or findByDisplayValue to verify value since name field uses standard HTML inputs
    expect(screen.getByDisplayValue("Hanoi Lab")).toBeInTheDocument();
    console.log("TESTDEBUG: test 5 finished successfully");
  });

  it("triggers delete action and opens confirmation dialog", async () => {
    console.log("TESTDEBUG: test 6 start");
    renderPage();

    console.log("TESTDEBUG: test 6 looking for Hanoi Lab");
    const element = await screen.findByText("Hanoi Lab");
    console.log("TESTDEBUG: test 6 found Hanoi Lab");
    expect(element).toBeInTheDocument();

    const actionButtons = screen.getAllByRole("button", { name: "Open device group actions" });
    console.log("TESTDEBUG: test 6 clicking first action button");
    fireEvent.click(actionButtons[0]);

    console.log("TESTDEBUG: test 6 clicking Xóa nhóm");
    // Click Xóa nhóm
    fireEvent.click(screen.getByRole("menuitem", { name: "Xóa nhóm" }));

    console.log("TESTDEBUG: test 6 verifying confirmation heading");
    // Verify ConfirmDialog is shown
    expect(screen.getByText("Xóa nhóm thiết bị?")).toBeInTheDocument();
    expect(screen.getByText("Bạn có chắc muốn xóa nhóm này không? Thiết bị trong nhóm sẽ không bị xóa, chỉ bị gỡ khỏi nhóm.")).toBeInTheDocument();
    
    console.log("TESTDEBUG: test 6 clicking Hủy");
    // Click Cancel
    fireEvent.click(screen.getByRole("button", { name: /Hủy|Huỷ/i }));
    expect(screen.queryByText("Xóa nhóm thiết bị?")).not.toBeInTheDocument();
    console.log("TESTDEBUG: test 6 finished successfully");
  });
});
