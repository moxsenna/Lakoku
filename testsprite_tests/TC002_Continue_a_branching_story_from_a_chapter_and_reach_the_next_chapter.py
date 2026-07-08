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
        
        # -> Navigate to the login page (/auth/login).
        await page.goto("http://localhost:3000/auth/login")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill 'metalizer77' into the KATA SANDI (password) field and click the 'Masuk' button to submit the login form.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill 'metalizer77' into the KATA SANDI (password) field and click the 'Masuk' button to submit the login form.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjutkan Cerita' button on the 'Warisan yang Terkubur' hero card to open the story detail/reader.
        # CERITA BERJALAN — BAB 1 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Scroll down the reader page to reveal the branching choice buttons (look for 'Melangkah maju' or 'Menahan diri') and then click one if visible.
        await page.mouse.wheel(0, 300)
        
        # -> Scroll further down the chapter to reveal the branching choice buttons (e.g., 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # -> Scroll down the chapter to reveal branching choices (buttons like 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # -> Click the 'Melangkah maju menghadapi keadaan' branching choice to advance to the next chapter, then verify the reader advanced and branching choices are present on the new chapter.
        # Melangkah maju menghadapi keadaan button
        elem = page.get_by_role('button', name='Melangkah maju menghadapi keadaan', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjut ke Bab 3' button to advance the reader to Bab 3.
        # Lanjut ke Bab 3 link
        elem = page.get_by_role('link', name='Lanjut ke Bab 3', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the next chapter is displayed
        # Assert: The reader advanced to the next chapter (URL contains 'bab=3').
        await expect(page).to_have_url(re.compile("bab=3"), timeout=15000), "The reader advanced to the next chapter (URL contains 'bab=3')."
        current_url = await page.evaluate("() => window.location.href")
        # Assert: page loaded with a URL (final outcome verified by the AI judge during the run)
        assert current_url, 'Page should have loaded with a URL'
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    