"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTest = executeTest;
const playwright_1 = require("playwright");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
async function executeTest(testRunId, url, steps) {
    const artifactsDir = path_1.default.join(process.cwd(), 'artifacts', testRunId);
    fs_1.default.mkdirSync(artifactsDir, { recursive: true });
    const browser = await playwright_1.chromium.launch();
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
    let errorMessage;
    try {
        for (const step of steps) {
            console.log(`Executing step: ${step.description}`);
            if (step.action === 'navigate') {
                await page.goto(url);
            }
            else if (step.action === 'click') {
                if (step.selector) {
                    await page.click(step.selector);
                }
                else {
                    // fallback fuzzy click
                    await page.getByText(step.value || step.description, { exact: false }).first().click();
                }
            }
            else if (step.action === 'fill') {
                if (step.selector) {
                    await page.fill(step.selector, step.value || '');
                }
                else {
                    await page.getByRole('textbox').first().fill(step.value || '');
                }
            }
            else if (step.action === 'wait') {
                await page.waitForTimeout(2000);
            }
            else if (step.action === 'assert') {
                // Just wait for state
                await page.waitForTimeout(1000);
            }
        }
    }
    catch (error) {
        errorMessage = error.message;
    }
    const screenshotPath = path_1.default.join(artifactsDir, 'final.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await browser.close();
    fs_1.default.writeFileSync(path_1.default.join(artifactsDir, 'logs.txt'), logs);
    fs_1.default.writeFileSync(path_1.default.join(artifactsDir, 'network.txt'), network);
    if (errorMessage) {
        fs_1.default.writeFileSync(path_1.default.join(artifactsDir, 'error.txt'), errorMessage);
    }
    return {
        logs,
        network,
        screenshotPath,
        errorMessage
    };
}
