import urllib.request, json, subprocess
from app.core.ota_tokens import create_ota_download_token

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

print(f'Job: {job_id}, FW: {fw_id}, Dev: {device_uid}, Tenant: {tenant_id}')

token = create_ota_download_token(
    firmware_id=fw_id,
    job_id=job_id,
    device_uid=device_uid,
    tenant_id=tenant_id,
    campaign_id=camp_id
)
url = f'http://127.0.0.1:8002/api/v1/firmware/ota-download/{fw_id}?token={token}'
req = urllib.request.Request(url)
try:
    with urllib.request.urlopen(req) as res:
        print('STATUS:', res.status)
        print('BODY:', res.read().decode())
except urllib.error.HTTPError as e:
    print('STATUS:', e.code)
    print('BODY:', e.read().decode())
