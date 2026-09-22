//! Fetching a model file, the one way both models do it.
//!
//! The file is written beside its destination and renamed into place on completion, so
//! an interrupted download is never mistaken for an installed model. A half-written
//! ONNX file fails at load time with an error nobody can act on.

use std::io::Write;
use std::path::Path;

/// How often progress is reported. The synonym model's `.data` file is 422 MB and
/// would otherwise produce tens of thousands of events.
const PROGRESS_EVERY: u64 = 4 * 1024 * 1024;

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("inkblot")
        .build()
        .map_err(|e| format!("http client: {e}"))
}

/// Download `url` to `destination`, calling `progress(received, total)` as it goes.
/// `total` is 0 when the server sends no content-length.
pub async fn fetch_to(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    label: &str,
    progress: &(dyn Fn(u64, u64) + Send + Sync),
) -> Result<(), String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("downloading {label}: {e}"))?
        .error_for_status()
        .map_err(|e| format!("downloading {label}: {e}"))?;

    let total = response.content_length().unwrap_or(0);
    let partial = destination.with_extension(match destination.extension() {
        Some(ext) => format!("{}.partial", ext.to_string_lossy()),
        None => "partial".to_string(),
    });
    let mut file =
        std::fs::File::create(&partial).map_err(|e| format!("creating {partial:?}: {e}"))?;

    let mut received: u64 = 0;
    let mut last_emit: u64 = 0;
    while let Some(chunk) =
        response.chunk().await.map_err(|e| format!("reading {label}: {e}"))?
    {
        file.write_all(&chunk).map_err(|e| format!("writing {label}: {e}"))?;
        received += chunk.len() as u64;

        if received - last_emit >= PROGRESS_EVERY || received == total {
            last_emit = received;
            progress(received, total);
        }
    }

    file.flush().map_err(|e| format!("flushing {label}: {e}"))?;
    drop(file);
    std::fs::rename(&partial, destination)
        .map_err(|e| format!("installing {destination:?}: {e}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_partial_file_never_has_the_final_name() {
        let path = std::path::Path::new("/m/synonym.onnx.data");
        let partial = path.with_extension(format!(
            "{}.partial",
            path.extension().unwrap().to_string_lossy()
        ));
        assert_eq!(partial, std::path::Path::new("/m/synonym.onnx.data.partial"));
    }
}
