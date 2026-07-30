/**
 * Platform abstraction: save/load.
 * Web implementation uses localStorage.
 * WeChat port will swap this for wx.setStorage / wx.getStorage
 * WITHOUT touching any game code.
 */
export interface SaveStore {
  load<T>(key: string): T | null;
  save<T>(key: string, value: T): void;
  remove(key: string): void;
}

export class LocalStorageStore implements SaveStore {
  load<T>(key: string): T | null {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  save<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }
}

export const saveStore: SaveStore = new LocalStorageStore();
