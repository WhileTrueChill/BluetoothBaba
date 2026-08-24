# The plugin class is instantiated by name via the Tauri runtime (reflection),
# so it and its command methods must survive shrinking/obfuscation.
-keep class app.tauri.blemesh.** { *; }
