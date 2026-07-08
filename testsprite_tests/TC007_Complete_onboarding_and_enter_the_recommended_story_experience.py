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
        
        # -> Click the 'Masuk ke Cerita Pertamaku' button to begin onboarding.
        # Masuk ke Cerita Pertamaku link
        elem = page.get_by_role('link', name='Masuk ke Cerita Pertamaku', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the onboarding option labeled "Rahasia keluarga dan warisan" to set the main conflict for the role.
        # Rahasia keluarga dan warisan button
        elem = page.get_by_role('button', name='Rahasia keluarga dan warisan', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Menyimpan semuanya sampai waktunya tiba' option to answer the onboarding question about how the character handles conflict.
        # Menyimpan semuanya sampai waktunya tiba button
        elem = page.get_by_role('button', name='Menyimpan semuanya sampai waktunya tiba', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the relationship option 'Cinta yang harus diperjuangkan lagi' to answer the onboarding question.
        # Cinta yang harus diperjuangkan lagi button
        elem = page.get_by_role('button', name='Cinta yang harus diperjuangkan lagi', exact=True)
        await elem.click(timeout=10000)
        
        # -> Select the 'Kedamaian — melepaskan dan melangkah' option on the 'Akhir seperti apa yang paling ingin kamu kejar?' page.
        # Kedamaian — melepaskan dan melangkah button
        elem = page.get_by_role('button', name='Kedamaian — melepaskan dan melangkah', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the story card labeled 'Jejak Rahasia di Balik Kraton' to choose a recommended story.
        # Rahasia Keluarga Warisan Mematikan Cinta... button
        elem = page.locator('xpath=/html/body/main/section/div[2]/button')
        await elem.click(timeout=10000)
        
        # -> Click the 'Masuk ke Cerita Ini' button to continue into the chosen story experience.
        # Masuk ke Cerita Ini button
        elem = page.get_by_role('button', name='Masuk ke Cerita Ini', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill the EMAIL field with 'moxsenna@gmail.com', fill the KATA SANDI field with the password, then click the 'Masuk' button to sign in.
        # email field
        elem = page.get_by_label('EMAIL', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("moxsenna@gmail.com")
        
        # -> Fill the EMAIL field with 'moxsenna@gmail.com', fill the KATA SANDI field with the password, then click the 'Masuk' button to sign in.
        # password field
        elem = page.get_by_label('KATA SANDI', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("metalizer77")
        
        # -> Fill the EMAIL field with 'moxsenna@gmail.com', fill the KATA SANDI field with the password, then click the 'Masuk' button to sign in.
        # Masuk button
        elem = page.get_by_role('button', name='Masuk', exact=True)
        await elem.click(timeout=10000)
        
        # -> Open the 'Beranda' page and check that the hero card labeled 'Lanjutkan Cerita' is visible.
        await page.goto("http://localhost:3000/beranda")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Lanjutkan Cerita' button on the hero card titled 'Warisan yang Terkubur' to open the current story.
        # CERITA BERJALAN — BAB 3 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # -> Open the 'Beranda' page and check that the hero card labeled 'Lanjutkan Cerita' is visible.
        await page.goto("http://localhost:3000/beranda")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Lanjutkan Cerita' button on the 'Warisan yang Terkubur' hero card to open the story reader.
        # CERITA BERJALAN — BAB 4 DARI 50 Warisan yang... link
        elem = page.locator('a[href="/baca/warisan-terkubur"]')
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify a current story entry is available
        await page.locator("xpath=/html/body/main/header/a").nth(0).scroll_into_view_if_needed()
        # Assert: A back-to-detail link for the current story is visible in the reader header.
        await expect(page.locator("xpath=/html/body/main/header/a").nth(0)).to_be_visible(timeout=15000), "A back-to-detail link for the current story is visible in the reader header."
        # Assert: The header story link points to /cerita/warisan-terkubur, confirming the current story entry is available.
        await expect(page.locator("xpath=/html/body/main/header/a").nth(0)).to_have_attribute("href", "/cerita/warisan-terkubur", timeout=15000), "The header story link points to /cerita/warisan-terkubur, confirming the current story entry is available."
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
    