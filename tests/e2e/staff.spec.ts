import { expect, test } from '@playwright/test';

// Staff on a phone: first-launch walkthrough, typed command → check screen (language tag, tap to correct) → confirm, and the attempts screen.
test.describe('staff', () => {
  test('walkthrough, voice-by-text, correct, confirm, attempts', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Your code').fill('S301');
    await page.getByLabel('Passcode').fill('1234');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // First sign-in: the walkthrough, ending with a safe practice command.
    const intro = page.getByRole('dialog', { name: 'How to use' });
    await expect(intro).toBeVisible();
    await expect(intro.getByRole('heading', { name: 'Hold the mic and speak' })).toBeVisible();
    for (let i = 0; i < 3; i++) await intro.getByRole('button', { name: 'Next' }).click();
    await intro.getByRole('button', { name: 'Try it' }).click();
    await expect(page.getByRole('status')).toContainText('say “my bag”');
    const box = page.getByPlaceholder('Type: room 203, 2 soap');
    await box.fill('my bag'); await box.press('Enter');
    await expect(page.getByRole('status')).toBeHidden();          // practice done

    // Back home, a typed sentence goes through the same path as speech.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Home' }).click();
    await box.fill('Return two soap to store'); await box.press('Enter');
    await expect(page.getByText('Check and confirm')).toBeVisible();
    await expect(page.locator('.lang-tag')).toHaveText('English');

    // Tap the heard words: they come back in the box to fix, nothing saved.
    await page.getByText('Tap to correct').click();
    await expect(box).toHaveValue('Return two soap to store');
    await box.fill('Return three soap to store'); await box.press('Enter');
    await expect(page.getByText('Check and confirm')).toBeVisible();
    await expect(page.locator('.summary-sentence')).toContainText('3');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Saved', { exact: false }).first()).toBeVisible();

    // Last voice attempts: both typed sentences are there, no audio anywhere.
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Last voice attempts' }).click();
    await expect(page.getByText('“Return three soap to store”')).toBeVisible();
    await expect(page.getByText('✓ saved').first()).toBeVisible();

    // Second visit: no walkthrough, but it can be reopened from the menu.
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'How to use' })).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'How to use' }).click();
    await expect(page.getByRole('dialog', { name: 'How to use' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();
  });

  test('Gujarati sentence is understood and tagged', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sw_intro_')) localStorage.removeItem(k); });
    await page.getByLabel('Your code').fill('S101');
    await page.getByLabel('Passcode').fill('1234');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const dlg = page.getByRole('dialog');
    if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button').first().click();   // Skip, in whatever language
    const box = page.locator('.composer-bar input');
    await box.fill('રૂમ ૨૦૩ માં બે સાબુ અને એક શેમ્પૂ મૂક્યા'); await box.press('Enter');
    await expect(page.locator('.lang-tag')).toHaveText('ગુજરાતી');
    await expect(page.locator('.bigroom b')).toHaveText('203');
  });
});
