from app.main import app
from app.db.session import SessionLocal
from app.bounded_contexts.tenant_management.presentation.router_client import _build_client_ota_payload
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.firmware_ota.application.use_cases import get_firmware_by_id
import json

db = SessionLocal()
job = db.query(OtaJob).order_by(OtaJob.created_at.desc()).first()
device = db.get(Device, job.device_id)
fw = get_firmware_by_id(db, job.firmware_version_id)

payload = _build_client_ota_payload(job.id, fw, device.device_uid, job.tenant_id, getattr(job, 'campaign_id', None))
json_str = json.dumps(payload)
print('PAYLOAD_LENGTH:', len(json_str))
print('PAYLOAD:', json_str)
