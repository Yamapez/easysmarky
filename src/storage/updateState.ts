const KEY = "easysmarky:update";

interface UpdateState {
  v: 1;
  /** 「あとで」した最後のバージョン。このバージョンは再通知しない */
  dismissedVersion: string | null;
  /** 直近のフェッチ試行時刻(成功可否問わず)。通信頻度を抑えるクールダウンに使う */
  lastCheckedAt: number;
}

const DEFAULT_STATE: UpdateState = { v: 1, dismissedVersion: null, lastCheckedAt: 0 };

function loadUpdateState(): UpdateState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<UpdateState>;
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1) return DEFAULT_STATE;
    return {
      v: 1,
      dismissedVersion: parsed.dismissedVersion ?? null,
      lastCheckedAt: parsed.lastCheckedAt ?? 0,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

function saveUpdateState(state: UpdateState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 通知が出なくなる/クールダウンが効かなくなるだけなので無視する
  }
}

export function getDismissedVersion(): string | null {
  return loadUpdateState().dismissedVersion;
}

export function dismissVersion(version: string): void {
  const state = loadUpdateState();
  saveUpdateState({ ...state, dismissedVersion: version });
}

export function getLastCheckedAt(): number {
  return loadUpdateState().lastCheckedAt;
}

export function markChecked(now: number = Date.now()): void {
  const state = loadUpdateState();
  saveUpdateState({ ...state, lastCheckedAt: now });
}
