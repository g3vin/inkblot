//! A GET on the page's behalf, for looking a source up (`references/fetchText.js`).
//!
//! The page cannot fetch another origin, so the References panel's lookups — a web
//! page's metadata, doi.org, Open Library, arXiv, PubMed — come through here. Only
//! http(s), only GET, and only so much of the body.

use serde::Serialize;

const MAX_BYTES: usize = 5 * 1024 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Inkblot";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedText {
    status: u16,
    final_url: String,
    content_type: String,
    body: String,
}

#[tauri::command]
pub async fn fetch_text(url: String, accept: Option<String>) -> Result<FetchedText, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Only web addresses can be looked up".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only web addresses can be looked up".into());
    }
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let mut request = client.get(parsed).header("Accept-Language", "en-US,en;q=0.9");
    if let Some(accept) = accept.filter(|a| !a.is_empty()) {
        request = request.header("Accept", accept);
    }
    let mut response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() >= MAX_BYTES {
            break;
        }
    }
    Ok(FetchedText { status, final_url, content_type, body: String::from_utf8_lossy(&bytes).into_owned() })
}
