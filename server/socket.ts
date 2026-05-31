import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: SocketIOServer | null = null;

export function initSocket(server: HttpServer) {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);
    
    // Example: Rooms for profile-specific events
    socket.on('join_profile', (profileId: string) => {
      socket.join(`profile_${profileId}`);
      console.log(`[Socket] ${socket.id} joined profile_${profileId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.io has not been initialized. Call initSocket first.');
  }
  return io;
}

// Helper functions for easy broadcasting
export function broadcastTradeOpened(profileId: number, trade: any) {
  if (!io) return;
  io.to(`profile_${profileId}`).emit('trade_opened', trade);
  io.emit('global_trade_opened', trade); // Broadcast globally if needed
}

export function broadcastTradeClosed(profileId: number, trade: any) {
  if (!io) return;
  io.to(`profile_${profileId}`).emit('trade_closed', trade);
  io.emit('global_trade_closed', trade);
}

export function broadcastEngineStatus(status: any) {
  if (!io) return;
  io.emit('engine_status_update', status);
}

export function broadcastNewsUpdate(news: any) {
  if (!io) return;
  io.emit('news_update', news);
}
