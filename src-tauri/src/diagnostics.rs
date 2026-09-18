//! Local diagnostics are an observer, never a participant in save transactions.
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_RECORD_BYTES: usize = 32 * 1024;
enum WriterMessage {
    Record(Value),
    Flush(mpsc::Sender<()>),
    CleanExit(Value, mpsc::Sender<bool>),
}
#[derive(Clone)]
pub struct Diagnostics {
    pub run_id: String,
    detailed_deadline: Arc<Mutex<Option<std::time::Instant>>>,
    sender: SyncSender<WriterMessage>,
    dropped: Arc<AtomicU64>,
    failures: Arc<AtomicU64>,
    sequence: Arc<AtomicU64>,
    recent: Arc<Mutex<std::collections::VecDeque<Value>>>,
    pub directory: PathBuf,
}

pub(crate) fn open_run_lock(directory: &PathBuf) -> std::io::Result<std::fs::File> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options.open(directory.join("writer.lock"))
}

/// On Windows the exclusive run lock protects active instances during retention.
/// Other platforms keep historical runs until a native locking strategy is added.
#[cfg(windows)]
fn prune_closed_runs(root: &PathBuf, current: &PathBuf) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut directories: Vec<_> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|t| t.is_dir() && !t.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|s| s.to_str())
                .map(|s| s.bytes().all(|c| c.is_ascii_digit() || c == b'-'))
                .unwrap_or(false)
        })
        .collect();
    directories.sort();
    let excess = directories.len().saturating_sub(8);
    for path in directories.into_iter().take(excess) {
        if path == *current {
            continue;
        }
        if let Ok(lock) = open_run_lock(&path) {
            use std::os::windows::fs::OpenOptionsExt;
            let watchdog_lock = OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .share_mode(0)
                .open(path.join("watchdog.lock"));
            let Ok(watchdog_lock) = watchdog_lock else {
                continue;
            };
            // Only our bounded log files are removed; never recurse through a run.
            for name in [
                "runtime.jsonl",
                "runtime.1.jsonl",
                "runtime.2.jsonl",
                "runtime.3.jsonl",
                "health.json",
                "health.tmp",
                "run-start.json",
                "run-start.tmp",
                "run-clean.json",
                "run-clean.tmp",
                "watchdog.jsonl",
                "hang-1.dmp",
                "hang-2.dmp",
            ] {
                let _ = fs::remove_file(path.join(name));
            }
            drop(lock);
            drop(watchdog_lock);
            let _ = fs::remove_file(path.join("watchdog.lock"));
            let _ = fs::remove_file(path.join("writer.lock"));
            let _ = fs::remove_dir(path);
        }
    }
}

pub fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn write_record(directory: &PathBuf, value: &Value) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let path = directory.join("runtime.jsonl");
    let bytes = serde_json::to_vec(value)?;
    if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) + bytes.len() as u64 > MAX_BYTES {
        let oldest = directory.join("runtime.3.jsonl");
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..3).rev() {
            let from = directory.join(format!("runtime.{index}.jsonl"));
            if from.exists() {
                fs::rename(from, directory.join(format!("runtime.{}.jsonl", index + 1)))?;
            }
        }
        if path.exists() {
            fs::rename(&path, directory.join("runtime.1.jsonl"))?;
        }
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    file.write_all(&bytes)?;
    file.write_all(b"\n")?;
    file.flush()
}

impl Diagnostics {
    pub fn new(directory: PathBuf) -> Self {
        static RUN_SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let run_id = format!(
            "{}-{}-{}",
            timestamp_ms(),
            std::process::id(),
            RUN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let root = directory;
        let directory = root.join(&run_id);
        let (sender, receiver) = mpsc::sync_channel::<WriterMessage>(256);
        let failures = Arc::new(AtomicU64::new(0));
        let worker_failures = failures.clone();
        let worker_directory = directory.clone();
        let spawn = std::thread::Builder::new()
            .name("diagnostics-writer".into())
            .spawn(move || {
                let run_lock = fs::create_dir_all(&worker_directory)
                    .and_then(|_| open_run_lock(&worker_directory));
                if run_lock.is_err() {
                    worker_failures.fetch_add(1, Ordering::Relaxed);
                }
                #[cfg(windows)]
                if run_lock.is_ok() {
                    prune_closed_runs(&root, &worker_directory);
                }
                for message in receiver {
                    match message {
                        WriterMessage::CleanExit(marker, acknowledge) => {
                            let success = run_lock.is_ok()
                                && crate::diagnostic_health::write_json(
                                    &worker_directory.join("run-clean.json"),
                                    &marker,
                                )
                                .is_ok();
                            if !success {
                                worker_failures.fetch_add(1, Ordering::Relaxed);
                            }
                            let _ = acknowledge.send(success);
                        }
                        WriterMessage::Flush(acknowledge) => {
                            let _ = acknowledge.send(());
                        }
                        WriterMessage::Record(record) => {
                            if cfg!(debug_assertions) {
                                let _ = writeln!(std::io::stderr(), "{record}");
                            }
                            if run_lock.is_err()
                                || write_record(&worker_directory, &record).is_err()
                            {
                                worker_failures.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                    }
                }
            });
        if spawn.is_err() {
            failures.fetch_add(1, Ordering::Relaxed);
        }
        Self {
            run_id,
            detailed_deadline: Arc::new(Mutex::new(None)),
            sender,
            dropped: Arc::new(AtomicU64::new(0)),
            failures,
            sequence: Arc::new(AtomicU64::new(0)),
            recent: Arc::new(Mutex::new(std::collections::VecDeque::new())),
            directory,
        }
    }

    pub fn set_detailed(&self, enabled: bool) {
        if let Ok(mut deadline) = self.detailed_deadline.lock() {
            *deadline =
                enabled.then(|| std::time::Instant::now() + std::time::Duration::from_secs(300));
        }
    }

    pub fn record(&self, mut record: Value, process: &str) {
        if !cfg!(debug_assertions)
            && record["level"] == "debug"
            && !self
                .detailed_deadline
                .lock()
                .map(|d| {
                    d.map(|deadline| std::time::Instant::now() < deadline)
                        .unwrap_or(false)
                })
                .unwrap_or(false)
        {
            return;
        }
        if serde_json::to_vec(&record)
            .map(|v| v.len() > MAX_RECORD_BYTES)
            .unwrap_or(true)
        {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let Some(object) = record.as_object_mut() else {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        if process == "frontend" {
            object.retain(|key, _| {
                [
                    "timestamp",
                    "sequence",
                    "source",
                    "event",
                    "level",
                    "operationId",
                    "sessionId",
                    "data",
                    "error",
                ]
                .contains(&key.as_str())
            });
            if let Some(data) = object.get_mut("data").and_then(Value::as_object_mut) {
                data.retain(|key, _| {
                    [
                        "modelId",
                        "sampleRate",
                        "sampleCount",
                        "maxFrameRms",
                        "frameDurationMs",
                        "rms",
                        "peak",
                        "rmsDbfs",
                        "dbfsFloor",
                        "dbfsFloored",
                        "nearZeroRatio",
                        "nearZeroThreshold",
                        "clippedRatio",
                        "clippingThreshold",
                        "invalidSampleCount",
                        "audioContextSampleRate",
                        "channelCount",
                        "echoCancellation",
                        "noiseSuppression",
                        "autoGainControl",
                        "maxActivePaths",
                        "trailingBlanks",
                        "keywordsScore",
                        "keywordsThreshold",
                        "keywordCount",
                        "loadMode",
                        "loadDurationMs",
                        "decodeCount",
                        "decodeDurationMs",
                        "hitCount",
                        "actionIds",
                        "unknownReason",
                        "inputMode",
                        "frontendBuildId",
                        "issues",
                        "feedback",
                        "componentStack",
                        "line",
                        "column",
                        "commandType",
                        "storyId",
                        "stepId",
                        "checkpoint",
                        "expectedRevision",
                        "revision",
                        "contentPackageId",
                        "contentVersion",
                        "code",
                        "phase",
                        "outcome",
                        "actionId",
                        "recognition",
                        "inputLength",
                        "durationMs",
                        "status",
                        "runtime",
                        "storageMode",
                        "transport",
                        "reason",
                        "caseId",
                        "source",
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
                    ]
                    .contains(&key.as_str())
                });
            } else {
                object.remove("data");
            }
            if let Some(error) = object.get_mut("error").and_then(Value::as_object_mut) {
                error.retain(|key, _| {
                    ["name", "message", "stack", "cause", "code"].contains(&key.as_str())
                });
            }
        }
        object.insert("runId".into(), json!(self.run_id));
        object.insert("buildId".into(), json!(env!("EAGLE_BUILD_ID")));
        object.insert("process".into(), json!(process));
        object.insert(
            "hostSequence".into(),
            json!(self.sequence.fetch_add(1, Ordering::Relaxed) + 1),
        );
        object.insert("receivedAtMs".into(), json!(timestamp_ms()));
        if serde_json::to_vec(&record)
            .map(|v| v.len() > MAX_RECORD_BYTES)
            .unwrap_or(true)
        {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        if let Ok(mut recent) = self.recent.try_lock() {
            if recent.len() >= 128 {
                recent.pop_front();
            }
            recent.push_back(record.clone());
        }
        if self.sender.try_send(WriterMessage::Record(record)).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Explicit shutdown/export use only; business calls never wait for a flush.
    pub fn mark_clean_exit(&self) -> bool {
        let (sender, receiver) = mpsc::channel();
        self.sender
            .try_send(WriterMessage::CleanExit(
                json!({"runId":self.run_id,"finishedAtMs":timestamp_ms()}),
                sender,
            ))
            .is_ok()
            && receiver
                .recv_timeout(std::time::Duration::from_millis(200))
                .unwrap_or(false)
    }

    /// Explicit shutdown/export use only; business calls never wait for a flush.
    pub fn flush(&self, timeout: std::time::Duration) -> bool {
        let (sender, receiver) = mpsc::channel();
        self.sender.try_send(WriterMessage::Flush(sender)).is_ok()
            && receiver
                .recv_timeout(timeout.min(std::time::Duration::from_millis(500)))
                .is_ok()
    }

    pub fn status(&self) -> Value {
        json!({ "runId": self.run_id, "buildId": env!("EAGLE_BUILD_ID"), "development": cfg!(debug_assertions), "dropped": self.dropped.load(Ordering::Relaxed), "writeFailures": self.failures.load(Ordering::Relaxed), "logDirectory": self.directory, "recent": self.recent.try_lock().map(|r| r.iter().cloned().collect::<Vec<_>>()).unwrap_or_default() })
    }
}

#[tauri::command]
pub fn diagnostics_identity(state: tauri::State<'_, Diagnostics>) -> Value {
    state.status()
}

#[tauri::command]
pub fn diagnostics_write(
    state: tauri::State<'_, Diagnostics>,
    records: Vec<Value>,
) -> Result<(), String> {
    if records.len() > 32 {
        return Err("Diagnostic batch exceeds 32 records".into());
    }
    for record in records {
        state.record(record, "frontend");
    }
    Ok(())
}

pub fn install(app: &tauri::App) {
    if let Some(state) = app.try_state::<Diagnostics>() {
        state.record(json!({"source":"host", "event":"host.ready", "level":"info", "data":{"os":std::env::consts::OS, "arch":std::env::consts::ARCH}}), "host");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_overrides_untrusted_identity_and_bounds_records() {
        let directory = std::env::temp_dir().join(format!("eagle-logs-{}", timestamp_ms()));
        let diagnostics = Diagnostics::new(directory);
        diagnostics.record(
            json!({"runId":"forged", "process":"forged", "event":"test"}),
            "frontend",
        );
        let status = diagnostics.status();
        assert_eq!(status["recent"][0]["runId"], diagnostics.run_id);
        assert_eq!(status["recent"][0]["process"], "frontend");
        diagnostics.record(json!({"data":"x".repeat(MAX_RECORD_BYTES)}), "frontend");
        assert_eq!(diagnostics.status()["dropped"], 1);
        assert!(diagnostics.flush(std::time::Duration::from_millis(500)));
        let text = fs::read_to_string(diagnostics.directory.join("runtime.jsonl")).unwrap();
        assert_eq!(text.lines().count(), 1);
    }

    #[test]
    fn write_failure_is_visible_without_panicking_or_blocking_producer() {
        let root = std::env::temp_dir().join(format!("eagle-file-{}", timestamp_ms()));
        fs::write(&root, "not a directory").unwrap();
        let diagnostics = Diagnostics::new(root.clone());
        diagnostics.record(json!({"event":"test"}), "host");
        assert!(diagnostics.flush(std::time::Duration::from_millis(500)));
        assert!(diagnostics.status()["writeFailures"].as_u64().unwrap() > 0);
        fs::remove_file(root).unwrap();
    }

    #[test]
    fn rotates_at_the_size_limit() {
        let root = std::env::temp_dir().join(format!("eagle-rotation-{}", timestamp_ms()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("runtime.jsonl"), vec![b'x'; MAX_BYTES as usize]).unwrap();
        write_record(&root, &json!({"event":"next"})).unwrap();
        assert_eq!(
            fs::metadata(root.join("runtime.1.jsonl")).unwrap().len(),
            MAX_BYTES
        );
        assert!(fs::read_to_string(root.join("runtime.jsonl"))
            .unwrap()
            .contains("next"));
    }
}
