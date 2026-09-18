//! Amplitude evidence only, never a speech detector or an inference decision.
use serde_json::{json, Value};
pub(crate) fn summarize(samples: &[f32], sample_rate: u32) -> Value {
    let (mut sum, mut peak, mut frame_sum, mut max_frame_rms) =
        (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64);
    let (mut near_zero, mut clipped, mut invalid, mut frame_count) = (0, 0, 0, 0);
    let frame_size = (sample_rate as usize / 50).max(1);
    for &sample in samples {
        if !sample.is_finite() {
            invalid += 1;
            continue;
        }
        let amplitude = f64::from(sample).abs();
        sum += amplitude * amplitude;
        peak = peak.max(amplitude);
        frame_sum += amplitude * amplitude;
        frame_count += 1;
        if frame_count == frame_size {
            max_frame_rms = max_frame_rms.max((frame_sum / frame_count as f64).sqrt());
            frame_count = 0;
            frame_sum = 0.0;
        }
        if amplitude <= 0.0001 {
            near_zero += 1;
        }
        if amplitude >= 0.999 {
            clipped += 1;
        }
    }
    if frame_count > 0 {
        max_frame_rms = max_frame_rms.max((frame_sum / frame_count as f64).sqrt());
    }
    let count = samples.len() - invalid;
    let rms = if count > 0 {
        (sum / count as f64).sqrt()
    } else {
        0.0
    };
    json!({"sampleRate":sample_rate,"sampleCount":samples.len(),"durationMs":if sample_rate>0 {samples.len() as f64/sample_rate as f64*1000.0} else {0.0},"rms":rms,"peak":peak,"maxFrameRms":max_frame_rms,"frameDurationMs":20,"rmsDbfs":20.0*rms.max(1e-6).log10(),"dbfsFloor":-120,"dbfsFloored":rms<=1e-6,"nearZeroRatio":if count>0 {near_zero as f64/count as f64}else{0.0},"nearZeroThreshold":0.0001,"clippedRatio":if count>0{clipped as f64/count as f64}else{0.0},"clippingThreshold":0.999,"invalidSampleCount":invalid})
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn synthetic_signal_statistics_stay_finite() {
        let zero = summarize(&vec![0.0; 16000], 16000);
        assert_eq!(zero["rmsDbfs"], -120.0);
        assert_eq!(zero["nearZeroRatio"], 1.0);
        let sine = (0..16000)
            .map(|n| (std::f64::consts::TAU * 1000.0 * n as f64 / 16000.0).sin() as f32 * 0.5)
            .collect::<Vec<_>>();
        assert!(
            (summarize(&sine, 16000)["rms"].as_f64().unwrap() - 0.5 / 2.0_f64.sqrt()).abs() < 1e-6
        );
        let clipped = summarize(&[1.0, -1.0, 0.0, 0.0], 16000);
        assert_eq!(clipped["clippedRatio"], 0.5);
        assert_eq!(summarize(&[f32::NAN], 16000)["invalidSampleCount"], 1);
    }
}
