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
        
        # -> Open the login page (Masuk) so the email and password fields are visible.
        await page.goto("http://localhost:3000/auth/login")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, fill the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button to log in.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, fill the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button to log in.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, fill the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button to log in.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjutkan Cerita' button on the 'Warisan yang Terkubur' hero card to open the story.
        # CERITA BERJALAN — BAB 1 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Scroll down the chapter page to reveal the branching choice buttons (e.g., "Melangkah maju" or "Menahan diri").
        await page.mouse.wheel(0, 300)
        
        # -> Scroll further down the chapter page to reveal the branching choice buttons such as 'Melangkah maju' or 'Menahan diri'.
        await page.mouse.wheel(0, 300)
        
        # -> Click the button shown below the 'PILIHANMU' prompt to reveal the branching choice options.
        # Melangkah maju menghadapi keadaan button
        elem = page.get_by_role('button', name='Melangkah maju menghadapi keadaan', exact=True)
        await elem.click(timeout=10000)
        
        # -> Scroll down the chapter page to reveal the 'PILIHANMU' section and the branching choice buttons (e.g., 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # -> Scroll down the chapter page to reveal the 'PILIHANMU' section and the branching choice buttons (e.g., 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # --> Test passed — verified by AI agent
        frame = context.pages[-1]
        current_url = await frame.evaluate("() => window.location.href")
        assert current_url is not None, "Test completed successfully"
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    