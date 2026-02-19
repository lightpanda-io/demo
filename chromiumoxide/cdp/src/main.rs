// Copyright 2023-2026 Lightpanda (Selecy SAS)
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//! Campfire-commerce scraping / test using chromiumoxide.
//!
//! Mirrors the behavior of puppeteer/cdp.js:
//! - Navigates to the campfire-commerce product page.
//! - Waits for the dynamically-loaded price and reviews sections.
//! - Extracts product data (name, price, description, image, related, reviews).
//! - Asserts the extracted values against known-good expectations.
//!
//! Environment variables:
//!   BROWSER_ADDRESS  WebSocket URL of the browser CDP endpoint (default: ws://127.0.0.1:9222)
//!   BASE_URL         Base URL of the demo web server            (default: http://127.0.0.1:1234)
//!   RUNS             Number of iterations to run                (default: 100)

use std::time::{Duration, Instant};

use anyhow::{bail, Context};
use chromiumoxide::Browser;
use futures::StreamExt;
use serde::Deserialize;

const BROWSER_WS_DEFAULT: &str = "ws://127.0.0.1:9222";
const BASE_URL_DEFAULT: &str = "http://127.0.0.1:1234";

// Maximum time to wait for dynamic content to appear in the DOM.
const WAIT_TIMEOUT_MS: u64 = 5_000;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RelatedProduct {
    name: String,
    price: f64,
    image: String,
}

#[derive(Debug, Deserialize)]
struct Review {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    text: String,
}

#[derive(Debug)]
struct Product {
    #[allow(dead_code)]
    name: String,
    price: f64,
    #[allow(dead_code)]
    description: String,
    image: String,
    related: Vec<RelatedProduct>,
    reviews: Vec<Review>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let browser_ws =
        std::env::var("BROWSER_ADDRESS").unwrap_or_else(|_| BROWSER_WS_DEFAULT.to_string());
    let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| BASE_URL_DEFAULT.to_string());
    let runs: usize = std::env::var("RUNS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);

    // Connect to an existing browser CDP endpoint.
    let (browser, mut handler) = Browser::connect(&browser_ws)
        .await
        .with_context(|| format!("connect to browser at {}", browser_ws))?;

    // The Handler drives the browser's internal event loop and must be polled
    // continuously for CDP messages to be processed.
    tokio::spawn(async move {
        loop {
            if handler.next().await.is_none() {
                break;
            }
        }
    });

    let url = format!("{}/campfire-commerce/", base_url);

    let gstart = Instant::now();
    let mut metrics: Vec<u128> = Vec::with_capacity(runs);

    for run in 0..runs {
        let rstart = Instant::now();

        // Navigate directly to the product page.
        // chromiumoxide will wait for the page's load lifecycle event.
        let page = browser
            .new_page(&url)
            .await
            .with_context(|| format!("navigate to {}", url))?;

        // Wait for the price element to be populated.
        // The page uses XHR/fetch to load product data asynchronously.
        wait_for_nonempty(&page, "#product-price", WAIT_TIMEOUT_MS).await?;

        // Wait for the reviews section to be populated.
        wait_for_count(&page, "#product-reviews > div", 1, WAIT_TIMEOUT_MS).await?;

        // Extract all product data in a single evaluate call.
        let product = extract_product(&page).await?;

        // ---- assertions ----
        if (product.price - 244.99).abs() > f64::EPSILON {
            bail!("invalid product price: {:?}", product);
        }
        if product.image != "images/nomad_000.jpg" {
            bail!("invalid product image: {:?}", product);
        }
        if product.related.len() != 3 {
            bail!("invalid related products count: {:?}", product);
        }
        if product.reviews.len() != 3 {
            bail!("invalid reviews count: {:?}", product);
        }

        eprint!(".");
        if run > 0 && run % 80 == 0 {
            eprintln!();
        }

        let _ = page.close().await;

        metrics.push(rstart.elapsed().as_millis());
    }

    eprintln!();

    let total_ms = gstart.elapsed().as_millis();
    println!("total runs {}", runs);
    println!("total duration (ms) {}", total_ms);
    if !metrics.is_empty() {
        let avg = metrics.iter().sum::<u128>() / metrics.len() as u128;
        let min = metrics.iter().copied().min().unwrap();
        let max = metrics.iter().copied().max().unwrap();
        println!("avg run duration (ms) {}", avg);
        println!("min run duration (ms) {}", min);
        println!("max run duration (ms) {}", max);
    }

    Ok(())
}

/// Polls until the text content of `selector` is non-empty, or until timeout.
async fn wait_for_nonempty(
    page: &chromiumoxide::Page,
    selector: &str,
    timeout_ms: u64,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    // escape single quotes inside selector for inline JS
    let js = format!(
        "(() => {{ const el = document.querySelector('{selector}'); return el && el.textContent.length > 0; }})()"
    );
    loop {
        let ready = page
            .evaluate(js.as_str())
            .await?
            .into_value::<bool>()
            .unwrap_or(false);
        if ready {
            return Ok(());
        }
        if Instant::now() >= deadline {
            bail!("timeout waiting for '{}' to be non-empty", selector);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Polls until `selector` matches at least `min_count` elements, or until timeout.
async fn wait_for_count(
    page: &chromiumoxide::Page,
    selector: &str,
    min_count: usize,
    timeout_ms: u64,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let js = format!("document.querySelectorAll('{selector}').length");
    loop {
        let count = page
            .evaluate(js.as_str())
            .await?
            .into_value::<u64>()
            .unwrap_or(0);
        if count >= min_count as u64 {
            return Ok(());
        }
        if Instant::now() >= deadline {
            bail!(
                "timeout: expected at least {} elements for '{}', got {}",
                min_count,
                selector,
                count
            );
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

/// Extracts product data from the page using a single JavaScript evaluation.
async fn extract_product(page: &chromiumoxide::Page) -> anyhow::Result<Product> {
    let name: String = page
        .evaluate("document.querySelector('#product-name').textContent")
        .await?
        .into_value()?;

    let price_text: String = page
        .evaluate("document.querySelector('#product-price').textContent")
        .await?
        .into_value()?;
    let price: f64 = price_text
        .trim_start_matches('$')
        .parse()
        .with_context(|| format!("parse price from '{}'", price_text))?;

    let description: String = page
        .evaluate("document.querySelector('#product-description').textContent")
        .await?
        .into_value()?;

    let image: String = page
        .evaluate("document.querySelector('#product-image').getAttribute('src')")
        .await?
        .into_value()?;

    let related: Vec<RelatedProduct> = page
        .evaluate(
            r#"Array.from(document.querySelectorAll('#product-related > div')).map(row => ({
                name:  row.querySelector('h4').textContent,
                price: parseFloat(row.querySelector('p').textContent.substring(1)),
                image: row.querySelector('img').getAttribute('src'),
            }))"#,
        )
        .await?
        .into_value()?;

    let reviews: Vec<Review> = page
        .evaluate(
            r#"Array.from(document.querySelectorAll('#product-reviews > div')).map(row => ({
                name: row.querySelector('h4').textContent,
                text: row.querySelector('p').textContent,
            }))"#,
        )
        .await?
        .into_value()?;

    Ok(Product {
        name,
        price,
        description,
        image,
        related,
        reviews,
    })
}
