export interface TrafficHeader {
  name: string;
  value: string;
}

export interface TrafficEntry {
  requestId: string;
  tabId: number;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  method: string;
  url: string;
  type: string;
  statusCode?: number;
  statusLine?: string;
  fromCache?: boolean;
  ip?: string;
  requestHeaders?: TrafficHeader[];
  responseHeaders?: TrafficHeader[];
  responseBody?: string;
  responseBodyEncoding?: 'base64';
  responseBodySize?: number;
  responseBodyTruncated?: boolean;
  responseMimeType?: string;
  responseBodyError?: string;
  error?: string;
}

export interface RecorderTabSession {
  tabId: number;
  active: boolean;
  startedAt: number;
  stoppedAt?: number;
  captureToken?: string;
  captureError?: string;
  entries: TrafficEntry[];
}

export interface RecorderState {
  tabs: Record<string, RecorderTabSession>;
}

export interface RecorderResult {
  ok: boolean;
  error?: string;
  state?: RecorderState;
}
