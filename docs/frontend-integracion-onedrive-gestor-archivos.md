# Guía frontend: integración OneDrive (Gestor de archivos)

Documento para el equipo frontend. Contrato API, File Picker v8, preview/import y reglas de seguridad.

**Estado:** TO-BE (no implementado).  
**Documento backend relacionado:** [`docs/Documentos requerimientos/onedrive-implementacion-gestor-archivos.md`](Documentos%20requerimientos/onedrive-implementacion-gestor-archivos.md)  
**Referencia AS-IS:** flujo Google Drive en `GooglePickerService` / `gestor-archivos` — ver [`docs/frontend-integracion-google-drive-oauth.md`](frontend-integracion-google-drive-oauth.md).

**Prerrequisito:** Fase 0 backend (refactor por proveedor) completada antes de cablear OneDrive en producción.

---

## 1. Objetivo funcional

- Conectar OneDrive desde el gestor de archivos (OAuth **backend-first**).
- Abrir **OneDrive File Picker v8** (iframe/popup + `postMessage`).
- Mostrar preview/miniatura del archivo seleccionado antes de importar.
- Importar imágenes (`image/*`) y `video/mp4` a la biblioteca interna del tenant.

El frontend **no** intercambia `code` por tokens, **no** llama a Microsoft Graph directamente y **no** persiste tokens OAuth en el navegador.

---

## 2. Endpoints backend que consume el frontend

`provider = onedrive`. Headers en todos los endpoints autenticados:

- `Authorization: Bearer <jwt>`
- `X-Tenant-Id: <tenantIdActivo>`

| Acción | Endpoint | Notas |
|--------|----------|-------|
| Estado de conexión | `GET /api/integrations/onedrive/status` | Antes de mostrar UI de importación |
| Iniciar OAuth | `GET /api/integrations/onedrive/oauth/start` | Devuelve `authorizationUrl`; redirect del usuario |
| Callback OAuth | `GET /api/integrations/onedrive/oauth/callback` | **Solo backend**; el front recibe redirect a `/dashboard/archivos?oneDriveConnected=*` |
| Token para picker | `GET /api/integrations/onedrive/picker-token?resource={url}` | Opcional `resource` / `audience`; ver sección 5 |
| Preview archivos | `POST /api/integrations/onedrive/files/preview/batch` | Body `{ files: [{ fileId, driveId? }] }`; 1 o N archivos |
| Miniatura proxy | `GET /api/integrations/onedrive/files/{fileId}/thumbnail?driveId=` | Fetch autenticado + blob; ver sección 8 |
| Importar uno | `POST /api/integrations/onedrive/import` | Body con `fileId`, `driveId?`, `name?`, `tags?` |
| Importar batch | `POST /api/integrations/onedrive/import/batch` | Hasta 50 ítems |
| Desconectar | `POST /api/integrations/onedrive/disconnect` | |

---

## 3. Principios de arquitectura (obligatorios)

| Principio | Detalle |
|-----------|---------|
| Backend-first OAuth | El front solo redirige a `authorizationUrl`; el callback y el intercambio de tokens ocurren en servidor |
| Sin Graph en el cliente | No llamar `graph.microsoft.com` desde el SPA (import, preview, thumbnails) |
| Tokens picker en memoria | No `localStorage`, no `sessionStorage`, no cookies con tokens Microsoft |
| Tokens por recurso | File Picker v8 pide tokens por audiencia (Graph, SharePoint baseUrl); pedir `picker-token?resource=...` por comando |
| No estilo Google Picker | No usar `gapi.load('picker')`; usar iframe/popup Microsoft + `postMessage` |

---

## 4. Flujo UX completo

```mermaid
sequenceDiagram
  participant U as Usuario
  participant FE as Frontend
  participant API as Backend
  participant P as OneDrive File Picker
  participant G as Microsoft Graph

  U->>FE: Importar desde OneDrive
  FE->>API: GET /status
  alt no conectado
    FE->>API: GET /oauth/start → redirect Microsoft
    API-->>FE: vuelve con oneDriveConnected=1
    FE->>API: GET /status
  end
  FE->>P: Abrir File Picker (iframe/popup SharePoint URL)
  loop Comandos de autenticación (postMessage)
    P-->>FE: solicita token para resource/baseUrl
    FE->>API: GET /picker-token?resource=...
    API-->>FE: oauthToken para ese recurso (memoria)
    FE-->>P: responde comando con token
  end
  P-->>FE: fileId, driveId?, name, mimeType (1 o N)
  FE->>API: POST /files/preview/batch { files: [...] }
  API->>G: metadata + thumbnail (server-side)
  API-->>FE: results[] con thumbnailUrl interna (/thumbnail)
  FE->>API: GET /files/{fileId}/thumbnail (fetch + Bearer)
  API-->>FE: bytes imagen → Blob/objectURL
  U->>FE: Importar a biblioteca
  FE->>API: POST /import { fileId, driveId, name, tags }
  API-->>FE: mediaId, publicUrl
  FE->>FE: Descartar tokens de memoria; revocar objectURL
```

---

## 5. OAuth: conectar cuenta

### 5.1 Flujo

1. `GET /api/integrations/onedrive/status` → si `connected=false`, mostrar «Conectar OneDrive».
2. `GET /api/integrations/onedrive/oauth/start` → redirect a `data.authorizationUrl`.
3. Tras consentimiento, el backend redirige al frontend (no intervención del SPA en callback).

### 5.2 Query params post-OAuth

Detectar en `/dashboard/archivos` (o ruta configurada):

| Param | Significado |
|-------|-------------|
| `oneDriveConnected=1` | Éxito |
| `oneDriveConnected=0` | Error |
| `oneDriveError=<code>` | Detalle opcional |

**Acciones:**

1. Toast éxito/error.
2. Limpiar query params de la URL.
3. `GET /status` de nuevo.
4. Habilitar importación solo si `connected=true`.

---

## 6. OneDrive File Picker v8

### 6.1 Qué es (y qué no es)

Microsoft documenta [File Picker v8](https://learn.microsoft.com/en-us/onedrive/developer-controls/file-picker/) como un **control hospedado por Microsoft**, embebible mediante **iframe o popup** (p. ej. `https://{tenant}-my.sharepoint.com/_layouts/15/FilePicker.aspx`), que se comunica con la app mediante **`postMessage`** y message ports.

**No es** un SDK JS clásico estilo `gapi.load('picker')`.

### 6.2 Configuración necesaria en frontend

| Dato | Origen |
|------|--------|
| `clientId` | Application (client) ID de Azure — env/build (público) |
| Tokens OAuth | Siempre vía `GET .../picker-token` del backend |
| Permisos Entra | Graph `Files.Read` + SharePoint `MyFiles.Read` si el picker lo exige (validar en pruebas) |

### 6.3 Audiencia del token (crítico)

**No asumir** que un token Graph sirve para todos los comandos del picker.

El picker envía **comandos de autenticación** pidiendo tokens para el recurso que necesite (Graph, SharePoint/OneDrive baseUrl, etc.). El host (frontend) debe:

1. Escuchar `postMessage`.
2. Por cada comando de auth, llamar al backend con el `resource` indicado.
3. Responder al picker con el token recibido.

### 6.4 Endpoint `picker-token` desde el frontend

```
GET /api/integrations/onedrive/picker-token?resource=https://contoso-my.sharepoint.com
```

| Query | Descripción |
|-------|-------------|
| `resource` | URL/baseUrl que pide el picker (opcional) |
| `audience` | Alias de `resource` (usar uno u otro) |

Sin query → token para Graph (`https://graph.microsoft.com`).

**Respuesta:**

```json
{
  "data": {
    "provider": "onedrive",
    "resource": "https://contoso-my.sharepoint.com",
    "oauthToken": "<access_token_para_ese_recurso>",
    "apiKey": null
  }
}
```

### 6.5 Reglas de seguridad del token

| Regla | Detalle |
|-------|---------|
| No persistir | No guardar `oauthToken` en `localStorage` ni `sessionStorage` |
| Solo en memoria | Map `resource → token` durante la sesión del picker |
| Just-in-time | Pedir token **por cada recurso** en comandos de auth |
| Renovación | Si falla por expiración, pedir de nuevo con el mismo `resource` y reintentar una vez |
| Descarte | Al cerrar picker, vaciar el Map de tokens |

### 6.6 Ejemplo conceptual (`OneDrivePickerService`)

```typescript
type PickedOneDriveFile = {
  id: string;
  driveId?: string;
  name?: string;
  mimeType?: string;
};

async function getPickerTokenForResource(resource: string): Promise<string> {
  const res = await fetch(
    `/api/integrations/onedrive/picker-token?resource=${encodeURIComponent(resource)}`,
    { headers: { Authorization: `Bearer ${jwt}`, 'X-Tenant-Id': tenantId } }
  );
  const { data } = await res.json();
  return data.oauthToken; // solo memoria; no persistir
}

async function openOneDrivePicker(clientId: string): Promise<PickedOneDriveFile | null> {
  // 1. Embeber iframe/popup (FilePicker.aspx o URL documentada por Microsoft)
  // 2. onMessage: si comando auth → getPickerTokenForResource(payload.resource) → responder
  // 3. onMessage: si selección → { id, driveId, name, mimeType }
}
```

Servicio sugerido: `OneDrivePickerService`, análogo a `GooglePickerService`.

---

## 7. Preview e importación

### 7.1 Tras seleccionar archivo en el picker

Propagar al backend:

| Campo | Origen | Obligatorio |
|-------|--------|-------------|
| `fileId` | `driveItem.id` del picker | Sí |
| `driveId` | `parentReference.driveId` si aplica | No (SharePoint / drives compartidos) |
| `name` | Nombre en picker | No |
| `tags` | UI del modal | No |

### 7.2 Preview (batch)

```
POST /api/integrations/onedrive/files/preview/batch
```

**Body:**

```json
{
  "files": [
    { "fileId": "01ABCDEF...", "driveId": "b!xxxx" },
    { "fileId": "01GHIJKL...", "driveId": "b!yyyy" }
  ]
}
```

**Respuesta relevante para UI:**

```json
{
  "data": {
    "totalRequested": 1,
    "processed": 1,
    "failed": 0,
    "results": [
      {
        "fileId": "01ABCDEF...",
        "driveId": "b!xxxx",
        "ok": true,
        "data": {
          "fileId": "01ABCDEF...",
          "driveId": "b!xxxx",
          "name": "banner.jpg",
          "mimeType": "image/jpeg",
          "sizeBytes": 245000,
          "modifiedTime": "2026-06-10T14:00:00Z",
          "thumbnailUrl": "/api/integrations/onedrive/files/01ABCDEF/thumbnail?driveId=b!xxxx",
          "iconUrl": null
        }
      }
    ]
  }
}
```

- Un solo archivo seleccionado usa el **mismo endpoint** con `files` de longitud 1.
- `thumbnailUrl` es **ruta interna** al proxy backend, nunca URL de Graph.
- Si `ok: false` o `thumbnailUrl` es `null`, fallback visual por `mimeType`.

### 7.3 Importar

```json
POST /api/integrations/onedrive/import
{
  "fileId": "01ABCDEF...",
  "driveId": "b!xxxx",
  "name": "banner-campana.jpg",
  "tags": ["onedrive", "campana"]
}
```

**Errores habituales:**

| HTTP | `code` | UI sugerida |
|------|--------|-------------|
| `412` | `INTEGRATION_NOT_CONNECTED` | Pedir reconectar OneDrive |
| `404` | `ONEDRIVE_FILE_NOT_FOUND` | Archivo no encontrado |
| `403` | `MEDIA_QUOTA_EXCEEDED` | Cuota de almacenamiento |
| `415` | `MEDIA_INVALID_TYPE` | Tipo no permitido |
| `413` | `MEDIA_TOO_LARGE` | Archivo demasiado grande |

---

## 8. Miniatura: fetch + Blob (no `<img src>` directo)

El endpoint `/thumbnail` exige JWT. Un `<img src="...">` **no** envía `Authorization: Bearer`.

**Decisión recomendada (SPA con JWT Bearer):**

```typescript
async function loadThumbnailBlobUrl(thumbnailUrl: string): Promise<string> {
  const response = await fetch(thumbnailUrl, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Tenant-Id': tenantId },
  });
  if (!response.ok) throw new Error('thumbnail_failed');
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// Al destruir componente o cerrar modal:
// URL.revokeObjectURL(objectUrl);
```

| Alternativa | Cuándo |
|-------------|--------|
| URL firmada temporal en `preview.thumbnailUrl` | Si backend implementa HMAC/TTL; entonces sí `<img src>` |
| Cookie HttpOnly | Solo si la API comparte cookie de sesión con el SPA |

**Reglas tarjeta «Archivo seleccionado»:**

- Llamar `POST .../preview/batch` tras selección (incluir `driveId` en cada ítem si existe).
- Cargar miniatura con fetch + blob/objectURL (OneDrive).
- **Nunca** URL directa de Graph.
- Placeholder «OD» si no hay preview ni icono por tipo.
- Revocar `objectURL` al cerrar modal.

Ver también: [`google-drive-preview-miniatura-backend.md`](Documentos%20requerimientos/google-drive-preview-miniatura-backend.md) (misma UX de confirmación visual).

---

## 9. Servicio API (`ComposerMediaService`)

Métodos genéricos con `provider: 'onedrive'`:

```typescript
getIntegrationStatus('onedrive')
startIntegrationOAuth('onedrive')          // redirect authorizationUrl
getIntegrationPickerToken('onedrive', resource?)  // JIT; no persistir
getIntegrationFilePreviewBatch('onedrive', { files: [{ fileId, driveId? }] })
getIntegrationFileThumbnail('onedrive', fileId, driveId?)  // fetch + blob
importFromIntegration('onedrive', { fileId, driveId, name, tags })
disconnectIntegration('onedrive')
```

---

## 10. Estados de UI sugeridos

| Estado | Cuándo |
|--------|--------|
| `disconnected` | `GET /status` → `connected=false` |
| `connecting` | Redirect OAuth en curso |
| `connected` | Listo para abrir picker |
| `picker_open` | iframe/popup activo; tokens en memoria |
| `previewing` | Cargando preview/thumbnail |
| `importing` | `POST /import` en curso |
| `error` | Fallo OAuth, picker, preview o import |

**Mensajes sugeridos:**

- «Conectando con OneDrive…»
- «OneDrive conectado correctamente.»
- «No se pudo conectar OneDrive.»
- «Archivo importado correctamente.»

---

## 11. Diferencias vs Google Drive (frontend)

| Tema | Google Drive | OneDrive |
|------|--------------|----------|
| Picker | `gapi.load('picker')` + `apiKey` + `oauthToken` | File Picker v8: iframe/popup + `postMessage` |
| Token picker | Un token al abrir | Tokens **por recurso** (`picker-token?resource=`) |
| Preview thumbnail | `POST .../preview/batch` + URL/icono en respuesta | Batch preview + proxy `/thumbnail` + fetch+blob |
| IDs | `fileId` | `fileId` + `driveId` opcional |
| Query OAuth éxito | `googleDriveConnected=1` | `oneDriveConnected=1` |
| Permisos | Google Cloud scopes | Validar Graph + SharePoint `MyFiles.Read` en Entra |

---

## 12. Plan de implementación frontend

> Depende de Fases 1–3 backend (OAuth, import, preview/thumbnail proxy).

### Fase F1 — Conexión OAuth (P1)

- [ ] Detectar `oneDriveConnected=*` en ruta del gestor.
- [ ] Botón conectar + `GET /oauth/start` + refresh `GET /status`.
- [ ] Botón desconectar + `POST /disconnect`.

### Fase F2 — File Picker v8 (P1)

- [ ] `OneDrivePickerService`: iframe/popup + handler `postMessage`.
- [ ] Loop comandos auth → `picker-token?resource=...`.
- [ ] Tokens solo en memoria; descarte al cerrar.
- [ ] Gate: picker funciona con permisos Entra (Graph + `MyFiles.Read` si aplica).

### Fase F3 — Modal importación (P1)

- [ ] Modal «Importar desde OneDrive» en `gestor-archivos`.
- [ ] Preview + thumbnail (fetch+blob).
- [ ] Tarjeta «Archivo seleccionado» con fallback por `mimeType`.
- [ ] `POST /import` con `fileId` + `driveId` opcional.
- [ ] Toast éxito/error; refrescar grid de biblioteca.

---

## 13. Criterios de aceptación (frontend)

- [ ] OAuth backend-first: sin tokens Microsoft en `localStorage` / `sessionStorage`.
- [ ] File Picker v8 vía iframe/popup + `postMessage` (no `gapi.load`).
- [ ] Comandos de auth del picker resueltos con `picker-token?resource=...`.
- [ ] Preview antes de importar; miniatura vía fetch+blob (o URL firmada).
- [ ] Network del SPA sin llamadas a `graph.microsoft.com`.
- [ ] `driveId` propagado a preview e import cuando el picker lo devuelve.
- [ ] `objectURL` revocado al cerrar modal; tokens picker descartados al cerrar picker.
- [ ] Errores HTTP muestran mensaje según `code` cuando exista.

---

## 14. Checklist QA

- [ ] `GET /status` → `connected=false` antes de conectar.
- [ ] Flujo OAuth termina en redirect backend → `oneDriveConnected=1`.
- [ ] Picker abre y responde comandos de auth sin error 403 de permisos.
- [ ] Selección devuelve `fileId`; preview muestra nombre y miniatura o fallback.
- [ ] Import exitoso → nuevo ítem en grid con `source=onedrive`.
- [ ] Desconectar → `GET /status` → `connected=false`.
- [ ] No hay tokens Microsoft en Application → Local Storage.

---

## 15. Referencias

### Documentación interna

- [OneDrive — plan backend](Documentos%20requerimientos/onedrive-implementacion-gestor-archivos.md)
- [Google Drive — guía frontend](frontend-integracion-google-drive-oauth.md)
- [Google Drive — preview backend](Documentos%20requerimientos/google-drive-preview-miniatura-backend.md)

### Microsoft

- [OneDrive File Picker v8](https://learn.microsoft.com/en-us/onedrive/developer-controls/file-picker/)
- [Microsoft Graph — driveItem](https://learn.microsoft.com/en-us/graph/api/resources/driveitem)

### Código frontend (orientativo)

- `src/app/features/media/services/google-picker.service.ts` — patrón a espejar
- `src/app/features/media/components/gestor-archivos/` — modal e importación
- `ComposerMediaService` — métodos genéricos `{provider}`
