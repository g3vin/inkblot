use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::thread;
use tauri::State;

const KOKORO_TTS_SCRIPT: &str = include_str!("kokoro_tts.py");

#[derive(Clone, Default)]
pub struct KokoroSpeechState {
    worker: Arc<Mutex<Option<KokoroWorker>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KokoroScriptRequest {
    action: &'static str,
    text: String,
    voice: String,
    speed: f32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KokoroSpeechResponse {
    pub audio_base64: String,
    pub sample_rate: u32,
    pub engine: String,
    pub graphemes: Vec<String>,
    pub phonemes: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KokoroServerResponse {
    ok: Option<bool>,
    error: Option<String>,
    audio_base64: Option<String>,
    sample_rate: Option<u32>,
    engine: Option<String>,
    graphemes: Option<Vec<String>>,
    phonemes: Option<Vec<String>>,
}

struct KokoroWorker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    python: String,
}

impl Drop for KokoroWorker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[tauri::command]
pub async fn generate_kokoro_speech(
    state: State<'_, KokoroSpeechState>,
    text: String,
    voice: String,
    speed: Option<f32>,
) -> Result<KokoroSpeechResponse, String> {
    let worker_state = state.worker.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut worker = worker_state.lock();
        request_with_worker(
            &mut worker,
            KokoroScriptRequest {
                action: "generate",
                text,
                voice,
                speed: speed.unwrap_or(1.0),
            },
        )
    })
    .await
    .map_err(|err| format!("Kokoro task failed: {err}"))?
}

#[tauri::command]
pub async fn prewarm_kokoro_speech(
    state: State<'_, KokoroSpeechState>,
    voice: String,
) -> Result<KokoroSpeechResponse, String> {
    let worker_state = state.worker.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut worker = worker_state.lock();
        request_with_worker(
            &mut worker,
            KokoroScriptRequest {
                action: "prewarm",
                text: String::new(),
                voice,
                speed: 1.0,
            },
        )
    })
    .await
    .map_err(|err| format!("Kokoro prewarm task failed: {err}"))?
}

fn request_with_worker(
    worker_slot: &mut Option<KokoroWorker>,
    request: KokoroScriptRequest,
) -> Result<KokoroSpeechResponse, String> {
    if request.action == "generate" && request.text.trim().is_empty() {
        return Err("No text was provided for Kokoro.".to_string());
    }

    if worker_slot.is_none() {
        *worker_slot = Some(spawn_worker()?);
    }

    let request_json = serde_json::to_string(&request)
        .map_err(|err| format!("Could not serialize Kokoro request: {err}"))?;

    let worker = worker_slot
        .as_mut()
        .ok_or_else(|| "Kokoro worker was not available.".to_string())?;

    if let Err(err) = worker.write_request(&request_json) {
        *worker_slot = None;
        return Err(format!("Could not send text to Kokoro: {err}"));
    }

    match worker.read_response() {
        Ok(response) => Ok(response),
        Err(err) => {
            *worker_slot = None;
            Err(err)
        }
    }
}

fn spawn_worker() -> Result<KokoroWorker, String> {
    let mut spawn_errors = Vec::new();

    for python in python_candidates() {
        let mut child = match Command::new(&python)
            .arg("-c")
            .arg(KOKORO_TTS_SCRIPT)
            .arg("--server")
            .env("PYTORCH_ENABLE_MPS_FALLBACK", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                spawn_errors.push(format!("{python}: {err}"));
                continue;
            }
        };

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("Could not open stdin for Kokoro worker in {python}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("Could not open stdout for Kokoro worker in {python}"))?;

        if let Some(stderr) = child.stderr.take() {
            let python_label = python.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[kokoro:{python_label}] {line}");
                }
            });
        }

        return Ok(KokoroWorker {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            python,
        });
    }

    Err(format!(
        "Could not find a usable Python interpreter for Kokoro. Tried: {}",
        spawn_errors.join("; ")
    ))
}

impl KokoroWorker {
    fn write_request(&mut self, request_json: &str) -> std::io::Result<()> {
        self.stdin.write_all(request_json.as_bytes())?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()
    }

    fn read_response(&mut self) -> Result<KokoroSpeechResponse, String> {
        let mut line = String::new();

        loop {
            line.clear();
            let read = self
                .stdout
                .read_line(&mut line)
                .map_err(|err| format!("Kokoro worker read failed: {err}"))?;

            if read == 0 {
                return Err(format!(
                    "Kokoro worker in {} exited unexpectedly.",
                    self.python
                ));
            }

            let trimmed = line.trim();
            if !trimmed.starts_with('{') {
                continue;
            }

            let response = serde_json::from_str::<KokoroServerResponse>(trimmed)
                .map_err(|err| format!("Kokoro returned invalid JSON: {err}"))?;

            if response.ok == Some(false) {
                return Err(format_kokoro_python_error(
                    &self.python,
                    response.error.as_deref().unwrap_or("unknown Kokoro error"),
                ));
            }

            return Ok(KokoroSpeechResponse {
                audio_base64: response.audio_base64.unwrap_or_default(),
                sample_rate: response.sample_rate.unwrap_or(24_000),
                engine: response
                    .engine
                    .unwrap_or_else(|| "kokoro-python".to_string()),
                graphemes: response.graphemes.unwrap_or_default(),
                phonemes: response.phonemes.unwrap_or_default(),
            });
        }
    }
}

fn python_candidates() -> Vec<String> {
    let mut candidates = Vec::new();

    if let Ok(python) = std::env::var("INKBLOT_KOKORO_PYTHON") {
        if !python.trim().is_empty() {
            candidates.push(python);
        }
    }

    candidates.extend([
        "python3".to_string(),
        "python".to_string(),
        "/opt/anaconda3/bin/python3".to_string(),
        "/opt/homebrew/bin/python3".to_string(),
        "/usr/local/bin/python3".to_string(),
        "/usr/bin/python3".to_string(),
    ]);

    candidates
}

fn format_kokoro_python_error(python: &str, stderr: &str) -> String {
    if stderr.contains("No module named 'kokoro'") {
        return format!(
            "Native Kokoro is not installed for {python}. Install it with: python3 -m pip install 'kokoro>=0.9.4' soundfile misaki[en]"
        );
    }

    if stderr.contains("espeak") || stderr.contains("espeak-ng") {
        return format!(
            "Kokoro needs espeak-ng for this text/voice. Install it with: brew install espeak-ng. Details: {stderr}"
        );
    }

    if stderr.is_empty() {
        format!("Kokoro failed in {python}, but did not report an error.")
    } else {
        format!("Kokoro failed in {python}: {stderr}")
    }
}
