use std::{fs, path::Path};
use tauri::Manager;

// Installed package directory names use portable ASCII IDs (letters, digits,
// hyphens, underscores, dots). Display names remain unrestricted content data.
fn safe_segment(value: &str) -> bool {
    let stem = value.split('.').next().unwrap_or("").to_ascii_lowercase();
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.ends_with('.')
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        && !matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        && !(stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.as_bytes()[3].is_ascii_digit())
}

fn reject_link(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT includes junctions, even those pointing
        // inside the package. This also prevents recursive directory cycles.
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Content resource reparse points are not supported".into());
        }
    }
    if metadata.file_type().is_symlink() {
        return Err("Content resource links are not supported".into());
    }
    Ok(())
}

fn collect_files(root: &Path, directory: &Path, files: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        reject_link(&path)?;
        // Reject links, including Windows junctions that resolve outside the package.
        // Resources are read-only application data, never an arbitrary-path file API.
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() || !canonical.starts_with(root) {
            return Err("Linked or escaping content resources are not supported".into());
        }
        if kind.is_dir() {
            collect_files(root, &path, files)?;
        } else if kind.is_file() {
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
            files.push(
                relative
                    .to_str()
                    .ok_or("Invalid resource filename")?
                    .replace('\\', "/"),
            );
        } else {
            return Err("Unsupported content resource file type".into());
        }
    }
    Ok(())
}

fn read_package(
    resource_dir: &Path,
    package_id: &str,
    version: &str,
) -> Result<serde_json::Value, String> {
    if !safe_segment(package_id) || !safe_segment(version) {
        return Err("Invalid content package path segment".into());
    }
    let content_path = resource_dir.join("content");
    reject_link(&content_path)?;
    let content_root = content_path.canonicalize().map_err(|e| e.to_string())?;
    let package_path = content_root.join(package_id);
    reject_link(&package_path)?;
    let version_path = package_path.join(version);
    reject_link(&version_path)?;
    let root = version_path.canonicalize().map_err(|e| e.to_string())?;
    if !root.starts_with(&content_root) {
        return Err("Content package escapes the resource directory".into());
    }
    let mut inventory = Vec::new();
    collect_files(&root, &root, &mut inventory)?;
    inventory.sort();
    let mut sources = Vec::new();
    for source in &inventory {
        if source.ends_with(".json") {
            let text = fs::read_to_string(root.join(source)).map_err(|e| e.to_string())?;
            sources.push(serde_json::json!({ "source": source, "text": text }));
        }
    }
    Ok(serde_json::json!({ "sources": sources, "fileInventory": inventory }))
}

/// Only transports installed files; the TypeScript loader owns schemas and game rules.
#[tauri::command]
pub fn read_bundled_content_package(
    app: tauri::AppHandle,
    package_id: String,
    version: String,
) -> Result<serde_json::Value, String> {
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    read_package(&resource_dir, &package_id, &version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_and_windows_aliases() {
        for segment in [
            "",
            ".",
            "..",
            "../other",
            "a\\b",
            "C:",
            "a%2fb",
            "a.",
            "NUL",
            "com1.json",
        ] {
            assert!(!safe_segment(segment), "{segment}");
        }
        assert!(safe_segment("minimal-test-package"));
        assert!(safe_segment("1.0.0"));
    }

    #[test]
    fn reads_real_package_with_full_inventory() {
        let resources = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let value = read_package(resources, "minimal-test-package", "1.0.0").unwrap();
        assert_eq!(value["sources"].as_array().unwrap().len(), 3);
        assert!(value["fileInventory"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v == "media/videos/ending-balanced.mp4"));
        assert!(read_package(resources, "minimal-test-package", "9.9.9").is_err());
    }
}
