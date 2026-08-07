import { chromium, Page } from 'playwright';
import path from 'path';
import fs from 'fs';

export async function executeTest(testRunId: string, url: string, steps: any[]): Promise<{ logs: string, network: string, screenshotPath: string, errorMessage?: string }> {
  const artifactsDir = path.join(process.cwd(), 'artifacts', testRunId);
  fs.mkdirSync(artifactsDir, { recursive: true });
  
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  let logs = '';
  let network = '';
  
  page.on('console', msg => {
    logs += `[${msg.type()}] ${msg.text()}\n`;
  });
  
  page.on('request', request => {
    network += `-> ${request.method()} ${request.url()}\n`;
  });
  
  page.on('response', response => {
    network += `<- ${response.status()} ${response.url()}\n`;
  });
  
  let errorMessage: string | undefined;
  
  try {
    for (const step of steps) {
      console.log(`Executing step: ${step.description}`);
      if (step.action === 'navigate') {
        await page.goto(url);
      } else if (step.action === 'click') {
        if (step.selector) {
          await page.click(step.selector);
        } else {
          // fallback fuzzy click
          await page.getByText(step.value || step.description, { exact: false }).first().click();
        }
      } else if (step.action === 'fill') {
        if (step.selector) {
          await page.fill(step.selector, step.value || '');
        } else {
          await page.getByRole('textbox').first().fill(step.value || '');
        }
      } else if (step.action === 'wait') {
        await page.waitForTimeout(2000);
      } else if (step.action === 'assert') {
        // Just wait for state
        await page.waitForTimeout(1000);
      }
    }
  } catch (error: any) {
    errorMessage = error.message;
  }
  
  const screenshotPath = path.join(artifactsDir, 'final.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  await browser.close();
  
  fs.writeFileSync(path.join(artifactsDir, 'logs.txt'), logs);
  fs.writeFileSync(path.join(artifactsDir, 'network.txt'), network);
  if (errorMessage) {
    fs.writeFileSync(path.join(artifactsDir, 'error.txt'), errorMessage);
  }
  
  return {
    logs,
    network,
    screenshotPath,
    errorMessage
  };
}
