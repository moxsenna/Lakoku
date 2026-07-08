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
        
        # -> Open the site's login page (the 'Masuk' authentication page).
        await page.goto("http://localhost:3000/auth/login")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, fill the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, fill the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the 'EMAIL' field with moxsenna@gmail.com, fill the 'KATA SANDI' field with metalizer77, then click the 'Masuk' button.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Profil' link to open the profile page and view profile settings.
        # Profil link
        elem = page.get_by_role('link', name='Profil', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Ganti ke tema terang' button to switch to the light theme.
        # Ganti ke tema terang button
        elem = page.get_by_role('button', name='Ganti ke tema terang', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Ganti ke tema gelap' button to toggle the profile theme back to dark and verify the UI updates.
        # Ganti ke tema gelap button
        elem = page.get_by_role('button', name='Ganti ke tema gelap', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify reading stats are displayed
        # Assert: Cerita Berjalan stat is visible and shows 6.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[1]/div[1]/span[1]").nth(0)).to_have_text("6", timeout=15000), "Cerita Berjalan stat is visible and shows 6."
        # Assert: Akhir Dicapai stat is visible and shows 0.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[1]/div[2]/span[1]").nth(0)).to_have_text("0", timeout=15000), "Akhir Dicapai stat is visible and shows 0."
        # Assert: Pilihan Penting stat is visible and shows 0.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/section[1]/div[3]/span[1]").nth(0)).to_have_text("0", timeout=15000), "Pilihan Penting stat is visible and shows 0."
        
        # --> Verify the theme setting changes successfully
        # Assert: The theme toggle button's aria-label is 'Ganti ke tema terang', indicating the theme changed to dark.
        await expect(page.locator("xpath=/html/body/div[2]/div/main/header/button").nth(0)).to_have_attribute("aria-label", "Ganti ke tema terang", timeout=15000), "The theme toggle button's aria-label is 'Ganti ke tema terang', indicating the theme changed to dark."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    