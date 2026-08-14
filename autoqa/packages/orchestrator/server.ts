import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { prisma } from '@autoqa/db';

let globalIo: Server | null = null;

export function startDashboardServer() {
  const app = express();
  app.use(cors());
  
  const httpServer = createServer(app);
  globalIo = new Server(httpServer, {
    cors: { origin: '*' }
  });

  globalIo.on('connection', async (socket) => {
    console.log('[Dashboard Server] Client connected');
    
    // Send initial state
    const runs = await prisma.testRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      include: {
        feature: true,
        testCases: {
          include: { bugReports: true }
        }
      }
    });
    socket.emit('init', runs);
  });

  httpServer.listen(3001, () => {
    console.log('[Dashboard Server] Listening on http://localhost:3001');
  });
}

export async function broadcastUpdate(testRunId: string) {
  if (!globalIo) return;
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: {
      feature: true,
      testCases: {
        include: { bugReports: true }
      }
    }
  });
  if (run) {
    globalIo.emit('update', run);
  }
}
