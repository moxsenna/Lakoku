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
        
        # -> Click the 'Masuk ke Cerita Pertamaku' link to start the login or account flow.
        # Masuk ke Cerita Pertamaku link
        elem = page.get_by_role('link', name='Masuk ke Cerita Pertamaku', exact=True)
        await elem.click(timeout=10000)
        
        # -> Open the login page (Masuk) by navigating to /auth/login so the email and password fields are visible.
        await page.goto("http://localhost:3000/auth/login")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the email and password fields and click the 'Masuk' button to submit the login form.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the email and password fields and click the 'Masuk' button to submit the login form.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the email and password fields and click the 'Masuk' button to submit the login form.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjutkan Cerita' button on the 'Warisan yang Terkubur' hero card to open the story and resume reading.
        # CERITA BERJALAN — BAB 2 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Scroll to the end of the chapter to reveal the branching choice buttons (for example, 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # -> Click the 'Melangkah maju menghadapi keadaan' choice button to select that branch and advance the story.
        # Melangkah maju menghadapi keadaan button
        elem = page.get_by_role('button', name='Melangkah maju menghadapi keadaan', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjut ke Bab 3' button to open Chapter 3 and continue the reading flow.
        # Lanjut ke Bab 3 link
        elem = page.get_by_role('link', name='Lanjut ke Bab 3', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the next chapter is displayed
        # Assert: Next chapter (Bab 3) is displayed, confirmed by the URL containing '/baca/warisan-terkubur?bab=3'.
        await expect(page).to_have_url(re.compile("/baca/warisan\\-terkubur\\?bab=3"), timeout=15000), "Next chapter (Bab 3) is displayed, confirmed by the URL containing '/baca/warisan-terkubur?bab=3'."
        
        # --> Verify the chosen path is reflected in the reading flow
        # Assert: The URL contains 'bab=3', confirming the chosen path advanced the reader to chapter 3.
        await expect(page).to_have_url(re.compile("bab=3"), timeout=15000), "The URL contains 'bab=3', confirming the chosen path advanced the reader to chapter 3."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    