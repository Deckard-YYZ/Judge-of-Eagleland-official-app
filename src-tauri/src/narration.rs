//! Bounded local narration synthesis. This module never plays audio or mutates game state.
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::Manager;

pub const MAX_TEXT_CHARS: usize = 500;
pub const MAX_AUDIO_SECONDS: usize = 30;
pub const MAX_GENERATION_SECONDS: u64 = 60;
const MODEL_ID: &str = "vits-melo-tts-zh_en";

#[derive(Default)]
pub struct NarrationState {
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
    #[cfg(windows)]
    model: Mutex<Option<sherpa_onnx::OfflineTts>>,
}

fn validate(request_id: &str, text: &str, locale: &str, voice_id: &str) -> Result<(), String> {
    if request_id.is_empty()
        || request_id.len() > 100
        || text.trim().is_empty()
        || text.chars().count() > MAX_TEXT_CHARS
        || text.contains('\0')
        || !["zh-CN", "en-US"].contains(&locale)
        || voice_id != "system"
    {
        return Err("INVALID_REQUEST".into());
    }
    Ok(())
}
impl NarrationState {
    fn begin(&self, request_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut active = self.active.lock().map_err(|_| "UNAVAILABLE")?;
        if active.is_some() {
            return Err("BUSY".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        *active = Some((request_id.into(), cancelled.clone()));
        Ok(cancelled)
    }
    fn cancel(&self, request_id: &str) {
        if let Ok(active) = self.active.lock() {
            if let Some((id, cancelled)) = &*active {
                if id == request_id {
                    cancelled.store(true, Ordering::Relaxed);
                }
            }
        }
    }
}
/// Cancellation invalidates the result but must not release the native computation slot.
struct ActiveGuard(Arc<NarrationState>);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.active.lock() {
            *active = None;
        }
    }
}
fn check_deadline(cancelled: &AtomicBool, started: Instant) -> Result<(), String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("CANCELLED".into());
    }
    if started.elapsed() >= Duration::from_secs(MAX_GENERATION_SECONDS) {
        return Err("TIMEOUT".into());
    }
    Ok(())
}
fn validate_audio(samples: &[f32], sample_rate: i32) -> Result<(), String> {
    if !(8000..=48000).contains(&sample_rate)
        || samples.is_empty()
        || samples.len() > sample_rate as usize * MAX_AUDIO_SECONDS
        || samples
            .iter()
            .any(|sample| !sample.is_finite() || sample.abs() > 1.0)
    {
        return Err("SYNTHESIS_FAILED".into());
    }
    Ok(())
}

#[cfg(windows)]
fn load_model(directory: &Path) -> Result<sherpa_onnx::OfflineTts, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let manifest: Value = serde_json::from_str(include_str!("../tts/model-manifest.json"))
        .map_err(|_| "UNAVAILABLE")?;
    for (name, hash) in manifest.as_object().ok_or("UNAVAILABLE")? {
        let mut file = std::fs::File::open(directory.join(name)).map_err(|_| "UNAVAILABLE")?;
        let metadata = file.metadata().map_err(|_| "UNAVAILABLE")?;
        if !metadata.is_file() || metadata.len() > 200 * 1024 * 1024 {
            return Err("UNAVAILABLE".into());
        }
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let count = file.read(&mut buffer).map_err(|_| "UNAVAILABLE")?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        if format!("{:x}", digest.finalize()) != hash.as_str().unwrap_or_default() {
            return Err("UNAVAILABLE".into());
        }
    }
    let path = |name: &str| Some(directory.join(name).to_string_lossy().into_owned());
    let mut config = sherpa_onnx::OfflineTtsConfig::default();
    config.model.vits.model = path("model.onnx");
    config.model.vits.lexicon = path("lexicon.txt");
    config.model.vits.tokens = path("tokens.txt");
    config.model.provider = Some("cpu".into());
    config.model.num_threads = 2;
    config.max_num_sentences = 1;
    config.silence_scale = 0.2;
    config.rule_fsts = Some(
        ["date.fst", "number.fst", "phone.fst"]
            .map(|name| directory.join(name).to_string_lossy().into_owned())
            .join(","),
    );
    let model = sherpa_onnx::OfflineTts::create(&config).ok_or("UNAVAILABLE")?;
    if model.num_speakers() != 1 || !(8000..=48000).contains(&model.sample_rate()) {
        return Err("UNAVAILABLE".into());
    }
    Ok(model)
}

#[cfg(windows)]
fn synthesize(
    state: &NarrationState,
    directory: &Path,
    text: &str,
    cancelled: Arc<AtomicBool>,
    started: Instant,
) -> Result<(Vec<f32>, i32), String> {
    check_deadline(&cancelled, started)?;
    let mut cached = state.model.lock().map_err(|_| "UNAVAILABLE")?;
    if cached.is_none() {
        *cached = Some(load_model(directory)?);
    }
    check_deadline(&cancelled, started)?;
    let model = cached.as_ref().ok_or("UNAVAILABLE")?;
    let sample_limit = model.sample_rate() as usize * MAX_AUDIO_SECONDS;
    let callback_cancelled = cancelled.clone();
    let overflow = Arc::new(AtomicBool::new(false));
    let callback_overflow = overflow.clone();
    // sherpa checks this callback between sentence batches, not during an ONNX call.
    // The deadline is cooperative: a blocked SDK keeps the slot until it returns.
    let mut generated_count = 0usize;
    let audio = model.generate_with_config(
        text,
        &sherpa_onnx::GenerationConfig::default(),
        Some(move |samples: &[f32], _| {
            generated_count = generated_count.saturating_add(samples.len());
            if generated_count > sample_limit
                || samples.iter().any(|s| !s.is_finite() || s.abs() > 1.0)
            {
                callback_overflow.store(true, Ordering::Relaxed);
            }
            check_deadline(&callback_cancelled, started).is_ok()
                && !callback_overflow.load(Ordering::Relaxed)
        }),
    );
    check_deadline(&cancelled, started)?;
    if overflow.load(Ordering::Relaxed) {
        return Err("SYNTHESIS_FAILED".into());
    }
    let audio = audio.ok_or("SYNTHESIS_FAILED")?;
    validate_audio(audio.samples(), audio.sample_rate())?;
    Ok((audio.samples().to_vec(), audio.sample_rate()))
}
#[cfg(not(windows))]
fn synthesize(
    _: &NarrationState,
    _: &Path,
    _: &str,
    _: Arc<AtomicBool>,
    _: Instant,
) -> Result<(Vec<f32>, i32), String> {
    Err("UNAVAILABLE".into())
}

#[tauri::command]
pub fn narration_cancel(state: tauri::State<'_, Arc<NarrationState>>, request_id: String) {
    state.cancel(&request_id);
}

#[tauri::command]
pub async fn narration_synthesize(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<NarrationState>>,
    diagnostics: tauri::State<'_, crate::diagnostics::Diagnostics>,
    request_id: String,
    text: String,
    locale: String,
    voice_id: String,
    operation_id: Option<String>,
) -> Result<Value, String> {
    validate(&request_id, &text, &locale, &voice_id)?;
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| "UNAVAILABLE")?
        .join("tts");
    let state = state.inner().clone();
    let cancelled = state.begin(&request_id)?;
    let guard = ActiveGuard(state.clone());
    let diagnostics = diagnostics.inner().clone();
    let operation_id = operation_id.filter(|id| !id.is_empty() && id.len() <= 100);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let started = Instant::now();
        diagnostics.record(
            json!({
                "source": "narration", "event": "narration.synthesis_started", "level": "info",
                "operationId": operation_id,
                "data": {"requestId": request_id, "modelId": MODEL_ID, "locale": locale,
                    "voiceId": voice_id, "textLength": text.chars().count()}
            }),
            "host",
        );
        let result =
            synthesize(&state, &directory, &text, cancelled.clone(), started).and_then(|audio| {
                check_deadline(&cancelled, started)?;
                Ok(audio)
            });
        diagnostics.record(
            json!({
                "source": "narration", "event": "narration.synthesis_finished",
                "level": if result.is_ok() { "info" } else { "warn" }, "operationId": operation_id,
                "data": {"requestId": request_id, "durationMs": started.elapsed().as_millis(),
                    "sampleRate": result.as_ref().ok().map(|audio| audio.1),
                    "sampleCount": result.as_ref().ok().map(|audio| audio.0.len()),
                    "code": result.as_ref().err()}
            }),
            "host",
        );
        result.map(|(samples, sample_rate)| json!({"samples": samples, "sampleRate": sample_rate}))
    })
    .await
    .map_err(|_| "SYNTHESIS_FAILED".to_string())?
}

/// Explicit offline smoke mode writes only fixed public fixture speech next to the executable.
pub fn smoke_mode() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--tts-model-smoke") {
        return false;
    }
    #[cfg(windows)]
    let result = (|| {
        let executable = std::env::current_exe().map_err(|_| "UNAVAILABLE")?;
        let root = executable.parent().ok_or("UNAVAILABLE")?;
        let state = Arc::new(NarrationState::default());
        let mut reports = Vec::new();
        for (locale, text) in [
            ("zh-CN", "请敬礼。"),
            ("en-US", "Please salute."),
            ("zh-CN", "接下来请按照提示完成一个简单输入。"),
            (
                "en-US",
                "Follow the next prompt to complete a simple input.",
            ),
            ("zh-CN", "请敬礼。"),
        ] {
            let started = Instant::now();
            let (samples, sample_rate) = synthesize(
                &state,
                &root.join("tts"),
                text,
                Arc::new(AtomicBool::new(false)),
                started,
            )?;
            let file = root.join(format!("tts-{}-{}.wav", locale, reports.len()));
            if !sherpa_onnx::write(file.to_str().ok_or("UNAVAILABLE")?, &samples, sample_rate) {
                return Err("SYNTHESIS_FAILED".into());
            }
            reports.push(json!({
                "locale": locale, "sampleRate": sample_rate, "sampleCount": samples.len(),
                "durationSeconds": samples.len() as f64 / sample_rate as f64,
                "elapsedMs": started.elapsed().as_millis(),
                "peak": samples.iter().fold(0f32, |a,s| a.max(s.abs())), "file": file
            }));
        }
        // Use the warmed real model, cancel while it computes, then verify slot recovery.
        let flag = state.begin("smoke-cancel")?;
        let guard = ActiveGuard(state.clone());
        let running_state = state.clone();
        let directory = root.join("tts");
        let cancelled_at = Instant::now();
        let worker = std::thread::spawn(move || {
            let _guard = guard;
            synthesize(
                &running_state,
                &directory,
                "请向法官敬礼，然后继续。请向法官敬礼，然后继续。",
                flag,
                Instant::now(),
            )
        });
        std::thread::sleep(Duration::from_millis(20));
        state.cancel("smoke-cancel");
        let busy_while_cancelled = state.begin("smoke-overlap").is_err();
        if !busy_while_cancelled {
            return Err("CANCELLATION_SLOT_RELEASED_EARLY".into());
        }
        let cancelled_result = worker.join().map_err(|_| "SYNTHESIS_FAILED")?;
        if !matches!(cancelled_result, Err(ref code) if code == "CANCELLED") {
            return Err("CANCELLATION_NOT_OBSERVED".into());
        }
        let recovered = state.begin("smoke-recovered")?;
        let recovery_guard = ActiveGuard(state.clone());
        synthesize(
            &state,
            &root.join("tts"),
            "Hello.",
            recovered,
            Instant::now(),
        )?;
        drop(recovery_guard);
        let report = json!({
            "cancellation": {"code": "CANCELLED", "busyUntilNativeExit": busy_while_cancelled,
                "recovered": true, "elapsedMs": cancelled_at.elapsed().as_millis()},
            "modelId": MODEL_ID, "sdkVersion": "1.13.8", "voiceId": "system",
            "speakerId": 0, "speed": 1.0, "listeningVerified": false, "runs": reports
        });
        std::fs::write(
            root.join("tts-smoke.json"),
            serde_json::to_string_pretty(&report).unwrap(),
        )
        .map_err(|_| "UNAVAILABLE")?;
        println!("{report}");
        Ok::<(), String>(())
    })();
    #[cfg(not(windows))]
    let result: Result<(), String> = Err("UNAVAILABLE".into());
    if let Err(code) = result {
        eprintln!("TTS smoke failed: {code}");
        std::process::exit(1);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_uncontrolled_requests_and_nul_before_ffi() {
        for (text, locale, voice) in [
            ("x\0y", "en-US", "system"),
            ("  ", "zh-CN", "system"),
            ("text", "fr-FR", "system"),
            ("text", "en-US", "../../model"),
        ] {
            assert_eq!(
                validate("id", text, locale, voice),
                Err("INVALID_REQUEST".into())
            );
        }
        assert!(validate("id", &"中".repeat(500), "zh-CN", "system").is_ok());
        assert!(validate("id", &"中".repeat(501), "zh-CN", "system").is_err());
    }
    #[test]
    fn cancelled_native_work_keeps_slot_until_guard_drops() {
        let state = Arc::new(NarrationState::default());
        let flag = state.begin("old").unwrap();
        let guard = ActiveGuard(state.clone());
        state.cancel("other");
        assert!(!flag.load(Ordering::Relaxed));
        state.cancel("old");
        assert!(flag.load(Ordering::Relaxed));
        assert_eq!(state.begin("new").unwrap_err(), "BUSY");
        drop(guard);
        let new_flag = state.begin("new").unwrap();
        state.cancel("old");
        assert!(!new_flag.load(Ordering::Relaxed));
    }
    #[test]
    fn rejects_invalid_or_unbounded_audio_and_checks_timeout() {
        assert!(validate_audio(&[f32::NAN], 44100).is_err());
        assert!(validate_audio(&[1.1], 44100).is_err());
        assert!(validate_audio(&[], 44100).is_err());
        assert!(validate_audio(&[0.1], 0).is_err());
        assert!(validate_audio(&vec![0.1; 8000 * 31], 8000).is_err());
        assert!(validate_audio(&[0.1], 44100).is_ok());
        assert_eq!(
            check_deadline(
                &AtomicBool::new(false),
                Instant::now() - Duration::from_secs(61)
            ),
            Err("TIMEOUT".into())
        );
    }
    #[test]
    #[cfg(windows)]
    fn corrupt_assets_are_rejected_before_native_loading() {
        let directory =
            std::env::temp_dir().join(format!("eagle-tts-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        // LICENSE is the first sorted manifest entry. A mismatched asset must fail
        // before the C API can see incomplete/untrusted model data.
        let file = directory.join("LICENSE");
        std::fs::write(&file, "corrupted fixture").unwrap();
        assert!(matches!(load_model(&directory), Err(code) if code == "UNAVAILABLE"));
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
    #[test]
    #[cfg(windows)]
    fn absent_assets_are_stable_unavailable() {
        assert!(
            matches!(load_model(Path::new("__missing_tts_assets__")),Err(code) if code == "UNAVAILABLE")
        );
    }
}
