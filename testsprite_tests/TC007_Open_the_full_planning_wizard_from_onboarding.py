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
        
        # -> Open the onboarding page by navigating to the 'Mulai' onboarding page (navigate to /mulai) and inspect the entry screen.
        await page.goto("http://localhost:3000/mulai")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Mode lengkap' option on the onboarding entry screen to enter the full planning flow.
        # Mode lengkap Rancang premis, tokoh, misteri, dan... link
        elem = page.get_by_role('link', name='Mode lengkap Rancang premis, tokoh, misteri, dan dunia satu per satu.', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the full planning wizard is displayed
        await page.locator("xpath=/html/body/main/section/textarea").nth(0).scroll_into_view_if_needed()
        # Assert: The idea input textarea is visible, showing the planning wizard's input step.
        await expect(page.locator("xpath=/html/body/main/section/textarea").nth(0)).to_be_visible(timeout=15000), "The idea input textarea is visible, showing the planning wizard's input step."
        await page.locator("xpath=/html/body/main/section/button").nth(0).scroll_into_view_if_needed()
        # Assert: The primary action button 'Usulkan 3 premis' is visible on the planning wizard.
        await expect(page.locator("xpath=/html/body/main/section/button").nth(0)).to_be_visible(timeout=15000), "The primary action button 'Usulkan 3 premis' is visible on the planning wizard."
        await page.locator("xpath=/html/body/main/header/a").nth(0).scroll_into_view_if_needed()
        # Assert: The back control 'Kembali ke Beranda' is visible, indicating the wizard navigation is present.
        await expect(page.locator("xpath=/html/body/main/header/a").nth(0)).to_be_visible(timeout=15000), "The back control 'Kembali ke Beranda' is visible, indicating the wizard navigation is present."
        
        # --> Verify the user is on the story planning flow
        # Assert: Seed idea textarea is present with the expected placeholder.
        await expect(page.locator("xpath=/html/body/main/section/textarea").nth(0)).to_have_attribute("placeholder", "mis. seorang istri menemukan warisan tersembunyi yang mengubah segalanya\u2026", timeout=15000), "Seed idea textarea is present with the expected placeholder."
        # Assert: Primary action button 'Usulkan 3 premis' is visible.
        await expect(page.locator("xpath=/html/body/main/section/button").nth(0)).to_have_text("Usulkan 3 premis", timeout=15000), "Primary action button 'Usulkan 3 premis' is visible."
        # Assert: Back control labeled 'Kembali ke Beranda' is available.
        await expect(page.locator("xpath=/html/body/main/header/a").nth(0)).to_have_attribute("aria-label", "Kembali ke Beranda", timeout=15000), "Back control labeled 'Kembali ke Beranda' is available."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    