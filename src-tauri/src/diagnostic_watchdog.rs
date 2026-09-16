//! Debug-only independent observer. It never restarts the game or replays commands.
#![cfg(all(windows, debug_assertions))]
use crate::{
    diagnostic_health::write_json,
    diagnostics::{timestamp_ms, Diagnostics},
};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::windows::{io::AsRawHandle, process::CommandExt},
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_TIMEOUT},
    System::{
        Diagnostics::Debug::{CheckRemoteDebuggerPresent, MiniDumpNormal, MiniDumpWriteDump},
        Threading::{
            GetProcessTimes, OpenProcess, WaitForSingleObject, PROCESS_QUERY_INFORMATION,
            PROCESS_SYNCHRONIZE, PROCESS_VM_READ,
        },
    },
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DUMP_LIMIT: u64 = 64 * 1024 * 1024;
const ROOT_DUMP_LIMIT: u64 = 256 * 1024 * 1024;

struct Process(HANDLE);
impl Drop for Process {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}
fn open_process(pid: u32) -> windows::core::Result<Process> {
    unsafe {
        OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_VM_READ | PROCESS_SYNCHRONIZE,
            false,
            pid,
        )
        .map(Process)
    }
}
fn creation(process: &Process) -> windows::core::Result<u64> {
    let mut created = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetProcessTimes(process.0, &mut created, &mut exit, &mut kernel, &mut user)?;
    }
    Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
}
fn alive(process: &Process) -> bool {
    unsafe { WaitForSingleObject(process.0, 0) == WAIT_TIMEOUT }
}
fn hidden_command() -> std::io::Result<Command> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(command)
}
fn observe(directory: &Path, event: &str, data: Value) {
    // Independent bounded evidence survives the game's writer being stalled.
    let path = directory.join("watchdog.jsonl");
    if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 256 * 1024 {
        return;
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "{}",
            json!({"timestampMs":timestamp_ms(),"source":"watchdog","event":event,"buildId":env!("EAGLE_BUILD_ID"),"runId":directory.file_name().and_then(|v|v.to_str()),"data":data})
        );
    }
}
pub fn spawn(diagnostics: &Diagnostics) {
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let process = open_process(std::process::id())?;
        let mut command = hidden_command()?;
        command
            .arg("--diagnostics-watchdog")
            .arg(std::process::id().to_string())
            .arg(creation(&process)?.to_string())
            .arg(&diagnostics.directory)
            .spawn()?;
        Ok(())
    })();
    diagnostics.record(json!({"source":"health","event":"watchdog.started","level":if result.is_ok(){"info"}else{"warn"},"data":{"outcome":if result.is_ok(){"spawned"}else{"unavailable"}}}), "host");
}

fn dump_bytes(root: &Path) -> u64 {
    fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.file_type()
                .map(|t| t.is_dir() && !t.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| {
            ["hang-1.dmp", "hang-2.dmp"]
                .iter()
                .map(|name| {
                    fs::metadata(entry.path().join(name))
                        .map(|m| m.len())
                        .unwrap_or(0)
                })
                .sum::<u64>()
        })
        .sum()
}
fn capture(directory: &Path, pid: u32, identity: u64, index: u32) {
    let Some(root) = directory.parent() else {
        return;
    };
    use std::os::windows::fs::OpenOptionsExt;
    // Serialize quota reservation across all active game instances without blocking them.
    let Ok(_budget_lock) = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .share_mode(0)
        .open(root.join("dump-budget.lock"))
    else {
        observe(
            directory,
            "watchdog.dump_skipped",
            json!({"reason":"budget_busy"}),
        );
        return;
    };
    if dump_bytes(root) + DUMP_LIMIT > ROOT_DUMP_LIMIT {
        observe(
            directory,
            "watchdog.dump_skipped",
            json!({"reason":"quota"}),
        );
        return;
    }
    let path = directory.join(format!("hang-{index}.dmp"));
    let result = (|| -> std::io::Result<bool> {
        let mut child = hidden_command()?
            .arg("--diagnostics-dump")
            .arg(pid.to_string())
            .arg(identity.to_string())
            .arg(&path)
            .spawn()?;
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            if let Some(status) = child.try_wait()? {
                return Ok(status.success());
            }
            if Instant::now() > deadline
                || fs::metadata(&path)
                    .map(|m| m.len() > DUMP_LIMIT)
                    .unwrap_or(false)
            {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&path);
                return Ok(false);
            }
            thread::sleep(Duration::from_millis(50));
        }
    })();
    // The final check catches a fast dump writer exceeding quota between polls.
    let valid = result.unwrap_or(false)
        && fs::metadata(&path)
            .map(|m| m.len() > 32 && m.len() <= DUMP_LIMIT)
            .unwrap_or(false);
    if !valid {
        let _ = fs::remove_file(&path);
    }
    observe(
        directory,
        "watchdog.dump_finished",
        json!({"outcome":if valid{"captured"}else{"unavailable"},"file":path.file_name().and_then(|v|v.to_str()),"scope":"host_minidump_not_renderer_memory"}),
    );
}

fn watchdog(pid: u32, identity: u64, directory: &Path, fixture: bool) {
    let Ok(process) = open_process(pid) else {
        return;
    };
    if creation(&process).ok() != Some(identity) {
        return;
    }
    // Hold an independent lock while observing: retention must not delete this run.
    let mut lock_options = OpenOptions::new();
    use std::os::windows::fs::OpenOptionsExt;
    lock_options
        .create(true)
        .truncate(false)
        .write(true)
        .share_mode(0);
    let Ok(_lock) = lock_options.open(directory.join("watchdog.lock")) else {
        return;
    };
    observe(
        directory,
        "watchdog.ready",
        json!({"pid":pid,"identity":identity,"fixture":fixture}),
    );
    let grace = Duration::from_secs(if fixture { 1 } else { 45 });
    let overdue_ms = if fixture { 3000 } else { 20000 };
    let confirmation = Duration::from_secs(if fixture { 1 } else { 10 });
    let mut grace_until = Instant::now() + grace;
    let mut last_tick = Instant::now();
    let mut prior = "";
    let mut suspect_since = None;
    let mut dumps = 0;
    let mut captured_episode = false;
    let mut last_health: Option<Value> = None;
    let mut last_health_change = Instant::now();
    while alive(&process) {
        let now = Instant::now();
        let mut debugger = windows::core::BOOL::default();
        let debugger_known =
            unsafe { CheckRemoteDebuggerPresent(process.0, &mut debugger).is_ok() };
        if now.duration_since(last_tick) > Duration::from_secs(5)
            || !debugger_known
            || debugger.as_bool()
        {
            grace_until = now + grace;
        }
        last_tick = now;
        let health = fs::File::open(directory.join("health.json"))
            .ok()
            .and_then(|file| {
                let mut bytes = Vec::new();
                file.take(4097).read_to_end(&mut bytes).ok()?;
                Some(bytes)
            })
            .filter(|b| b.len() <= 4096)
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        // Compare generations/content, then age the observation on this process's
        // monotonic clock. Wall-clock adjustments must not hide a stopped writer.
        if health.is_some() && health != last_health {
            last_health_change = now;
            last_health = health.clone();
        }
        let current = if now < grace_until {
            "grace"
        } else if let Some(health) = health {
            if health["pid"].as_u64() != Some(pid as u64)
                || health["runId"].as_str() != directory.file_name().and_then(|v| v.to_str())
            {
                "identity_mismatch"
            } else if now.duration_since(last_health_change) > Duration::from_millis(overdue_ms) {
                "observer_or_storage_overdue"
            } else {
                match health["status"].as_str() {
                    Some("main_overdue") => "main_overdue",
                    Some("frontend_overdue") => "frontend_overdue",
                    Some("grace") => "grace",
                    Some("background") => "background",
                    Some("responsive") => "responsive",
                    _ => "unknown",
                }
            }
        } else {
            "health_unavailable"
        };
        if current != prior {
            observe(
                directory,
                "watchdog.observation",
                json!({"status":current,"previousStatus":prior}),
            );
            prior = current;
        }
        let suspect = matches!(
            current,
            "main_overdue" | "frontend_overdue" | "observer_or_storage_overdue"
        );
        if suspect {
            let since = suspect_since.get_or_insert(now);
            if now.duration_since(*since) >= confirmation && !captured_episode && dumps < 2 {
                dumps += 1;
                captured_episode = true;
                observe(
                    directory,
                    "watchdog.dump_requested",
                    json!({"reason":current,"attempt":dumps,"diagnosis":"unconfirmed"}),
                );
                capture(directory, pid, identity, dumps);
            }
        } else {
            suspect_since = None;
            captured_episode = false;
        }
        thread::sleep(Duration::from_millis(if fixture { 100 } else { 1000 }));
    }
    observe(
        directory,
        "watchdog.process_exited",
        json!({"outcome":if directory.join("run-clean.json").exists(){"clean"}else{"unclean"}}),
    );
}

fn dump(pid: u32, identity: u64, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let process = open_process(pid)?;
    if creation(&process)? != identity || !alive(&process) {
        return Err("Process identity changed".into());
    }
    let file = OpenOptions::new().create_new(true).write(true).open(path)?;
    unsafe {
        MiniDumpWriteDump(
            process.0,
            pid,
            HANDLE(file.as_raw_handle()),
            MiniDumpNormal,
            None,
            None,
            None,
        )?;
    }
    file.sync_all()?;
    Ok(())
}

/// Reproducible fault harness, isolated from profiles, SQLite, and the application UI.
fn fixture(mode: &str, directory: &Path) {
    fs::create_dir_all(directory).unwrap();
    let process = open_process(std::process::id()).unwrap();
    let mut child = hidden_command()
        .unwrap()
        .arg("--diagnostics-watchdog-fixture")
        .arg(std::process::id().to_string())
        .arg(creation(&process).unwrap().to_string())
        .arg(directory)
        .spawn()
        .unwrap();
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(12) {
        // Host fault: stop the health writer entirely. Frontend fault: keep host pulses alive.
        if mode == "frontend" || started.elapsed() < Duration::from_secs(1) {
            let status = if mode == "frontend" && started.elapsed() > Duration::from_secs(3) {
                "frontend_overdue"
            } else {
                "responsive"
            };
            let _ = write_json(
                &directory.join("health.json"),
                &json!({"pid":std::process::id(),"runId":directory.file_name().and_then(|v|v.to_str()),"timestampMs":timestamp_ms(),"status":status}),
            );
        }
        if directory.join("hang-1.dmp").is_file()
            && fs::read_to_string(directory.join("watchdog.jsonl"))
                .unwrap_or_default()
                .contains("captured")
        {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    // Parent runner verifies the watchdog notices this process exiting without a clean marker.
    let _ = child.try_wait();
}

/// Returns true only for explicitly requested debug helper modes; release never exposes them.
pub fn helper_mode() -> bool {
    let args: Vec<_> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("--diagnostics-watchdog")
        | Some("--diagnostics-watchdog-fixture")
        | Some("--diagnostics-dump")
            if args.len() == 5 =>
        {
            if let (Ok(pid), Ok(identity)) = (args[2].parse(), args[3].parse()) {
                if args[1] == "--diagnostics-dump" {
                    if dump(pid, identity, Path::new(&args[4])).is_err() {
                        std::process::exit(2);
                    }
                } else {
                    watchdog(
                        pid,
                        identity,
                        Path::new(&args[4]),
                        args[1].ends_with("fixture"),
                    );
                }
            }
            true
        }
        Some("--diagnostics-fixture") if args.len() == 4 => {
            fixture(&args[2], Path::new(&args[3]));
            true
        }
        Some("--diagnostics-self-test") => {
            let root =
                std::env::temp_dir().join(format!("eagle-diagnostic-fixture-{}", timestamp_ms()));
            for mode in ["frontend", "host"] {
                let directory = root.join(mode);
                let result = hidden_command()
                    .unwrap()
                    .arg("--diagnostics-fixture")
                    .arg(mode)
                    .arg(&directory)
                    .status()
                    .unwrap();
                assert!(result.success());
                thread::sleep(Duration::from_millis(500));
                let bytes = fs::read(directory.join("hang-1.dmp"))
                    .expect("Independent observer must capture a dump");
                assert_eq!(&bytes[..4], b"MDMP");
                let text = fs::read_to_string(directory.join("watchdog.jsonl")).unwrap();
                assert!(text.contains(if mode == "host" {
                    "observer_or_storage_overdue"
                } else {
                    "frontend_overdue"
                }));
                assert!(text.contains("unclean"));
            }
            println!("Diagnostic fixture passed: {}", root.display());
            true
        }
        _ => false,
    }
}
