import prompts from 'prompts';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import chalk from 'chalk';
import fs from 'fs';

async function run() {
  console.log(chalk.bold.blue('=== AutoQA Start Wizard ===\n'));

  const response = await prompts([
    {
      type: 'text',
      name: 'repoPath',
      message: 'Which local project folder would you like to watch?',
      initial: process.cwd(),
      validate: (value) => fs.existsSync(value) ? true : 'Path does not exist.'
    },
    {
      type: 'text',
      name: 'localUrl',
      message: 'What is the local URL of the app to test?',
      initial: 'http://localhost:3000'
    }
  ]);

  if (!response.repoPath || !response.localUrl) {
    console.log(chalk.yellow('Aborted.'));
    process.exit(0);
  }

  const { repoPath, localUrl } = response;
  
  // Update the global config with the new targetUrl so requireConfig() passes
  const configPath = path.join(process.cwd(), 'd-bug.config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.targetUrl = localUrl;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // We will run the autoqa binary from our local CLI package
  const autoqaBin = path.join(process.cwd(), 'packages', 'cli', 'bin', 'autoqa.ts');
  const dashboardDir = path.join(process.cwd(), 'packages', 'dashboard');

  const processes: ChildProcess[] = [];

  function spawnProcess(name: string, command: string, args: string[], cwd: string, color: chalk.Chalk) {
    console.log(chalk.gray(`Starting ${name}...`));
    const child = spawn(command, args, { cwd, env: process.env });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      lines.forEach((line: string) => console.log(color(`[${name}] `) + line));
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      lines.forEach((line: string) => console.log(color(`[${name}] `) + chalk.red(line)));
    });

    child.on('close', (code) => {
      console.log(color(`[${name}] `) + chalk.gray(`Exited with code ${code}`));
    });

    processes.push(child);
  }

  // 1. Dashboard Backend
  spawnProcess('Dashboard-Server', 'npx', ['tsx', autoqaBin, 'dashboard-server'], process.cwd(), chalk.cyan);

  // 2. Worker
  spawnProcess('Worker', 'npx', ['tsx', autoqaBin, 'worker'], process.cwd(), chalk.green);

  // 3. Watcher
  spawnProcess('Watcher', 'npx', ['tsx', autoqaBin, 'watch', '--url', localUrl, repoPath], process.cwd(), chalk.magenta);

  // 4. Dashboard Frontend (Vite)
  spawnProcess('Dashboard-UI', 'npm', ['run', 'dev'], dashboardDir, chalk.yellow);

  console.log(chalk.bold.green('\nAll services started! Press CTRL+C to stop all.\n'));

  // Clean shutdown
  process.on('SIGINT', () => {
    console.log(chalk.bold.yellow('\nShutting down all services...'));
    processes.forEach(p => {
      try { p.kill('SIGINT'); } catch (e) {}
    });
    process.exit(0);
  });
}

run().catch(console.error);
