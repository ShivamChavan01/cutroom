export async function openProjectTool(page, name) {
  const trigger = page.getByRole('navigation', { name: 'Project tools' }).getByRole('button', { name, exact: true });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}

export async function openProjectMenu(page) {
  if (!await page.locator('#project-menu').isVisible()) {
    await page.getByRole('button', { name: 'Project menu', exact: true }).click();
  }
}

export async function openSampleGuide(page) {
  if (!await page.locator('#sample-guide').isVisible()) {
    await openProjectMenu(page);
    await page.getByRole('button', { name: 'Sample guide', exact: true }).click();
  }
}
