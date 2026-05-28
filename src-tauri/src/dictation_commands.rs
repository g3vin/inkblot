use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, Stream};
use inkblot_dictation::{
    DictationEvent, DictationEventCallback, DictationService, DictationStatus,
    LiveDictationOptions, ModelInfo,
};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

pub struct AppDictationState {
    pub service: Mutex<DictationService>,
    level_meter: Mutex<Option<DictationLevelMeter>>,
}

impl Default for AppDictationState {
    fn default() -> Self {
        Self {
            service: Mutex::new(DictationService::new()),
            level_meter: Mutex::new(None),
        }
    }
}

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

#[tauri::command]
pub async fn load_dictation_model(
    state: State<'_, AppDictationState>,
    model_path: String,
) -> Result<ModelInfo, String> {
    let mut service = state.service.lock();

    service
        .load_model(model_path)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn start_dictation_session(
    app: AppHandle,
    state: State<'_, AppDictationState>,
    options: Option<LiveDictationOptions>,
) -> Result<String, String> {
    let options = options.unwrap_or_default();
    let callback = make_tauri_dictation_callback(app.clone());
    let session_id = {
        let mut service = state.service.lock();

        service
            .start_session(options, callback)
            .map_err(|err| err.to_string())?
    };

    if let Err(err) = start_level_meter_for_state(app, &state) {
        eprintln!("Failed to start dictation level meter: {err}");
    }

    Ok(session_id)
}

#[tauri::command]
pub async fn stop_dictation_session(state: State<'_, AppDictationState>) -> Result<(), String> {
    stop_level_meter_for_state(&state);

    let mut service = state.service.lock();

    service.stop_session().map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn cancel_dictation_session(state: State<'_, AppDictationState>) -> Result<(), String> {
    stop_level_meter_for_state(&state);

    let mut service = state.service.lock();
    service.cancel_session();
    Ok(())
}

#[tauri::command]
pub async fn dictation_status(
    state: State<'_, AppDictationState>,
) -> Result<DictationStatus, String> {
    let service = state.service.lock();
    Ok(service.status())
}

fn make_tauri_dictation_callback(app: AppHandle) -> DictationEventCallback {
    Arc::new(move |event| match event {
        DictationEvent::Started(payload) => {
            let _ = app.emit("dictation://started", payload);
        }
        DictationEvent::Partial(payload) => {
            let _ = app.emit("dictation://partial", payload);
        }
        DictationEvent::Final(payload) => {
            let _ = app.emit("dictation://final", payload);
        }
        DictationEvent::Stopped(payload) => {
            let _ = app.emit("dictation://stopped", payload);
        }
        DictationEvent::Error(payload) => {
            let _ = app.emit("dictation://error", payload);
        }
    })
}

fn start_level_meter_for_state(
    app: AppHandle,
    state: &State<'_, AppDictationState>,
) -> Result<(), String> {
    let next_meter = build_dictation_level_meter(app)?;
    let previous_meter = {
        let mut level_meter = state.level_meter.lock();
        level_meter.replace(next_meter)
    };

    if let Some(previous_meter) = previous_meter {
        previous_meter.stop();
    }

    Ok(())
}

fn stop_level_meter_for_state(state: &State<'_, AppDictationState>) {
    let previous_meter = {
        let mut level_meter = state.level_meter.lock();
        level_meter.take()
    };

    if let Some(previous_meter) = previous_meter {
        previous_meter.stop();
    }
}

fn build_dictation_level_meter(app: AppHandle) -> Result<DictationLevelMeter, String> {
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
    let worker = spawn_level_meter_worker(app, level_rx, stop_flag.clone());

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
                eprintln!("CPAL dictation level stream error: {err}");
            },
            None,
        )
        .map_err(|err| err.to_string())
}

fn spawn_level_meter_worker(
    app: AppHandle,
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
                        emit_level(&app, rms, smoothed_level);
                        last_emit_at = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    smoothed_level *= 0.72;

                    if last_emit_at.elapsed() >= Duration::from_millis(80) {
                        emit_level(&app, 0.0, smoothed_level);
                        last_emit_at = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        emit_level(&app, 0.0, 0.0);
    })
}

fn emit_level(app: &AppHandle, rms: f32, level: f32) {
    let _ = app.emit(
        "dictation://level",
        DictationLevelPayload {
            rms,
            level: level.clamp(0.0, 1.0),
        },
    );
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
