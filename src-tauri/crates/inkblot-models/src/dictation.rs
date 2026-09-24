//! Whisper dictation, and the microphone level meter that animates the control.
//!
//! The page listens for `dictation://started`, `…/partial`, `…/final`, `…/stopped`,
//! `…/error` and `…/level`. Those names are the contract — the Tauri app emits them
//! with `AppHandle::emit`, the Swift shell through the shim's `__inkblotTauri.emit` —
//! so they are produced here, once, and each shell only forwards them.

use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, Stream};
use inkblot_dictation::{DictationEvent, DictationService};
use parking_lot::Mutex;
use serde::Serialize;

pub use inkblot_dictation::{DictationStatus, LiveDictationOptions, ModelInfo};

/// Where a dictation event goes: the event name the page listens for, and its payload.
pub type DictationSink = Arc<dyn Fn(&'static str, serde_json::Value) + Send + Sync + 'static>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DictationLevelPayload {
    rms: f32,
    level: f32,
}

struct DictationLevelMeter {
    stop_flag: Arc<AtomicBool>,
    stream: Option<Stream>,
    worker: Option<JoinHandle<()>>,
}

impl DictationLevelMeter {
    fn stop(mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);

        if let Some(stream) = self.stream.take() {
            drop(stream);
        }

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub struct DictationEngine {
    app_data_dir: PathBuf,
    service: Mutex<DictationService>,
    level_meter: Mutex<Option<DictationLevelMeter>>,
}

impl DictationEngine {
    pub fn new(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            app_data_dir: app_data_dir.into(),
            service: Mutex::new(DictationService::new()),
            level_meter: Mutex::new(None),
        }
    }

    /// Load a whisper model — the one named, or the first found where one is looked for.
    pub fn load_model(&self, model_path: Option<String>) -> Result<ModelInfo, String> {
        let resolved = match model_path {
            Some(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => {
                let candidates = default_model_candidates(&self.app_data_dir);
                candidates
                    .iter()
                    .find(|path| path.is_file())
                    .cloned()
                    .ok_or_else(|| {
                        // A sentinel plus the search path, so the UI can both branch on it
                        // and tell the user where to put the file.
                        format!(
                            "DICTATION_MODEL_NOT_INSTALLED: looked in {}",
                            candidates
                                .iter()
                                .map(|p| p.display().to_string())
                                .collect::<Vec<_>>()
                                .join(", ")
                        )
                    })?
            }
        };

        if !resolved.is_file() {
            return Err(format!(
                "DICTATION_MODEL_NOT_INSTALLED: no file at {}",
                resolved.display()
            ));
        }

        self.service
            .lock()
            .load_model(resolved.to_string_lossy().to_string())
            .map_err(|err| err.to_string())
    }

    pub fn start_session(
        &self,
        options: Option<LiveDictationOptions>,
        sink: DictationSink,
    ) -> Result<String, String> {
        let options = options.unwrap_or_default();
        let session_id = {
            let events = sink.clone();
            self.service
                .lock()
                .start_session(options, Arc::new(move |event| forward(&events, event)))
                .map_err(|err| err.to_string())?
        };

        // The meter is decoration: a Mac with no input device can still dictate from an
        // aggregate device, so failing to open one is logged rather than fatal.
        match build_level_meter(sink) {
            Ok(meter) => {
                if let Some(previous) = self.level_meter.lock().replace(meter) {
                    previous.stop();
                }
            }
            Err(err) => log::warn!("Failed to start dictation level meter: {err}"),
        }

        Ok(session_id)
    }

    pub fn stop_session(&self) -> Result<(), String> {
        self.stop_level_meter();
        self.service
            .lock()
            .stop_session()
            .map_err(|err| err.to_string())
    }

    pub fn cancel_session(&self) {
        self.stop_level_meter();
        self.service.lock().cancel_session();
    }

    pub fn status(&self) -> DictationStatus {
        self.service.lock().status()
    }

    fn stop_level_meter(&self) {
        let previous = self.level_meter.lock().take();
        if let Some(previous) = previous {
            previous.stop();
        }
    }
}

/// Where a whisper model is looked for when the caller does not name one.
///
/// Nearest first: `$INKBLOT_DICTATION_MODEL`, then `<AppData>/models/ggml-small.en.bin`,
/// then `~/inkblot-dictation/models/ggml-small.en.bin`, a per-user location that
/// survives reinstalling the app.
pub fn default_model_candidates(app_data_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(explicit) = std::env::var("INKBLOT_DICTATION_MODEL") {
        if !explicit.trim().is_empty() {
            candidates.push(PathBuf::from(explicit));
        }
    }

    candidates.push(app_data_dir.join("models").join("ggml-small.en.bin"));

    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(
            PathBuf::from(home)
                .join("inkblot-dictation")
                .join("models")
                .join("ggml-small.en.bin"),
        );
    }

    candidates
}

fn forward(sink: &DictationSink, event: DictationEvent) {
    let (name, payload) = match event {
        DictationEvent::Started(payload) => ("dictation://started", serde_json::to_value(payload)),
        DictationEvent::Partial(payload) => ("dictation://partial", serde_json::to_value(payload)),
        DictationEvent::Final(payload) => ("dictation://final", serde_json::to_value(payload)),
        DictationEvent::Stopped(payload) => ("dictation://stopped", serde_json::to_value(payload)),
        DictationEvent::Error(payload) => ("dictation://error", serde_json::to_value(payload)),
    };
    if let Ok(payload) = payload {
        sink(name, payload);
    }
}

fn build_level_meter(sink: DictationSink) -> Result<DictationLevelMeter, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default input device found".to_string())?;

    let supported_config = device
        .default_input_config()
        .map_err(|err| err.to_string())?;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();

    let (level_tx, level_rx) = mpsc::sync_channel::<f32>(4);
    let stop_flag = Arc::new(AtomicBool::new(false));
    let worker = spawn_level_meter_worker(sink, level_rx, stop_flag.clone());

    let stream = match sample_format {
        SampleFormat::F32 => build_level_input_stream::<f32>(&device, &config, level_tx),
        SampleFormat::I16 => build_level_input_stream::<i16>(&device, &config, level_tx),
        SampleFormat::U16 => build_level_input_stream::<u16>(&device, &config, level_tx),
        other => Err(format!("Unsupported sample format: {other:?}")),
    }?;

    stream.play().map_err(|err| err.to_string())?;

    Ok(DictationLevelMeter {
        stop_flag,
        stream: Some(stream),
        worker: Some(worker),
    })
}

fn build_level_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    level_tx: mpsc::SyncSender<f32>,
) -> Result<Stream, String>
where
    T: Sample + cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _info: &cpal::InputCallbackInfo| {
                let rms = audio_rms(data.iter().map(|sample| f32::from_sample(*sample)));
                let _ = level_tx.try_send(rms);
            },
            move |err| {
                log::warn!("CPAL dictation level stream error: {err}");
            },
            None,
        )
        .map_err(|err| err.to_string())
}

fn spawn_level_meter_worker(
    sink: DictationSink,
    level_rx: mpsc::Receiver<f32>,
    stop_flag: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut last_emit_at = Instant::now();
        let mut smoothed_level = 0.0_f32;

        while !stop_flag.load(Ordering::SeqCst) {
            match level_rx.recv_timeout(Duration::from_millis(40)) {
                Ok(rms) => {
                    let level = normalize_rms_level(rms);
                    smoothed_level = smoothed_level.mul_add(0.68, level * 0.32);

                    if last_emit_at.elapsed() >= Duration::from_millis(45) {
                        emit_level(&sink, rms, smoothed_level);
                        last_emit_at = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    smoothed_level *= 0.72;

                    if last_emit_at.elapsed() >= Duration::from_millis(80) {
                        emit_level(&sink, 0.0, smoothed_level);
                        last_emit_at = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        emit_level(&sink, 0.0, 0.0);
    })
}

fn emit_level(sink: &DictationSink, rms: f32, level: f32) {
    if let Ok(payload) = serde_json::to_value(DictationLevelPayload {
        rms,
        level: level.clamp(0.0, 1.0),
    }) {
        sink("dictation://level", payload);
    }
}

fn audio_rms(samples: impl Iterator<Item = f32>) -> f32 {
    let mut sum = 0.0_f32;
    let mut count = 0_usize;

    for sample in samples {
        sum += sample * sample;
        count += 1;
    }

    if count == 0 {
        return 0.0;
    }

    (sum / count as f32).sqrt()
}

fn normalize_rms_level(rms: f32) -> f32 {
    ((rms - 0.004) * 8.5).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_data_model_is_looked_for_before_the_home_directory_one() {
        let candidates = default_model_candidates(Path::new("/data"));
        let app = candidates
            .iter()
            .position(|p| p == Path::new("/data/models/ggml-small.en.bin"));
        let home = candidates
            .iter()
            .position(|p| p.ends_with("inkblot-dictation/models/ggml-small.en.bin"));
        assert!(app.is_some());
        if let Some(home) = home {
            assert!(app.unwrap() < home);
        }
    }

    #[test]
    fn a_missing_model_is_the_sentinel() {
        let engine = DictationEngine::new("/nonexistent");
        let error = engine
            .load_model(Some("/nonexistent/model.bin".into()))
            .unwrap_err();
        assert!(error.starts_with("DICTATION_MODEL_NOT_INSTALLED"));
    }

    #[test]
    fn silence_is_level_zero() {
        assert_eq!(audio_rms(std::iter::empty()), 0.0);
        assert_eq!(normalize_rms_level(0.0), 0.0);
        assert_eq!(normalize_rms_level(1.0), 1.0);
    }
}
