use tauri_plugin_sql::{Migration, MigrationKind};
mod content_resources;
mod diagnostic_health;
pub mod diagnostic_reports;
#[cfg(all(windows, debug_assertions))]
pub mod diagnostic_watchdog;
pub mod diagnostics;
mod voice_audio_stats;
pub mod voice_input;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start the writer before Tauri/plugins so startup failures also have a sink.
    // Windows is the shipping target; fallback remains local and never aborts startup.
    let logs = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("com.eaglejudge.app")
        .join("logs");
    let diagnostics = diagnostics::Diagnostics::new(logs);
    diagnostic_health::begin_run(&diagnostics);
    let health = diagnostic_health::Health::new();
    diagnostics.record(
        serde_json::json!({"source":"host", "event":"host.starting", "level":"info"}),
        "host",
    );
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_storage_tables",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    let panic_diagnostics = diagnostics.clone();
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("non-string panic payload");
        panic_diagnostics.record(serde_json::json!({"source":"host", "event":"host.panic", "level":"error", "data":{"location":info.location().map(|location| diagnostic_health::fatal_summary(&location.to_string(), 512))},"error":{"code":"RUST_PANIC","message":diagnostic_health::fatal_summary(payload,2048),"stack":diagnostic_health::fatal_summary(&std::backtrace::Backtrace::force_capture().to_string(),8000)}}), "host");
        panic_diagnostics.flush(std::time::Duration::from_millis(200));
        previous_hook(info);
    }));
    let result = tauri::Builder::default()
        .manage(diagnostics.clone())
        .manage(health.clone())
        .manage(std::sync::Arc::new(voice_input::VoiceState::default()))
        .setup(|app| {
            use tauri::Manager;
            diagnostics::install(app);
            diagnostic_health::install(
                app,
                app.state::<diagnostics::Diagnostics>().inner().clone(),
                app.state::<std::sync::Arc<diagnostic_health::Health>>()
                    .inner()
                    .clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            content_resources::read_bundled_content_package,
            diagnostics::diagnostics_identity,
            diagnostics::diagnostics_write,
            diagnostic_reports::diagnostics_snapshot,
            diagnostic_reports::diagnostics_set_detailed,
            diagnostic_reports::diagnostics_export,
            diagnostic_health::diagnostics_heartbeat,
            voice_input::voice_infer,
            voice_input::voice_cancel
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:judge.db", migrations)
                .build(),
        )
        .build(tauri::generate_context!());
    if let Err(error) = &result {
        diagnostics.record(serde_json::json!({"source":"host", "event":"host.run_failed", "level":"error", "error":{"message":error.to_string()}}), "host");
    }
    if result.is_err() {
        diagnostics.flush(std::time::Duration::from_millis(500));
    }
    // Diagnostics observes startup failure; it must not convert it into exit 0.
    let app = result.expect("error while running eagle judge application");
    // App::run exits the process directly: shutdown observers belong in Exit, not after run.
    app.run(move |_, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            diagnostic_health::finish_run(&diagnostics, &health);
            diagnostics.flush(std::time::Duration::from_millis(500));
        }
    });
}
