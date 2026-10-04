# Device workspaces

Projects provide a stable workspace identity for device assignment, memberships,
datastreams, Automation, and command scopes. The API supports basic project CRUD,
device assignment, capabilities, datastream configuration, and the existing device
command endpoint. The page/widget dashboard builder and its mutation endpoints,
validation helpers, and rendering schemas have been removed.

Project details expose basic metadata. Device bindings use the device's explicit
`project_id`, and support summaries use assigned devices and their latest telemetry.

Historical `project_pages` and `project_widgets` ORM definitions and migrations
remain for existing databases and legacy command-context validation. No new page
or widget records are created by project creation. Firmware, OTA, command-center,
and Rule Engine contracts are preserved.
