//! Diagnostic energy segmentation, not a speech classifier or neural VAD.
//! Conservative padding protects weak consonants; noise can still pass this heuristic.
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const FRAME_MS: usize = 20;
const MIN_ACTIVE_MS: usize = 60;
const PRE_MS: usize = 500;
const POST_MS: usize = 300;
const RMS_THRESHOLD: f64 = 0.0005;

pub struct Plan {
    pub ranges: Vec<(usize, usize)>,
    pub diagnostics: Value,
}

pub fn plan(samples: &[f32], rate: u32) -> Plan {
    let frame = (rate as usize * FRAME_MS / 1000).max(1);
    let pre = rate as usize * PRE_MS / 1000;
    let post = rate as usize * POST_MS / 1000;
    let minimum = (rate as usize * MIN_ACTIVE_MS).div_ceil(1000);
    let mut runs = Vec::new();
    let mut start = None;
    let mut max_rms = 0.0_f64;
    for (index, chunk) in samples.chunks(frame).enumerate() {
        let rms =
            (chunk.iter().map(|&x| f64::from(x).powi(2)).sum::<f64>() / chunk.len() as f64).sqrt();
        max_rms = max_rms.max(rms);
        if rms >= RMS_THRESHOLD {
            start.get_or_insert(index * frame);
        } else if let Some(begin) = start.take() {
            runs.push((begin, index * frame));
        }
    }
    if let Some(begin) = start {
        runs.push((begin, samples.len()));
    }
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    let mut rejected = Vec::new();
    for &(begin, end) in &runs {
        if end - begin < minimum {
            rejected.push(json!({"startSample":begin,"endSample":end}));
            continue;
        }
        let padded = (
            begin.saturating_sub(pre),
            end.saturating_add(post).min(samples.len()),
        );
        // Merge overlapping buffers, preserving all separated regions and their chronological order.
        if let Some(last) = ranges.last_mut().filter(|last| last.1 >= padded.0) {
            last.1 = last.1.max(padded.1);
        } else {
            ranges.push(padded);
        }
    }
    let retained: usize = ranges.iter().map(|(a, b)| b - a).sum();
    Plan {
        ranges,
        diagnostics: json!({
            "algorithm":"energy-rms-v1", "isSpeechClassifier":false,
            "frameMs":FRAME_MS,"minimumActiveMs":MIN_ACTIVE_MS,"rmsThreshold":RMS_THRESHOLD,
            "preRollMs":PRE_MS,"postRollMs":POST_MS,"maxFrameRms":max_rms,
            "activeRuns":runs.iter().map(|(a,b)|json!({"startSample":a,"endSample":b})).collect::<Vec<_>>(),
            "rejectedShortRuns":rejected,"removedSampleCount":samples.len()-retained,
            "removedDurationMs":(samples.len()-retained) as f64 * 1000.0 / f64::from(rate)
        }),
    }
}

/// Atomically allocate a fresh sibling directory. Never overwrite another experiment or original.
pub fn output_dir(input: &Path) -> Result<PathBuf, String> {
    let parent = input.parent().unwrap_or_else(|| Path::new("."));
    let stem = input.file_stem().unwrap_or_default().to_string_lossy();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    for attempt in 0..100 {
        let path = parent.join(format!(
            "{stem}-segments-{stamp}-{}-{attempt}",
            std::process::id()
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Cannot create segment directory: {e}")),
        }
    }
    Err("Cannot allocate a unique segment directory".into())
}

pub fn save(path: &Path, samples: &[f32], rate: u32) -> Result<(), String> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(file, spec).map_err(|e| e.to_string())?;
    for &sample in samples {
        writer
            .write_sample((sample * 32768.0).round().clamp(-32768.0, 32767.0) as i16)
            .map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_and_short_click_are_not_speech() {
        assert!(plan(&vec![0.0; 16000], 16000).ranges.is_empty());
        assert!(plan(&[0.1; 320], 16000).ranges.is_empty());
        assert!(plan(&[], 16000).ranges.is_empty());
    }
    #[test]
    fn protects_edges_and_preserves_all_separated_regions() {
        let mut pcm = vec![0.0; 16000 * 5];
        pcm[16000..19200].fill(0.01);
        pcm[48000..51200].fill(0.01);
        assert_eq!(
            plan(&pcm, 16000).ranges,
            vec![(8000, 24000), (40000, 56000)]
        );
        assert_eq!(plan(&[0.01; 960], 16000).ranges, vec![(0, 960)]);
    }
    #[test]
    fn overlapping_padding_merges_and_weak_start_survives() {
        let mut pcm = vec![0.0; 32000];
        pcm[8000..9600].fill(0.0006);
        pcm[16000..19200].fill(0.1);
        assert_eq!(plan(&pcm, 16000).ranges, vec![(0, 24000)]);
    }
    #[test]
    fn sample_rates_and_final_partial_frame_remain_in_bounds() {
        for rate in [8000, 11025, 16000, 44100, 192000] {
            let n = rate as usize * 60;
            let mut pcm = vec![0.0; n];
            pcm[n - rate as usize / 5..].fill(0.01);
            let p = plan(&pcm, rate);
            assert_eq!(p.ranges.len(), 1);
            assert_eq!(p.ranges[0].1, n);
            assert!(p.ranges[0].0 < n);
        }
    }
}
