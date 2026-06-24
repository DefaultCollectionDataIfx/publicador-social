# POST `/api/media/upload` — Construcción técnica (contrato maduro)

Sube uno o varios archivos locales (`multipart/form-data`) a la biblioteca del tenant, persiste los originales y publica estado de derivados (`processingStatus`) con semántica madura de URLs.

---

## 1. Resumen

| Aspecto | Detalle |
|--------|---------|
| Método y ruta | `POST /api/media/upload` |
| Controlador | `MediaController.Upload` |
| Servicio | `IMediaService.UploadAsync` (`MediaService`) |
| Auth | JWT requerido |
| Autorización | `TenantMember` |
| Content-Type | `multipart/form-data` |
| Campo requerido | `files` (uno o varios, mismo nombre repetido) |
| Respuesta | `200` con `ApiResponse<MediaUploadBatchResultDto>` |

---

## 2. Flujo de capas

1. Controller valida tenant (`TenantContext`) y usuario (`NameIdentifier`).
2. `MediaService` valida cuota y persiste registro inicial de `ComposerMedia` por cada archivo.
3. Se guarda cada original en storage con ruta estable por `tenantId/mediaId`.
4. Se dispara generación de derivados:
   - síncrona para imágenes pequeñas.
   - asíncrona (job) para videos, PDF y archivos grandes.
5. Se responde con resultado parcial por archivo (`totalRequested`, `processed`, `failed`, `results[]`).

---

## 3. Contrato de entrada

Body `multipart/form-data`:

- `files` (`IFormFile`) — uno o varios; repetir el mismo nombre de campo por archivo.

Ejemplo frontend:

```typescript
const formData = new FormData();
for (const file of files) {
  formData.append('files', file, file.name);
}
```

---

## 4. Contrato de salida (`200`)

Siempre devuelve resultado batch (incluso con un solo archivo):

```json
{
  "data": {
    "totalRequested": 1,
    "processed": 1,
    "failed": 0,
    "results": [
      {
        "fileName": "foto.jpg",
        "ok": true,
        "data": {
          "mediaId": 123,
          "publicUrl": "https://host/uploads/media/121/123/original.jpg",
          "thumbnailUrl": "https://host/uploads/media/121/123/thumb_320.webp",
          "previewUrl": "https://host/uploads/media/121/123/preview_1280.webp",
          "hasThumbnail": true,
          "hasPreview": true,
          "processingStatus": "completed",
          "mimeType": "image/jpeg",
          "width": 1920,
          "height": 1080
        }
      }
    ]
  }
}
```

### Ítem con error parcial

```json
{
  "fileName": "video.zip",
  "ok": false,
  "status": 415,
  "code": "MEDIA_INVALID_TYPE",
  "message": "Tipo de archivo no permitido."
}
```

Notas:

- `publicUrl` siempre apunta al original.
- `thumbnailUrl`/`previewUrl` son derivados reales o `null` (nunca fallback al original).
- `width`/`height` representan dimensiones del original.
- Si un ítem falla, los demás pueden procesarse igual (`processed` + `failed`).

---

## 5. Comportamiento temporal async

Cuando el derivado se procesa en job asíncrono, el ítem exitoso puede incluir:

```json
{
  "fileName": "clip.mp4",
  "ok": true,
  "data": {
    "mediaId": 124,
    "publicUrl": "https://host/uploads/media/121/124/original.mp4",
    "thumbnailUrl": null,
    "previewUrl": null,
    "hasThumbnail": false,
    "hasPreview": false,
    "processingStatus": "pending",
    "mimeType": "video/mp4",
    "width": null,
    "height": null
  }
}
```

Estados posibles de `processingStatus`:

- `pending`
- `completed`
- `failed`

---

## 6. Códigos HTTP y errores

- `200`: request procesado (puede incluir fallos parciales por ítem en `results[]`).
- `400`: request inválido (sin archivos, extensión engañosa, etc.).
- `401`: token inválido o ausente.
- `403`: sin acceso tenant o cuota excedida (`MEDIA_QUOTA_EXCEEDED`).
- `413`: tamaño excedido (`MEDIA_TOO_LARGE`).
- `415`: MIME/tipo no permitido (`MEDIA_INVALID_TYPE`).

Formato de error de negocio (request completo o por ítem):

```json
{ "message": "texto", "code": "MEDIA_INVALID_TYPE" }
```

---

## 7. Reglas de negocio / invariantes

- Siempre se valida cuota en backend.
- Se valida MIME real por contenido (no solo por extensión o header).
- Puede rechazarse extensión engañosa (`Media.RejectMismatchedExtension`).
- Upload/import operan con streaming para evitar cargas completas en memoria.
- Consistencia storage/DB: ante error en persistencia se compensa borrando archivo físico.

---

## 8. Frontend

- `ComposerMediaService.uploadMedia(files: File | File[])` → `POST /api/media/upload`
- Campo multipart: `files` (repetido)
- Respuesta: `MediaUploadBatchResultDto`
- Gestor de archivos: input `multiple`; toasts según `processed` / `failed`

---

## 9. Referencias en código

- `DataColor.Api/Controllers/MediaController.cs`
- `DataColor.Core/Services/MediaService.cs`
- `DataColor.Core/Services/MediaDerivativeService.cs`
- `DataColor.Core/Interfaces/IFileStorageService.cs`
- `DataColor.Core/DTOs/MediaDtos.cs`
- Frontend: `src/app/features/scheduler/services/composer-media.service.ts`
- Frontend: `src/app/features/media/components/gestor-archivos/gestor-archivos.component.ts`
