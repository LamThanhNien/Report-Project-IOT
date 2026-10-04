idf_component_register(SRCS "src/aifom_mqtt.c"
                       INCLUDE_DIRS "include"
                       REQUIRES mqtt esp_event lwip mdns
                       PRIV_REQUIRES config_manager device_identity)
