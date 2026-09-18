//! Whole-utterance ASR comparison harness. No game dispatch or fuzzy action matching.
use serde_json::{json, Value};
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig, Wave};
use std::{collections::BTreeSet, path::PathBuf, time::Instant};

mod recording;
#[path = "../../../src-tauri/src/voice_audio_stats.rs"]
mod voice_audio_stats;

const WORDS: &str = include_str!("../../../src-tauri/voice/keywords.json");
const MODEL_ID: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";
const HELP: &str = "Eagle ASR CLI - local whole-utterance SenseVoice diagnostics
Usage: asr-test --model-dir DIR [options] WAV [WAV ...]
       asr-test --model-dir DIR [options] --record OUTPUT.wav
  --locale zh-CN|en-US  Recognition language and project aliases (default: zh-CN)
  --record FILE        Record default microphone, save WAV, then recognize that file
  --record-seconds N   Automatic recording limit, 1..60 seconds (default: 8)
  --help               Show help
  --                   End options
Input: 16-bit PCM mono WAV, 8000..192000 Hz, at most 60 seconds / 32 MiB.
Non-16k input uses SDK resampling. No segmentation, denoising, or appended silence.
Model directory must contain model.int8.onnx and tokens.txt.
Stdout: one JSON object per file including rawText, normalizedText and action result.
Exact alias matching only: trims boundary punctuation/space and lowercases English.
Exit: 0 includes unknown; 1 means arguments, model, recording, or WAV failed.
Recording: press Enter to prepare, wait for RECORDING, speak, then Enter to stop.
Requires interactive stdin. Existing recordings are never overwritten.
Audio and transcripts stay local. No game/save access or network requests.";

#[derive(Debug)]
struct Options {
    model_dir: PathBuf,
    locale: String,
    files: Vec<String>,
    record: Option<PathBuf>,
    record_seconds: u32,
}

fn parse(args: impl IntoIterator<Item = String>) -> Result<Option<Options>, String> {
    let mut args = args.into_iter();
    let mut opts = Options {
        model_dir: PathBuf::new(),
        locale: "zh-CN".into(),
        files: Vec::new(),
        record: None,
        record_seconds: 8,
    };
    let mut positional = false;
    let mut seconds_set = false;
    while let Some(arg) = args.next() {
        if positional {
            opts.files.push(arg);
            continue;
        }
        if arg == "--" {
            positional = true;
            continue;
        }
        if arg == "--help" || arg == "-h" {
            return Ok(None);
        }
        if !arg.starts_with('-') {
            opts.files.push(arg);
            continue;
        }
        if !["--model-dir", "--locale", "--record", "--record-seconds"].contains(&arg.as_str()) {
            return Err(format!("Unknown option: {arg}"));
        }
        let value = args
            .next()
            .ok_or_else(|| format!("{arg} requires a value"))?;
        match arg.as_str() {
            "--model-dir" => opts.model_dir = value.into(),
            "--locale" => {
                if !["zh-CN", "en-US"].contains(&value.as_str()) {
                    return Err("--locale must be zh-CN or en-US".into());
                }
                opts.locale = value;
            }
            "--record" => opts.record = Some(value.into()),
            "--record-seconds" => {
                seconds_set = true;
                opts.record_seconds = value
                    .parse()
                    .map_err(|_| "--record-seconds must be an integer in 1..60")?;
                if !(1..=60).contains(&opts.record_seconds) {
                    return Err("--record-seconds must be in 1..60".into());
                }
            }
            _ => unreachable!(),
        }
    }
    if opts.model_dir.as_os_str().is_empty() {
        return Err("--model-dir is required".into());
    }
    if opts.record.is_some() && !opts.files.is_empty() {
        return Err("--record cannot be combined with input WAV files".into());
    }
    if seconds_set && opts.record.is_none() {
        return Err("--record-seconds requires --record".into());
    }
    if opts.record.is_none() && opts.files.is_empty() {
        return Err("At least one WAV file or --record OUTPUT.wav is required".into());
    }
    Ok(Some(opts))
}

fn boundary(c: char) -> bool {
    c.is_whitespace() || "。，！？、；：,.!?;:\"'“”‘’（）()【】[]《》〈〉…".contains(c)
}

fn normalize(text: &str) -> String {
    // Internal punctuation/whitespace remains significant: do not turn a sentence into a command.
    text.trim_matches(boundary).to_lowercase()
}

fn classify(normalized: &str, locale: &str, words: &Value) -> Value {
    if normalized.is_empty() {
        return json!({"type":"unknown", "unknownReason":"empty_transcript"});
    }
    let ids: BTreeSet<&str> = words["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["locale"] == locale)
        .filter(|row| {
            row["alias"]
                .as_str()
                .is_some_and(|alias| normalize(alias) == normalized)
        })
        .filter_map(|row| row["actionId"].as_str())
        .collect();
    match ids.len() {
        1 => json!({"type":"known", "actionId":ids.first().unwrap()}),
        0 => json!({"type":"unknown", "unknownReason":"no_alias"}),
        _ => json!({"type":"unknown", "unknownReason":"multiple_actions"}),
    }
}

fn recognize(
    recognizer: &OfflineRecognizer,
    file: &str,
    locale: &str,
    words: &Value,
) -> Result<Value, String> {
    let metadata = std::fs::metadata(file).map_err(|e| format!("Cannot open WAV: {e}"))?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 * 1024 {
        return Err("WAV must be a regular file of at most 32 MiB".into());
    }
    let wave = Wave::read(file).ok_or("Cannot decode WAV: expected 16-bit PCM mono WAV")?;
    let rate = wave.sample_rate();
    if !(8000..=192000).contains(&rate) {
        return Err("Unsupported sample rate; expected 8000..192000 Hz".into());
    }
    let samples = wave.samples();
    if samples.len() > rate as usize * 60 {
        return Err("WAV exceeds 60 seconds".into());
    }
    let pcm = voice_audio_stats::summarize(samples, rate as u32);
    let started = Instant::now();
    // Only provably empty/silent or sub-200ms input bypasses ASR; low-volume speech still runs.
    let skipped = if samples.len() < rate as usize / 5 {
        Some("too_short")
    } else if samples.iter().all(|sample| *sample == 0.0) {
        Some("silence")
    } else {
        None
    };
    let raw = if skipped.is_some() {
        String::new()
    } else {
        let stream = recognizer.create_stream();
        stream.accept_waveform(rate, samples);
        recognizer.decode(&stream);
        stream.get_result().ok_or("ASR returned no result")?.text
    };
    let elapsed = started.elapsed().as_secs_f64() * 1000.0;
    let normalized = normalize(&raw);
    let result = match skipped {
        Some(reason) => json!({"type":"unknown", "unknownReason":reason}),
        None => classify(&normalized, locale, words),
    };
    Ok(
        json!({"rawText":raw,"normalizedText":normalized,"result":result,"pcm":pcm,
        "sdkResampled":rate != 16000,"recognitionDurationMs":elapsed,"inferenceSkipped":skipped.is_some()}),
    )
}

fn run(mut opts: Options) -> Result<bool, String> {
    let words: Value = serde_json::from_str(WORDS).map_err(|e| e.to_string())?;
    if words["rows"].as_array().is_none() {
        return Err("Missing project alias rows".into());
    }
    let model_path = |name: &str| -> Result<Option<String>, String> {
        let path = opts.model_dir.join(name);
        if !path.is_file() {
            return Err(format!("Missing model file: {}", path.display()));
        }
        let text = path.to_str().ok_or("Model path is not valid UTF-8")?;
        if text.contains('\0') {
            return Err("Model path contains NUL".into());
        }
        Ok(Some(text.into()))
    };
    let language = if opts.locale == "zh-CN" { "zh" } else { "en" };
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.sense_voice.model = model_path("model.int8.onnx")?;
    config.model_config.sense_voice.language = Some(language.into());
    config.model_config.sense_voice.use_itn = false;
    config.model_config.tokens = model_path("tokens.txt")?;
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = 2;
    config.decoding_method = Some("greedy_search".into());
    config.feat_config.sample_rate = 16000;
    config.feat_config.feature_dim = 80;
    let started = Instant::now();
    let recognizer = OfflineRecognizer::create(&config)
        .ok_or("ASR model initialization failed; inspect SDK stderr and model files")?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;
    let effective = json!({"modelDir":opts.model_dir,"locale":opts.locale,"language":language,
        "useItn":false,"provider":"cpu","numThreads":2,"decodingMethod":"greedy_search",
        "featureSampleRate":16000,"featureDim":80,"matching":"exact_alias_boundary_punctuation_casefold",
        "aliasHash":words["aliasHash"],"segmentation":false,"tailMs":0});
    if let Some(path) = &opts.record {
        recording::record(path, opts.record_seconds)?;
        opts.files.push(path.to_string_lossy().into_owned());
    }
    let mut success = true;
    for file in &opts.files {
        let mut row = match recognize(&recognizer, file, &opts.locale, &words) {
            Ok(row) => row,
            Err(error) => {
                success = false;
                eprintln!("{file}: {error}");
                json!({"error":error})
            }
        };
        row["file"] = json!(file);
        row["modelId"] = json!(MODEL_ID);
        row["backend"] = json!("sherpa-onnx-sensevoice");
        row["config"] = effective.clone();
        row["modelLoadDurationMs"] = json!(load_ms);
        println!("{row}");
    }
    Ok(success)
}

fn main() {
    let result = match parse(std::env::args().skip(1)) {
        Ok(None) => {
            println!("{HELP}");
            return;
        }
        Ok(Some(opts)) => run(opts),
        Err(error) => Err(format!("{error}\nUse --help for usage.")),
    };
    match result {
        Ok(true) => {}
        Ok(false) => std::process::exit(1),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Result<Option<Options>, String> {
        parse(values.iter().map(|s| (*s).into()))
    }
    #[test]
    fn options_reject_ambiguous_or_invalid_inputs() {
        assert!(args(&["--help"]).unwrap().is_none());
        for invalid in [
            vec![],
            vec!["--model-dir", "m"],
            vec!["--locale", "fr"],
            vec!["--model-dir", "m", "--record", "out.wav", "in.wav"],
            vec!["--model-dir", "m", "in.wav", "--record-seconds", "2"],
            vec![
                "--model-dir",
                "m",
                "--record",
                "out.wav",
                "--record-seconds",
                "0",
            ],
            vec![
                "--model-dir",
                "m",
                "--record",
                "out.wav",
                "--record-seconds",
                "61",
            ],
            vec![
                "--model-dir",
                "m",
                "--record",
                "out.wav",
                "--record-seconds",
                "1.5",
            ],
        ] {
            assert!(args(&invalid).is_err(), "{invalid:?}");
        }
        let opts = args(&[
            "--model-dir",
            "m",
            "--locale",
            "en-US",
            "--",
            "-in.wav",
            "second.wav",
        ])
        .unwrap()
        .unwrap();
        assert_eq!(opts.files, ["-in.wav", "second.wav"]);
        assert_eq!(opts.locale, "en-US");
        assert_eq!(
            args(&["--model-dir", "m", "--record", "out.wav"])
                .unwrap()
                .unwrap()
                .record_seconds,
            8
        );
    }
    #[test]
    fn exact_aliases_allow_only_boundary_punctuation_and_case() {
        let words = serde_json::from_str(WORDS).unwrap();
        for (raw, locale, action) in [
            (" 敬礼。 ", "zh-CN", "salute"),
            ("“行礼！”", "zh-CN", "salute"),
            ("挥手！", "zh-CN", "wave"),
            (" SALUTE! ", "en-US", "salute"),
        ] {
            assert_eq!(
                classify(&normalize(raw), locale, &words)["actionId"],
                action
            );
        }
        for raw in [
            "经理",
            "经历",
            "请敬礼",
            "敬礼挥手",
            "敬 礼",
            "敬，礼",
            "你好",
            "salute",
        ] {
            assert_eq!(
                classify(&normalize(raw), "zh-CN", &words)["unknownReason"],
                "no_alias"
            );
        }
        assert_eq!(
            classify(&normalize(" ，。！？ "), "zh-CN", &words)["unknownReason"],
            "empty_transcript"
        );
    }
}
