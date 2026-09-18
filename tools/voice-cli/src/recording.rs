//! Explicit, bounded local recording. Audio is never included in diagnostics.
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::{
    fs::{File, OpenOptions},
    io::{self, IsTerminal},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

struct Capture {
    samples: Vec<i16>,
    limit: usize,
}

impl Capture {
    fn append<T: cpal::Sample>(&mut self, data: &[T], channels: usize)
    where
        f32: cpal::FromSample<T>,
    {
        // Average complete interleaved frames; never select only the left channel.
        for frame in data
            .chunks_exact(channels)
            .take(self.limit - self.samples.len())
        {
            let sum: f64 = frame
                .iter()
                .map(|s| {
                    let value: f32 = s.to_sample();
                    if value.is_finite() {
                        value as f64
                    } else {
                        0.0
                    }
                })
                .sum();
            let mono = (sum / channels as f64).clamp(-1.0, 1.0);
            self.samples.push(if mono < 0.0 {
                (mono * 32768.0).round() as i16
            } else {
                (mono * 32767.0).round() as i16
            });
        }
    }
}

fn input_stream<T: cpal::SizedSample>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    capture: Arc<Mutex<Capture>>,
    active: Arc<AtomicBool>,
    ready: mpsc::SyncSender<()>,
    errors: mpsc::SyncSender<String>,
) -> Result<cpal::Stream, String>
where
    f32: cpal::FromSample<T>,
{
    let channels = config.channels as usize;
    let callback_errors = errors.clone();
    let mut notified = false;
    device
        .build_input_stream(
            config,
            move |data: &[T], _| {
                if !notified {
                    let _ = ready.try_send(());
                    notified = true;
                }
                if active.load(Ordering::Acquire) {
                    match capture.lock() {
                        Ok(mut buffer) => buffer.append(data, channels),
                        Err(_) => {
                            let _ = callback_errors.try_send("Recording buffer unavailable".into());
                        }
                    }
                }
            },
            move |error| {
                let _ = errors.try_send(format!("Microphone stream failed: {error}"));
            },
            None,
        )
        .map_err(|e| format!("Cannot open microphone: {e}"))
}

fn write_wav(file: File, rate: u32, samples: &[i16]) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::new(io::BufWriter::new(file), spec)
        .map_err(|e| format!("Cannot create WAV header: {e}"))?;
    for sample in samples {
        writer
            .write_sample(*sample)
            .map_err(|e| format!("Cannot write recording: {e}"))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("Cannot finalize recording: {e}"))
}

pub fn record(path: &Path, seconds: u32) -> Result<(), String> {
    if !io::stdin().is_terminal() {
        return Err(
            "Recording requires an interactive console (stdin must not be redirected)".into(),
        );
    }
    if !(1..=60).contains(&seconds) {
        return Err("Recording limit must be 1..60 seconds".into());
    }
    if path.exists() {
        return Err(format!("Refusing to overwrite {}", path.display()));
    }
    eprintln!("Press Enter to prepare the microphone. Wait for RECORDING before speaking.");
    if io::stdin()
        .read_line(&mut String::new())
        .map_err(|e| format!("Cannot read console: {e}"))?
        == 0
    {
        return Err("Console input closed; recording cancelled".into());
    }
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No default microphone found")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("Cannot query microphone: {e}"))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let rate = config.sample_rate.0;
    if !(8000..=192000).contains(&rate) || !(1..=64).contains(&config.channels) {
        return Err(format!(
            "Unsupported microphone configuration: {rate} Hz / {} channels",
            config.channels
        ));
    }
    let limit = rate as usize * seconds as usize;
    let capture = Arc::new(Mutex::new(Capture {
        samples: Vec::with_capacity(limit),
        limit,
    }));
    let active = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let (error_tx, error_rx) = mpsc::sync_channel(1);
    macro_rules! stream {
        ($ty:ty) => {
            input_stream::<$ty>(
                &device,
                &config,
                capture.clone(),
                active.clone(),
                ready_tx,
                error_tx,
            )?
        };
    }
    let stream = match format {
        cpal::SampleFormat::F32 => stream!(f32),
        cpal::SampleFormat::F64 => stream!(f64),
        cpal::SampleFormat::I8 => stream!(i8),
        cpal::SampleFormat::I16 => stream!(i16),
        cpal::SampleFormat::I32 => stream!(i32),
        cpal::SampleFormat::I64 => stream!(i64),
        cpal::SampleFormat::U8 => stream!(u8),
        cpal::SampleFormat::U16 => stream!(u16),
        cpal::SampleFormat::U32 => stream!(u32),
        cpal::SampleFormat::U64 => stream!(u64),
        other => return Err(format!("Unsupported microphone sample format: {other}")),
    };
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create recording directory: {e}"))?;
    }
    // Reserve before starting; create_new closes the overwrite race with another process.
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Cannot create recording {}: {e}", path.display()))?;
    let result = (|| {
        stream
            .play()
            .map_err(|e| format!("Cannot start microphone: {e}"))?;
        ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| {
            error_rx
                .try_recv()
                .unwrap_or_else(|_| "Microphone supplied no samples within 5 seconds".into())
        })?;
        let (stop_tx, stop_rx) = mpsc::sync_channel(1);
        // Only one recording per process. A pending console read ends with the process
        // after the duration limit; it never owns the microphone or WAV writer.
        std::thread::Builder::new()
            .name("record-stop-console".into())
            .spawn(move || {
                let result = io::stdin().read_line(&mut String::new());
                let _ = stop_tx.send(
                    result
                        .map(|_| ())
                        .map_err(|e| format!("Console input failed: {e}")),
                );
            })
            .map_err(|e| format!("Cannot start console reader: {e}"))?;
        eprintln!("RECORDING: speak now; press Enter to stop (automatic limit: {seconds}s). {rate} Hz, {} input channels -> mono.", config.channels);
        active.store(true, Ordering::Release);
        let started = Instant::now();
        loop {
            if let Ok(error) = error_rx.try_recv() {
                return Err(error);
            }
            match stop_rx.recv_timeout(Duration::from_millis(25)) {
                Ok(result) => {
                    result?;
                    break;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Console reader stopped".into())
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if started.elapsed() >= Duration::from_secs(seconds as u64) {
                break;
            }
        }
        Ok(())
    })();
    active.store(false, Ordering::Release);
    drop(stream); // Release the microphone before disk I/O or inference.
    let save_result = result.and_then(|()| {
        if let Ok(error) = error_rx.try_recv() {
            return Err(error);
        }
        let buffer = capture.lock().map_err(|_| "Recording buffer unavailable")?;
        if buffer.samples.is_empty() {
            return Err("No audio samples captured".into());
        }
        write_wav(file, rate, &buffer.samples)?;
        eprintln!(
            "Saved {} ({:.3}s, mono 16-bit PCM; no appended silence).",
            path.display(),
            buffer.samples.len() as f64 / rate as f64
        );
        Ok(())
    });
    if save_result.is_err() {
        // This path was created exclusively by this invocation, never a pre-existing WAV.
        let _ = std::fs::remove_file(path);
    }
    save_result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixes_channels_sanitizes_and_bounds_capture() {
        let mut capture = Capture {
            samples: vec![],
            limit: 4,
        };
        capture.append(
            &[1.0f32, -1.0, 0.5, 0.5, f32::NAN, 1.0, -2.0, -2.0, 1.0, 1.0],
            2,
        );
        assert_eq!(capture.samples, [0, 16384, 16384, -32768]);
        capture.append(&[1.0f32, 1.0], 2);
        assert_eq!(capture.samples.len(), 4);
    }
    #[test]
    fn wav_roundtrip_preserves_rate_length_and_samples() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "eagle-record-test-{}-{unique}.wav",
            std::process::id()
        ));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        let samples = [-32768i16, -1, 0, 1, 32767];
        write_wav(file, 48000, &samples).unwrap();
        let mut reader = hound::WavReader::open(&path).unwrap();
        assert_eq!(reader.spec().sample_rate, 48000);
        assert_eq!(reader.spec().channels, 1);
        assert_eq!(reader.duration(), 5);
        assert_eq!(
            reader
                .samples::<i16>()
                .collect::<Result<Vec<_>, _>>()
                .unwrap(),
            samples
        );
        assert!(OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .is_err());
        drop(reader);
        std::fs::remove_file(path).unwrap();
    }
}
