//! Pinterest board scraping over plain HTTP.
//!
//! Unauthenticated, so it only sees public boards — the session-backed path runs in a
//! webview and is driven from the shell. Pure request/parse: no Tauri, no DOM.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
// `default` so that one malformed pin in a report cannot fail the deserialization of
// the whole scrape and lose every other pin with it.
#[serde(rename_all = "camelCase", default)]
pub struct ScrapedPin {
    pub pin_href: String,
    pub image_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeResult {
    pub pins: Vec<ScrapedPin>,
    pub html: String,
}

/// What the scraping script running inside the Pinterest page sends back.
///
/// The session-backed scrape happens in a webview showing the user's logged-in
/// Pinterest session, driven by an injected script. This is that script's side of the
/// conversation: one report per stage, and one final report carrying the pins.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ScrapeReport {
    /// Which scrape this belongs to. One run, one id.
    pub request_id: String,
    /// `location.href` at the moment the report was sent — which is how the caller
    /// learns it was redirected to a login page.
    pub url: String,
    pub pins: Vec<ScrapedPin>,
    /// Why the script stopped: `session_api`, `stable`, `max`, `timeout`, `empty`,
    /// `script_error`, or `probe` for the channel check.
    pub reason: String,
    /// Where in the script it was, for debugging a scrape that found nothing.
    pub stage: String,
    /// True for a report that is only saying how it is going. A progress report never
    /// ends the wait.
    pub progress: bool,
}

pub(crate) fn best_url_from_srcset(srcset: &str) -> Option<String> {
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

pub(crate) fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{}=\"", attr);
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

pub async fn scrape_pinterest_html(
    url: String,
    max_pins: Option<usize>,
) -> Result<ScrapeResult, String> {
    let parsed = Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if host != "www.pinterest.com" && host != "pinterest.com" {
        return Ok(ScrapeResult {
            pins: Vec::new(),
            html: String::new(),
        });
    }

    let max = max_pins.unwrap_or(30).clamp(1, 200);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Pinterest HTML: {e}"))?;

    let html: String = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Pinterest HTML: {e}"))?;

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
        out.push(ScrapedPin {
            pin_href,
            image_url,
        });
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
                    let decoded = json_blob.replace("\\u002F", "/").replace("\\/", "/");

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

                        let pin_href = format!("https://www.pinterest.com/pin/{}/", digits);

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
