# Copyright 2023-2026 Lightpanda (Selecy SAS)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Campfire-commerce scraping / test using Python Playwright over CDP.
#
# Mirrors the behavior of chromiumoxide/cdp and playwright/cdp.js:
# - Connects to an existing browser via CDP WebSocket endpoint.
# - Navigates to the campfire-commerce product page.
# - Waits for the dynamically-loaded price and reviews sections.
# - Extracts product data (name, price, description, image, related, reviews).
# - Asserts the extracted values against known-good expectations.
#
# Environment variables:
#   BROWSER_ADDRESS  WebSocket URL of the browser CDP endpoint (default: ws://127.0.0.1:9222)
#   BASE_URL         Base URL of the demo web server            (default: http://127.0.0.1:1234)
#   RUNS             Number of iterations to run                (default: 100)

import os
import sys
import time

from playwright.sync_api import sync_playwright

BROWSER_WS_DEFAULT = "ws://127.0.0.1:9222"
BASE_URL_DEFAULT = "http://127.0.0.1:1234"

browser_address = os.environ.get("BROWSER_ADDRESS", BROWSER_WS_DEFAULT)
base_url = os.environ.get("BASE_URL", BASE_URL_DEFAULT)
runs = int(os.environ.get("RUNS", "100"))

with sync_playwright() as p:
    # Connect to an existing browser CDP endpoint.
    print(f"Connection to browser on {browser_address}")
    browser = p.chromium.connect_over_cdp(browser_address)

    gstart = time.perf_counter_ns()
    metrics = []

    for run in range(runs):
        rstart = time.perf_counter_ns()

        context = browser.new_context(base_url=base_url)
        page = context.new_page()
        page.goto("/campfire-commerce/")

        # Wait for the price element to be populated (XHR/fetch loaded).
        page.wait_for_function(
            """() => {
                const price = document.querySelector('#product-price');
                return price && price.textContent.length > 0;
            }""",
            timeout=100,
        )

        # Wait for the reviews section to be populated.
        page.wait_for_function(
            """() => {
                const reviews = document.querySelectorAll('#product-reviews > div');
                return reviews.length > 0;
            }""",
            timeout=100,
        )

        # Extract product data.
        res = {}
        res["name"] = page.locator("#product-name").text_content()
        price_text = page.locator("#product-price").text_content()
        res["price"] = float(price_text.lstrip("$"))
        res["description"] = page.locator("#product-description").text_content()
        res["features"] = page.locator("#product-features > li").all_text_contents()
        res["image"] = page.locator("#product-image").get_attribute("src")

        related = []
        for row in page.locator("#product-related > div").all():
            related.append({
                "name": row.locator("h4").text_content(),
                "price": float(row.locator("p").text_content().lstrip("$")),
                "image": row.locator("img").get_attribute("src"),
            })
        res["related"] = related

        reviews = []
        for row in page.locator("#product-reviews > div").all():
            reviews.append({
                "title": row.locator("h4").text_content(),
                "text": row.locator("p").text_content(),
            })
        res["reviews"] = reviews

        # Assertions.
        if res["price"] != 244.99:
            print(res)
            raise AssertionError("invalid product price")
        if res["image"] != "images/nomad_000.jpg":
            print(res)
            raise AssertionError("invalid product image")
        if len(res["related"]) != 3:
            print(res)
            raise AssertionError("invalid products related length")
        if len(res["reviews"]) != 3:
            print(res)
            raise AssertionError("invalid reviews length")

        sys.stderr.write(".")
        if run > 0 and run % 80 == 0:
            sys.stderr.write("\n")

        page.close()
        context.close()

        metrics.append(time.perf_counter_ns() - rstart)

    browser.close()

    gduration = time.perf_counter_ns() - gstart

    sys.stderr.write("\n")

    avg = sum(metrics) // len(metrics)
    mn = min(metrics)
    mx = max(metrics)

    print(f"total runs {runs}")
    print(f"total duration (ms) {gduration // 1_000_000}")
    print(f"avg run duration (ms) {avg // 1_000_000}")
    print(f"min run duration (ms) {mn // 1_000_000}")
    print(f"max run duration (ms) {mx // 1_000_000}")
