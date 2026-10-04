import importlib.util
from pathlib import Path


def module():
    path = Path(__file__).resolve().parents[2] / "scripts" / "seed_demo.py"
    spec = importlib.util.spec_from_file_location("demo_seed_contract", path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_seed_creates_only_accounts_and_workspace(monkeypatch):
    seed = module()
    created = []

    def record_owned(db, model, seed_key, **fields):
        from types import SimpleNamespace

        created.append(model.__name__)
        return SimpleNamespace(id=seed.demo_id(seed_key), **fields)

    class EmptySession:
        def execute(self, statement):
            return None

        def scalar(self, statement):
            return None

    monkeypatch.setattr(seed, "owned", record_owned)
    monkeypatch.setattr(seed, "hash_password", lambda value: "hashed:" + value)
    monkeypatch.setattr(seed, "verify_password", lambda password, hashed: True)
    seed.seed(EmptySession(), {f"VITE_DEMO_{label}_PASSWORD": "demo-password" for label in seed.ACCOUNTS})
    assert set(created) == {"ServicePlan", "Tenant", "TenantProject", "User", "ProjectMember"}
    assert created.count("User") == 3
    assert created.count("ProjectMember") == 2


def test_demo_accounts_have_dedicated_roles_and_stable_unique_ids():
    seed = module()
    assert {role for _, role, _ in seed.ACCOUNTS.values()} == {
        "admin",
        "tenant_owner",
        "viewer",
    }
    assert all(email.startswith("demo-") for email, _, _ in seed.ACCOUNTS.values())
    assert seed.demo_id("tenant") == seed.demo_id("tenant")
    assert len({seed.demo_id("user-" + label) for label in seed.ACCOUNTS}) == 3


def test_local_config_does_not_generate_device_credentials(monkeypatch):
    seed = module()
    monkeypatch.setattr(seed, "dotenv_values", lambda path: {})
    config = seed.local_config()
    assert all(key.startswith("VITE_DEMO_") for key in config)
