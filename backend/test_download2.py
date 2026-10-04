import urllib.request, json, subprocess
from app.core.ota_tokens import create_ota_download_token
import traceback
import uuid

res = subprocess.run(['docker', 'exec', 'aifom-postgres-1', 'psql', '-U', 'aifom', '-d', 'aifom', '-t', '-c', 
                        'SELECT id, firmware_version_id, device_id, tenant_id, campaign_id, status FROM ota_jobs ORDER BY created_at DESC LIMIT 1;'], 
                        capture_output=True, text=True)
cols = [x.strip() for x in res.stdout.strip().split('|')]
job_id, fw_id, dev_id, tenant_id, camp_id, status = cols
if not camp_id:
    camp_id = None

res = subprocess.run(['docker', 'exec', 'aifom-postgres-1', 'psql', '-U', 'aifom', '-d', 'aifom', '-t', '-c', 
                        f"SELECT device_uid FROM devices WHERE id = '{dev_id}';"], 
                        capture_output=True, text=True)
device_uid = res.stdout.strip()

token = create_ota_download_token(
    firmware_id=fw_id,
    job_id=job_id,
    device_uid=device_uid,
    tenant_id=tenant_id,
    campaign_id=camp_id
)

print(f'Token generated: {token}')

script = f"""
from app.db.session import SessionLocal
from app.bounded_contexts.firmware_ota.presentation.router_firmware import _ensure_ota_resource_scope, decode_ota_download_token, get_firmware_by_id
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
import uuid

db = SessionLocal()
payload = decode_ota_download_token('{token}')
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
"""
with open('test_scope.py', 'w') as f:
    f.write(script)

res = subprocess.run(['docker', 'exec', 'aifom-api-1', 'python', 'test_scope.py'], capture_output=True, text=True)
print('DOCKER OUTPUT:')
print(res.stdout)
print(res.stderr)
