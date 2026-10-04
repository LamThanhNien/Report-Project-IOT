import logging
import sys
import asyncio

logging.basicConfig(level=logging.DEBUG, stream=sys.stdout)

from app.main import app
from app.db.session import SessionLocal, sync_tenant_context_in_pg

def test():
    with SessionLocal() as new_db:
        sync_tenant_context_in_pg(new_db)
        print("Success sync!")

if __name__ == "__main__":
    test()
