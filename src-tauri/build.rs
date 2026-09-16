fn main() {
    // tauri-build tracks existing resource files individually. Watch the directory
    // as well so newly added package versions are copied on incremental builds.
    println!("cargo:rerun-if-changed=../content");
    tauri_build::build();
}
