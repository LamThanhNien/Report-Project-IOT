
from app.db.session import SessionLocal
from app.bounded_contexts.firmware_ota.presentation.router_firmware import _ensure_ota_resource_scope, decode_ota_download_token, get_firmware_by_id
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
import uuid

db = SessionLocal()
payload = decode_ota_download_token('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhaWZvbS1iYWNrZW5kIiwiYXVkIjoiYWlmb20tb3RhLWRldmljZSIsInN1YiI6Im90YS1kb3dubG9hZCIsInR5cCI6Im90YS1kb3dubG9hZCtqd3QiLCJqdGkiOiIzZjJmNmY3Yy0yYTI3LTQwNGMtYjIxMi00MWE4NzZiZDVlYWEiLCJmaXJtd2FyZV9pZCI6IjhiYjU0OWI3LWNiNTEtNGUxOC1hMGM2LTBiNTg1NDcwZjhhOSIsImpvYl9pZCI6IjFhOWNjYzIzLTZjMGItNGUwOC1iMzYxLTFlYTNhOGU3NDI2MSIsImRldmljZV91aWQiOiJlc3AzMi1kZW1vLTAwMSIsInRlbmFudF9pZCI6IiIsImlhdCI6MTc4Mzc2NzA3NSwibmJmIjoxNzgzNzY3MDc1LCJleHAiOjE3ODM3Njc5NzV9.oycS5eKKrkx-NGcwmRfFpjF9Sin5mS2s1ke1jsoy0ks')
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
