import chokidar from 'chokidar';
import simpleGit from 'simple-git';
import path from 'path';
import { prisma } from '@autoqa/db';
import { analyzeDiff } from '@autoqa/llm-agents';
import { testQueue } from './queue';

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

  const ignoredPaths = [
    /(^|[\/\\])\../, // Ignore hidden files/dirs (like .git)
    /node_modules/,
    /dist/,
    /build/,
    /coverage/,
    path.join(process.cwd(), 'artifacts'),
  ];

  console.log(`Watching for file changes in ${repoPath}...`);
  console.log(`Ignoring: node_modules, .git, build outputs`);

  let debounceTimer: NodeJS.Timeout | null = null;
  let isProcessing = false;

  chokidar.watch(repoPath, { 
    persistent: true, 
    ignored: ignoredPaths,
    ignoreInitial: true 
  }).on('all', async (event, filePath) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      if (isProcessing) return;
      isProcessing = true;
      try {
        console.log(`\nChanges detected. Analyzing...`);
        // Here we'd ideally run `git diff` or pass the changed files to the LLM
        // For now, we simulate the old git-based extraction behavior since
        // the original implementation depended on `git show`
        
        const status = await git.status();
        if (status.files.length === 0) {
          console.log('No git changes found despite file save. Skipping.');
          return;
        }

        const diff = await git.diff();
        
        console.log('Analyzing diff...');
        const analysis = await analyzeDiff(diff);
        
        // Use a timestamp as ID since we don't have a commit hash
        const runId = Date.now().toString();
        
        const featureRecord = await prisma.feature.create({
          data: {
            projectId,
            name: analysis.featureName,
            description: analysis.description,
            status: 'discovered',
          }
        });

        console.log(`Feature discovered and saved: "${analysis.featureName}"`);
        console.log(`Adding to BullMQ testQueue for autonomous testing...`);
        
        await testQueue.add('run-test', {
          featureId: featureRecord.id,
          instruction: analysis.description,
          url: localUrl
        });
        console.log(`Job enqueued successfully.\n`);
        
      } catch (err) {
        console.error('Error processing changes:', err);
      } finally {
        isProcessing = false;
      }
    }, 2000); // 2 second debounce
  });
}
