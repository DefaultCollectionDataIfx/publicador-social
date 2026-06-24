import { Injectable } from '@angular/core';

declare global {
  interface Window {
    gapi?: {
      load: (
        module: string,
        options: { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }
      ) => void;
    };
    google?: {
      picker?: {
        Action: { PICKED: string; CANCEL: string };
        Feature: { MULTISELECT_ENABLED: string };
        DocsView: new () => { setIncludeFolders: (v: boolean) => unknown; setSelectFolderEnabled: (v: boolean) => unknown };
        PickerBuilder: new () => {
          setDeveloperKey: (key: string) => unknown;
          setOAuthToken: (token: string) => unknown;
          setAppId: (appId: string) => unknown;
          addView: (view: unknown) => unknown;
          enableFeature: (feature: string) => unknown;
          setCallback: (cb: (data: unknown) => void) => unknown;
          build: () => { setVisible: (visible: boolean) => void };
        };
      };
    };
  }
}

export interface PickedGoogleFile {
  fileId: string;
  name?: string;
  mimeType?: string;
}

const MAX_PICKER_FILES = 50;

@Injectable({ providedIn: 'root' })
export class GooglePickerService {
  private scriptReadyPromise: Promise<void> | null = null;
  private pickerModuleReadyPromise: Promise<void> | null = null;

  ensureReady(): Promise<void> {
    if (!this.scriptReadyPromise) {
      this.scriptReadyPromise = this.loadScript();
    }
    return this.scriptReadyPromise.then(() => this.loadPickerModule());
  }

  openPicker(params: {
    apiKey: string;
    oauthToken: string;
    appId?: string;
  }): Promise<PickedGoogleFile[] | null> {
    return this.ensureReady().then(
      () =>
        new Promise<PickedGoogleFile[] | null>((resolve) => {
          const pickerNs = window.google?.picker;
          if (!pickerNs) {
            resolve(null);
            return;
          }
          const DocsViewCtor = pickerNs.DocsView as any;
          const PickerBuilderCtor = pickerNs.PickerBuilder as any;
          const view = new DocsViewCtor().setIncludeFolders(true).setSelectFolderEnabled(false);
          let builder: any = new PickerBuilderCtor()
            .setDeveloperKey(params.apiKey)
            .setOAuthToken(params.oauthToken)
            .addView(view)
            .enableFeature(pickerNs.Feature.MULTISELECT_ENABLED)
            .setCallback((data: any) => {
              const action = data?.action;
              const docs = Array.isArray(data?.docs) ? data.docs : [];
              if (action === pickerNs.Action.PICKED || docs.length > 0) {
                const files = docs
                  .map((doc: any) => ({
                    fileId: String(doc?.id ?? '').trim(),
                    name: typeof doc?.name === 'string' ? doc.name : undefined,
                    mimeType: typeof doc?.mimeType === 'string' ? doc.mimeType : undefined
                  }))
                  .filter((file: PickedGoogleFile) => Boolean(file.fileId));
                resolve(files.length ? files : null);
                return;
              }
              if (data?.action === pickerNs.Action.CANCEL) {
                resolve(null);
              }
            });
          if (params.appId) {
            builder = builder.setAppId(params.appId);
          }
          const picker = builder.build();
          picker.setVisible(true);
        })
    );
  }

  static dedupeAndCap(files: PickedGoogleFile[], max = MAX_PICKER_FILES): { files: PickedGoogleFile[]; truncated: boolean } {
    const seen = new Set<string>();
    const deduped: PickedGoogleFile[] = [];
    for (const file of files) {
      const fileId = file.fileId?.trim();
      if (!fileId || seen.has(fileId)) continue;
      seen.add(fileId);
      deduped.push({ ...file, fileId });
    }
    if (deduped.length <= max) {
      return { files: deduped, truncated: false };
    }
    return { files: deduped.slice(0, max), truncated: true };
  }

  private loadScript(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (window.gapi) {
        resolve();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>('script[data-google-api-script="true"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('No se pudo cargar gapi script')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.defer = true;
      script.dataset['googleApiScript'] = 'true';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('No se pudo cargar gapi script'));
      document.head.appendChild(script);
    });
  }

  private loadPickerModule(): Promise<void> {
    if (this.pickerModuleReadyPromise) return this.pickerModuleReadyPromise;
    this.pickerModuleReadyPromise = new Promise<void>((resolve, reject) => {
      if (window.google?.picker) {
        resolve();
        return;
      }
      if (!window.gapi) {
        reject(new Error('gapi no está cargado'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => resolve(),
        onerror: () => reject(new Error('No se pudo cargar módulo picker')),
        timeout: 8000,
        ontimeout: () => reject(new Error('Timeout cargando módulo picker'))
      });
    });
    return this.pickerModuleReadyPromise;
  }
}
