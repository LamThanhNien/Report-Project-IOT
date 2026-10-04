idf_component_register(SRCS "src/ota_client.c"
                       INCLUDE_DIRS "include"
                       REQUIRES json app_update esp_http_client mbedtls esp_partition
                       PRIV_REQUIRES mqtt_client device_identity config_manager)
