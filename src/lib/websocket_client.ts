import EventEmitter from 'eventemitter3';

// 클라이언트가 발생시키는 이벤트 타입을 정의합니다.
// 이를 통해 이벤트 이름 오타를 방지하고, 리스너에서 타입을 명확히 할 수 있습니다.
export enum WebSocketEvents {
  Connected = 'connected', // 연결 성공
  Disconnected = 'disconnected', // 연결 끊김 (의도적 또는 비의도적)
  Message = 'message', // 메시지 수신
  Error = 'error', // 웹소켓 에러 발생
  Reconnecting = 'reconnecting', // 재연결 시도 중
  Reconnected = 'reconnected', // 재연결 성공
}

// WebSocket 통신 상태를 나타내는 타입
export enum WebSocketState {
  Idle = 'idle', // 초기 상태 또는 연결 끊김 상태
  Connecting = 'connecting', // 연결 시도 중
  Connected = 'connected', // 연결됨
  Reconnecting = 'reconnecting', // 재연결 시도 중
  Disconnecting = 'disconnecting', // 연결 종료 중
}

// 재연결 옵션 인터페이스
interface ReconnectOptions {
  retries: number; // 최대 재연결 시도 횟수
  delay: number; // 재연결 시도 간격 (ms)
  increaseDelay: boolean; // 재연결 시도 시 딜레이 증가 여부
}

/**
 * WebSocket 클라이언트 클래스.
 * EventEmitter3를 사용하여 WebSocket 관련 이벤트를 관리합니다.
 */
export class WebSocketClient extends EventEmitter {
  private url: string; // WebSocket 서버 URL
  private ws: WebSocket | null = null; // WebSocket 인스턴스
  private state: WebSocketState = WebSocketState.Idle; // 현재 연결 상태
  private reconnectOptions: ReconnectOptions | null; // 재연결 옵션
  private reconnectAttempts: number = 0; // 현재까지의 재연결 시도 횟수
  private reconnectTimeoutId: NodeJS.Timeout | null = null; // 재연결 타임아웃 ID
  private isReconnectingAttempt: boolean = false; // 재연결 시도 중인지 나타내는 플래그

  /**
   * WebSocketClient 생성자
   * @param url - 연결할 WebSocket 서버 URL
   * @param reconnectOptions - 자동 재연결 옵션 (선택 사항)
   */
  constructor(url: string, reconnectOptions?: ReconnectOptions) {
    super(); // EventEmitter 초기화
    this.url = url;
    this.reconnectOptions = reconnectOptions || null; // 기본값은 재연결 안함

    // 브라우저 환경이 아닐 경우(Node.js 테스트 환경 등) WebSocket 폴리필이 필요할 수 있습니다.
    // 테스트 환경 설정에서 global.WebSocket을 mock-socket의 WebSocket으로 설정하면 해결됩니다.
  }

  /**
   * WebSocket 서버에 연결을 시도합니다.
   * 이미 연결 중이거나 연결된 상태면 아무 작업도 수행하지 않습니다.
   */
  public connect(): void {
    // 이미 연결(중)이거나 종료 중이면 중복 실행 방지
    if (this.state === WebSocketState.Connecting || this.state === WebSocketState.Connected || this.state === WebSocketState.Disconnecting) {
      return;
    }

    console.log(`[WebSocketClient] Connecting to ${this.url}...`);
    this.state = WebSocketState.Connecting;

    // 이전 타임아웃 클리어 (수동 연결 시 재연결 로직 중단)
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    try {
      // 표준 WebSocket API 또는 mock-socket의 WebSocket 사용
      // 테스트 환경에서는 mock-socket이 global.WebSocket을 대체하게 됩니다.
      this.ws = new WebSocket(this.url);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('[WebSocketClient] Failed to create WebSocket connection:', error);
      this.state = WebSocketState.Idle;
      this.isReconnectingAttempt = false; // 연결 생성 실패 시 플래그 리셋
      this.emit(WebSocketEvents.Error, error); // 에러 이벤트 발생
      // 연결 생성 실패 시에도 재연결 시도 가능
      this.scheduleReconnect();
    }
  }

  /**
   * WebSocket 연결을 종료합니다.
   */
  public disconnect(): void {
    if (!this.ws || this.state === WebSocketState.Idle || this.state === WebSocketState.Disconnecting) {
      console.warn('[WebSocketClient] Not connected or already disconnecting.');
      return;
    }

    console.log('[WebSocketClient] Disconnecting...');
    this.state = WebSocketState.Disconnecting;

    // 재연결 로직 중단
    this.isReconnectingAttempt = false; // 수동 종료 시 플래그 리셋
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;

    // WebSocket 연결 종료 요청
    // close() 메서드는 onclose 이벤트를 트리거합니다.
    this.ws.close();
  }

  /**
   * 현재 연결 상태를 반환합니다.
   * @returns boolean - 연결되어 있으면 true, 그렇지 않으면 false
   */
  public isConnected(): boolean {
    return this.state === WebSocketState.Connected;
  }

  /**
   * 현재 WebSocket 연결 상태를 반환합니다.
   * @returns WebSocketState - 현재 상태
   */
  public getState(): WebSocketState {
    return this.state;
  }

  /**
   * WebSocket 서버로 메시지를 전송합니다.
   * 연결된 상태에서만 메시지를 전송할 수 있습니다.
   * @param data - 전송할 데이터 (string, Blob, ArrayBuffer 등)
   */
  public sendMessage(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
    if (!this.isConnected() || !this.ws) {
      console.warn('[WebSocketClient] Cannot send message. Not connected.');
      return;
    }
    try {
      this.ws.send(data);
      console.log('[WebSocketClient] Message sent:', data);
    } catch (error) {
      console.error('[WebSocketClient] Failed to send message:', error);
      this.emit(WebSocketEvents.Error, error); // 에러 이벤트 발생
    }
  }

  // --- Private Event Handlers ---

  /**
   * WebSocket 'open' 이벤트 핸들러.
   * 연결 성공 시 호출됩니다.
   */
  private handleOpen(): void {
    const wasReconnecting = this.isReconnectingAttempt;
    console.log('[WebSocketClient] Connection established.');
    this.state = WebSocketState.Connected;
    this.reconnectAttempts = 0; // 재연결 성공 시 시도 횟수 초기화
    this.isReconnectingAttempt = false; // 연결 성공 시 플래그 리셋

    if (wasReconnecting) {
      this.emit(WebSocketEvents.Reconnected); // 재연결 성공 이벤트
    }
    this.emit(WebSocketEvents.Connected); // 연결 성공 이벤트
  }

  /**
   * WebSocket 'message' 이벤트 핸들러.
   * 서버로부터 메시지를 수신했을 때 호출됩니다.
   * @param event - MessageEvent 객체
   */
  private handleMessage(event: MessageEvent): void {
    console.log('[WebSocketClient] Message received:', event.data);
    this.emit(WebSocketEvents.Message, event.data); // 메시지 수신 이벤트 발생
  }

  /**
   * WebSocket 'close' 이벤트 핸들러.
   * 연결이 종료되었을 때 호출됩니다 (의도적 또는 비의도적).
   * @param event - CloseEvent 객체
   */
  private handleClose(event: CloseEvent): void {
    // 이미 수동으로 연결 종료 중이었다면 상태 변경 및 이벤트 발생 완료됨
    if (this.state === WebSocketState.Disconnecting) {
      console.log(`[WebSocketClient] Connection closed intentionally. Code: ${event.code}, Reason: ${event.reason}`);
      this.ws = null;
      this.state = WebSocketState.Idle;
      this.isReconnectingAttempt = false; // 리셋
      this.emit(WebSocketEvents.Disconnected, { wasClean: event.wasClean, code: event.code });
      return; // 재연결 로직 실행 안함
    }

    // 비정상 종료 또는 예기치 않은 종료
    console.warn(`[WebSocketClient] Connection closed unexpectedly. Code: ${event.code}, Reason: ${event.reason}, Was Clean: ${event.wasClean}`);
    this.ws = null; // 웹소켓 인스턴스 제거
    const previousState = this.state;
    this.state = WebSocketState.Idle; // 상태를 Idle로 변경

    // 연결이 끊겼다는 이벤트 발생
    this.emit(WebSocketEvents.Disconnected, { wasClean: event.wasClean, code: event.code });

    // 재연결 옵션이 있고, 이전에 연결/재연결 중 상태였을 경우 재연결 시도
    if (this.reconnectOptions && (previousState === WebSocketState.Connected || previousState === WebSocketState.Connecting || previousState === WebSocketState.Reconnecting)) {
      this.scheduleReconnect();
    } else {
      this.isReconnectingAttempt = false; // 재연결 안 하면 리셋
    }
  }

  /**
   * WebSocket 'error' 이벤트 핸들러.
   * WebSocket 통신 중 에러가 발생했을 때 호출됩니다.
   * @param event - ErrorEvent 객체 (또는 간단한 Error 객체일 수 있음)
   */
  private handleError(event: Event | ErrorEvent): void {
    // Event 타입일 경우 상세 에러 정보가 없을 수 있음
    const error = (event instanceof ErrorEvent) ? event.error : new Error('WebSocket error occurred');
    console.error('[WebSocketClient] WebSocket error:', error);

    // 에러 발생 시에도 연결은 보통 닫히므로(close 이벤트 발생),
    // 여기서 상태를 변경하기보다 close 핸들러에서 처리하는 것이 일반적입니다.
    // 다만, 에러 이벤트를 외부로 전달하여 로깅 등에 활용합니다.
    this.emit(WebSocketEvents.Error, error);

    // 에러 발생 후 연결이 즉시 닫히지 않는 경우도 있을 수 있으므로,
    // 필요하다면 여기서 연결 상태를 확인하고 재연결을 시도할 수도 있습니다.
    // 하지만 보통 close 이벤트에서 재연결을 처리하는 것이 더 안정적입니다.
  }

  // --- Private Reconnection Logic ---

  /**
   * 재연결 타이머를 설정합니다.
   */
  private scheduleReconnect(): void {
    if (!this.reconnectOptions || this.reconnectTimeoutId || this.state === WebSocketState.Disconnecting) {
      this.isReconnectingAttempt = false; // 재연결 로직 진입 불가 시 리셋
      return; // 재연결 비활성화, 이미 타이머 설정됨, 또는 수동 종료 중이면 실행 안함
    }

    const { retries, delay, increaseDelay } = this.reconnectOptions;

    if (this.reconnectAttempts >= this.reconnectOptions.retries) {
      console.error('[WebSocketClient] Reached max reconnect attempts.');
      this.reconnectAttempts = 0;
      this.isReconnectingAttempt = false; // 최대 시도 도달 시 리셋
      return;
    }

    // 재연결 시도 횟수 증가
    this.reconnectAttempts++;

    // 재연결 딜레이 계산 (증가 옵션 적용)
    const currentDelay = this.reconnectOptions.increaseDelay ? this.reconnectOptions.delay * this.reconnectAttempts : this.reconnectOptions.delay;

    console.log(`[WebSocketClient] Attempting to reconnect (${this.reconnectAttempts}/${this.reconnectOptions.retries}) in ${currentDelay}ms...`);
    this.state = WebSocketState.Reconnecting;
    this.isReconnectingAttempt = true; // **수정:** 재연결 시도 플래그 설정!
    this.emit(WebSocketEvents.Reconnecting, this.reconnectAttempts);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      if (this.state === WebSocketState.Reconnecting) {
        this.connect(); // 여기서 connect 호출 시 isReconnectingAttempt는 true인 상태
      } else {
        // 재연결 상태가 아니라면(예: 중간에 disconnect 호출됨) 플래그 리셋
        this.isReconnectingAttempt = false;
      }
    }, currentDelay);
  }

  /**
   * 재연결 타이머를 제거합니다.
   */
  private clearReconnectTimer(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
      this.isReconnectingAttempt = false;
      console.log('[WebSocketClient] Reconnect timer cleared.');
    }
  }
}