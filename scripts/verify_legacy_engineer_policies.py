"""Offline regressions for migration 0013; never open a database connection.

Run: .venv/Scripts/python.exe scripts/verify_legacy_engineer_policies.py
Uses Alembic's PostgreSQL SQL renderer, without application imports/lifespan,
backend conftest, Docker, database credentials, or a live PostgreSQL session.
"""

import importlib.util
import io
import unittest
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "backend/alembic/versions/0013_retire_legacy_engineer_policies.py"
spec = importlib.util.spec_from_file_location("legacy_engineer_policies", SOURCE)
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class LegacyPolicyTests(unittest.TestCase):
    def policy(self, name, table=None):
        matches = [p for p in migration.POLICIES if p["policyname"] == name and
                   (table is None or p["tablename"] == table)]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def test_frozen_catalog_and_revision_chain(self):
        self.assertEqual(migration.revision, "0013")
        self.assertEqual(migration.down_revision, "0012")
        self.assertEqual(len(migration.POLICIES), 71)
        self.assertEqual(len({(p["schemaname"], p["tablename"], p["policyname"])
                              for p in migration.POLICIES}), 71)
        for p in migration.POLICIES:
            self.assertEqual(p["schemaname"], "public")
            self.assertEqual(p["roles"], ["public"])
            self.assertEqual(p["permissive"], "PERMISSIVE")
            self.assertTrue("engineer" in (p["qual"] or "") or
                            "engineer" in (p["with_check"] or ""))

    def test_all_forward_expressions_remove_both_retired_roles(self):
        for p in migration.POLICIES:
            with self.subTest(table=p["tablename"], policy=p["policyname"]):
                self.assertNotIn("engineer", p["new_qual"] or "")
                self.assertNotIn("engineer", p["new_with_check"] or "")
                self.assertEqual(p["qual"] is None, p["new_qual"] is None)
                self.assertEqual(p["with_check"] is None, p["new_with_check"] is None)

    def test_48_engineer_only_policies_are_denied_without_admin_promotion(self):
        policies = [p for p in migration.POLICIES if p["policyname"].startswith("platform_engineer")]
        self.assertEqual(len(policies), 48)
        for p in policies:
            for key in ("new_qual", "new_with_check"):
                self.assertIn(p[key], (None, "false"))

    def test_diagnostic_system_bypass_and_admin_check_preserved(self):
        insert = self.policy("diagnostic_trace_insert_policy")
        self.assertEqual(insert["new_with_check"],
                         "current_setting('app.bypass_rls'::text, true) = 'true'::text")
        self.assertNotIn("admin", insert["new_with_check"])
        update = self.policy("diagnostic_trace_update_policy")
        self.assertIn("app.bypass_rls", update["new_qual"])
        self.assertIn("'admin'::text", update["new_qual"])
        self.assertIn("ARRAY['admin'::text]", update["new_with_check"])

    def test_published_templates_keep_owner_and_viewer_only(self):
        for table in ("project_templates", "project_template_revisions"):
            p = self.policy(table + "_select_policy")
            self.assertIn("ARRAY['tenant_owner'::text, 'viewer'::text]", p["new_qual"])
            self.assertIn("((status)::text = 'published'::text)", p["new_qual"])
            self.assertIn("app.bypass_rls", p["new_qual"])
            self.assertIn("'admin'::text", p["new_qual"])

    def test_delete_safety_and_tenant_owned_support_reads_preserved(self):
        template = self.policy("project_templates_safe_delete_policy")["new_qual"]
        revision = self.policy("project_template_revisions_safe_delete_policy")["new_qual"]
        for predicate in (template, revision):
            self.assertIn("'draft'::text", predicate)
            self.assertIn("NOT ", predicate)
            self.assertIn("is_builtin", predicate)
            self.assertIn("current_published_revision_id IS NULL", predicate)
            self.assertIn("'admin'::text", predicate)
        self.assertIn("parent.id = project_template_revisions.template_id", revision)
        support = self.policy("support_grants_select_policy")["new_qual"]
        self.assertIn("'tenant_owner'::text", support)
        self.assertIn("tenant_id = (NULLIF(current_setting('app.current_tenant_id'", support)

    def test_absent_policies_skipped_and_changed_definitions_rejected(self):
        for sql, p in zip(migration.policy_statements(), migration.POLICIES, strict=True):
            self.assertIn("IF FOUND THEN", sql)
            self.assertIn("RAISE EXCEPTION", sql)
            self.assertIn("existing.roles IS DISTINCT FROM ARRAY['public']::name[]", sql)
            self.assertIn("existing.qual IS DISTINCT FROM " + migration._literal(p["qual"]), sql)
            self.assertIn("existing.with_check IS DISTINCT FROM " + migration._literal(p["with_check"]), sql)
            self.assertNotIn("CREATE POLICY", sql)
            self.assertNotIn("DROP POLICY", sql)

    def test_downgrade_exact_originals_and_never_creates_legacy_grants(self):
        for sql, p in zip(migration.policy_statements(restore_retired_role=True),
                          migration.POLICIES, strict=True):
            self.assertIn("IF FOUND THEN", sql)
            self.assertNotIn("CREATE POLICY", sql)
            if p["qual"] is not None:
                self.assertIn(" USING (" + p["qual"] + ")", sql)
            if p["with_check"] is not None:
                self.assertIn(" WITH CHECK (" + p["with_check"] + ")", sql)

    def test_real_alembic_offline_execution_has_no_data_or_rls_flag_writes(self):
        for direction in ("upgrade", "downgrade"):
            output = io.StringIO()
            context = MigrationContext.configure(dialect_name="postgresql", opts={
                "as_sql": True, "output_buffer": output,
            })
            with Operations.context(context):
                getattr(migration, direction)()
            sql = output.getvalue()
            self.assertEqual(sql.count("DO $retire_legacy_policy$"), 71)
            self.assertEqual(sql.count("ALTER POLICY"), 71)
            for statement in ("UPDATE users", "DELETE FROM", "DROP TABLE", "TRUNCATE", "DISABLE ROW LEVEL", "NO FORCE ROW LEVEL"):
                self.assertNotIn(statement, sql)


if __name__ == "__main__":
    unittest.main(verbosity=2)
