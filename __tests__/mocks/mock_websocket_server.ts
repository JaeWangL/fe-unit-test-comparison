import { Client, Server } from 'mock-socket'; // WebSocket 이름을 MockWebSocket으로 변경하여 혼동 방지

// Mock 서버 URL 정의
export const MOCK_WEBSOCKET_URL = 'ws://localhost:1234';

/**
 * Mock WebSocket 서버 인스턴스를 관리하는 클래스입니다.
 * 테스트 환경에서 실제 서버 없이 WebSocket 통신을 시뮬레이션합니다.
 */
export class MockWebSocketServer {
  private server: Server | null = null; // Mock 서버 인스턴스

  // connection 이벤트에서 받는 소켓 객체의 타입을 명시적으로 지정하기 어려울 수 있으므로,
  // Set<any>를 사용하거나, 서버의 clients() 메소드를 활용하는 방식으로 변경합니다.
  // 여기서는 서버의 clients() 메소드를 활용하는 방식으로 변경하여 Set 관리를 제거합니다.

  /**
   * Mock 서버를 시작합니다.
   * 지정된 URL로 들어오는 WebSocket 연결 요청을 감지합니다.
   */
  start(): void {
    if (this.server) {
      console.warn('Mock server is already running.');
      return;
    }

    this.server = new Server(MOCK_WEBSOCKET_URL);
    console.log(`Mock WebSocket Server started at ${MOCK_WEBSOCKET_URL}`);

    // 클라이언트 연결 이벤트 리스너
    // 'connection' 이벤트 핸들러의 'socket' 파라미터 타입을 명시하지 않고 타입 추론에 맡기거나 'any'로 지정합니다.
    // mock-socket 내부 타입인 'Client'와 import한 'WebSocket' 간의 미묘한 차이를 해결하기 위함입니다.
    this.server.on('connection', (socket: Client) => { // socket 타입을 any로 지정하여 유연성 확보
      console.log('Mock Server: Client connected');

      // 클라이언트로부터 메시지 수신 리스너
      socket.on('message', (data: any) => { // data 타입도 any 또는 string/Buffer 등으로 지정 가능
        const message = typeof data === 'string' ? data : data.toString();
        console.log(`Mock Server: Received message: ${message}`);

        // 에코 기능
        socket.send(`Server echo: ${message}`);

        // 특정 메시지에 대한 자동 응답
        if (message === 'ping') {
          socket.send('pong');
        }
      });

      // 클라이언트 연결 종료 이벤트 리스너
      socket.on('close', () => {
        console.log('Mock Server: Client disconnected');
        // 별도의 클라이언트 Set을 관리하지 않으므로 여기서 제거할 필요 없음
      });

      // 에러 처리 리스너
      socket.on('error', (error: Error) => { // error 타입을 Error로 지정
        console.error('Mock Server: Socket error:', error);
        // 에러 발생 시 해당 클라이언트 연결은 자동으로 닫힐 수 있음
      });

      // 연결 성공 시 환영 메시지 전송
      socket.send('Welcome to the Mock WebSocket Server!');
    });

    // 서버 자체 에러 처리
    this.server.on('error', (_socket: Client) => { // error 타입을 Error로 지정
      console.error('Mock Server: Server error:');
      this.stop();
    });
  }

  /**
   * Mock 서버를 중지하고 모든 클라이언트 연결을 종료합니다.
   */
  stop(): void {
    if (this.server) {
      console.log('Stopping Mock WebSocket Server...');

      // mock-socket의 Server 인스턴스가 관리하는 클라이언트 목록을 직접 사용합니다.
      // 이 클라이언트 객체의 close 메소드는 mock-socket 내부 타입에 맞춰 동작합니다.
      try {
        // server.clients()가 Client[] 타입을 반환한다고 가정합니다.
        this.server.clients().forEach((client: any) => { // 타입을 any로 하여 호환성 문제 회피
          // 표준 WebSocket.OPEN 상수 대신 숫자 1 사용 (mock-socket 내부 상태값과 일치시킬 필요)
          // 또는 client.readyState === MockWebSocket.OPEN (import한 MockWebSocket 사용)
          if (client.readyState === 1) { // WebSocket.OPEN 상태 확인
            // mock-socket의 Client 객체에 맞는 close 메소드 호출 (인자 없이 호출하거나, 필요시 CloseOptions 객체 전달)
            client.close(); // 대부분의 경우 인자 없이 호출해도 무방
          }
        });
      } catch (e) {
        console.error('Error while closing clients:', e);
      }


      // 서버 중지 콜백
      const serverInstance = this.server;
      this.server = null; // 참조 제거 먼저 수행
      serverInstance.stop(() => {
        console.log('Mock WebSocket Server stopped.');
      });

    }
  }

  /**
   * 연결된 모든 클라이언트에게 메시지를 브로드캐스트합니다.
   * @param message - 브로드캐스트할 메시지 내용 (string 또는 Buffer 등)
   */
  broadcast(message: string | Buffer | ArrayBuffer | Buffer[]): void {
    if (!this.server) {
      console.warn('Mock server is not running. Cannot broadcast.');
      return;
    }
    console.log(`Mock Server: Broadcasting message: ${message}`);
    // server.clients()를 사용하여 현재 연결된 모든 클라이언트에게 메시지 전송
    this.server.clients().forEach((client: any) => { // 타입을 any로 지정
      // 표준 WebSocket.OPEN 상수 대신 숫자 1 사용 또는 MockWebSocket.OPEN 사용
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }

  /**
   * 현재 연결된 클라이언트 수를 반환합니다.
   * @returns number - 연결된 클라이언트 수
   */
  getClientCount(): number {
    return this.server?.clients()?.length ?? 0;
  }

  /**
   * Mock 서버 인스턴스를 반환합니다. (테스트에서 직접 제어 필요시 사용)
   * @returns Server | null - Mock 서버 인스턴스 또는 null
   */
  getServerInstance(): Server | null {
    return this.server;
  }
}

export const mockWebSocketServer = new MockWebSocketServer();