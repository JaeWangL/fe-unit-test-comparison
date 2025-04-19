import { WebSocket } from 'mock-socket'; // mock-socket에서 WebSocket 가져오기

// 전역 WebSocket을 mock-socket의 WebSocket으로 교체
global.WebSocket = WebSocket as any;
