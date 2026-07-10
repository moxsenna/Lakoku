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
        
        # -> Scroll the landing page to reveal the onboarding controls (so the 'Masuk ke Cerita Pertamaku' or 'Mulai' control can be clicked).
        await page.mouse.wheel(0, 300)
        
        # -> Click the 'Masuk ke Cerita Pertamaku' button to start the story onboarding flow.
        # Masuk ke Cerita Pertamaku link
        elem = page.get_by_role('link', name='Masuk ke Cerita Pertamaku', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Aku punya ide sendiri' button to begin creating a story from a custom idea and verify the UI navigates to the custom-idea entry step.
        # Aku punya ide sendiri Tulis benih ceritamu, lalu... button
        elem = page.get_by_role('button', name='Aku punya ide sendiri Tulis benih ceritamu, lalu Lakoku mengubahnya menjadi 3 premis.', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the story onboarding entry screen is displayed
        # Assert: The story input textarea shows the expected placeholder prompt.
        await expect(page.locator("xpath=/html/body/main/section/textarea").nth(0)).to_have_attribute("placeholder", "Contoh: seorang pewaris menemukan surat lama yang membongkar rahasia keluarganya...", timeout=15000), "The story input textarea shows the expected placeholder prompt."
        # Assert: The primary action button is labeled 'Siapkan 3 cerita' on the entry screen.
        await expect(page.locator("xpath=/html/body/main/section/button").nth(0)).to_have_text("Siapkan 3 cerita", timeout=15000), "The primary action button is labeled 'Siapkan 3 cerita' on the entry screen."
        # Assert: The back button with the aria-label 'Kembali ke langkah sebelumnya' is present on the entry screen.
        await expect(page.locator("xpath=/html/body/main/header/button").nth(0)).to_have_attribute("aria-label", "Kembali ke langkah sebelumnya", timeout=15000), "The back button with the aria-label 'Kembali ke langkah sebelumnya' is present on the entry screen."
        
        # --> Verify the user can choose a story creation mode
        # Assert: The custom-idea textarea shows the expected placeholder, confirming the custom-idea creation entry screen is displayed.
        await expect(page.locator("xpath=/html/body/main/section/textarea").nth(0)).to_have_attribute("placeholder", "Contoh: seorang pewaris menemukan surat lama yang membongkar rahasia keluarganya...", timeout=15000), "The custom-idea textarea shows the expected placeholder, confirming the custom-idea creation entry screen is displayed."
        await page.locator("xpath=/html/body/main/section/button").nth(0).scroll_into_view_if_needed()
        # Assert: The 'Siapkan 3 cerita' button is visible, indicating the custom-idea creation mode is active.
        await expect(page.locator("xpath=/html/body/main/section/button").nth(0)).to_be_visible(timeout=15000), "The 'Siapkan 3 cerita' button is visible, indicating the custom-idea creation mode is active."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    