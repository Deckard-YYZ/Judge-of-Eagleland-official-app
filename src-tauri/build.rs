fn main() {
    println!("cargo:rerun-if-changed=../dist/build-info.json");
    println!("cargo:rerun-if-changed=src");
    let frontend_id = std::fs::read_to_string("../dist/build-info.json")
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value["buildId"].as_str().map(str::to_owned));
    println!(
        "cargo:rustc-env=EAGLE_FRONTEND_BUILD_ID={}",
        frontend_id.as_deref().unwrap_or("unavailable")
    );
    let native_id = || {
        format!(
            "native-dev-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        )
    };
    let build_id = if std::env::var("PROFILE").as_deref() == Ok("release") {
        frontend_id.unwrap_or_else(native_id)
    } else {
        native_id()
    };
    println!("cargo:rustc-env=EAGLE_BUILD_ID={build_id}");
    // tauri-build tracks existing resource files individually. Watch the directory
    // as well so newly added package versions are copied on incremental builds.
    println!("cargo:rerun-if-changed=../content");
    println!("cargo:rerun-if-changed=voice");
    println!("cargo:rerun-if-changed=../artifacts/voice/model");
    println!("cargo:rerun-if-changed=../artifacts/voice/native/lib");
    tauri_build::build();
}
