//! Local diagnostic harness; microphone capture requires explicit interactive opt-in.
use serde_json::{json, Value};
use sherpa_onnx::{KeywordSpotter, KeywordSpotterConfig, Wave};
use std::{collections::BTreeSet, path::PathBuf, time::Instant};

mod recording;
mod segmentation;
#[path = "../../../src-tauri/src/voice_audio_stats.rs"]
mod voice_audio_stats;

const WORDS: &str = include_str!("../../../src-tauri/voice/keywords.json");
const MAX_ACTIVE_PATHS: i32 = 4;
const TRAILING_BLANKS: i32 = 1;
const HELP: &str = "Eagle Voice CLI - offline sherpa-onnx keyword diagnostics
Usage: voice-test --model-dir DIR [options] WAV [WAV ...]
       voice-test --model-dir DIR [options] --record OUTPUT.wav
  --record FILE        Record default microphone, save WAV, then recognize that file
  --record-seconds N   Automatic recording limit, 1..60 seconds (default: 8)
  --segment            Compare all energy segments with the unmodified whole WAV
  --locale zh-CN|en-US  Project keyword locale (default: zh-CN)
  --keywords FILE      UTF-8 tokenized sherpa keywords; overrides project keywords
  --threshold NUMBER   Global keyword threshold, >0 and <=1 (default: 0.25)
  --score NUMBER       Global keyword score, >0 and <=100 (default: 1)
  --tail-ms INTEGER    Silence appended for flushing, 0..5000 (default: 500)
  --help               Show this help
  --                   End options (for WAV names starting with a dash)
Input: 16-bit PCM mono WAV, 8000..192000 Hz, at most 60 seconds / 32 MiB.
16 kHz input is recommended. Other rates use SDK resampling, NOT browser resampling.
Stdout: one JSON object per file; SDK messages and errors go to stderr.
Exit: 0 includes unknown/no_keyword; 1 indicates invalid arguments or file/model errors.
Custom keyword files require model tokens, not plain Chinese/English phrases.
Per-keyword :score/#threshold overrides in custom files take precedence over globals.
Recording: press Enter to prepare, wait for RECORDING, speak, then Enter to stop.
Requires interactive stdin. Existing files are never overwritten. No automatic tuning.
WAV stores mono 16-bit PCM at the device rate, without recognition tail silence.
No game/save access; recordings stay at the explicitly selected local path.";

#[derive(Debug)]
struct Options {
    model_dir: PathBuf,
    locale: String,
    keywords: Option<PathBuf>,
    threshold: f32,
    score: f32,
    tail_ms: u32,
    files: Vec<String>,
    record: Option<PathBuf>,
    record_seconds: u32,
    segment: bool,
}

fn number(value: &str, name: &str, max: f32) -> Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|_| format!("{name}: invalid number {value:?}"))?;
    // The C API substitutes defaults for zero via SHERPA_ONNX_OR.
    if !parsed.is_finite() || parsed <= 0.0 || parsed > max {
        return Err(format!("{name}: expected a finite number >0 and <={max}"));
    }
    Ok(parsed)
}

fn parse(args: impl IntoIterator<Item = String>) -> Result<Option<Options>, String> {
    let mut args = args.into_iter();
    let mut result = Options {
        model_dir: PathBuf::new(),
        locale: "zh-CN".into(),
        keywords: None,
        threshold: 0.25,
        score: 1.0,
        tail_ms: 500,
        files: Vec::new(),
        record: None,
        record_seconds: 8,
        segment: false,
    };
    let mut positional = false;
    let mut record_seconds_set = false;
    while let Some(arg) = args.next() {
        if positional {
            result.files.push(arg);
            continue;
        }
        if arg == "--" {
            positional = true;
            continue;
        }
        if arg == "--help" || arg == "-h" {
            return Ok(None);
        }
        if arg == "--segment" {
            result.segment = true;
            continue;
        }
        if !arg.starts_with('-') {
            result.files.push(arg);
            continue;
        }
        if ![
            "--model-dir",
            "--locale",
            "--keywords",
            "--threshold",
            "--score",
            "--tail-ms",
            "--record",
            "--record-seconds",
        ]
        .contains(&arg.as_str())
        {
            return Err(format!("Unknown option: {arg}"));
        }
        let value = args
            .next()
            .ok_or_else(|| format!("{arg} requires a value"))?;
        match arg.as_str() {
            "--record" => result.record = Some(value.into()),
            "--record-seconds" => {
                record_seconds_set = true;
                result.record_seconds = value
                    .parse::<u32>()
                    .map_err(|_| "--record-seconds must be an integer in 1..60")?;
                if !(1..=60).contains(&result.record_seconds) {
                    return Err("--record-seconds must be in 1..60".into());
                }
            }
            "--model-dir" => result.model_dir = value.into(),
            "--locale" => {
                if !["zh-CN", "en-US"].contains(&value.as_str()) {
                    return Err("--locale must be zh-CN or en-US".into());
                }
                result.locale = value;
            }
            "--keywords" => result.keywords = Some(value.into()),
            "--threshold" => result.threshold = number(&value, &arg, 1.0)?,
            "--score" => result.score = number(&value, &arg, 100.0)?,
            "--tail-ms" => {
                result.tail_ms = value
                    .parse::<u32>()
                    .map_err(|_| "--tail-ms must be an integer in 0..5000")?;
                if result.tail_ms > 5000 {
                    return Err("--tail-ms must be in 0..5000".into());
                }
            }
            _ => unreachable!(),
        }
    }
    if result.model_dir.as_os_str().is_empty() {
        return Err("--model-dir is required".into());
    }
    if result.record.is_some() && !result.files.is_empty() {
        return Err("--record cannot be combined with input WAV files".into());
    }
    if record_seconds_set && result.record.is_none() {
        return Err("--record-seconds requires --record".into());
    }
    if result.files.is_empty() && result.record.is_none() {
        return Err("At least one WAV file or --record OUTPUT.wav is required".into());
    }
    Ok(Some(result))
}

fn classify(found: &BTreeSet<String>, allowed: Option<&BTreeSet<String>>) -> Value {
    let reason = if found.is_empty() {
        Some("no_keyword")
    } else if allowed.is_some_and(|ids| found.iter().any(|id| !ids.contains(id))) {
        Some("unrecognized_label")
    } else if found.len() > 1 {
        Some("multiple_actions")
    } else {
        None
    };
    match reason {
        Some(reason) => json!({"type":"unknown", "unknownReason":reason}),
        None if allowed.is_some() => json!({"type":"known", "actionId":found.first().unwrap()}),
        None => json!({"type":"known", "label":found.first().unwrap()}),
    }
}

fn recognize(
    kws: &KeywordSpotter,
    file: &str,
    opts: &Options,
    allowed: Option<&BTreeSet<String>>,
) -> Result<Value, String> {
    let started = Instant::now();
    let metadata = std::fs::metadata(file).map_err(|e| format!("Cannot open WAV: {e}"))?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 * 1024 {
        return Err("WAV must be a regular file of at most 32 MiB".into());
    }
    let wave = Wave::read(file).ok_or(
        "Cannot decode WAV: expected 16-bit PCM mono WAV (not MP3, stereo, float, or 24-bit PCM)",
    )?;
    let rate = wave.sample_rate();
    if !(8000..=192000).contains(&rate) {
        return Err(format!(
            "Unsupported sample rate {rate}; expected 8000..192000 Hz"
        ));
    }
    let samples = wave.samples();
    if samples.len() > rate as usize * 60 {
        return Err("WAV exceeds 60 seconds".into());
    }
    let mut row = recognize_samples(kws, samples, rate, opts, allowed);
    if opts.segment {
        let segmented = (|| -> Result<Value, String> {
            let plan = segmentation::plan(samples, rate as u32);
            let mut report = plan.diagnostics;
            let mut segment_rows = Vec::new();
            let mut all_labels = BTreeSet::new();
            let output = if plan.ranges.is_empty() {
                None
            } else {
                Some(segmentation::output_dir(std::path::Path::new(file))?)
            };
            for (index, &(begin, end)) in plan.ranges.iter().enumerate() {
                let path = output
                    .as_ref()
                    .unwrap()
                    .join(format!("segment{:02}.wav", index + 1));
                segmentation::save(&path, &samples[begin..end], rate as u32)?;
                let saved =
                    Wave::read(&path.to_string_lossy()).ok_or("Cannot reread saved segment WAV")?;
                let mut part =
                    recognize_samples(kws, saved.samples(), saved.sample_rate(), opts, allowed);
                for label in part["labels"].as_array().unwrap() {
                    if let Some(label) = label.as_str() {
                        all_labels.insert(label.to_owned());
                    }
                }
                part["file"] = json!(path);
                part["startSample"] = json!(begin);
                part["endSample"] = json!(end);
                part["startMs"] = json!(begin as f64 * 1000.0 / f64::from(rate));
                part["endMs"] = json!(end as f64 * 1000.0 / f64::from(rate));
                segment_rows.push(part);
            }
            report["result"] = if plan.ranges.is_empty() {
                json!({"type":"unknown","unknownReason":"no_speech"})
            } else {
                classify(&all_labels, allowed)
            };
            report["labels"] = json!(all_labels);
            report["outputDirectory"] = json!(output);
            report["segments"] = json!(segment_rows);
            Ok(report)
        })();
        row["segmentation"] = match segmented {
            Ok(report) => report,
            Err(error) => json!({"error":error}),
        };
    }
    row["fileDurationMs"] = json!(started.elapsed().as_secs_f64() * 1000.0);
    Ok(row)
}

// A fresh stream for each region keeps segment comparisons independent of preceding silence.
fn recognize_samples(
    kws: &KeywordSpotter,
    samples: &[f32],
    rate: i32,
    opts: &Options,
    allowed: Option<&BTreeSet<String>>,
) -> Value {
    let pcm = voice_audio_stats::summarize(samples, rate as u32);
    let stream = kws.create_stream();
    let mut found = BTreeSet::new();
    let (mut decode_count, mut hit_count) = (0, 0);
    let decode_started = Instant::now();
    let result = if samples.len() < rate as usize / 5 {
        json!({"type":"unknown", "unknownReason":if samples.is_empty(){"empty_audio"}else{"too_short"}})
    } else {
        stream.accept_waveform(rate, samples);
        // The synthetic tail belongs to inference only, never to saved audio.
        stream.accept_waveform(
            rate,
            &vec![0.0; rate as usize * opts.tail_ms as usize / 1000],
        );
        stream.input_finished();
        while kws.is_ready(&stream) {
            kws.decode(&stream);
            decode_count += 1;
            if let Some(hit) = kws.get_result(&stream) {
                if !hit.keyword.is_empty() {
                    hit_count += 1;
                    found.insert(hit.keyword);
                    kws.reset(&stream);
                }
            }
        }
        classify(&found, allowed)
    };
    json!({"pcm":pcm,"sdkResampled":rate!=16000,"decodeCount":decode_count,"hitCount":hit_count,"labels":found,"result":result,"decodeDurationMs":decode_started.elapsed().as_secs_f64()*1000.0})
}

fn run(mut opts: Options) -> Result<bool, String> {
    let words: Value = serde_json::from_str(WORDS).map_err(|e| e.to_string())?;
    let keywords = match &opts.keywords {
        Some(path) => {
            use std::io::Read;
            let file = std::fs::File::open(path)
                .map_err(|e| format!("Cannot open keywords {}: {e}", path.display()))?;
            let mut text = String::new();
            file.take(1024 * 1024 + 1)
                .read_to_string(&mut text)
                .map_err(|e| format!("Cannot read UTF-8 keywords {}: {e}", path.display()))?;
            if text.len() > 1024 * 1024 {
                return Err("Keywords file exceeds 1 MiB".into());
            }
            text
        }
        None => words["keywords"][&opts.locale]
            .as_str()
            .ok_or("Missing generated project keywords")?
            .into(),
    };
    let keywords = keywords.trim_start_matches('\u{feff}');
    // The C API accepts a NUL-terminated buffer. Reject truncation and empty dictionaries early.
    if keywords.contains('\0') || keywords.trim().is_empty() {
        return Err("Keywords must be nonempty UTF-8 without NUL bytes".into());
    }
    let mut config = KeywordSpotterConfig::default();
    let path = |name: &str| -> Result<Option<String>, String> {
        let path = opts.model_dir.join(name);
        if !path.is_file() {
            return Err(format!("Missing model file: {}", path.display()));
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    };
    config.model_config.transducer.encoder =
        path("encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx")?;
    config.model_config.transducer.decoder = path("decoder-epoch-13-avg-2-chunk-16-left-64.onnx")?;
    config.model_config.transducer.joiner =
        path("joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx")?;
    config.model_config.tokens = path("tokens.txt")?;
    config.model_config.provider = Some("cpu".into());
    config.model_config.num_threads = 1;
    config.max_active_paths = MAX_ACTIVE_PATHS;
    config.num_trailing_blanks = TRAILING_BLANKS;
    config.keywords_score = opts.score;
    config.keywords_threshold = opts.threshold;
    config.keywords_buf = Some(keywords.into());
    let started = Instant::now();
    let kws = KeywordSpotter::create(&config).ok_or(
        "Model initialization failed; inspect SDK stderr, model files and tokenized keywords",
    )?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;
    let allowed: BTreeSet<String> = words["rows"]
        .as_array()
        .ok_or("Missing project keyword rows")?
        .iter()
        .filter(|r| r["locale"] == opts.locale)
        .filter_map(|r| r["actionId"].as_str().map(str::to_owned))
        .collect();
    let effective = json!({"modelId":words["modelId"],"modelDir":opts.model_dir,"locale":opts.locale,"keywordSource":opts.keywords,"keywordCount":keywords.lines().filter(|line| !line.trim().is_empty()).count(),"keywordsText":keywords,"provider":"cpu","numThreads":1,"maxActivePaths":MAX_ACTIVE_PATHS,"trailingBlanks":TRAILING_BLANKS,"keywordsScore":opts.score,"keywordsThreshold":opts.threshold,"tailMs":opts.tail_ms,"featureSampleRate":16000});
    if let Some(path) = &opts.record {
        recording::record(path, opts.record_seconds)?;
        opts.files.push(path.to_string_lossy().into_owned());
    }
    let mut failed = false;
    for file in &opts.files {
        let mut row = match recognize(
            &kws,
            file,
            &opts,
            if opts.keywords.is_none() {
                Some(&allowed)
            } else {
                None
            },
        ) {
            Ok(row) => row,
            Err(error) => {
                failed = true;
                eprintln!("{file}: {error}");
                json!({"error":error})
            }
        };
        if row["segmentation"]["error"].is_string() {
            failed = true;
            eprintln!(
                "{file}: segmentation failed: {}",
                row["segmentation"]["error"]
            );
        }
        row["file"] = json!(file);
        row["config"] = effective.clone();
        row["modelLoadDurationMs"] = json!(load_ms);
        println!("{row}");
    }
    Ok(!failed)
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
    fn options(extra: &[&str]) -> Result<Option<Options>, String> {
        parse(
            ["--model-dir", "models", "audio.wav"]
                .into_iter()
                .chain(extra.iter().copied())
                .map(str::to_owned),
        )
    }
    #[test]
    fn defaults_and_invalid_parameters() {
        let opts = options(&[]).unwrap().unwrap();
        assert!(!opts.segment);
        assert!(options(&["--segment"]).unwrap().unwrap().segment);
        assert_eq!((opts.threshold, opts.score, opts.tail_ms), (0.25, 1.0, 500));
        for args in [
            &["--threshold", "NaN"][..],
            &["--threshold", "1.1"],
            &["--threshold", "0"],
            &["--score", "0"],
            &["--score", "-1"],
            &["--tail-ms", "5001"],
            &["--tail-ms", "1.5"],
            &["--locale", "fr"],
            &["--oops"],
        ] {
            assert!(options(args).is_err(), "{args:?}");
        }
        assert!(parse(Vec::new()).is_err());
        assert!(parse(vec!["--help".into()]).unwrap().is_none());
    }
    #[test]
    fn collect_all_labels_and_preserve_custom_labels() {
        let allowed = BTreeSet::from(["salute".into(), "wave".into()]);
        assert_eq!(
            classify(&BTreeSet::new(), Some(&allowed))["unknownReason"],
            "no_keyword"
        );
        assert_eq!(
            classify(
                &BTreeSet::from(["salute".into(), "salute".into()]),
                Some(&allowed)
            )["actionId"],
            "salute"
        );
        assert_eq!(
            classify(&allowed, Some(&allowed))["unknownReason"],
            "multiple_actions"
        );
        let custom = BTreeSet::from(["hello".into()]);
        assert_eq!(
            classify(&custom, Some(&allowed))["unknownReason"],
            "unrecognized_label"
        );
        assert_eq!(classify(&custom, None)["label"], "hello");
    }
    #[test]
    fn recording_options_are_bounded_and_exclusive() {
        let parse_record = |extra: &[&str]| {
            parse(
                ["--model-dir", "models", "--record", "speech.wav"]
                    .into_iter()
                    .chain(extra.iter().copied())
                    .map(str::to_owned),
            )
        };
        let opts = parse_record(&[]).unwrap().unwrap();
        assert_eq!(opts.record_seconds, 8);
        assert_eq!(opts.record.unwrap(), PathBuf::from("speech.wav"));
        for args in [
            &["other.wav"][..],
            &["--record-seconds", "0"],
            &["--record-seconds", "61"],
            &["--record-seconds", "NaN"],
        ] {
            assert!(parse_record(args).is_err());
        }
        assert!(options(&["--record-seconds", "8"]).is_err());
    }
}
