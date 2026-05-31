import React, { createContext, useContext, useEffect, useState } from 'react';
// @ts-ignore
import { io } from 'socket.io-client';
type Socket = any;

interface WebSocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextType>({ socket: null, isConnected: false });

export const useWebSocket = () => useContext(WebSocketContext);

export const WebSocketProvider: React.FC<{ authUser: any, children: React.ReactNode }> = ({ authUser, children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!authUser) {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    const socketUrl = process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : '/';
    
    const newSocket = io(socketUrl, {
      withCredentials: true // Relies on session cookies for auth
    });

    newSocket.on('connect', () => {
      console.log('✅ WebSocket Connected:', newSocket.id);
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ WebSocket Disconnected');
      setIsConnected(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [authUser]);


  return (
    <WebSocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
};
