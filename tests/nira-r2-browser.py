"""Real browser smoke for the Nira R2 observer UI. Run in a trusted CI runner."""
import json
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts" / "nira-r2-browser"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
PORT = 8796
SERVER = subprocess.Popen(
    ["python", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT)],
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)

def expect(condition, description):
    if not condition:
        raise AssertionError(description)

try:
    time.sleep(1)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/nira.html", wait_until="networkidle", timeout=45000)
        page.locator("#npcList .npc-row").first.wait_for(timeout=30000)
        expect(page.locator("#npcList .npc-row").count() == 30, "R2 should render all 30 NPCs")
        expect(page.locator("#loadStatus").inner_text().startswith("R2"), "R2 atlas loaded")
        expect("Canon map" in page.locator("#assetInfo").inner_text(), "world map asset loaded")
        page.locator("#simToggle").click()
        page.locator("#simDay").click()
        expect("Day 2" in page.locator("#simClock").inner_text(), "day step changes clock")
        report = json.loads(page.evaluate("localStorage.getItem('nira-r2-world-save-v1')"))
        expect(report["schema"] == "nira-living-world-r2-v1", "R2 snapshot must be saved")
        expect(report["stats"]["socialMeetings"] > 0, "NPC should meet within the first day")
        expect(page.locator("#socialFeed .event-line").count() > 0, "social timeline should render")
        expect("พบปะ" in page.locator("#socialStats").inner_text(), "social metrics should render")
        page.locator("#npcFilter").fill("trader")
        expect(0 < page.locator("#npcList .npc-row").count() < 30, "search filters NPC list")
        page.locator("#npcList .npc-row").first.click()
        expect("อาชีพ" in page.locator("#npcInspector").inner_text(), "NPC inspector renders")
        expect(page.locator("#npcRelations").inner_text().strip() != "", "relation inspector renders")
        page.locator("#npcFilter").fill("")
        page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=False)

        # Test browser-local R1 save migration without erasing the original key.
        page.evaluate("""() => {
          const key='nira-r2-world-save-v1', oldKey='nira-r1-world-save-v1';
          const old=JSON.parse(localStorage.getItem(key));
          old.schema='nira-living-world-r1-v1';
          delete old.social;
          for(const npc of old.agents)delete npc.social;
          for(const k of ['socialMeetings','socialHelp','socialDisputes','knowledgeShared','socialObservations'])delete old.stats[k];
          localStorage.setItem(oldKey,JSON.stringify(old));
          localStorage.removeItem(key);
        }""")
        page.reload(wait_until="networkidle", timeout=45000)
        page.locator("#npcList .npc-row").first.wait_for(timeout=30000)
        expect("Day 2" in page.locator("#simClock").inner_text(), "legacy save kept its clock")
        migrated = json.loads(page.evaluate("localStorage.getItem('nira-r2-world-save-v1')"))
        expect(migrated["schema"] == "nira-living-world-r2-v1", "legacy R1 snapshot migrated to R2")
        expect(migrated["stats"]["socialMeetings"] == 0, "migration must not fabricate past encounters")
        expect(page.evaluate("localStorage.getItem('nira-r1-world-save-v1')") is not None, "legacy save remains available")
        expect(not errors, f"browser JS errors: {errors}")
        print("PASS R2 desktop: controls / NPCs / social timeline / legacy save migration / no page exceptions")

        mobile = context.new_page()
        mobile_errors = []
        mobile.on("pageerror", lambda e: mobile_errors.append(str(e)))
        mobile.set_viewport_size({"width": 390, "height": 844})
        mobile.goto(f"http://127.0.0.1:{PORT}/nira.html", wait_until="networkidle", timeout=45000)
        mobile.locator("#npcList .npc-row").first.wait_for(timeout=30000)
        expect(mobile.locator("#npcList .npc-row").count() == 30, "mobile should show 30 NPC")
        expect(mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2"), "no horizontal page overflow on phone")
        expect("Day 2" in mobile.locator("#simClock").inner_text(), "mobile restores browser snapshot")
        expect(not mobile_errors, f"mobile JS errors: {mobile_errors}")
        mobile.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
        print("PASS R2 mobile: 390px responsive / resume state / no page exceptions")
        browser.close()
finally:
    SERVER.terminate()
    SERVER.wait(timeout=10)
