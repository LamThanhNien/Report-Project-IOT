# main

`app_main.c` boot sequence:

1. init NVS
2. load device UID
3. init relay/LED GPIO outputs
4. connect Wi-Fi
5. connect MQTT
6. start OTA client
7. start telemetry/status tasks
8. subscribe command topic and execute runtime commands
