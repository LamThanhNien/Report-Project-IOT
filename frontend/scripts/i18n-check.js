import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const vnRegex = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/;

// Converted files in scope (PR 1 & PR 2 files)
const filesToCheck = [
  "src/components/layout/ClientSidebar.tsx",
  "src/components/layout/ClientTopbar.tsx",
  "src/components/layout/WorkspaceLayout.tsx",
  "src/pages/client/projects/ClientDashboard.tsx",
  "src/pages/client/projects/ClientReports.tsx",
  "src/pages/client/projects/ClientAuditLogs.tsx",
  "src/pages/client/projects/ProjectsList.tsx",
  "src/pages/client/projects/ProjectCard.tsx",
  "src/pages/client/projects/ProjectEditor.tsx",
  "src/pages/client/projects/ProjectTemplateModal.tsx",
  "src/pages/client/projects/ProjectSearchAndFilters.tsx",
  "src/pages/client/projects/ProjectActionsMenu.tsx",
  "src/pages/client/projects/ProjectEmptyState.tsx",
  "src/pages/client/projects/ProjectListRow.tsx",
  "src/pages/client/projects/ClientDevices.tsx",
  "src/pages/client/projects/ClientDeviceGroups.tsx",
  "src/pages/client/projects/ClientProvisioning.tsx",
  "src/pages/client/projects/ClientDeviceDetail.tsx",
  "src/pages/client/projects/ClientDeviceOnboarding.tsx",
];

let totalViolations = 0;

console.log("🔍 Checking for un-translated hardcoded Vietnamese text in scope files...\n");

for (const relPath of filesToCheck) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) continue;

  const content = fs.readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  const violations = [];
  lines.forEach((line, idx) => {
    // Ignore comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

    if (vnRegex.test(line)) {
      // Check if it's enclosed inside t(...) or fallback comment
      if (!line.includes("t(") && !line.includes("i18n")) {
        violations.push({ lineNum: idx + 1, lineText: trimmed });
      }
    }
  });

  if (violations.length > 0) {
    console.error(`❌ ${relPath} (${violations.length} violations):`);
    for (const v of violations) {
      console.error(`   L${v.lineNum}: ${v.lineText}`);
    }
    totalViolations += violations.length;
  }
}

if (totalViolations > 0) {
  console.error(`\n❌ i18n Check Failed: Found ${totalViolations} hardcoded strings.`);
  process.exit(1);
} else {
  console.log("✅ i18n Check Passed: 0 hardcoded strings found in scope files!");
  process.exit(0);
}
