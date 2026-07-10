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
        
        # -> Open the /mulai onboarding page and click the 'Mulai cepat' option on that page.
        await page.goto("http://localhost:3000/mulai")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Click the 'Mulai cepat' button to start the quick-start onboarding flow.
        # Mulai cepat Pilih beberapa arah cerita, lalu... button
        elem = page.get_by_role('button', name='Mulai cepat Pilih beberapa arah cerita, lalu Lakoku menyiapkan 3 cerita.', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Tulis sendiri' (Write your own) option to open the custom answer input for this question.
        # Tulis sendiri button
        elem = page.get_by_role('button', name='Tulis sendiri', exact=True)
        await elem.click(timeout=10000)
        
        # -> Fill the 'Tulis jawabanmu sendiri...' textarea with a custom answer and click the 'Pakai jawaban ini' button.
        # Tulis jawabanmu sendiri... text area
        elem = page.get_by_placeholder('Tulis jawabanmu sendiri...', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Seorang pewaris yang dijatuhkan dari tahta keluarga, berusaha merebut kembali warisan dan kebenaran.")
        
        # -> Fill the 'Tulis jawabanmu sendiri...' textarea with a custom answer and click the 'Pakai jawaban ini' button.
        # Pakai jawaban ini button
        elem = page.get_by_role('button', name='Pakai jawaban ini', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Tulis sendiri' (Write your own) button to open the custom answer input for this question.
        # Tulis sendiri button
        elem = page.get_by_role('button', name='Tulis sendiri', exact=True)
        await elem.click(timeout=10000)
        
        # -> Type a custom answer into the 'Tulis jawabanmu sendiri...' textarea and click the 'Pakai jawaban ini' button to save it.
        # Tulis jawabanmu sendiri... text area
        elem = page.get_by_placeholder('Tulis jawabanmu sendiri...', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Mereka menghadapi konflik dengan kecerdikan dan perencanaan matang, selalu menunggu saat yang tepat untuk bertindak.")
        
        # -> Type a custom answer into the 'Tulis jawabanmu sendiri...' textarea and click the 'Pakai jawaban ini' button to save it.
        # Pakai jawaban ini button
        elem = page.get_by_role('button', name='Pakai jawaban ini', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Tulis sendiri' button to open the custom answer textarea for the current question.
        # Tulis sendiri button
        elem = page.get_by_role('button', name='Tulis sendiri', exact=True)
        await elem.click(timeout=10000)
        
        # -> Type a custom answer into the 'Tulis jawabanmu sendiri...' textarea and click the 'Pakai jawaban ini' button to save it and advance to the next onboarding step.
        # Tulis jawabanmu sendiri... text area
        elem = page.get_by_placeholder('Tulis jawabanmu sendiri...', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Hubungan penuh ketegangan dan pertumbuhan \u2014 dua karakter saling menantang, berkorban, dan akhirnya saling memahami.")
        
        # -> Type a custom answer into the 'Tulis jawabanmu sendiri...' textarea and click the 'Pakai jawaban ini' button to save it and advance to the next onboarding step.
        # Pakai jawaban ini button
        elem = page.get_by_role('button', name='Pakai jawaban ini', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the 'Tulis sendiri' button to open the custom answer textarea for step 4.
        # Tulis sendiri button
        elem = page.get_by_role('button', name='Tulis sendiri', exact=True)
        await elem.click(timeout=10000)
        
        # -> Type a custom answer into the 'Tulis jawabanmu sendiri...' textarea and click the 'Pakai jawaban ini' button to save and advance to the next step.
        # Tulis jawabanmu sendiri... text area
        elem = page.get_by_placeholder('Tulis jawabanmu sendiri...', exact=True)
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("Akhir yang menenangkan \u2014 penebusan, damai, dan kebenaran yang terungkap.")
        
        # -> Type a custom answer into the 'Tulis jawabanmu sendiri...' textarea and click the 'Pakai jawaban ini' button to save and advance to the next step.
        # Pakai jawaban ini button
        elem = page.get_by_role('button', name='Pakai jawaban ini', exact=True)
        await elem.click(timeout=10000)
        
        # -> Click the proposal card labeled 'Pewaris yang dijatuhkan' to select a premise and proceed to the summary or next step.
        # Pewaris yang dijatuhkan Perencanaan matang Intrik... button
        elem = page.locator('xpath=/html/body/main/section/div[2]/button')
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the custom answer is accepted and the setup can continue
        # Assert: The summary shows the 'Masuk ke Cerita Ini' button, confirming the flow advanced to the summary.
        await expect(page.locator("xpath=/html/body/main/section/div[2]/button[1]").nth(0)).to_have_text("Masuk ke Cerita Ini", timeout=15000), "The summary shows the 'Masuk ke Cerita Ini' button, confirming the flow advanced to the summary."
        await page.locator("xpath=/html/body/main/section/div[2]/button[2]").nth(0).scroll_into_view_if_needed()
        # Assert: The 'Lihat Cerita Lain' button is visible, indicating proposal/summary actions are available.
        await expect(page.locator("xpath=/html/body/main/section/div[2]/button[2]").nth(0)).to_be_visible(timeout=15000), "The 'Lihat Cerita Lain' button is visible, indicating proposal/summary actions are available."
        # Assert: The back button is present with the expected aria-label, showing navigation controls are available.
        await expect(page.locator("xpath=/html/body/main/header/button").nth(0)).to_have_attribute("aria-label", "Kembali ke langkah sebelumnya", timeout=15000), "The back button is present with the expected aria-label, showing navigation controls are available."
        
        # --> Verify premise proposals are available after completing the quiz
        await page.locator("xpath=/html/body/main/section/div[2]/button[1]").nth(0).scroll_into_view_if_needed()
        # Assert: The proposal action button 'Masuk ke Cerita Ini' is visible on the summary page.
        await expect(page.locator("xpath=/html/body/main/section/div[2]/button[1]").nth(0)).to_be_visible(timeout=15000), "The proposal action button 'Masuk ke Cerita Ini' is visible on the summary page."
        await page.locator("xpath=/html/body/main/section/div[2]/button[2]").nth(0).scroll_into_view_if_needed()
        # Assert: The proposal action button 'Lihat Cerita Lain' is visible on the summary page.
        await expect(page.locator("xpath=/html/body/main/section/div[2]/button[2]").nth(0)).to_be_visible(timeout=15000), "The proposal action button 'Lihat Cerita Lain' is visible on the summary page."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    