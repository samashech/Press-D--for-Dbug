import chokidar from 'chokidar';
import simpleGit from 'simple-git';
import path from 'path';
import { prisma } from '@autoqa/db';
import { analyzeDiff } from '@autoqa/llm-agents';

export async function startWatcher(repoPath: string, localUrl: string) {
  const git = simpleGit(repoPath);
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error('Provided path is not a git repository');
  }

  // Ensure project exists
  let project = await prisma.project.findFirst({ where: { repoPath } });
  if (!project) {
    project = await prisma.project.create({
      data: {
        name: path.basename(repoPath),
        repoPath,
        localUrl,
      }
    });
  }
  const projectId = project.id;

  const gitRoot = await git.revparse(['--show-toplevel']);
  const gitLogsPath = path.join(gitRoot.trim(), '.git', 'logs', 'HEAD');
  console.log(`Watching for commits at ${gitLogsPath}...`);

  let isProcessing = false;

  chokidar.watch(gitLogsPath, { persistent: true, ignoreInitial: true }).on('change', async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      const log = await git.log({ maxCount: 1 });
      const latestCommit = log.latest;
      
      if (!latestCommit) return;

      const existingCommit = await prisma.commit.findUnique({
        where: { id: latestCommit.hash } // We use hash as ID for simplicity
      });

      if (existingCommit) {
        return; // Already processed
      }

      console.log(`\nNew commit detected: ${latestCommit.hash.substring(0, 7)} - ${latestCommit.message}`);
      
      const diff = await git.show([latestCommit.hash]);
      
      console.log('Analyzing diff...');
      const analysis = await analyzeDiff(diff);
      
      const commitRecord = await prisma.commit.create({
        data: {
          id: latestCommit.hash,
          projectId,
          hash: latestCommit.hash,
          diffSummary: analysis.description,
        }
      });

      await prisma.feature.create({
        data: {
          projectId,
          commitId: commitRecord.id,
          name: analysis.featureName,
          description: analysis.description,
          status: 'discovered',
        }
      });

      console.log(`Feature discovered and saved: "${analysis.featureName}"`);
      console.log(`Run 'autoqa review' to approve and test it.\n`);
      
    } catch (err) {
      console.error('Error processing commit:', err);
    } finally {
      isProcessing = false;
    }
  });
}
