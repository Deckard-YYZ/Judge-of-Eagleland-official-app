use tauri_plugin_sql::{Migration, MigrationKind};
mod content_resources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_storage_tables",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            content_resources::read_bundled_content_package
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:judge.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running eagle judge application");
}
