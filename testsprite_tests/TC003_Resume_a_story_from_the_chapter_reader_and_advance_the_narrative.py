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
        
        # -> Open the Login page ('Masuk') and fill the email field with the test account email.
        await page.goto("http://localhost:3000/auth/login")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the EMAIL field with moxsenna@gmail.com, fill the KATA SANDI field with metalizer77, then click the 'Masuk' button.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the EMAIL field with moxsenna@gmail.com, fill the KATA SANDI field with metalizer77, then click the 'Masuk' button.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the EMAIL field with moxsenna@gmail.com, fill the KATA SANDI field with metalizer77, then click the 'Masuk' button.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjutkan Cerita' button on the 'Warisan yang Terkubur' hero card to open the story.
        # CERITA BERJALAN — BAB 1 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Scroll to the end of the chapter to reveal the branching choices (look for options like 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # -> Click the 'Melangkah maju menghadapi keadaan' choice to advance the story.
        # Melangkah maju menghadapi keadaan button
        elem = page.get_by_role('button', name='Melangkah maju menghadapi keadaan', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjut ke Bab 2' button to advance to Chapter 2 and verify the reader displays Bab 2.
        # Lanjut ke Bab 2 link
        elem = page.get_by_role('link', name='Lanjut ke Bab 2', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the next chapter is displayed
        # Assert: The URL contains 'bab=2', confirming the reader is viewing the next chapter (Bab 2).
        await expect(page).to_have_url(re.compile("bab=2"), timeout=15000), "The URL contains 'bab=2', confirming the reader is viewing the next chapter (Bab 2)."
        
        # --> Verify the story continues after the choice is accepted
        # Assert: The story advanced to the next chapter as indicated by the URL containing 'bab=2'.
        await expect(page).to_have_url(re.compile("bab=2"), timeout=15000), "The story advanced to the next chapter as indicated by the URL containing 'bab=2'."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    