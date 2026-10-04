from app.main import app
from app.db.session import SessionLocal
from app.bounded_contexts.firmware_ota.presentation.router_firmware import _ensure_ota_resource_scope, decode_ota_download_token, get_firmware_by_id
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
import uuid

# token from previous step
token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhaWZvbS1iYWNrZW5kIiwiYXVkIjoiYWlmb20tb3RhLWRldmljZSIsInN1YiI6Im90YS1kb3dubG9hZCIsInR5cCI6Im90YS1kb3dubG9hZCtqd3QiLCJqdGkiOiJkNDg4NDgyZC1kMGQxLTQ2YzktOWQwNi0wYThkMGRkZDE5OGIiLCJmaXJtd2FyZV9pZCI6IjEwZGU1NTgzLTQ5ZTQtNDRiOS05OWMwLWVmMWY5MWQyODhmMiIsImpvYl9pZCI6IjdjYjVjMzA5LTA2M2ItNGZkMy1hYTc5LWYzZjY4MTlkN2UyOCIsImRldmljZV91aWQiOiJlc3AzMnBhcmEiLCJ0ZW5hbnRfaWQiOiIzOWM0M2I2My1iNmU4LTRlMjctOGM5Ni1kMDAxNDU2MjU5YWMiLCJpYXQiOjE3ODI4MzQzMjksIm5iZiI6MTc4MjgzNDMyOSwiZXhwIjoxNzgyODM2MTI5fQ.UbF8oC7eHyllyrGVgOygxZR-8lgtSvAoKs6pPoKr2VM"

db = SessionLocal()
payload = decode_ota_download_token(token)
job_id = uuid.UUID(str(payload.get('job_id')))
job = db.get(OtaJob, job_id)
if job is None:
    print('JOB IS NONE')
else:
    print('JOB FOUND', job.id)
    device = db.get(Device, job.device_id)
    fw = get_firmware_by_id(db, job.firmware_version_id)
    try:
        _ensure_ota_resource_scope(payload, str(fw.id), job, device, fw, None)
        print('SCOPE OK')
    except Exception as e:
        print('SCOPE EXCEPTION:', type(e), getattr(e, 'detail', str(e)))
