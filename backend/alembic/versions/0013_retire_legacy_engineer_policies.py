"""Retire legacy Engineer policies left by pre-baseline databases.

Revision ID: 0013
Revises: 0012

Some upgraded installations retain additional policies not created by 0001.
The frozen catalog records exactly 71 such policies: 48 Engineer-only grants
become false; 23 mixed policies retain their existing non-Engineer branches.
Only policy expressions change. No accounts, ownership, rows, RLS flags,
policy commands, permissiveness, or database-role targets change.

Missing policies are deliberately skipped on clean installations. An existing
policy whose original definition differs from the frozen catalog is rejected
rather than overwritten. Downgrade restores the original expressions only for
policies still present; it never creates a legacy grant on a clean database.
"""

import json
from pathlib import Path
from collections.abc import Iterator, Sequence

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

POLICIES = json.loads(
    Path(__file__).with_name("0013_legacy_policy_snapshot.json").read_text(encoding="utf-8")
)


def _literal(value: str | None) -> str:
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def _identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def policy_statements(*, restore_retired_role: bool = False) -> Iterator[str]:
    """Render catalog-guarded SQL without connecting to a database."""
    for policy in POLICIES:
        schema, table, name = (policy[key] for key in ("schemaname", "tablename", "policyname"))
        using = policy["qual" if restore_retired_role else "new_qual"]
        check = policy["with_check" if restore_retired_role else "new_with_check"]
        alter = f"ALTER POLICY {_identifier(name)} ON {_identifier(schema)}.{_identifier(table)}"
        if using is not None:
            alter += f" USING ({using})"
        if check is not None:
            alter += f" WITH CHECK ({check})"
        # SQL expressions are PostgreSQL's exported pg_policies definitions,
        # frozen at authoring time, never values supplied by an application user.
        original_guard = ""
        if not restore_retired_role:
            original_guard = (
                f" OR existing.qual IS DISTINCT FROM {_literal(policy['qual'])}"
                f" OR existing.with_check IS DISTINCT FROM {_literal(policy['with_check'])}"
            )
        roles = "ARRAY[" + ", ".join(_literal(role) for role in sorted(policy["roles"])) + "]::name[]"
        yield f"""DO $retire_legacy_policy$
DECLARE existing record;
BEGIN
    SELECT * INTO existing FROM pg_policies
    WHERE schemaname = {_literal(schema)} AND tablename = {_literal(table)}
      AND policyname = {_literal(name)};
    IF FOUND THEN
        IF existing.cmd IS DISTINCT FROM {_literal(policy['cmd'])}
           OR existing.permissive IS DISTINCT FROM {_literal(policy['permissive'])}
           OR existing.roles IS DISTINCT FROM {roles}{original_guard} THEN
            RAISE EXCEPTION 'Legacy policy definition changed: %.%.%',
                {_literal(schema)}, {_literal(table)}, {_literal(name)};
        END IF;
        {alter};
    END IF;
END
$retire_legacy_policy$;"""


def upgrade() -> None:
    for statement in policy_statements():
        op.execute(statement)


def downgrade() -> None:
    for statement in policy_statements(restore_retired_role=True):
        op.execute(statement)
