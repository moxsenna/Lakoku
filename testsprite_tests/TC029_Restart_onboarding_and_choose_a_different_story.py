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
        
        # -> Open the 'Mulai' quiz start page (navigate to /mulai).
        await page.goto("http://localhost:3000/mulai")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Pasangan yang berkhianat' option on the quiz start page.
        # Pasangan yang berkhianat button
        elem = page.get_by_role('button', name='Pasangan yang berkhianat', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Kembali ke langkah sebelumnya' button to go back toward the first quiz question so the quiz can be restarted with new answers.
        # Kembali ke langkah sebelumnya button
        elem = page.get_by_role('button', name='Kembali ke langkah sebelumnya', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Pernikahan kontrak yang berubah arah' option to choose a different first answer.
        # Pernikahan kontrak yang berubah arah button
        elem = page.get_by_role('button', name='Pernikahan kontrak yang berubah arah', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Kembali ke langkah sebelumnya' button to go back to the prior quiz question so the quiz can be restarted.
        # Kembali ke langkah sebelumnya button
        elem = page.get_by_role('button', name='Kembali ke langkah sebelumnya', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the option labeled 'Rahasia keluarga dan warisan' to advance to the next quiz question.
        # Rahasia keluarga dan warisan button
        elem = page.get_by_role('button', name='Rahasia keluarga dan warisan', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the answer button labeled 'Tenang dan menyusun rencana' to advance to the next quiz question.
        # Tenang dan menyusun rencana button
        elem = page.get_by_role('button', name='Tenang dan menyusun rencana', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the option labeled 'Cinta yang harus diperjuangkan lagi' to advance to the next quiz question.
        # Cinta yang harus diperjuangkan lagi button
        elem = page.get_by_role('button', name='Cinta yang harus diperjuangkan lagi', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Kedamaian — melepaskan dan melangkah' option to continue and finish the quiz.
        # Kedamaian — melepaskan dan melangkah button
        elem = page.get_by_role('button', name='Kedamaian — melepaskan dan melangkah', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Jejak Warisan Terkubur' story card to begin that recommended story.
        # Rahasia Keluarga Cinta yang Hilang Drama Warisan... button
        elem = page.locator('xpath=/html/body/main/section/div[2]/button')
        await elem.click(timeout=10000)
        
        # -> Click the 'Masuk ke Cerita Ini' button to begin the recommended story.
        # Masuk ke Cerita Ini button
        elem = page.get_by_role('button', name='Masuk ke Cerita Ini', exact=True)
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the home experience is displayed
        # Assert: Expected the page URL to contain '/beranda' indicating the home experience is displayed.
        await expect(page).to_have_url(re.compile("/beranda"), timeout=15000), "Expected the page URL to contain '/beranda' indicating the home experience is displayed."
        # Assert: Expected the home hero text 'Lanjutkan Cerita' to be visible.
        await expect(page.locator("xpath=/html/body/main/ol/li[1]/span[1]").nth(0)).to_contain_text("Lanjutkan Cerita", timeout=15000), "Expected the home hero text 'Lanjutkan Cerita' to be visible."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    