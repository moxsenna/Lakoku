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
        
        # -> Open the 'Beranda' page (navigate to the Beranda/home experience).
        await page.goto("http://localhost:3000/beranda")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the hero card 'Warisan yang Terkubur' (the 'Lanjutkan Cerita' link) to open the story detail page.
        # CERITA BERJALAN — BAB 1 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Fill the EMAIL and KATA SANDI fields with the provided credentials and click the 'Masuk' button to sign in.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the EMAIL and KATA SANDI fields with the provided credentials and click the 'Masuk' button to sign in.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the EMAIL and KATA SANDI fields with the provided credentials and click the 'Masuk' button to sign in.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the back arrow labeled 'Kembali ke beranda' to return to the Beranda (home) experience.
        # Kembali ke beranda link
        elem = page.get_by_role('link', name='Kembali ke beranda', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjutkan Cerita' hero card titled 'Warisan yang Terkubur' to open the story detail page.
        # CERITA BERJALAN — BAB 2 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Click the top back arrow (the 'Kembali' control) to return to the Beranda home experience and verify the story feed is visible.
        # Kembali ke detail cerita link
        elem = page.get_by_role('link', name='Kembali ke detail cerita', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Kembali ke Beranda' back arrow to return to the Beranda home and verify the story feed is displayed.
        # Kembali ke Beranda link
        elem = page.get_by_role('link', name='Kembali ke Beranda', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the home experience is displayed
        # Assert: The browser is on the Beranda page (URL contains /beranda).
        await expect(page).to_have_url(re.compile("/beranda"), timeout=15000), "The browser is on the Beranda page (URL contains /beranda)."
        await page.locator("xpath=/html/body/div[2]/div/main/section[1]/a").nth(0).scroll_into_view_if_needed()
        # Assert: The Beranda hero story 'Warisan yang Terkubur' is visible.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[1]/a").nth(0)).to_be_visible(timeout=15000), "The Beranda hero story 'Warisan yang Terkubur' is visible."
        
        # --> Verify the story feed remains available
        # Assert: The hero story 'Warisan yang Terkubur' is visible on Beranda.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[1]/a").nth(0)).to_contain_text("Warisan yang Terkubur", timeout=15000), "The hero story 'Warisan yang Terkubur' is visible on Beranda."
        # Assert: A story feed item ('Jejak Bayang Warisan') is visible in the feed.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[2]/div[2]/a[1]").nth(0)).to_contain_text("Jejak Bayang Warisan", timeout=15000), "A story feed item ('Jejak Bayang Warisan') is visible in the feed."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    