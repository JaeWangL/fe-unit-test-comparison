import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketClient, WebSocketEvents, WebSocketState } from '@/lib/websocket_client';
import { MOCK_WEBSOCKET_URL, MockWebSocketServer } from '@/../__tests__/mocks/mock_websocket_server';

// describe 블록 전체에 적용될 타임아웃 증가 (필요한 경우)
// describe.configure({ testTimeout: 10000 }); // 예: 10초

describe('WebSocketClient (Vitest)', () => {
  let mockServer: MockWebSocketServer | null = null; // null로 초기화하여 finally에서 체크
  let client: WebSocketClient;

  // 각 테스트 전에 Mock 서버 시작 및 클라이언트 인스턴스 생성
  beforeEach(() => {
    // 이전 테스트에서 서버가 제대로 닫히지 않았을 경우를 대비하여 명시적 확인은 어려움
    // mock-socket 내부 상태를 초기화하는 방법이 공식적으로 없다면,
    // 테스트 러너가 프로세스를 분리하지 않는 이상 URL 충돌은 발생할 수 있음
    // 여기서는 afterEach의 finally 블록에 의존
    mockServer = new MockWebSocketServer();
    mockServer.start();
    // 재연결 옵션 없이 클라이언트 생성 (기본)
    client = new WebSocketClient(MOCK_WEBSOCKET_URL);
  });

  // 각 테스트 후에 Mock 서버 중지 및 클라이언트 정리
  afterEach(async () => {
    vi.useRealTimers(); // Fake timers 사용 시 실제 시간으로 먼저 복원

    try {
      // 클라이언트 연결 상태 확인 및 종료 (존재하고, Idle 상태가 아닐 때)
      if (client && client.getState() !== WebSocketState.Idle) {
        const disconnectPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            console.warn('[afterEach] Disconnect event timeout');
            reject(new Error('Disconnect event didn\'t fire in time')); // 타임아웃 시 reject
          }, 2000); // 타임아웃 시간 (2초)

          const handler = () => {
            clearTimeout(timeout);
            client.off(WebSocketEvents.Disconnected, handler); // 리스너 제거
            resolve();
          };
          client.on(WebSocketEvents.Disconnected, handler);
          // 이미 Disconnecting 상태일 수 있으므로 확인 후 호출
          if (client.getState() !== WebSocketState.Disconnecting) {
            client.disconnect();
          } else {
            // 이미 disconnect()가 호출되었다면 이벤트만 기다림
          }
        });

        try {
          await disconnectPromise;
          // Idle 상태가 될 때까지 추가 대기 (필요시)
          await vi.waitFor(() => {
            expect(client.getState()).toBe(WebSocketState.Idle);
          }, { timeout: 500 }); // 짧은 추가 대기
        } catch (err) {
          console.error('[afterEach] Error waiting for client disconnect:', err);
          // 여기서 에러를 던지면 다음 테스트에 영향을 줄 수 있으므로 로깅만 할 수도 있음
        }
      }
    } catch (error) {
      console.error('[afterEach] Error during client cleanup:', error);
    } finally {
      // mockServer가 null이 아니고, 서버 인스턴스가 존재하면 중지 시도
      // mock-socket의 stop()은 콜백을 받지만, 비동기 완료 보장이 명확하지 않을 수 있음
      // 일단 호출하고, 짧은 지연 추가
      if (mockServer?.getServerInstance()) {
        await new Promise<void>(resolve => {
          mockServer!.stop();
          // mock-socket의 stop 콜백은 내부 타이머 등에 의존할 수 있어 불안정할 수 있음
          // 짧은 시간 후 resolve하여 포트 정리 시간 확보
          setTimeout(resolve, 50);
        });
      }
      mockServer = null; // 참조 제거
      // client = null; // client는 beforeEach에서 새로 생성되므로 null 할당은 불필요
    }
  });

  // --- Test Cases ---

  it('should connect to the WebSocket server successfully', async () => {
    const connectHandler = vi.fn();
    client.on(WebSocketEvents.Connected, connectHandler);

    client.connect();

    // 서버 연결 인지 확인 (선택적)
    await vi.waitFor(() => {
      expect(mockServer?.getClientCount()).toBe(1);
    });

    // **수정:** 클라이언트 상태가 Connected가 될 때까지 기다림
    await vi.waitFor(() => {
      expect(client.getState()).toBe(WebSocketState.Connected);
    });

    expect(client.isConnected()).toBe(true);
    expect(connectHandler).toHaveBeenCalledOnce();
  });

  it('should disconnect from the WebSocket server', async () => {
    const disconnectHandler = vi.fn();
    client.on(WebSocketEvents.Disconnected, disconnectHandler);

    client.connect();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Connected));

    client.disconnect();

    // **수정:** Disconnected 이벤트가 발생하고 Idle 상태가 될 때까지 기다림
    await vi.waitFor(() => {
      expect(disconnectHandler).toHaveBeenCalledOnce();
      expect(client.getState()).toBe(WebSocketState.Idle);
    });

    expect(client.isConnected()).toBe(false);
    // mock-socket은 수동 close 시 code 1005, wasClean: false를 반환하는 경향이 있음
    expect(disconnectHandler).toHaveBeenCalledWith(expect.objectContaining({
      code: 1005, // 또는 mock-socket 구현에 따른 다른 코드
      // wasClean: false // mock-socket 동작 확인 필요
    }));
    await vi.waitFor(() => expect(mockServer?.getClientCount()).toBe(0)); // 서버에서도 연결 종료 확인
  });

  it('should return correct connection status using isConnected()', async () => {
    expect(client.isConnected()).toBe(false);

    client.connect();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Connected));
    expect(client.isConnected()).toBe(true);

    client.disconnect();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Idle));
    expect(client.isConnected()).toBe(false);
  });

  it('should send data to the server when connected', async () => {
    // 서버에서 메시지 수신 대기 설정
    const serverMessages: string[] = [];
    mockServer?.getServerInstance()?.on('connection', (socket) => {
      socket.on('message', (data) => {
        serverMessages.push(data.toString());
      });
    });

    client.connect();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Connected));

    const message = 'Hello Server!';
    client.sendMessage(message);

    // 서버가 해당 메시지를 수신했는지 확인
    await vi.waitFor(() => {
      expect(serverMessages).toContain(message);
    });
  });

  it('should receive data from the server', async () => {
    const messageHandler = vi.fn();
    client.on(WebSocketEvents.Message, messageHandler);

    client.connect();
    await vi.waitFor(() => expect(mockServer?.getClientCount()).toBe(1));

    // **수정:** Welcome 메시지 수신을 먼저 기다릴 수 있음 (선택적이지만 안정성 증가)
    await vi.waitFor(() => {
      expect(messageHandler).toHaveBeenCalledWith('Welcome to the Mock WebSocket Server!');
    });
    messageHandler.mockClear(); // Welcome 메시지 호출 기록 지우기

    // 서버에서 테스트 메시지 전송
    const testMessage = 'Hello Client!';
    mockServer?.broadcast(testMessage);

    // **수정:** 테스트 메시지를 수신할 때까지 기다림
    await vi.waitFor(() => {
      expect(messageHandler).toHaveBeenCalledWith(testMessage);
    });
    expect(messageHandler).toHaveBeenCalledOnce(); // clear 후 한 번만 호출되었는지 확인
  });

  it('should emit error event on connection failure', async () => {
    const errorHandler = vi.fn();
    client.on(WebSocketEvents.Error, errorHandler);
    const disconnectHandler = vi.fn();
    client.on(WebSocketEvents.Disconnected, disconnectHandler);

    mockServer?.stop(); // 서버를 먼저 중지

    client.connect();

    // 에러 이벤트 및 Disconnected 이벤트 발생 확인
    await vi.waitFor(() => {
      expect(errorHandler).toHaveBeenCalledOnce();
      // mock-socket에서 연결 실패 시 close 이벤트(1006)도 발생하는 경향이 있음
      expect(disconnectHandler).toHaveBeenCalledOnce();
    });
    expect(client.getState()).toBe(WebSocketState.Idle);
  });

  it('should attempt to reconnect on unexpected disconnection', async ({ onTestFinished }) => {
    vi.useFakeTimers();
    // 재연결 옵션 설정
    client = new WebSocketClient(MOCK_WEBSOCKET_URL, { retries: 3, delay: 50, increaseDelay: false });

    const disconnectHandler = vi.fn();
    const reconnectingHandler = vi.fn();
    const reconnectedHandler = vi.fn();

    client.on(WebSocketEvents.Disconnected, disconnectHandler);
    client.on(WebSocketEvents.Reconnecting, reconnectingHandler);
    client.on(WebSocketEvents.Reconnected, reconnectedHandler);

    // 테스트 종료 시 타이머 복원 보장
    onTestFinished(() => vi.useRealTimers());


    client.connect();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Connected));

    // 서버에서 예기치 않게 연결 종료 시뮬레이션
    const mockServerSocket = mockServer?.getServerInstance()?.clients()[0];
    mockServerSocket?.close();

    // Disconnected 이벤트 및 상태 확인
    await vi.waitFor(() => {
      expect(disconnectHandler).toHaveBeenCalledOnce();
      // **수정:** mock-socket 동작에 맞춰 wasClean: true, code: 1000 (또는 1005/1006 등 실제 값) 예상
      expect(disconnectHandler).toHaveBeenCalledWith(expect.objectContaining({ wasClean: true }));
    });
    // disconnect 후 바로 Reconnecting 상태로 진입 확인
    expect(client.getState()).toBe(WebSocketState.Reconnecting);


    // Reconnecting 이벤트 확인 (첫 번째 시도)
    await vi.waitFor(() => {
      expect(reconnectingHandler).toHaveBeenCalledWith(1);
    });


    // 시간 진행시켜 재연결 로직 실행
    vi.advanceTimersByTime(50);

    // 재연결 시도 (서버는 현재 떠 있음)
    // client.connect()가 내부적으로 호출됨

    // Reconnected 및 Connected 상태 확인
    await vi.waitFor(() => {
      expect(reconnectedHandler).toHaveBeenCalledOnce();
      expect(client.getState()).toBe(WebSocketState.Connected);
    }, { timeout: 1000 }); // 재연결 시간에 충분한 타임아웃 부여

    expect(client.isConnected()).toBe(true);
  });

  it('should stop reconnecting after reaching max retries', async ({ onTestFinished }) => {
    vi.useFakeTimers();
    // 재연결 옵션: 2번 시도
    client = new WebSocketClient(MOCK_WEBSOCKET_URL, { retries: 2, delay: 50, increaseDelay: false });

    const reconnectingHandler = vi.fn();
    const errorHandler = vi.fn();
    const disconnectHandler = vi.fn();
    const connectedHandler = vi.fn(); // Track initial connection

    client.on(WebSocketEvents.Reconnecting, reconnectingHandler);
    client.on(WebSocketEvents.Error, errorHandler);
    client.on(WebSocketEvents.Disconnected, disconnectHandler);
    client.on(WebSocketEvents.Connected, connectedHandler);

    onTestFinished(() => vi.useRealTimers());

    // 1. 초기 연결 및 상태 확인
    client.connect();
    await vi.waitFor(() => expect(connectedHandler).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Connected));
    const initialDisconnectCount = disconnectHandler.mock.calls.length; // Should be 0

    // 2. 서버 측에서 클라이언트 연결 강제 종료
    const serverSocket = mockServer?.getServerInstance()?.clients()[0];
    expect(serverSocket).toBeDefined(); // 서버 소켓 존재 확인
    serverSocket?.close();
    console.log('[Test] Server closed client socket.');

    // 3. 클라이언트가 Disconnected 이벤트를 받고 Reconnecting 상태로 전환될 때까지 대기
    //    - handleClose 실행 -> Disconnected 이벤트 발생 & 상태 Idle 변경
    //    - scheduleReconnect 실행 -> Reconnecting 이벤트 발생 & 상태 Reconnecting 변경
    await vi.waitFor(() => {
      // Disconnected 이벤트가 먼저 발생할 것을 기대
      expect(disconnectHandler).toHaveBeenCalledTimes(initialDisconnectCount + 1);
      // 그 후 Reconnecting 상태가 될 것을 기대
      expect(client.getState()).toBe(WebSocketState.Reconnecting);
    }, { timeout: 2000 }); // 상태 전환에 충분한 시간 부여
    console.log(`[Test] Client state is now: ${client.getState()}`);


    // 4. 서버 완전 중지 (재연결이 성공하지 못하도록)
    console.log('[Test] Stopping mock server...');
    await new Promise<void>(resolve => {
      if (mockServer) {
        mockServer.stop(resolve); // stop 콜백 사용
      } else {
        resolve();
      }
    });
    console.log('[Test] Mock server stopped.');
    mockServer = null;

    // --- 5. 첫 번째 재연결 시도 ---
    // Reconnecting(1) 이벤트 대기 (이미 발생했을 수 있으므로 확인)
    await vi.waitFor(() => expect(reconnectingHandler).toHaveBeenCalledWith(1), { timeout: 1000 });
    console.log('[Test] Reconnecting attempt 1 event received.');

    const errorCountAttempt1 = errorHandler.mock.calls.length;
    const disconnectCountAttempt1 = disconnectHandler.mock.calls.length;

    // 시간 진행 -> connect() 시도 -> 서버 없음 -> 실패
    console.log('[Test] Advancing timer for reconnect attempt 1...');
    vi.advanceTimersByTime(50);

    // 실패 -> Error 이벤트 대기
    await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(errorCountAttempt1 + 1), { timeout: 1000 });
    console.log('[Test] Error event received after attempt 1.');
    // 실패 -> Disconnected 이벤트 대기
    await vi.waitFor(() => expect(disconnectHandler).toHaveBeenCalledTimes(disconnectCountAttempt1 + 1), { timeout: 1000 });
    console.log('[Test] Disconnected event received after attempt 1.');
    // 실패 -> 다시 Reconnecting 상태 대기 (두 번째 시도 예약)
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Reconnecting), { timeout: 1000 });
    console.log(`[Test] Client state after attempt 1 failure: ${client.getState()}`);


    // --- 6. 두 번째 재연결 시도 ---
    // Reconnecting(2) 이벤트 대기
    await vi.waitFor(() => expect(reconnectingHandler).toHaveBeenCalledWith(2), { timeout: 1000 });
    console.log('[Test] Reconnecting attempt 2 event received.');

    const errorCountAttempt2 = errorHandler.mock.calls.length;
    const disconnectCountAttempt2 = disconnectHandler.mock.calls.length;

    // 시간 진행 -> connect() 시도 -> 서버 없음 -> 실패
    console.log('[Test] Advancing timer for reconnect attempt 2...');
    vi.advanceTimersByTime(50);

    // 실패 -> Error 이벤트 대기
    await vi.waitFor(() => expect(errorHandler).toHaveBeenCalledTimes(errorCountAttempt2 + 1), { timeout: 1000 });
    console.log('[Test] Error event received after attempt 2.');
    // 실패 -> Disconnected 이벤트 대기
    await vi.waitFor(() => expect(disconnectHandler).toHaveBeenCalledTimes(disconnectCountAttempt2 + 1), { timeout: 1000 });
    console.log('[Test] Disconnected event received after attempt 2.');


    // --- 7. 최대 시도 도달 후 Idle 상태 확인 ---
    // 'Reached max reconnect attempts' 로그 후 Idle 상태가 됨
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Idle), { timeout: 1000 });
    console.log(`[Test] Client state after max retries: ${client.getState()}`);


    // --- 8. 최종 검증 ---
    vi.advanceTimersByTime(1000); // 추가 시간 진행
    expect(reconnectingHandler).toHaveBeenCalledTimes(2); // 총 2번 시도
    expect(errorHandler.mock.calls.length).toBeGreaterThanOrEqual(2); // 최소 2번 에러
    expect(disconnectHandler.mock.calls.length).toBeGreaterThanOrEqual(3); // 최초 종료 + 2번 실패 = 최소 3번 종료
    expect(client.getState()).toBe(WebSocketState.Idle); // 최종 상태 Idle
  });

  it('should stop reconnecting if disconnect() is called manually', async ({ onTestFinished }) => {
    vi.useFakeTimers();
    client = new WebSocketClient(MOCK_WEBSOCKET_URL, { retries: 5, delay: 50, increaseDelay: false });

    const reconnectingHandler = vi.fn();
    client.on(WebSocketEvents.Reconnecting, reconnectingHandler);

    // 테스트 종료 시 타이머 복원 보장
    onTestFinished(() => vi.useRealTimers());


    client.connect();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Connected));


    // 서버 강제 종료
    mockServer?.getServerInstance()?.clients()[0]?.close();
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Reconnecting));


    // 첫 번째 재연결 시도 확인
    await vi.waitFor(() => expect(reconnectingHandler).toHaveBeenCalledWith(1));


    // 재연결 타이머가 실행되기 전에 수동으로 disconnect 호출
    client.disconnect();


    // 상태가 Idle 로 변경 확인
    await vi.waitFor(() => expect(client.getState()).toBe(WebSocketState.Idle));


    // 시간 진행시켜도 더 이상 reconnecting 이벤트 발생 안 함
    vi.advanceTimersByTime(1000);
    expect(reconnectingHandler).toHaveBeenCalledTimes(1);
  });

});