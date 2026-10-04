idf_component_register(SRCS "src/telemetry.c"
                       INCLUDE_DIRS "include"
                       REQUIRES json esp_wifi esp_timer esp_hw_support
                       PRIV_REQUIRES config_manager mqtt_client)
