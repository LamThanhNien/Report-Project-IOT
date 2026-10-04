> [!NOTE]
> **TÀI LIỆU ĐẶC TẢ LỊCH SỬ / BẢN THIẾT KẾ HỌC THUẬT (HISTORICAL SPECIFICATION & RESEARCH ROADMAP)**
>
> - **Mục đích tài liệu**: Tài liệu này là bản đặc tả kỹ thuật gốc được thiết kế cho lộ trình nghiên cứu học thuật 24 tháng của đề tài tốt nghiệp.
> - **Phạm vi triển khai thực tế (Current Scoped Implementation)**: Phạm vi hệ thống thực tế đã triển khai và nghiệm thu bảo vệ được quy định chuẩn tại [`docs/scope.md`](../../scope.md).
> - **Các thành phần đã tinh giản (Scoped-out / Future Work)**:
>   1. **AI / TinyML / MLOps**: Module TinyML biên, mô hình IsolationForest server-side và MLOps đã được tinh gọn thành định hướng nghiên cứu mở rộng; hệ thống không còn API `/api/v1/anomaly` hay MQTT topic `ml/*`.
>   2. **Bộ giả lập Simulator**: Toàn bộ cụm simulator phần mềm (`simulate_fleet.py`, `simulate_device.py`) đã được loại bỏ; nghiệm thu và demo thực tế sử dụng 100% phần cứng ESP32 vật lý (xem [`docs/esp32_firmware_setup.md`](../../esp32_firmware_setup.md)).
>   3. **Phân quyền người dùng (RBAC)**: Đã loại bỏ vai trò `platform_engineer` và `tenant_engineer` cùng giao diện `/console/engineer` (xem báo cáo kỹ thuật [`docs/reports/engineer-removal-2026-10-03.md`](../../reports/engineer-removal-2026-10-03.md)). Hệ thống hiện tại vận hành chuẩn 3 vai trò: `admin`, `tenant_owner`, và `viewer` (xem [`docs/access_control.md`](../../access_control.md)).
>   4. **Hạ tầng bổ trợ & Thương mại**: Các dịch vụ Prometheus, Grafana, MLflow, cổng tài liệu API tùy biến, website quảng bá và giao diện billing thương mại đã được gỡ bỏ khỏi stack chạy chính.

# 13 – CI/CD Pipelines

## 1. Mục tiêu CI/CD

Mọi thay đổi phải đi qua:

- lint
- test
- build
- security scan
- artifact upload
- deploy staging/demo nếu phù hợp

## 2. Workflows

```txt
.github/workflows/
├── backend.yml
├── firmware.yml
├── frontend.yml
├── model.yml
├── docker-image.yml
└── deploy-k3s.yml
```

## 3. Backend pipeline

Trigger:

- pull_request touching `backend/**`
- push to main

Jobs:

1. Setup Python 3.11.
2. Install dependencies.
3. Ruff lint.
4. Black check.
5. Pytest.
6. Build Docker image.
7. Trivy scan.
8. Push image on main.

Quality gate:

- pytest pass.
- coverage >= 75% for stable services.
- no high/critical CVE unless documented exception.

## 4. Firmware pipeline

Trigger:

- pull_request touching `firmware/**`
- tag `fw-v*`

Jobs:

1. Checkout.
2. Setup ESP-IDF.
3. Build firmware.
4. Run unit tests if available.
5. Generate size report.
6. On tag: sign firmware.
7. Upload artifact to OTA server or GitHub Release.

Pseudo workflow:

```yaml
name: firmware
on:
  pull_request:
    paths: ['firmware/**']
  push:
    tags: ['fw-v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build ESP-IDF project
        uses: espressif/esp-idf-ci-action@v1
        with:
          esp_idf_version: v5.2
          target: esp32
          path: firmware
      - name: Upload firmware artifact
        uses: actions/upload-artifact@v4
        with:
          name: firmware-bin
          path: firmware/build/*.bin
```

## 5. Admin UI pipeline

Jobs:

1. npm ci.
2. typecheck.
3. eslint.
4. unit tests.
5. build.
6. Docker build.
7. Push image.

## 6. Model pipeline

Trigger:

- manual workflow dispatch.
- scheduled nightly/weekly.
- data drift event optional.

Jobs:

1. Setup Python.
2. Pull dataset snapshot.
3. Validate data.
4. Train model.
5. Evaluate.
6. Quantize.
7. Compare with baseline.
8. Log MLflow.
9. Register model metadata.
10. Generate model card.

Gate:

- new model must not be worse than production by threshold.
- int8 size <= 100KB.
- accuracy >= 85%.

## 7. Docker image tagging

Image tags:

```txt
ghcr.io/<owner>/aifom/device-registry:<git-sha>
ghcr.io/<owner>/aifom/ota-server:<git-sha>
ghcr.io/<owner>/aifom/frontend:<git-sha>
```

Also tag `latest` only for main branch.

## 8. Deploy K3s pipeline

Options:

- Simple: `kubectl apply -k infrastructure/k8s/overlays/staging`.
- Better: ArgoCD watches Git repo.

For đồ án, simple deploy is acceptable.

## 9. Branch protection

- PR required before main.
- Required checks: backend/firmware/ui depending path.
- No force push main.
- Require signed commits optional.

## 10. Release process

### Firmware release

```bash
git tag fw-v1.2.3
git push origin fw-v1.2.3
```

CI builds/signs/uploads.

### Backend release

Merge main -> Docker images pushed -> deploy staging.

### Model release

Model pipeline promotes to Staging -> manual approval -> Production -> canary rollout.

## 11. Acceptance criteria

- PR backend fail nếu test fail.
- Firmware build chạy trên CI.
- Docker image build được.
- Trivy scan chạy.
- Tag firmware tạo artifact.
- Deploy staging bằng một workflow.
