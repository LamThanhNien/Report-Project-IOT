"""Seeding defaults must never reset existing tenant quotas or plan records."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace

from app.core.tenant_context import bypass_rls_context


def test_default_plan_seed_is_repeatable_and_preserves_existing_data(monkeypatch):
    path = Path(__file__).resolve().parents[2] / "scripts" / "reset_service_plans.py"
    spec = importlib.util.spec_from_file_location("seed_plan_defaults", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    custom = SimpleNamespace(name="Custom", max_devices=123, features={"ota_update": True})
    trial = SimpleNamespace(name="Trial", max_devices=19, features={"ota_update": True})
    records = [custom, trial]

    class SeedSession:
        def query(self, model):
            assert model is module.ServicePlan, "Seeding must not reassign tenants"
            return self

        def all(self):
            return records.copy()

        def add(self, record):
            records.append(record)

        def delete(self, record):
            raise AssertionError("Seeding must not delete an existing plan")

        def flush(self):
            pass

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(module, "SessionLocal", SeedSession)
    previous_bypass = bypass_rls_context.get()
    module.main()
    module.main()
    assert bypass_rls_context.get() == previous_bypass
    assert sorted(plan.name for plan in records) == [
        "Basic",
        "Custom",
        "Enterprise",
        "Pro",
        "Trial",
    ]
    assert records[0] is custom and custom.max_devices == 123
    assert records[1] is trial and trial.max_devices == 19
    assert trial.features == {"ota_update": True}
