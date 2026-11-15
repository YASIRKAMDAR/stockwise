import { expect, test } from '@playwright/test';

// Owner on a desktop: the voice-health card on Reports.
test('owner sees voice health', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Manager / Owner' }).click();
  await page.getByLabel('Employee code').fill('OWNER');
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: /Voice health/ })).toBeVisible();
  await expect(page.locator('b', { hasText: /^\d+% answered$/ })).toBeVisible();
  await expect(page.getByText('Target: 95% answered')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Website' })).toBeVisible();
});
