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
        
        # -> Navigate to the login page (open the login /auth/login page).
        await page.goto("http://localhost:3000/auth/login")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Lanjutkan Cerita' button on the hero card titled 'Warisan yang Terkubur' to open the story entry.
        # CERITA BERJALAN — BAB 2 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Scroll the chapter content down to reveal branching choice buttons (look for choices such as 'Melangkah maju' or 'Menahan diri').
        await page.mouse.wheel(0, 300)
        
        # --> Assertions to verify final state
        
        # --> Verify the chapter reader is displayed
        await page.locator("xpath=/html/body/main/header/a").nth(0).scroll_into_view_if_needed()
        # Assert: The reader header back link is visible, confirming the chapter reader is displayed.
        await expect(page.locator("xpath=/html/body/main/header/a").nth(0)).to_be_visible(timeout=15000), "The reader header back link is visible, confirming the chapter reader is displayed."
        
        # --> Verify a chapter and branching choices are available
        # Assert: The reader header links to the story detail at /cerita/warisan-terkubur.
        await expect(page.locator("xpath=/html/body/main/header/a").nth(0)).to_have_attribute("href", "/cerita/warisan-terkubur", timeout=15000), "The reader header links to the story detail at /cerita/warisan-terkubur."
        await page.locator("xpath=/html/body/main/article/section/div[2]/button[1]").nth(0).scroll_into_view_if_needed()
        # Assert: Branching choice "Melangkah maju menghadapi keadaan" is visible.
        await expect(page.locator("xpath=/html/body/main/article/section/div[2]/button[1]").nth(0)).to_be_visible(timeout=15000), "Branching choice \"Melangkah maju menghadapi keadaan\" is visible."
        await page.locator("xpath=/html/body/main/article/section/div[2]/button[2]").nth(0).scroll_into_view_if_needed()
        # Assert: Branching choice "Menahan diri dan mengamati" is visible.
        await expect(page.locator("xpath=/html/body/main/article/section/div[2]/button[2]").nth(0)).to_be_visible(timeout=15000), "Branching choice \"Menahan diri dan mengamati\" is visible."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    