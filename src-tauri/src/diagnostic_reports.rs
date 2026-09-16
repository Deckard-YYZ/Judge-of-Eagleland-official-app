//! Fixed-path, bounded evidence export. Never opens the game database or dump files.
use crate::diagnostics::{timestamp_ms, Diagnostics};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    time::Duration,
};
const FILE_LIMIT: u64 = 256 * 1024;
const REPORT_LIMIT: usize = 4 * 1024 * 1024;
const KEYS: &[&str] = &[
    "coverage",
    "omittedRecent",
    "memoryWindow",
    "earlierRecordsUnavailable",
    "timestamp",
    "timestampMs",
    "receivedAtMs",
    "sequence",
    "hostSequence",
    "source",
    "event",
    "level",
    "operationId",
    "sessionId",
    "runId",
    "buildId",
    "frontendBuildId",
    "development",
    "process",
    "data",
    "error",
    "name",
    "message",
    "stack",
    "cause",
    "code",
    "identity",
    "recent",
    "transport",
    "heartbeat",
    "queued",
    "dropped",
    "writeFailures",
    "failures",
    "active",
    "unavailable",
    "stopped",
    "pending",
    "degraded",
    "detailedUntil",
    "commandType",
    "storyId",
    "stepId",
    "checkpoint",
    "expectedRevision",
    "revision",
    "contentPackageId",
    "contentVersion",
    "phase",
    "outcome",
    "actionId",
    "recognition",
    "inputLength",
    "durationMs",
    "status",
    "runtime",
    "storageMode",
    "reason",
    "caseId",
    "locale",
    "count",
    "attempt",
    "queueLength",
    "fromRevision",
    "toRevision",
    "previousStatus",
    "nextStatus",
    "schemaVersion",
    "fromVersion",
    "toVersion",
    "resource",
    "issueCount",
    "path",
    "operationType",
    "stage",
    "issues",
    "feedback",
    "componentStack",
    "line",
    "column",
    "type",
    "attributeId",
    "actualDelta",
    "requestedDelta",
    "value",
    "version",
    "os",
    "arch",
    "location",
    "markerWritten",
    "mainAgeMs",
    "frontendAgeMs",
    "visible",
    "gap",
    "debugger",
    "kind",
    "pid",
    "generation",
    "startedAtMs",
    "finishedAtMs",
    "scope",
    "diagnosis",
    "fixture",
    "file",
];
fn text(value: &str) -> String {
    let value = crate::diagnostic_health::fatal_summary(value, 2048);
    // Best-effort token redaction supplements structural allowlists. Free-form
    // exception text is never guaranteed anonymous: users must review exports.
    value
        .split_inclusive(char::is_whitespace)
        .map(|part| {
            let lower = part.to_ascii_lowercase();
            if ["password", "token", "authorization", "api_key", "api-key"]
                .iter()
                .any(|key| lower.contains(key))
            {
                "<redacted>".to_string()
            } else if lower.contains(":\\users\\")
                || lower.contains(":/users/")
                || lower.starts_with("/home/")
                || lower.starts_with("/users/")
            {
                "<user-path>".to_string()
            } else if (lower.starts_with("https://") || lower.starts_with("http://"))
                && lower.contains('@')
            {
                "<credential-url>".to_string()
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("")
}
fn clean(value: &Value, depth: usize) -> Value {
    if depth > 7 {
        return json!("[truncated]");
    }
    match value {
        Value::String(s) => json!(text(s)),
        Value::Array(a) => Value::Array(a.iter().take(256).map(|v| clean(v, depth + 1)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(key, _)| KEYS.contains(&key.as_str()))
                .take(80)
                .map(|(k, v)| (k.clone(), clean(v, depth + 1)))
                .collect(),
        ),
        _ => value.clone(),
    }
}
/// Reject links/reparse points in every existing ancestor, not just the leaf.
fn safe(path: &Path) -> bool {
    for ancestor in path.ancestors() {
        if let Ok(m) = fs::symlink_metadata(ancestor) {
            if m.file_type().is_symlink() {
                return false;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if m.file_attributes() & 0x400 != 0 {
                    return false;
                }
            }
        }
    }
    true
}
fn read_evidence(path: &Path, lines: bool) -> Value {
    if !safe(path) {
        return json!({"missing":true,"reason":"link_rejected"});
    }
    let result = (|| -> std::io::Result<Value> {
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(0x00200000);
        }
        let mut file = options.open(path)?;
        let metadata = file.metadata()?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(std::io::ErrorKind::PermissionDenied.into());
            }
        }
        if !metadata.is_file() {
            return Err(std::io::ErrorKind::InvalidInput.into());
        }
        let size = metadata.len();
        let truncated = size > FILE_LIMIT;
        if truncated {
            file.seek(SeekFrom::Start(size - FILE_LIMIT))?;
        }
        let mut bytes = Vec::new();
        file.take(FILE_LIMIT).read_to_end(&mut bytes)?;
        let content = String::from_utf8_lossy(&bytes);
        let mut malformed = 0;
        let mut values = Vec::new();
        if lines {
            for line in content.lines().skip(usize::from(truncated)) {
                match serde_json::from_str::<Value>(line) {
                    Ok(value) => values.push(clean(&value, 0)),
                    Err(_) => malformed += 1,
                }
            }
        } else {
            match serde_json::from_str::<Value>(&content) {
                Ok(value) => values.push(clean(&value, 0)),
                Err(_) => malformed += 1,
            }
        }
        let omitted = values.len().saturating_sub(256);
        Ok(
            json!({"records":values.into_iter().skip(omitted).collect::<Vec<_>>(),"truncated":truncated || omitted>0,"omittedRecords":omitted,"malformedRecords":malformed,"sourceBytes":size}),
        )
    })();
    result.unwrap_or_else(|_| json!({"missing":true,"reason":"unavailable"}))
}
fn evidence(diagnostics: &Diagnostics) -> Value {
    let Some(root) = diagnostics.directory.parent() else {
        return json!([]);
    };
    if !safe(root) {
        return json!([]);
    }
    let mut runs = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            safe(p)
                && p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit() || b == b'-'))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    runs.sort();
    runs.reverse();
    let mut result = Vec::new();
    // Current + latest closed runs only; an active second instance is not an exit.
    runs.retain(|p| p != &diagnostics.directory);
    runs.insert(0, diagnostics.directory.clone());
    for directory in runs {
        if result.len() == 4 {
            break;
        }
        let current = directory == diagnostics.directory;
        let lock = if !current && safe(&directory.join("writer.lock")) {
            crate::diagnostics::open_run_lock(&directory).ok()
        } else {
            None
        };
        if !current && lock.is_none() {
            continue;
        }
        let mut files = serde_json::Map::new();
        for name in [
            "runtime.3.jsonl",
            "runtime.2.jsonl",
            "runtime.1.jsonl",
            "runtime.jsonl",
            "run-start.json",
            "run-clean.json",
            "health.json",
            "watchdog.jsonl",
        ] {
            files.insert(
                name.to_string(),
                read_evidence(&directory.join(name), name.ends_with("jsonl")),
            );
        }
        result.push(json!({"runId":directory.file_name().and_then(|n|n.to_str()),"current":current,"exit":if current{"running"}else if directory.join("run-clean.json").is_file(){"clean"}else{"unclean_not_proof_of_crash"},"files":files}));
    }
    json!(result)
}
#[tauri::command]
pub fn diagnostics_set_detailed(state: tauri::State<'_, Diagnostics>, enabled: bool) {
    state.set_detailed(enabled);
}
#[tauri::command]
pub async fn diagnostics_snapshot(state: tauri::State<'_, Diagnostics>) -> Result<Value, String> {
    let diagnostics = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut value = diagnostics.status();
        value["build"] = build_info();
        value["environment"] = json!({"os":std::env::consts::OS,"arch":std::env::consts::ARCH});
        value["health"] = read_evidence(&diagnostics.directory.join("health.json"), false);
        value
    })
    .await
    .map_err(|_| "Snapshot worker unavailable".into())
}
fn reduce_records(value: &mut Value) -> usize {
    let mut removed = 0;
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if key == "records" || key == "recent" {
                    if let Some(records) = value.as_array_mut() {
                        let count = records.len().saturating_sub(1).div_ceil(2);
                        records.drain(..count);
                        removed += count;
                    }
                } else {
                    removed += reduce_records(value);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                removed += reduce_records(value);
            }
        }
        _ => {}
    }
    removed
}

fn export(diagnostics: &Diagnostics, frontend: Value) -> Result<String, String> {
    if serde_json::to_vec(&frontend)
        .map(|b| b.len() > 512 * 1024)
        .unwrap_or(true)
    {
        return Err("Frontend summary exceeds limit".into());
    }
    let flushed = diagnostics.flush(Duration::from_millis(500));
    let report_id = format!("{}-{}", diagnostics.run_id, timestamp_ms());
    let mut report = json!({"protocolVersion":1,"reportId":report_id,"createdAtMs":timestamp_ms(),"build":build_info(),"environment":{"os":std::env::consts::OS,"arch":std::env::consts::ARCH},"writer":clean(&diagnostics.status(),0),"frontend":clean(&frontend,0),"flushAcknowledged":flushed,"runs":evidence(diagnostics),"limits":{"runs":4,"bytesPerFile":FILE_LIMIT,"recordsPerFile":256,"reportBytes":REPORT_LIMIT},"limitations":["Tail windows only; missing events do not prove operations never occurred","No save, database, raw player input or dump attachments","Best-effort exception redaction; review before sharing","Heartbeat responsiveness is not business success","Only current and recent closed runs are included"]});
    let mut omitted = 0;
    let bytes = loop {
        report["globalTruncation"] = json!({"truncated":omitted>0,"omittedRecords":omitted});
        let bytes = serde_json::to_vec_pretty(&report).map_err(|_| "Serialization failed")?;
        if bytes.len() <= REPORT_LIMIT {
            break bytes;
        }
        let removed = reduce_records(&mut report);
        if removed == 0 {
            return Err("Report metadata exceeds limit".into());
        }
        omitted += removed;
    };
    let root = diagnostics
        .directory
        .parent()
        .and_then(Path::parent)
        .ok_or("Report root unavailable")?
        .join("reports");
    if !safe(&root) {
        return Err("Report directory link rejected".into());
    }
    fs::create_dir_all(&root).map_err(|_| "Report directory unavailable")?;
    if !safe(&root) {
        return Err("Report directory link rejected".into());
    }
    let path = root.join(format!("report-{report_id}.json"));
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|_| "Cannot create report")?;
    if file.write_all(&bytes).is_err() {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err("Cannot write report".into());
    }
    drop(file);
    let mut reports = fs::read_dir(&root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            safe(p)
                && p.is_file()
                && p.file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| {
                        s.starts_with("report-")
                            && s.ends_with(".json")
                            && s[7..s.len() - 5]
                                .bytes()
                                .all(|b| b.is_ascii_digit() || b == b'-')
                    })
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();
    reports.sort();
    let excess = reports.len().saturating_sub(8);
    for old in reports.into_iter().take(excess) {
        let _ = fs::remove_file(old);
    }
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn diagnostics_export(
    state: tauri::State<'_, Diagnostics>,
    frontend: Value,
) -> Result<String, String> {
    let diagnostics = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || export(&diagnostics, frontend))
        .await
        .map_err(|_| "Export worker unavailable".to_string())?
}
pub fn build_info() -> Value {
    json!({"buildId":env!("EAGLE_BUILD_ID"),"frontendBuildId":env!("EAGLE_FRONTEND_BUILD_ID"),"version":env!("CARGO_PKG_VERSION"),"development":cfg!(debug_assertions),"arch":std::env::consts::ARCH})
}
pub fn build_info_mode() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--diagnostics-build-info") {
        return false;
    }
    // stdout works when launched with inherited/redirected handles, including release.
    let _ = writeln!(std::io::stdout(), "{}", build_info());
    true
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_closed_run_and_rejects_sensitive_fields_and_bad_records() {
        let root = std::env::temp_dir().join(format!("eagle-report-test-{}", timestamp_ms()));
        let logs = root.join("logs");
        let old = logs.join("1-1-1");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("runtime.jsonl"),"invalid\n{\"event\":\"save.commit.started\",\"text\":\"private\",\"data\":{\"displayName\":\"private\",\"revision\":3}}\n").unwrap();
        let diagnostics = Diagnostics::new(logs);
        let path = export(&diagnostics, json!({"password":"secret"})).unwrap();
        let contents = fs::read_to_string(path).unwrap();
        assert!(!contents.contains("private"));
        assert!(!contents.contains("secret"));
        assert!(contents.contains("save.commit.started"));
        assert!(contents.contains("malformedRecords"));
        assert!(contents.contains("unclean_not_proof_of_crash"));
        assert!(contents.contains("missing"));
    }
    #[test]
    fn full_runs_still_export_with_global_truncation() {
        let root = std::env::temp_dir().join(format!("eagle-report-full-{}", timestamp_ms()));
        let logs = root.join("logs");
        let line = format!(
            "{}\n",
            json!({"event":"test","error":{"message":"x".repeat(1900)}})
        );
        for run in 1..=3 {
            let directory = logs.join(format!("{run}-1-1"));
            fs::create_dir_all(&directory).unwrap();
            for name in [
                "runtime.jsonl",
                "runtime.1.jsonl",
                "runtime.2.jsonl",
                "runtime.3.jsonl",
            ] {
                fs::write(directory.join(name), line.repeat(200)).unwrap();
            }
        }
        let diagnostics = Diagnostics::new(logs);
        assert!(diagnostics.flush(Duration::from_millis(500)));
        for name in [
            "runtime.jsonl",
            "runtime.1.jsonl",
            "runtime.2.jsonl",
            "runtime.3.jsonl",
        ] {
            fs::write(diagnostics.directory.join(name), line.repeat(200)).unwrap();
        }
        fs::write(
            diagnostics.directory.join("health.json"),
            r#"{"status":"frontend_overdue"}"#,
        )
        .unwrap();
        let path = export(&diagnostics, json!({})).unwrap();
        let bytes = fs::read(path).unwrap();
        assert!(bytes.len() <= REPORT_LIMIT);
        let report: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(report["globalTruncation"]["truncated"], true);
        assert!(
            report["globalTruncation"]["omittedRecords"]
                .as_u64()
                .unwrap()
                > 0
        );
        assert_eq!(
            report["runs"][0]["files"]["health.json"]["records"][0]["status"],
            "frontend_overdue"
        );
        assert_eq!(report["runs"].as_array().unwrap().len(), 4);
        assert!(report["runs"]
            .as_array()
            .unwrap()
            .iter()
            .skip(1)
            .all(|run| run["files"]["runtime.jsonl"]["truncated"] == true));
    }
    #[cfg(windows)]
    #[test]
    fn rejects_directory_junction_evidence() {
        use std::os::windows::process::CommandExt;
        let root = std::env::temp_dir().join(format!("eagle-report-link-{}", timestamp_ms()));
        let real = root.join("real");
        let link = root.join("link");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("health.json"), "{}").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&real)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(!safe(&link));
        assert_eq!(
            read_evidence(&link.join("health.json"), false)["reason"],
            "link_rejected"
        );
        fs::remove_dir(&link).unwrap();
    }
    #[test]
    fn caps_tail_and_report_retention() {
        let root = std::env::temp_dir().join(format!("eagle-report-cap-{}", timestamp_ms()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("runtime.jsonl");
        fs::write(&path, "{\"event\":\"test\"}\n".repeat(20000)).unwrap();
        let result = read_evidence(&path, true);
        assert_eq!(result["truncated"], true);
        assert_eq!(result["records"].as_array().unwrap().len(), 256);
        let diagnostics = Diagnostics::new(root.join("logs"));
        for _ in 0..10 {
            export(&diagnostics, json!({})).unwrap();
        }
        assert!(fs::read_dir(root.join("reports")).unwrap().count() <= 8);
        assert!(export(&diagnostics, json!({"recent":"x".repeat(600*1024)})).is_err());
    }
}
