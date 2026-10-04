import logging
import sys

# Configure logging to see the output
logging.basicConfig(level=logging.DEBUG, stream=sys.stdout)

# Import all models to prevent NoReferencedTableError
from app.main import app

from app.db.session import SessionLocal
from app.shared.application.audit_service import log_event_best_effort

def test():
    log_event_best_effort(
        action="TEST_ACTION",
        user_id=None,
        tenant_id=None,
        resource_type="test",
        resource_id="123",
        detail={"test": "data"},
        ip_address="127.0.0.1"
    )

if __name__ == "__main__":
    test()
