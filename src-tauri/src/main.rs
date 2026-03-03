// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::collections::HashSet;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};
use url::Url;

use once_cell::sync::Lazy;

use ndarray::Array;
use ort::value::Tensor;
use ort::session::Session;
use ort::session::builder::SessionBuilder;

use reqwest;

/* ============================================================
   WEBVIEW COMMANDS
============================================================ */

#[tauri::command]
async fn navigate_webview(
    app_handle: AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    if let Some(webview) = app_handle.get_webview_window(&label) {
        let parsed_url =
            Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

        let webview_clone = webview.clone();

        webview
            .run_on_main_thread(move || {
                let _ = webview_clone.navigate(parsed_url);
            })
            .map_err(|e| format!("run_on_main_thread failed: {}", e))?;

        Ok(())
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}

#[tauri::command]
async fn get_webview_url(
    app_handle: AppHandle,
    label: String,
) -> Result<String, String> {
    if let Some(webview) = app_handle.get_webview_window(&label) {
        webview
            .url()
            .map(|u| u.to_string())
            .map_err(|e| format!("Failed to get URL: {e}"))
    } else {
        Err(format!("Webview '{}' not found", label))
    }
}

/* ============================================================
   PINTEREST SCRAPER (unchanged logic)
============================================================ */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScrapedPin {
    pin_href: String,
    image_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrapeResult {
    pins: Vec<ScrapedPin>,
    html: String,
}

fn best_url_from_srcset(srcset: &str) -> Option<String> {
    let mut best_scale = 0.0_f32;
    let mut best_url: Option<String> = None;

    for raw_part in srcset.split(',') {
        let part = raw_part.trim();
        if part.is_empty() {
            continue;
        }

        let mut pieces = part.split_whitespace();
        let url = pieces.next().unwrap_or("").trim();
        let descriptor = pieces.next().unwrap_or("").trim();

        if !url.contains("i.pinimg.com") {
            continue;
        }

        let scale = descriptor
            .strip_suffix('x')
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(0.0);

        if best_url.is_none() || scale >= best_scale {
            best_scale = scale;
            best_url = Some(url.to_string());
        }
    }

    best_url
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Extract (username, board_slug, section_slug) from a Pinterest URL path.
/// e.g. /soupyorangecat/constellations/koa/ → Some(("soupyorangecat", "constellations", Some("koa")))
fn parse_pinterest_path(path: &str) -> Option<(String, String, Option<String>)> {
    let trimmed = path.trim_matches('/');
    let parts: Vec<&str> = trimmed.split('/').collect();
    match parts.len() {
        2 => Some((parts[0].to_string(), parts[1].to_string(), None)),
        3 => Some((parts[0].to_string(), parts[1].to_string(), Some(parts[2].to_string()))),
        _ => None,
    }
}

/// Try to scrape pins via Pinterest's internal resource API (structured JSON).
async fn scrape_via_pinterest_api(
    client: &reqwest::Client,
    url: &Url,
    csrf_token: &str,
    max: usize,
) -> Result<Vec<ScrapedPin>, String> {
    let (username, board_slug, section_slug) = parse_pinterest_path(url.path())
        .ok_or_else(|| "Could not parse Pinterest path into username/board/section".to_string())?;

    let source_url = url.path().to_string();
    let mut out: Vec<ScrapedPin> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    eprintln!("[pinterest-api] csrf_token length: {}", csrf_token.len());

    // Helper closure to build a POST request with all required Pinterest headers.
    // Pinterest's /resource/*/get/ endpoints use POST with form-encoded body.
    let referer = url.to_string();
    let csrf_owned = csrf_token.to_string();
    let build_req = |api_url: &str, data: &str| {
        let mut req = client
            .post(api_url)
            .form(&[("source_url", source_url.as_str()), ("data", data)])
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Accept", "application/json, text/javascript, */*; q=0.01")
            .header("Referer", &referer)
            .header("Origin", "https://www.pinterest.com")
            .header("X-Pinterest-AppState", "active")
            .header("X-APP-VERSION", "unknown");
        if !csrf_owned.is_empty() {
            req = req.header("X-CSRFToken", csrf_owned.as_str());
        }
        req
    };

    // Helper: send a request and return (status, body)
    async fn send_and_log(
        req: reqwest::RequestBuilder,
        label: &str,
    ) -> Result<String, String> {
        let resp = req.send().await.map_err(|e| format!("{label} request failed: {e}"))?;
        let status = resp.status();
        let body = resp.text().await.map_err(|e| format!("{label} read failed: {e}"))?;
        eprintln!("[pinterest-api] {label}: status={status}, len={}, body_preview={:.300}",
            body.len(), body);
        Ok(body)
    }

    if let Some(ref section) = section_slug {
        // --- Board Section: first get section_id, then get pins ---
        let section_data = format!(
            r#"{{"options":{{"board_slug":"{}","section_slug":"{}","username":"{}"}},"context":{{}}}}"#,
            board_slug, section, username
        );
        let section_resp = send_and_log(
            build_req(
                "https://www.pinterest.com/resource/BoardSectionResource/get/",
                &section_data,
            ),
            "BoardSectionResource",
        ).await?;

        let section_json: serde_json::Value = serde_json::from_str(&section_resp)
            .map_err(|e| format!("BoardSectionResource JSON parse failed: {e}"))?;

        let section_id = section_json
            .pointer("/resource_response/data/id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                format!(
                    "No section id found in BoardSectionResource response: {}",
                    &section_resp[..section_resp.len().min(500)]
                )
            })?
            .to_string();

        eprintln!("[pinterest-api] section_id = {}", section_id);

        // Now fetch pins for this section
        let pins_data = format!(
            r#"{{"options":{{"section_id":"{}","page_size":{},"bookmark":""}},"context":{{}}}}"#,
            section_id, max.min(50)
        );
        let pins_resp = send_and_log(
            build_req(
                "https://www.pinterest.com/resource/BoardSectionPinsResource/get/",
                &pins_data,
            ),
            "BoardSectionPinsResource",
        ).await?;

        let pins_json: serde_json::Value = serde_json::from_str(&pins_resp)
            .map_err(|e| format!("BoardSectionPinsResource JSON parse failed: {e}"))?;

        if let Some(pins_arr) = pins_json.pointer("/resource_response/data").and_then(|v| v.as_array()) {
            for pin in pins_arr {
                if out.len() >= max { break; }

                let pin_id = pin.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if pin_id.is_empty() { continue; }

                // Try to get the best image URL from the images map
                let image_url = pin.pointer("/images/736x/url")
                    .or_else(|| pin.pointer("/images/474x/url"))
                    .or_else(|| pin.pointer("/images/564x/url"))
                    .or_else(|| pin.pointer("/images/236x/url"))
                    .or_else(|| pin.pointer("/images/orig/url"))
                    .or_else(|| pin.pointer("/image_large_url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if image_url.is_empty() || !image_url.contains("i.pinimg.com") { continue; }

                let pin_href = format!("https://www.pinterest.com/pin/{}/", pin_id);
                let key = format!("{}::{}", pin_href, image_url);
                if seen.contains(&key) { continue; }
                seen.insert(key);
                out.push(ScrapedPin {
                    pin_href,
                    image_url: image_url.to_string(),
                });
            }
        }
    } else {
        // --- Board (no section): use BoardFeedResource ---
        let feed_data = format!(
            r#"{{"options":{{"board_slug":"{}","username":"{}","page_size":{}}},"context":{{}}}}"#,
            board_slug, username, max.min(50)
        );
        let feed_resp = send_and_log(
            build_req(
                "https://www.pinterest.com/resource/BoardFeedResource/get/",
                &feed_data,
            ),
            "BoardFeedResource",
        ).await?;

        let feed_json: serde_json::Value = serde_json::from_str(&feed_resp)
            .map_err(|e| format!("BoardFeedResource JSON parse failed: {e}"))?;

        if let Some(pins_arr) = feed_json.pointer("/resource_response/data").and_then(|v| v.as_array()) {
            for pin in pins_arr {
                if out.len() >= max { break; }

                let pin_id = pin.get("id").and_then(|v| v.as_str()).unwrap_or("");
                if pin_id.is_empty() { continue; }

                let image_url = pin.pointer("/images/736x/url")
                    .or_else(|| pin.pointer("/images/474x/url"))
                    .or_else(|| pin.pointer("/images/564x/url"))
                    .or_else(|| pin.pointer("/images/236x/url"))
                    .or_else(|| pin.pointer("/images/orig/url"))
                    .or_else(|| pin.pointer("/image_large_url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                if image_url.is_empty() || !image_url.contains("i.pinimg.com") { continue; }

                let pin_href = format!("https://www.pinterest.com/pin/{}/", pin_id);
                let key = format!("{}::{}", pin_href, image_url);
                if seen.contains(&key) { continue; }
                seen.insert(key);
                out.push(ScrapedPin {
                    pin_href,
                    image_url: image_url.to_string(),
                });
            }
        }
    }

    eprintln!("[pinterest-api] total pins extracted: {}", out.len());
    Ok(out)
}

#[tauri::command]
async fn scrape_pinterest_html(url: String, max_pins: Option<usize>) -> Result<ScrapeResult, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if host != "www.pinterest.com" && host != "pinterest.com" {
        return Ok(ScrapeResult { pins: Vec::new(), html: String::new() });
    }

    let max = max_pins.unwrap_or(30).clamp(1, 200);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    // --- Strategy 0: Pinterest internal resource API (most reliable) ---
    // First visit the page to get cookies (csrftoken etc.), then call the API.
    let response = client
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Pinterest HTML: {e}"))?;

    // Extract csrftoken from Set-Cookie headers before consuming the body.
    let mut csrf_token = String::new();
    for val in response.headers().get_all("set-cookie") {
        if let Ok(s) = val.to_str() {
            if let Some(pos) = s.find("csrftoken=") {
                let after = &s[pos + 10..];
                let token: String = after.chars().take_while(|c| *c != ';' && *c != ' ').collect();
                if token.len() >= 8 {
                    csrf_token = token;
                }
            }
        }
    }
    eprintln!("[pinterest] csrftoken from Set-Cookie: len={}, preview={:.20}", csrf_token.len(), csrf_token);

    let html: String = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Pinterest HTML: {e}"))?;

    match scrape_via_pinterest_api(&client, &parsed, &csrf_token, max).await {
        Ok(api_pins) if !api_pins.is_empty() => {
            eprintln!("[pinterest] Strategy 0 (API) succeeded: {} pins", api_pins.len());
            return Ok(ScrapeResult { pins: api_pins, html });
        }
        Ok(_) => {
            eprintln!("[pinterest] Strategy 0 (API) returned 0 pins, falling back to HTML parsing");
        }
        Err(e) => {
            eprintln!("[pinterest] Strategy 0 (API) failed: {}, falling back to HTML parsing", e);
        }
    }

    let mut out: Vec<ScrapedPin> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // --- Strategy 1: Parse <img> tags with pinimg URLs ---
    let mut idx = 0usize;
    while let Some(rel_start) = html[idx..].find("<img") {
        let start = idx + rel_start;
        let end = match html[start..].find('>') {
            Some(v) => start + v,
            None => break,
        };

        let tag = &html[start..=end];
        idx = end + 1;

        let mut image_url = extract_attr(tag, "srcset")
            .and_then(|srcset| best_url_from_srcset(&srcset))
            .or_else(|| extract_attr(tag, "src"));

        if let Some(ref s) = image_url {
            if !s.contains("i.pinimg.com") {
                image_url = None;
            }
        }
        let Some(image_url) = image_url else { continue };

        // Search around this image tag for a nearby pin link or pin id.
        let left = start.saturating_sub(1200);
        let right = (end + 1200).min(html.len());
        let around = &html[left..right];

        let mut pin_href = url.clone();
        if let Some(pin_pos) = around.find("/pin/") {
            let tail = &around[pin_pos + 5..];
            let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                pin_href = format!("https://www.pinterest.com/pin/{}/", digits);
            }
        }

        if pin_href == url {
            if let Some(pin_id_attr) = around.find("data-pin-id=\"") {
                let after = &around[pin_id_attr + 13..];
                let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !digits.is_empty() {
                    pin_href = format!("https://www.pinterest.com/pin/{}/", digits);
                }
            }
        }

        let key = format!("{}::{}", pin_href, image_url);
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        out.push(ScrapedPin { pin_href, image_url });
        if out.len() >= max {
            break;
        }
    }

    // --- Strategy 2: Parse __PWS_DATA__ JSON blob ---
    // Pinterest embeds pin data in a <script id="__PWS_DATA__"> tag even when
    // <img> elements are absent (common for sections / JS-heavy pages).
    if out.len() < max {
        if let Some(pws_start) = html.find("id=\"__PWS_DATA__\"") {
            // Find the opening > of this <script> tag.
            if let Some(gt) = html[pws_start..].find('>') {
                let data_start = pws_start + gt + 1;
                if let Some(end_tag) = html[data_start..].find("</script>") {
                    let json_blob = &html[data_start..data_start + end_tag];
                    // Decode escaped forward slashes that Pinterest uses.
                    let decoded = json_blob
                        .replace("\\u002F", "/")
                        .replace("\\/", "/");

                    // Use a regex-like manual scan for pin-id + nearby pinimg URL pairs.
                    // Pattern: "/pin/<digits>/" followed within ~2000 chars by an i.pinimg.com URL.
                    let pin_re_needle = "/pin/";
                    let mut search_pos = 0usize;
                    while search_pos < decoded.len() && out.len() < max {
                        let Some(pin_pos) = decoded[search_pos..].find(pin_re_needle) else {
                            break;
                        };
                        let abs_pin_pos = search_pos + pin_pos;
                        let after_pin = abs_pin_pos + pin_re_needle.len();

                        // Extract pin id (digits).
                        let digits: String = decoded[after_pin..]
                            .chars()
                            .take_while(|c| c.is_ascii_digit())
                            .collect();
                        search_pos = after_pin + digits.len();

                        if digits.len() < 6 {
                            continue;
                        }

                        let pin_href =
                            format!("https://www.pinterest.com/pin/{}/", digits);

                        // Look ahead for a nearby i.pinimg.com URL.
                        let look_end = (search_pos + 2500).min(decoded.len());
                        let look_slice = &decoded[search_pos..look_end];

                        if let Some(img_pos) = look_slice.find("i.pinimg.com") {
                            // Walk backwards to find the start of the URL (https:// or //).
                            let mut url_start = img_pos;
                            while url_start > 0 {
                                let ch = look_slice.as_bytes()[url_start - 1];
                                if ch == b'"' || ch == b'\'' || ch == b' ' || ch == b'\\' {
                                    break;
                                }
                                url_start -= 1;
                            }
                            // Walk forward to find the end of the URL.
                            let mut url_end = img_pos;
                            while url_end < look_slice.len() {
                                let ch = look_slice.as_bytes()[url_end];
                                if ch == b'"' || ch == b'\'' || ch == b' ' || ch == b'\\' {
                                    break;
                                }
                                url_end += 1;
                            }

                            let mut img_url = look_slice[url_start..url_end].to_string();
                            // Ensure it starts with https://
                            if img_url.starts_with("//") {
                                img_url = format!("https:{}", img_url);
                            } else if !img_url.starts_with("http") {
                                img_url = format!("https://{}", img_url);
                            }

                            if img_url.contains("i.pinimg.com") {
                                let key = format!("{}::{}", pin_href, img_url);
                                if !seen.contains(&key) {
                                    seen.insert(key);
                                    out.push(ScrapedPin {
                                        pin_href,
                                        image_url: img_url,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(ScrapeResult { pins: out, html })
}

use tokenizers::Tokenizer;

static TOKENIZER: Lazy<Tokenizer> = Lazy::new(|| {
    println!("[INFO] Loading HuggingFace tokenizer...");
    Tokenizer::from_pretrained(
        "sentence-transformers/all-MiniLM-L6-v2",
        None,
    )
    .expect("Failed to load tokenizer")
});

struct SynonymModel {
    session: Session,
    vocab: Vec<String>,
}

fn find_target_position(
    encoding: &tokenizers::Encoding,
    text: &str,
    target: &str,
) -> i64 {
    let offsets = encoding.get_offsets(); // Vec<(u32,u32)> typically
    let start_char = text.find(target).unwrap_or(0);

    for (i, (s, e)) in offsets.iter().enumerate() {
        // cast offset endpoints to usize before comparing to start_char
        let s_usize = *s as usize;
        let e_usize = *e as usize;
        if s_usize <= start_char && start_char < e_usize {
            return i as i64;
        }
    }

    0
}

static MODEL: Lazy<Mutex<Option<SynonymModel>>> =
    Lazy::new(|| Mutex::new(None));

fn init_synonym_model() {
    let mut guard = MODEL.lock().unwrap();

    if guard.is_some() {
        return;
    }

    println!("[INFO] Loading ONNX synonym model...");

    let session = SessionBuilder::new()
        .unwrap()
        .commit_from_file("../public/synonym.onnx")
        .unwrap();

    let vocab: Vec<String> =
        serde_json::from_str(
            &std::fs::read_to_string("../public/vocab_kaggle.json")
                .expect("Failed to read vocab"),
        )
        .expect("Invalid vocab JSON");

    *guard = Some(SynonymModel { session, vocab });

    println!("[INFO] Synonym model loaded.");
}

#[derive(Serialize)]
struct SynonymResponse {
    synonyms: Vec<String>,
    antonyms: Vec<String>,
}

#[tauri::command]
async fn get_synonyms(
    _text: String,
    target_word: String,
) -> Result<SynonymResponse, String> {
    // ----- pull model from the global -----
    let mut guard = MODEL.lock().unwrap();
    let model = guard.as_mut().ok_or("Model not initialized")?;

    // ----- tokenizer / inputs -----
    let max_len: usize = 32;

    // TOKENIZER is the Lazy<Tokenizer> you already declared
    let encoding = TOKENIZER
        .encode(_text.as_str(), true)
        .map_err(|e| format!("tokenizer.encode error: {}", e))?;

    // convert ids / mask to i64 Vec
    let mut input_ids_i64: Vec<i64> = encoding
        .get_ids()
        .iter()
        .map(|&id| id as i64)
        .collect();

    let mut attention_mask_i64: Vec<i64> = encoding
        .get_attention_mask()
        .iter()
        .map(|&m| m as i64)
        .collect();

    // pad/truncate to max_len
    input_ids_i64.resize(max_len, 0);
    attention_mask_i64.resize(max_len, 0);
    input_ids_i64.truncate(max_len);
    attention_mask_i64.truncate(max_len);

    // find target token position (as i64)
    let target_pos_val: i64 = find_target_position(&encoding, &_text, &target_word) as i64;

    // build ndarrays with proper shapes and types
    let input_array = Array::from_shape_vec((1, max_len), input_ids_i64)
        .map_err(|e| format!("input ndarray build failed: {}", e))?;

    let mask_array = Array::from_shape_vec((1, max_len), attention_mask_i64)
        .map_err(|e| format!("mask ndarray build failed: {}", e))?;

    let target_array = Array::from_vec(vec![target_pos_val]);

    // convert to onnx runtime tensors
    let input_tensor = Tensor::from_array(input_array).map_err(|e| e.to_string())?;
    let mask_tensor = Tensor::from_array(mask_array).map_err(|e| e.to_string())?;
    let target_tensor = Tensor::from_array(target_array).map_err(|e| e.to_string())?;

    // ----- run model -----
    let outputs = model
        .session
        .run(vec![
            ("input_ids", &input_tensor),
            ("attention_mask", &mask_tensor),
            ("target_pos", &target_tensor),
        ])
        .map_err(|e| format!("onnx run failed: {}", e))?;

    let (_shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("extract tensor failed: {}", e))?;

    let sims: Vec<f32> = data.to_vec();

    if sims.is_empty() {
        return Err("Empty model output".into());
    }

    // ----- sorting + pick top/bottom -----
    let indices: Vec<usize> = (0..sims.len()).collect();

    let mut high = indices.clone();
    high.sort_by(|&a, &b| sims[b].partial_cmp(&sims[a]).unwrap());

    let mut low = indices;
    low.sort_by(|&a, &b| sims[a].partial_cmp(&sims[b]).unwrap());

    let mut synonyms = Vec::new();
    let mut antonyms = Vec::new();

    for idx in high.iter().take(200) { // iterate more, then filter like Python
        if let Some(word) = model.vocab.get(*idx) {
            if word != &target_word {
                synonyms.push(word.clone());
            }
        }
        if synonyms.len() >= 10 {
            break;
        }
    }

    for idx in low.iter().take(200) {
        if let Some(word) = model.vocab.get(*idx) {
            if word != &target_word {
                antonyms.push(word.clone());
            }
        }
        if antonyms.len() >= 5 { // you said you wanted 5 antonyms
            break;
        }
    }

    Ok(SynonymResponse { synonyms, antonyms })
}

/* ============================================================
   MAIN
============================================================ */

fn main() {
    init_synonym_model();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            navigate_webview,
            get_webview_url,
            scrape_pinterest_html,
            get_synonyms,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}