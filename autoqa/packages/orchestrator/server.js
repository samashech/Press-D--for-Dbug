"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDashboardServer = startDashboardServer;
exports.broadcastUpdate = broadcastUpdate;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const db_1 = require("@autoqa/db");
let globalIo = null;
function startDashboardServer() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    const httpServer = (0, http_1.createServer)(app);
    globalIo = new socket_io_1.Server(httpServer, {
        cors: { origin: '*' }
    });
    globalIo.on('connection', async (socket) => {
        console.log('[Dashboard Server] Client connected');
        // Send initial state
        const runs = await db_1.prisma.testRun.findMany({
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
async function broadcastUpdate(testRunId) {
    if (!globalIo)
        return;
    const run = await db_1.prisma.testRun.findUnique({
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
