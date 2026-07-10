import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        await page.goto("http://localhost:3000")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Masuk ke Cerita Pertamaku' link to enter the main home area.
        # Masuk ke Cerita Pertamaku link
        elem = page.get_by_role('link', name='Masuk ke Cerita Pertamaku', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Mode lengkap' option to enter the main home area.
        # Mode lengkap Rancang premis, tokoh, misteri, dan... link
        elem = page.get_by_role('link', name='Mode lengkap Rancang premis, tokoh, misteri, dan dunia satu per satu.', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Kembali ke Beranda' link to return to the home shell and check for the library area.
        # Kembali ke Beranda link
        elem = page.get_by_role('link', name='Kembali ke Beranda', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the home shell is displayed
        await page.locator("xpath=/html/body/div[2]/nav/ul/li[1]/a").nth(0).scroll_into_view_if_needed()
        # Assert: The home navigation link 'Beranda' is visible.
        await expect(page.locator("xpath=/html/body/div[2]/nav/ul/li[1]/a").nth(0)).to_be_visible(timeout=15000), "The home navigation link 'Beranda' is visible."
        await page.locator("xpath=/html/body/div[2]/div/main/section[2]/a").nth(0).scroll_into_view_if_needed()
        # Assert: The hero call-to-action 'Mulai Cerita Baru' is visible.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[2]/a").nth(0)).to_be_visible(timeout=15000), "The hero call-to-action 'Mulai Cerita Baru' is visible."
        
        # --> Verify the library area is available
        await page.locator("xpath=/html/body/div[2]/div/main/section[1]/div[1]/a").nth(0).scroll_into_view_if_needed()
        # Assert: The 'Lihat Koleksiku' library link is visible on the home page.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[1]/div[1]/a").nth(0)).to_be_visible(timeout=15000), "The 'Lihat Koleksiku' library link is visible on the home page."
        await page.locator("xpath=/html/body/div[2]/nav/ul/li[2]/a").nth(0).scroll_into_view_if_needed()
        # Assert: The 'Koleksiku' navigation item is visible in the bottom navigation.
        await expect(page.locator("xpath=/html/body/div[2]/nav/ul/li[2]/a").nth(0)).to_be_visible(timeout=15000), "The 'Koleksiku' navigation item is visible in the bottom navigation."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    