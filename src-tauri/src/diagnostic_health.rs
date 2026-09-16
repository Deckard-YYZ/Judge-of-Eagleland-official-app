//! Liveness observations are evidence, not proof of deadlock or save failure.
use crate::diagnostics::{timestamp_ms, Diagnostics};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

const OVERDUE: Duration = Duration::from_secs(20);
const GRACE: Duration = Duration::from_secs(45);

/// Fatal-path summaries are bounded and remove machine-specific home directories.
pub(crate) fn fatal_summary(value: &str, limit: usize) -> String {
    let mut end = value.len().min(limit);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    let mut value = value[..end].to_string();
    for name in ["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(name) {
            if !home.is_empty() {
                value = value
                    .replace(&home, "<user-home>")
                    .replace(&home.replace('\\', "/"), "<user-home>");
            }
        }
    }
    value
}

pub struct Health {
    frontend: Mutex<Option<(Instant, bool)>>,
    main_ack: Mutex<Instant>,
    main_pending: AtomicBool,
    stopped: AtomicBool,
}
impl Health {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            frontend: Mutex::new(None),
            main_ack: Mutex::new(Instant::now()),
            main_pending: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
        })
    }
}

#[tauri::command]
pub fn diagnostics_heartbeat(state: tauri::State<'_, Arc<Health>>, visible: bool) {
    if let Ok(mut frontend) = state.frontend.lock() {
        *frontend = Some((Instant::now(), visible));
    }
}

fn classify(frontend: Option<(Duration, bool)>, main_age: Duration, grace: bool) -> &'static str {
    if grace {
        "grace"
    } else if main_age > OVERDUE {
        "main_overdue"
    } else {
        match frontend {
            None => "frontend_unknown",
            Some((_, false)) => "background",
            Some((age, true)) if age > OVERDUE => "frontend_overdue",
            Some(_) => "responsive",
        }
    }
}

/// Atomic replacement keeps readers from interpreting partially written health.
pub(crate) fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(value)?)?;
    // Windows std::rename replaces an existing file. Readers allow transient I/O errors.
    fs::rename(temporary, path)
}

pub fn begin_run(diagnostics: &Diagnostics) {
    if fs::create_dir_all(&diagnostics.directory).is_err() {
        return;
    }
    if let Some(root) = diagnostics.directory.parent() {
        if let Ok(entries) = fs::read_dir(root) {
            let mut prior: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            prior.sort();
            // Report only the newest prior run; a missing clean marker is not a crash diagnosis.
            for path in prior.into_iter().rev().filter(|path| {
                path != &diagnostics.directory && path.join("run-start.json").is_file()
            }) {
                #[cfg(windows)]
                if let Ok(lock) = crate::diagnostics::open_run_lock(&path) {
                    diagnostics.record(json!({"source":"host","event":"host.previous_exit","level":"info","data":{"outcome":if path.join("run-clean.json").is_file(){"clean"}else{"unclean"}}}), "host");
                    drop(lock);
                    break;
                }
            }
        }
    }
    let _ = write_json(
        &diagnostics.directory.join("run-start.json"),
        &json!({"runId":diagnostics.run_id,"pid":std::process::id(),"startedAtMs":timestamp_ms()}),
    );
}

pub fn finish_run(diagnostics: &Diagnostics, health: &Health) {
    health.stopped.store(true, Ordering::Relaxed);
    let marker_written = diagnostics.mark_clean_exit();
    diagnostics.record(json!({"source":"host","event":"host.clean_exit","level":"info","data":{"markerWritten":marker_written}}), "host");
}

pub fn install(app: &tauri::App, diagnostics: Diagnostics, health: Arc<Health>) {
    #[cfg(windows)]
    install_webview(app, diagnostics.clone());
    let handle = app.handle().clone();
    let worker = diagnostics.clone();
    let spawn = std::thread::Builder::new().name("diagnostics-health".into()).spawn(move || {
        let mut last_tick = Instant::now();
        let mut grace_until = last_tick + GRACE;
        let mut previous = "";
        let mut write_failed = false;
        let mut generation = 0_u64;
        while !health.stopped.load(Ordering::Relaxed) {
            let now = Instant::now();
            // A suspended machine or debugger can pause all threads. Require fresh evidence after gaps.
            let gap = now.duration_since(last_tick) > Duration::from_secs(5);
            #[cfg(windows)]
            let debugger = unsafe { windows::Win32::System::Diagnostics::Debug::IsDebuggerPresent().as_bool() };
            #[cfg(not(windows))]
            let debugger = false;
            if gap || debugger { grace_until = now + GRACE; }
            last_tick = now;
            // Do not enqueue a callback each tick when the UI thread cannot pump messages.
            if !health.main_pending.swap(true, Ordering::Relaxed) {
                let callback_health = health.clone();
                if handle.run_on_main_thread(move || {
                    if let Ok(mut ack) = callback_health.main_ack.lock() { *ack = Instant::now(); }
                    callback_health.main_pending.store(false, Ordering::Relaxed);
                }).is_err() { health.main_pending.store(false, Ordering::Relaxed); }
            }
            let frontend = health.frontend.lock().ok().and_then(|f| *f).map(|(at, visible)| (at.elapsed(),visible));
            let main_age = health.main_ack.lock().map(|at| at.elapsed()).unwrap_or(OVERDUE + Duration::from_secs(1));
            let state = classify(frontend, main_age, now < grace_until);
            if state != previous {
                worker.record(json!({"source":"health","event":"health.changed","level":if state.ends_with("overdue"){"warn"}else{"info"},"data":{"previousStatus":previous,"status":state,"mainAgeMs":main_age.as_millis(),"frontendAgeMs":frontend.map(|v|v.0.as_millis()),"visible":frontend.map(|v|v.1),"gap":gap,"debugger":debugger}}), "host");
                previous = state;
            }
            generation = generation.wrapping_add(1);
            let result = write_json(&worker.directory.join("health.json"), &json!({"runId":worker.run_id,"pid":std::process::id(),"generation":generation,"timestampMs":timestamp_ms(),"status":state,"mainAgeMs":main_age.as_millis(),"frontendAgeMs":frontend.map(|v|v.0.as_millis()),"visible":frontend.map(|v|v.1),"debugger":debugger}));
            if result.is_err() != write_failed {
                write_failed = result.is_err();
                worker.record(json!({"source":"health","event":"health.storage_changed","level":if write_failed{"warn"}else{"info"},"data":{"status":if write_failed{"unavailable"}else{"available"}}}), "host");
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
    if spawn.is_err() {
        diagnostics.record(
            json!({"source":"health","event":"health.unavailable","level":"warn"}),
            "host",
        );
    }
    #[cfg(all(windows, debug_assertions))]
    crate::diagnostic_watchdog::spawn(&diagnostics);
}

#[cfg(windows)]
fn install_webview(app: &tauri::App, diagnostics: Diagnostics) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let callback_diagnostics = diagnostics.clone();
    let result = window.with_webview(move |webview| unsafe {
        let mut version = windows::core::PWSTR::null();
        let version_result = webview.environment().BrowserVersionString(&mut version);
        if version_result.is_ok() {
            let text = version.to_string().unwrap_or_default();
            windows::Win32::System::Com::CoTaskMemFree(Some(version.0.cast()));
            callback_diagnostics.record(json!({"source":"webview","event":"webview.runtime","level":"info","data":{"version":text}}), "host");
        } else {
            callback_diagnostics.record(json!({"source":"webview","event":"webview.runtime_unavailable","level":"warn"}), "host");
        }
        let registration = (|| -> windows::core::Result<()> {
            let core = webview.controller().CoreWebView2()?;
            let events = callback_diagnostics.clone();
            let handler = webview2_com::ProcessFailedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let mut kind = webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                    args.ProcessFailedKind(&mut kind)?;
                    events.record(json!({"source":"webview","event":"webview.process_failed","level":"error","data":{"kind":kind.0,"reason":process_failure_name(kind)}}), "host");
                }
                Ok(())
            }));
            let mut token = 0;
            core.add_ProcessFailed(&handler, &mut token)?;
            // COM owns the handler until the webview closes; no leaked Rust global is needed.
            Ok(())
        })();
        if registration.is_err() {
            callback_diagnostics.record(json!({"source":"webview","event":"webview.observer_unavailable","level":"warn"}), "host");
        }
    });
    if result.is_err() {
        diagnostics.record(
            json!({"source":"webview","event":"webview.observer_unavailable","level":"warn"}),
            "host",
        );
    }
}

#[cfg(windows)]
fn process_failure_name(
    kind: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND,
) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match kind {
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => "browser_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => "renderer_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => "renderer_unresponsive",
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED => "frame_renderer_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => "gpu_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED => "utility_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_SANDBOX_HELPER_PROCESS_EXITED => "sandbox_helper_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_PLUGIN_PROCESS_EXITED => "plugin_exited",
        COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_BROKER_PROCESS_EXITED => "broker_exited",
        _ => "unknown_process_exited",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifications_preserve_uncertainty_and_background_grace() {
        let stale = Duration::from_secs(25);
        assert_eq!(classify(Some((stale, true)), stale, true), "grace");
        assert_eq!(
            classify(Some((stale, false)), Duration::ZERO, false),
            "background"
        );
        assert_eq!(classify(None, Duration::ZERO, false), "frontend_unknown");
        assert_eq!(
            classify(Some((stale, true)), Duration::ZERO, false),
            "frontend_overdue"
        );
        assert_eq!(
            classify(Some((Duration::ZERO, true)), stale, false),
            "main_overdue"
        );
    }

    #[test]
    fn exit_markers_distinguish_unclean_and_clean_without_assuming_crash() {
        let root = std::env::temp_dir().join(format!("eagle-exit-{}", timestamp_ms()));
        let diagnostics = Diagnostics::new(root);
        begin_run(&diagnostics);
        assert!(diagnostics.directory.join("run-start.json").is_file());
        assert!(!diagnostics.directory.join("run-clean.json").exists());
        finish_run(&diagnostics, &Health::new());
        assert!(diagnostics.directory.join("run-clean.json").is_file());
    }

    #[test]
    fn fatal_summaries_bound_utf8_bytes() {
        assert_eq!(fatal_summary("你好世界", 8), "你好");
    }
}
