idf_component_register(SRCS "app_main.c"
                       INCLUDE_DIRS "."
                       REQUIRES nvs_flash esp_event
                                config_manager device_identity
                                wifi_manager mqtt_client telemetry ota_client)
