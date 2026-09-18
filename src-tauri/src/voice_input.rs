//! Local keyword inference observes one bounded utterance; it never mutates game facts.
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::Manager;

const MODEL_ID: &str = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20";
const MAX_ACTIVE_PATHS: i32 = 4;
const TRAILING_BLANKS: i32 = 1;
const KEYWORDS_SCORE: f32 = 1.0;
const KEYWORDS_THRESHOLD: f32 = 0.25;

#[derive(Default)]
pub struct VoiceState {
    active: Mutex<Option<(String, Arc<AtomicBool>)>>,
    #[cfg(windows)]
    model: Mutex<Option<(String, sherpa_onnx::KeywordSpotter)>>,
}
fn validate(
    samples: &[f32],
    sample_rate: u32,
    locale: &str,
    request_id: &str,
) -> Result<(), String> {
    if sample_rate != 16000
        || samples.len() > 128000
        || samples.iter().any(|v| !v.is_finite() || v.abs() > 1.0)
        || !["zh-CN", "en-US"].contains(&locale)
        || request_id.is_empty()
        || request_id.len() > 100
    {
        return Err("RECOGNITION_FAILED".into());
    }
    Ok(())
}
fn normalize(found: &BTreeSet<String>, locale: &str) -> Value {
    let generated: Value =
        serde_json::from_str(include_str!("../voice/keywords.json")).unwrap_or(Value::Null);
    let allowed: BTreeSet<&str> = generated["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["locale"] == locale)
        .filter_map(|row| row["actionId"].as_str())
        .collect();
    if found.len() == 1 {
        let action = found.first().unwrap();
        if allowed.contains(action.as_str()) {
            return json!({"type":"known","actionId":action});
        }
    }
    json!({"type":"unknown"})
}

fn unknown_reason(found: &BTreeSet<String>, allowed: &BTreeSet<&str>) -> Option<&'static str> {
    if found.is_empty() {
        Some("no_keyword")
    } else if found.iter().any(|id| !allowed.contains(id.as_str())) {
        Some("unrecognized_label")
    } else if found.len() > 1 {
        Some("multiple_actions")
    } else {
        None
    }
}

impl VoiceState {
    fn begin(&self, id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut active = self.active.lock().map_err(|_| "UNAVAILABLE")?;
        if active.is_some() {
            return Err("BUSY".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        *active = Some((id.into(), cancelled.clone()));
        Ok(cancelled)
    }
}
struct ActiveGuard(Arc<VoiceState>);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.0.active.lock() {
            *active = None;
        }
    }
}

#[cfg(windows)]
fn load_model(directory: &Path, locale: &str) -> Result<sherpa_onnx::KeywordSpotter, String> {
    use sha2::{Digest, Sha256};
    let manifest: Value = serde_json::from_str(include_str!("../voice/model-manifest.json"))
        .map_err(|_| "UNAVAILABLE")?;
    for (name, hash) in manifest.as_object().ok_or("UNAVAILABLE")? {
        let path = directory.join(name);
        let metadata = std::fs::metadata(&path).map_err(|_| "UNAVAILABLE")?;
        if !metadata.is_file() || metadata.len() > 20 * 1024 * 1024 {
            return Err("UNAVAILABLE".into());
        }
        let bytes = std::fs::read(&path).map_err(|_| "UNAVAILABLE")?;
        if format!("{:x}", Sha256::digest(bytes)) != hash.as_str().unwrap_or_default() {
            return Err("UNAVAILABLE".into());
        }
    }
    let words: Value =
        serde_json::from_str(include_str!("../voice/keywords.json")).map_err(|_| "UNAVAILABLE")?;
    let keywords = words["keywords"][locale].as_str().ok_or("UNAVAILABLE")?;
    let mut config = sherpa_onnx::KeywordSpotterConfig::default();
    let path = |name: &str| Some(directory.join(name).to_string_lossy().into_owned());
    config.model_config.transducer.encoder =
        path("encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx");
    config.model_config.transducer.decoder = path("decoder-epoch-13-avg-2-chunk-16-left-64.onnx");
    config.model_config.transducer.joiner =
        path("joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx");
    config.model_config.tokens = path("tokens.txt");
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = 1;
    config.keywords_buf = Some(keywords.into());
    config.max_active_paths = MAX_ACTIVE_PATHS;
    config.num_trailing_blanks = TRAILING_BLANKS;
    config.keywords_score = KEYWORDS_SCORE;
    config.keywords_threshold = KEYWORDS_THRESHOLD;
    sherpa_onnx::KeywordSpotter::create(&config).ok_or("UNAVAILABLE".into())
}

#[cfg(windows)]
fn infer(
    state: &VoiceState,
    directory: &Path,
    samples: &[f32],
    locale: &str,
    cancelled: &AtomicBool,
    observe: &dyn Fn(&str, Value),
) -> Result<Value, String> {
    if samples.len() < 3200 {
        observe(
            "voice.decode_summary",
            json!({"unknownReason":"too_short","decodeCount":0,"decodeDurationMs":0,"hitCount":0,"actionIds":[]}),
        );
        return Ok(json!({"type":"unknown"}));
    }
    let words: Value =
        serde_json::from_str(include_str!("../voice/keywords.json")).unwrap_or(Value::Null);
    let keyword_count = words["keywords"][locale]
        .as_str()
        .map(|s| s.lines().filter(|line| !line.is_empty()).count())
        .unwrap_or(0);
    observe(
        "voice.kws_config",
        json!({"modelId":MODEL_ID,"locale":locale,"maxActivePaths":MAX_ACTIVE_PATHS,"trailingBlanks":TRAILING_BLANKS,"keywordsScore":KEYWORDS_SCORE,"keywordsThreshold":KEYWORDS_THRESHOLD,"keywordCount":keyword_count}),
    );
    let mut model = state.model.lock().map_err(|_| "UNAVAILABLE")?;
    let cold = model.as_ref().map(|(language, _)| language.as_str()) != Some(locale);
    let load_started = std::time::Instant::now();
    if cold {
        let loaded = load_model(directory, locale);
        observe(
            "voice.model_load",
            json!({"loadMode":"cold","loadDurationMs":load_started.elapsed().as_secs_f64()*1000.0,"outcome":if loaded.is_ok(){"ready"}else{"error"}}),
        );
        *model = Some((locale.into(), loaded?));
    } else {
        observe(
            "voice.model_load",
            json!({"loadMode":"warm","loadDurationMs":load_started.elapsed().as_secs_f64()*1000.0,"outcome":"ready"}),
        );
    }
    if cancelled.load(Ordering::Relaxed) {
        return Err("CANCELLED".into());
    }
    let kws = &model.as_ref().unwrap().1;
    let stream = kws.create_stream();
    stream.accept_waveform(16000, samples);
    // Official example adds 0.5s silence before input_finished to flush trailing tokens.
    stream.accept_waveform(16000, &vec![0.0; 8000]);
    stream.input_finished();
    let mut found = BTreeSet::new();
    let (mut decode_count, mut hit_count) = (0, 0);
    let decode_started = std::time::Instant::now();
    while kws.is_ready(&stream) {
        if cancelled.load(Ordering::Relaxed) {
            return Err("CANCELLED".into());
        }
        kws.decode(&stream);
        decode_count += 1;
        if let Some(result) = kws.get_result(&stream) {
            if !result.keyword.is_empty() {
                hit_count += 1;
                found.insert(result.keyword);
                kws.reset(&stream);
            }
        }
    }
    // Collect the complete utterance: first-hit dispatch would miss ambiguity.
    let result = normalize(&found, locale);
    let allowed: BTreeSet<&str> = words["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["locale"] == locale)
        .filter_map(|row| row["actionId"].as_str())
        .collect();
    let actions: Vec<_> = found
        .iter()
        .filter(|id| allowed.contains(id.as_str()))
        .cloned()
        .collect();
    let reason = unknown_reason(&found, &allowed);
    observe(
        "voice.decode_summary",
        json!({"decodeCount":decode_count,"decodeDurationMs":decode_started.elapsed().as_secs_f64()*1000.0,"hitCount":hit_count,"actionIds":actions,"unknownReason":reason}),
    );
    Ok(result)
}
#[cfg(not(windows))]
fn infer(
    _: &VoiceState,
    _: &Path,
    _: &[f32],
    _: &str,
    _: &AtomicBool,
    _: &dyn Fn(&str, Value),
) -> Result<Value, String> {
    Err("UNAVAILABLE".into())
}

#[tauri::command]
pub fn voice_cancel(state: tauri::State<'_, Arc<VoiceState>>, request_id: String) {
    if let Ok(active) = state.active.lock() {
        if let Some((id, cancelled)) = &*active {
            if *id == request_id {
                cancelled.store(true, Ordering::Relaxed);
            }
        }
    }
}
#[tauri::command]
pub async fn voice_infer(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<VoiceState>>,
    diagnostics: tauri::State<'_, crate::diagnostics::Diagnostics>,
    request_id: String,
    samples: Vec<f32>,
    sample_rate: u32,
    locale: String,
    operation_id: Option<String>,
) -> Result<Value, String> {
    validate(&samples, sample_rate, &locale, &request_id)?;
    let directory = app
        .path()
        .resource_dir()
        .map_err(|_| "UNAVAILABLE")?
        .join("voice");
    let state = state.inner().clone();
    let cancelled = state.begin(&request_id)?;
    let guard = ActiveGuard(state.clone());
    let diagnostics = diagnostics.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard=guard; let started=std::time::Instant::now();
        let operation_id=operation_id.filter(|id|id.len()<=100);
        diagnostics.record(json!({"source":"voice","event":"voice.inference_started","level":"info","operationId":operation_id,"data":{"modelId":MODEL_ID,"locale":locale,"sampleRate":sample_rate,"sampleCount":samples.len()}}),"host");
        let observe=|event:&str,data:Value| diagnostics.record(json!({"source":"voice","event":event,"level":"info","operationId":operation_id,"data":data}),"host");
        observe("voice.pcm_received",crate::voice_audio_stats::summarize(&samples,sample_rate));
        let result=infer(&state,&directory,&samples,&locale,&cancelled,&observe);
        diagnostics.record(json!({"source":"voice","event":"voice.inference_finished","level":if result.is_ok(){"info"}else{"warn"},"operationId":operation_id,"data":{"outcome":result.as_ref().map(|v|v["type"].as_str().unwrap_or("unknown")).unwrap_or("error"),"code":result.as_ref().err(),"durationMs":started.elapsed().as_millis()}}),"host");
        result
    }).await.map_err(|_|"RECOGNITION_FAILED".to_string())?
}

/// No microphone, UI, or storage: verifies deployed real model loading with silence.
pub fn smoke_mode() -> bool {
    if std::env::args().nth(1).as_deref() != Some("--voice-model-smoke") {
        return false;
    }
    let result = (|| {
        let directory = std::env::current_exe()
            .map_err(|_| "UNAVAILABLE")?
            .parent()
            .ok_or("UNAVAILABLE")?
            .join("voice");
        let state = VoiceState::default();
        let cancelled = AtomicBool::new(false);
        for locale in ["zh-CN", "en-US"] {
            if infer(
                &state,
                &directory,
                &vec![0.0; 16000],
                locale,
                &cancelled,
                &|_, _| {},
            )? != json!({"type":"unknown"})
            {
                return Err("RECOGNITION_FAILED".into());
            }
        }
        Ok::<_, String>(())
    })();
    match result {
        Ok(()) => println!("Voice model silence smoke passed (not an accuracy test)"),
        Err(code) => {
            eprintln!("Voice smoke failed: {code}");
            std::process::exit(1);
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_reason_explains_result_without_exposing_unrecognized_text() {
        let allowed = ["salute", "wave"].into();
        assert_eq!(
            unknown_reason(&BTreeSet::new(), &allowed),
            Some("no_keyword")
        );
        assert_eq!(
            unknown_reason(&["salute".into(), "wave".into()].into(), &allowed),
            Some("multiple_actions")
        );
        assert_eq!(
            unknown_reason(&["unrecognized".into()].into(), &allowed),
            Some("unrecognized_label")
        );
        assert_eq!(unknown_reason(&["salute".into()].into(), &allowed), None);
    }
    #[cfg(windows)]
    #[test]
    fn short_pcm_reports_skip_without_loading_model() {
        let events = std::cell::RefCell::new(Vec::new());
        assert_eq!(
            infer(
                &VoiceState::default(),
                Path::new("missing-model"),
                &[0.0; 10],
                "zh-CN",
                &AtomicBool::new(false),
                &|event, data| events.borrow_mut().push((event.to_owned(), data))
            )
            .unwrap(),
            json!({"type":"unknown"})
        );
        assert_eq!(events.borrow()[0].1["unknownReason"], "too_short");
        assert_eq!(events.borrow()[0].1["decodeCount"], 0);
    }
    #[test]
    fn validates_pcm_locale_and_operation_bounds() {
        assert!(validate(&[0.0], 16000, "zh-CN", "id").is_ok());
        for samples in [
            vec![f32::NAN],
            vec![f32::INFINITY],
            vec![1.01],
            vec![0.0; 128001],
        ] {
            assert!(validate(&samples, 16000, "zh-CN", "id").is_err());
        }
        assert!(validate(&[], 48000, "en-US", "id").is_err());
        assert!(validate(&[], 16000, "bad", "id").is_err());
    }
    #[test]
    fn deduplicates_same_action_and_rejects_multiple_actions() {
        assert_eq!(
            normalize(&BTreeSet::new(), "zh-CN"),
            json!({"type":"unknown"})
        );
        assert_eq!(
            normalize(&["salute".into(), "salute".into()].into(), "zh-CN"),
            json!({"type":"known","actionId":"salute"})
        );
        assert_eq!(
            normalize(&["salute".into(), "wave".into()].into(), "en-US"),
            json!({"type":"unknown"})
        );
        assert_eq!(
            normalize(&["invented".into()].into(), "zh-CN"),
            json!({"type":"unknown"})
        );
    }
    #[test]
    fn only_one_inference_owns_the_native_worker() {
        let state = Arc::new(VoiceState::default());
        let first = state.begin("first").unwrap();
        assert_eq!(state.begin("second").unwrap_err(), "BUSY");
        first.store(true, Ordering::Relaxed);
        assert!(state.begin("second").is_err());
        drop(ActiveGuard(state.clone()));
        assert!(state.begin("second").is_ok());
    }
}
