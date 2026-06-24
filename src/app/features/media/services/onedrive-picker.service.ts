import { Injectable } from '@angular/core';

export interface PickedOneDriveFile {
  fileId: string;
  driveId?: string;
  name?: string;
  mimeType?: string;
}

interface OneDrivePickerOptions {
  sdk: string;
  entry: { oneDrive: Record<string, never> };
  authentication: Record<string, never>;
  messaging: {
    origin: string;
    channelId: string;
  };
  /** Por defecto el picker v8 es single; alineado con Google Picker (máx. 50). */
  selection: {
    mode: 'multiple';
    maximumCount: number;
    enablePersistence: boolean;
  };
  typesAndSources: {
    mode: 'files';
  };
}

interface PickerAuthenticateCommand {
  command: 'authenticate';
  resource?: string;
  type?: string;
  data?: { resource?: string };
}

interface PickerPickCommand {
  command: 'pick';
  items?: PickerItem[];
}

interface PickerCloseCommand {
  command: 'close';
}

type PickerCommand = PickerAuthenticateCommand | PickerPickCommand | PickerCloseCommand;

interface PickerItem {
  id?: string;
  name?: string;
  parentReference?: { driveId?: string };
  file?: { mimeType?: string };
  mimeType?: string;
}

const MAX_PICKER_FILES = 50;

@Injectable({ providedIn: 'root' })
export class OneDrivePickerService {
  private tokenCache = new Map<string, string>();

  openPicker(params: {
    baseUrl: string;
    initialToken: string;
    getToken: (resource: string) => Promise<string>;
    origin?: string;
  }): Promise<PickedOneDriveFile[] | null> {
    this.tokenCache.clear();
    const baseUrl = params.baseUrl.replace(/\/+$/, '');
    const origin = params.origin?.trim() || window.location.origin;
    const channelId = this.createChannelId();
    const options: OneDrivePickerOptions = {
      sdk: '8.0',
      entry: { oneDrive: {} },
      authentication: {},
      messaging: { origin, channelId },
      selection: {
        mode: 'multiple',
        maximumCount: MAX_PICKER_FILES,
        enablePersistence: true
      },
      typesAndSources: {
        mode: 'files'
      }
    };

    return new Promise<PickedOneDriveFile[] | null>((resolve, reject) => {
      const popup = window.open('', 'OneDrivePicker', 'width=1080,height=680');
      if (!popup) {
        reject(new Error('No se pudo abrir la ventana del selector de OneDrive.'));
        return;
      }

      let port: MessagePort | null = null;
      let settled = false;
      const pickedFiles: PickedOneDriveFile[] = [];

      const finish = (result: PickedOneDriveFile[] | null): void => {
        if (settled) return;
        settled = true;
        this.cleanup(popup, onWindowMessage);
        resolve(result);
      };

      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        this.cleanup(popup, onWindowMessage);
        reject(error instanceof Error ? error : new Error('No se pudo abrir OneDrive File Picker.'));
      };

      const onWindowMessage = (event: MessageEvent): void => {
        if (event.source !== popup) return;
        const message = event.data;
        if (message?.type !== 'initialize' || message?.channelId !== channelId) return;
        port = event.ports?.[0] ?? null;
        if (!port) {
          fail(new Error('No se estableció el canal de mensajes con OneDrive File Picker.'));
          return;
        }

        port.addEventListener('message', (portEvent) => {
          void this.handlePortMessage(portEvent, port!, params.getToken, pickedFiles, finish, fail);
        });
        port.start();
        port.postMessage({ type: 'activate' });
      };

      window.addEventListener('message', onWindowMessage);

      try {
        const queryString = new URLSearchParams({
          filePicker: JSON.stringify(options),
          locale: 'es-es'
        });
        const url = `${baseUrl}/_layouts/15/FilePicker.aspx?${queryString}`;
        const form = popup.document.createElement('form');
        form.setAttribute('action', url);
        form.setAttribute('method', 'POST');

        const tokenInput = popup.document.createElement('input');
        tokenInput.setAttribute('type', 'hidden');
        tokenInput.setAttribute('name', 'access_token');
        tokenInput.setAttribute('value', params.initialToken.trim());
        form.appendChild(tokenInput);

        popup.document.body.appendChild(form);
        form.submit();
      } catch (error) {
        fail(error);
      }
    });
  }

  static dedupeAndCap(
    files: PickedOneDriveFile[],
    max = MAX_PICKER_FILES
  ): { files: PickedOneDriveFile[]; truncated: boolean } {
    const seen = new Set<string>();
    const deduped: PickedOneDriveFile[] = [];
    for (const file of files) {
      const fileId = file.fileId?.trim();
      if (!fileId) continue;
      const key = `${file.driveId ?? ''}:${fileId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({ ...file, fileId });
    }
    if (deduped.length <= max) {
      return { files: deduped, truncated: false };
    }
    return { files: deduped.slice(0, max), truncated: true };
  }

  private async handlePortMessage(
    portEvent: MessageEvent,
    port: MessagePort,
    getToken: (resource: string) => Promise<string>,
    pickedFiles: PickedOneDriveFile[],
    finish: (result: PickedOneDriveFile[] | null) => void,
    fail: (error: unknown) => void
  ): Promise<void> {
    const payload = portEvent.data;
    if (!payload || typeof payload !== 'object') return;

    if (payload.type === 'notification') {
      return;
    }

    if (payload.type !== 'command') return;

    port.postMessage({
      type: 'acknowledge',
      id: payload.id
    });

    const command = payload.data as PickerCommand;
    if (!command?.command) return;

    switch (command.command) {
      case 'authenticate': {
        const authCommand = command as PickerAuthenticateCommand;
        const resource = String(authCommand.resource ?? authCommand.data?.resource ?? '').trim();
        if (!resource) {
          port.postMessage({
            type: 'result',
            id: payload.id,
            data: {
              result: 'error',
              error: { code: 'missingResource', message: 'Recurso de autenticación no indicado.' }
            }
          });
          return;
        }
        try {
          const token = await this.getTokenForResource(resource, getToken);
          if (!token) {
            throw new Error('No se obtuvo token para el recurso solicitado.');
          }
          port.postMessage({
            type: 'result',
            id: payload.id,
            data: { result: 'token', token }
          });
        } catch (error) {
          try {
            const retryToken = await this.getTokenForResource(resource, getToken, true);
            if (retryToken) {
              port.postMessage({
                type: 'result',
                id: payload.id,
                data: { result: 'token', token: retryToken }
              });
              return;
            }
          } catch {
            // fall through to error response
          }
          port.postMessage({
            type: 'result',
            id: payload.id,
            data: {
              result: 'error',
              error: {
                code: 'unableToObtainToken',
                message: error instanceof Error ? error.message : 'No se pudo obtener token.'
              }
            }
          });
        }
        break;
      }

      case 'pick': {
        const pickCommand = command as PickerPickCommand & {
          data?: PickerItem[] | { items?: PickerItem[] };
        };
        let items: PickerItem[] = [];
        if (Array.isArray(pickCommand.items)) {
          items = pickCommand.items;
        } else if (Array.isArray(pickCommand.data)) {
          items = pickCommand.data;
        } else if (Array.isArray(pickCommand.data?.items)) {
          items = pickCommand.data.items;
        }
        for (const item of items) {
          const mapped = this.mapPickerItem(item);
          if (mapped) pickedFiles.push(mapped);
        }
        port.postMessage({
          type: 'result',
          id: payload.id,
          data: { result: 'success' }
        });
        finish(pickedFiles.length ? pickedFiles : null);
        break;
      }

      case 'close': {
        port.postMessage({
          type: 'result',
          id: payload.id,
          data: { result: 'success' }
        });
        finish(pickedFiles.length ? pickedFiles : null);
        break;
      }

      default: {
        const unsupported = String((command as { command?: string }).command ?? 'unknown');
        port.postMessage({
          type: 'result',
          id: payload.id,
          data: {
            result: 'error',
            error: { code: 'unsupportedCommand', message: unsupported }
          }
        });
        break;
      }
    }
  }

  private mapPickerItem(item: PickerItem): PickedOneDriveFile | null {
    const fileId = String(item.id ?? '').trim();
    if (!fileId) return null;
    const driveId = item.parentReference?.driveId?.trim() || undefined;
    const mimeType = item.file?.mimeType?.trim() || item.mimeType?.trim() || undefined;
    const name = item.name?.trim() || undefined;
    return { fileId, driveId, name, mimeType };
  }

  private async getTokenForResource(
    resource: string,
    getToken: (resource: string) => Promise<string>,
    forceRefresh = false
  ): Promise<string> {
    if (!forceRefresh) {
      const cached = this.tokenCache.get(resource);
      if (cached) return cached;
    } else {
      this.tokenCache.delete(resource);
    }
    const token = (await getToken(resource))?.trim();
    if (token) {
      this.tokenCache.set(resource, token);
    }
    return token;
  }

  private cleanup(popup: Window | null, onWindowMessage: (event: MessageEvent) => void): void {
    window.removeEventListener('message', onWindowMessage);
    this.tokenCache.clear();
    if (popup && !popup.closed) {
      popup.close();
    }
  }

  private createChannelId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `picker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
