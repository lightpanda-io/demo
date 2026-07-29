import trio
import sys
import logging
from selenium import webdriver
from selenium.webdriver.common.by import By

logger = logging.getLogger('selenium')
logger.setLevel(logging.DEBUG)

handler = logging.StreamHandler(sys.stderr)
logger.addHandler(handler)

logging.getLogger('selenium.webdriver.remote').setLevel(logging.WARN)
logging.getLogger('selenium.webdriver.common').setLevel(logging.DEBUG)

async def run(driver):
    async with driver.bidi_connection() as session:
        await trio.to_thread.run_sync(lambda: driver.get('https://blg.tch.re'))

        links = driver.find_elements(By.TAG_NAME, 'a')

        for a in links:
            print(a.get_attribute("href"))

options = webdriver.ChromeOptions()
options.page_load_strategy = 'normal'
options.enable_bidi = True
options.add_experimental_option("debuggerAddress", "127.0.0.1:9222")

driver = webdriver.Chrome(options)

trio.run(run, driver)
