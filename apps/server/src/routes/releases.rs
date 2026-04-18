use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::State,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{errors::AppError, AppState, LatestReleaseCacheEntry};

const GITHUB_RELEASES_LATEST_URL: &str =
    "https://api.github.com/repos/emircanagac/voxpery/releases/latest";
const RELEASES_CACHE_TTL_SECS: u64 = 900;

#[derive(Clone, Debug, Serialize)]
pub struct LatestReleaseResponse {
    pub tag: Option<String>,
    pub html_url: String,
    pub published_at: Option<String>,
    pub downloads: LatestReleaseDownloads,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct LatestReleaseDownloads {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windows: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub macos: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linux: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseResponse {
    tag_name: Option<String>,
    html_url: Option<String>,
    published_at: Option<String>,
    assets: Option<Vec<GithubReleaseAsset>>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

pub fn router(_state: Arc<AppState>) -> Router<Arc<AppState>> {
    Router::new().route("/latest", get(latest_release))
}

async fn latest_release(
    State(state): State<Arc<AppState>>,
) -> Result<Json<LatestReleaseResponse>, AppError> {
    if let Some(cached) = get_fresh_release_cache(&state).await {
        return Ok(Json(cached));
    }

    match fetch_latest_release(&state).await {
        Ok(response) => {
            let mut cache = state.latest_release_cache.write().await;
            *cache = Some(LatestReleaseCacheEntry {
                response: response.clone(),
                fetched_at: Instant::now(),
            });
            Ok(Json(response))
        }
        Err(error) => {
            if let Some(cached) = get_cached_release(&state).await {
                tracing::warn!(
                    "Serving stale release metadata after GitHub fetch failed: {}",
                    error
                );
                return Ok(Json(cached));
            }
            Err(error)
        }
    }
}

async fn get_fresh_release_cache(state: &AppState) -> Option<LatestReleaseResponse> {
    let cache = state.latest_release_cache.read().await;
    let cached = cache.as_ref()?;
    if cached.fetched_at.elapsed() < Duration::from_secs(RELEASES_CACHE_TTL_SECS) {
        return Some(cached.response.clone());
    }
    None
}

async fn get_cached_release(state: &AppState) -> Option<LatestReleaseResponse> {
    let cache = state.latest_release_cache.read().await;
    cache.as_ref().map(|cached| cached.response.clone())
}

async fn fetch_latest_release(state: &AppState) -> Result<LatestReleaseResponse, AppError> {
    let response = state
        .release_http_client
        .get(GITHUB_RELEASES_LATEST_URL)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch GitHub release metadata: {e}")))?;

    let response = response
        .error_for_status()
        .map_err(|e| AppError::Internal(format!("GitHub release metadata request failed: {e}")))?;

    let release = response
        .json::<GithubReleaseResponse>()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse GitHub release metadata: {e}")))?;

    let assets = release.assets.unwrap_or_default();

    Ok(LatestReleaseResponse {
        tag: release.tag_name,
        html_url: release
            .html_url
            .unwrap_or_else(|| "https://github.com/emircanagac/voxpery/releases/latest".to_string()),
        published_at: release.published_at,
        downloads: LatestReleaseDownloads {
            windows: pick_windows_installer(&assets),
            macos: pick_macos_installer(&assets),
            linux: pick_linux_installer(&assets),
        },
    })
}

fn installable_assets<'a>(assets: &'a [GithubReleaseAsset]) -> impl Iterator<Item = &'a GithubReleaseAsset> {
    assets.iter().filter(|asset| {
        let name = asset.name.to_ascii_lowercase();
        !name.ends_with(".sig")
            && !name.ends_with(".sha256")
            && !name.ends_with(".json")
            && !name.ends_with(".txt")
    })
}

fn pick_windows_installer(assets: &[GithubReleaseAsset]) -> Option<String> {
    installable_assets(assets)
        .find(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
        .or_else(|| {
            installable_assets(assets)
                .find(|asset| asset.name.to_ascii_lowercase().ends_with(".msi"))
        })
        .map(|asset| asset.browser_download_url.clone())
}

fn pick_macos_installer(assets: &[GithubReleaseAsset]) -> Option<String> {
    installable_assets(assets)
        .find(|asset| asset.name.to_ascii_lowercase().ends_with(".dmg"))
        .or_else(|| {
            installable_assets(assets)
                .find(|asset| asset.name.to_ascii_lowercase().contains(".app.tar.gz"))
        })
        .map(|asset| asset.browser_download_url.clone())
}

fn pick_linux_installer(assets: &[GithubReleaseAsset]) -> Option<String> {
    installable_assets(assets)
        .find(|asset| asset.name.to_ascii_lowercase().ends_with(".appimage"))
        .or_else(|| {
            installable_assets(assets)
                .find(|asset| asset.name.to_ascii_lowercase().ends_with(".deb"))
        })
        .or_else(|| {
            installable_assets(assets)
                .find(|asset| asset.name.to_ascii_lowercase().ends_with(".rpm"))
        })
        .map(|asset| asset.browser_download_url.clone())
}

#[cfg(test)]
mod tests {
    use super::{pick_linux_installer, pick_macos_installer, pick_windows_installer, GithubReleaseAsset};

    fn asset(name: &str, url: &str) -> GithubReleaseAsset {
        GithubReleaseAsset {
            name: name.to_string(),
            browser_download_url: url.to_string(),
        }
    }

    #[test]
    fn picks_expected_platform_installers() {
        let assets = vec![
            asset("Voxpery_0.1.5_x64-setup.exe", "https://example.com/app.exe"),
            asset("Voxpery_0.1.5_x64.dmg", "https://example.com/app.dmg"),
            asset("Voxpery_0.1.5_amd64.deb", "https://example.com/app.deb"),
        ];

        assert_eq!(
            pick_windows_installer(&assets).as_deref(),
            Some("https://example.com/app.exe")
        );
        assert_eq!(
            pick_macos_installer(&assets).as_deref(),
            Some("https://example.com/app.dmg")
        );
        assert_eq!(
            pick_linux_installer(&assets).as_deref(),
            Some("https://example.com/app.deb")
        );
    }

    #[test]
    fn ignores_signature_and_metadata_assets() {
        let assets = vec![
            asset("latest.json", "https://example.com/latest.json"),
            asset("Voxpery_0.1.5_x64-setup.exe.sig", "https://example.com/app.exe.sig"),
            asset("Voxpery_0.1.5_x64-setup.exe", "https://example.com/app.exe"),
        ];

        assert_eq!(
            pick_windows_installer(&assets).as_deref(),
            Some("https://example.com/app.exe")
        );
    }
}
