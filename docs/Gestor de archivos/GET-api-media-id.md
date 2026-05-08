# GET `/api/media/{id}` — Construcción técnica

Obtiene el detalle de un activo media por id dentro del tenant actual. Las URLs de recurso (`publicUrl`, `thumbnailUrl`, `previewUrl`) se devuelven en **absolutas** según el host del API.

Incluye **`folderId`** y **`folderName`** con la misma semántica que en `GET /api/media` (`MediaListItemDto`): ubicación en la biblioteca para vistas de detalle o propiedades; `folderId` es `null` en la raíz; si la carpeta está eliminada lógicamente (`IsDeleted`), el nombre se expone como `null` aunque el `folderId` del medio pueda seguir informado en BD hasta otra operación.

---

## 1. Resumen

| Aspecto | Detalle |
|--------|---------|
| Método y ruta | `GET /api/media/{id}` (`{id}` entero positivo, restricción de ruta `{id:int}`) |
| Controlador | `MediaController.GetById` |
| Servicio | `IMediaService.GetByIdAsync` |
| Auth | JWT requerido |
| Autorización | `TenantMember` |
| Contexto tenant | Header `X-Tenant-Id` (vía `TenantContext`); ver errores si falta o no aplica |
| Respuesta | `200` con `ApiResponse<MediaDetailDto>` |

---

## 2. Flujo de capas

1. El controller comprueba que el contexto de tenant esté resuelto y que el usuario tenga `NameIdentifier` válido en el JWT.
2. `MediaService.GetByIdAsync` carga el medio por `mediaId` y `tenantId` (repositorio incluye `Tags` y `Folder`); si no existe en ese tenant, retorna `null`.
3. En **una sola consulta** al servidor (`GetInUseAndPlanUsageCountAsync`) se obtienen `isInUse` (misma regla que antes: targets pendientes del tenant para ese `mediaId`) y el conteo de planes (`PostPlans`) del tenant que referencian el medio; el valor expuesto de `usageCount` sigue siendo `max(usageCount persistido en el medio, conteo derivado)`.
4. El controller normaliza `publicUrl`, `thumbnailUrl` y `previewUrl` a URL absoluta cuando aplica.

---

## 3. Contrato de entrada

- **Path:** `id` — identificador del medio (`mediaId`), entero.
- **Headers:** mismo esquema multi-tenant que el resto de la API (`Authorization: Bearer …`, `X-Tenant-Id` cuando el pipeline lo exige).

---

## 4. Contrato de salida (`200`)

El cuerpo es `MediaDetailDto` bajo `data`. El identificador en JSON es **`mediaId`**, alineado con listados, subida (`MediaUploadResultDto`) y operaciones masivas.

| Campo | Tipo | Notas |
|-------|------|--------|
| `mediaId` | `int` | Clave del medio. |
| `folderId` | `int?` | Carpeta actual; `null` si el medio está en la raíz (sin carpeta). |
| `folderName` | `string?` | Nombre visible de la carpeta si existe y no está eliminada; en caso contrario `null` (misma regla que el listado). |
| `tenantId` | `int` | Tenant propietario. |
| `createdByUserId` | `int` | Usuario que creó el registro. |
| `mimeType` | `string` | Tipo MIME almacenado. |
| `sizeBytes` | `long` | Tamaño en bytes. |
| `publicUrl` | `string?` | URL del recurso principal; absoluta en respuesta. Si en persistencia no hay `publicUrl`, el servicio rellena este campo con la ruta lógica de servicio (equivalente a lo que internamente sería la clave de objeto), **sin** exponer un campo `storageKey` aparte. |
| `thumbnailUrl` | `string?` | Miniatura (p. ej. WebP); absoluta si existe. |
| `previewUrl` | `string?` | Vista previa intermedia; absoluta si existe. |
| `hasThumbnail` | `bool` | `true` solo si hay derivado **real**: `thumbnailUrl` no vacía, **distinta** del original (`publicUrl`/equivalente) y con nombre de fichero alineado al storage (`thumb_{px}.{ext}`). Evita `true` si la URL repitiera el original por error. |
| `hasPreview` | `bool` | Igual criterio para vista previa (`preview_{px}.{ext}`). |
| `processingStatus` | `string` | `pending`, `completed`, `failed` (`MediaProcessingStatuses`). Si en BD viene vacío, se expone como `pending`. |
| `width` / `height` | `int?` | Dimensiones conocidas del recurso, si aplica. |
| `source` | `string` | Origen del medio (p. ej. `upload`). |
| `name` | `string?` | Nombre visible. |
| `status` | `string` | p. ej. `active`, `archived`. |
| `isInUse` | `bool` | Derivado: medio referenciado en planes con targets pendientes del tenant. |
| `usageCount` | `int` | `max(valor persistido en entidad, conteo de PostPlans del tenant con ese mediaId)`. |
| `lastUsedAt` | `string?` (ISO 8601) | Último uso registrado, si existe. |
| `updatedAt` | `string?` (ISO 8601) | Última actualización del registro, si existe. |
| `tags` | `string[]` | Etiquetas asociadas. |
| `createdAt` | `string` (ISO 8601) | Fecha de creación. |

Ejemplo (estructura ilustrativa):

```json
{
  "data": {
    "mediaId": 12002,
    "folderId": 45,
    "folderName": "Campaña Junio",
    "tenantId": 121,
    "createdByUserId": 44,
    "mimeType": "image/jpeg",
    "sizeBytes": 452310,
    "publicUrl": "https://host/uploads/media/121/12002/original.jpg",
    "thumbnailUrl": "https://host/uploads/media/121/12002/thumb_320.webp",
    "previewUrl": "https://host/uploads/media/121/12002/preview_1280.webp",
    "hasThumbnail": true,
    "hasPreview": true,
    "processingStatus": "completed",
    "width": 1920,
    "height": 1080,
    "source": "upload",
    "name": "campana.jpg",
    "status": "active",
    "isInUse": false,
    "usageCount": 0,
    "lastUsedAt": null,
    "updatedAt": "2026-04-22T10:00:00Z",
    "tags": ["promo"],
    "createdAt": "2026-04-21T15:00:00Z"
  }
}
```

---

## 5. Códigos HTTP y errores

- `200`: medio encontrado para el tenant.
- `400`: no se pudo establecer el contexto del tenant (p. ej. falta `X-Tenant-Id`, tenant no resuelto, o contexto marcado como interno no aplicable al endpoint). Cuerpo típico: `{ "message": "No se pudo establecer el contexto del tenant. Envíe el header 'X-Tenant-Id'." }`.
- `401`: JWT ausente/inválido o usuario no identificado (`NameIdentifier`). Cuerpo típico: `{ "message": "Token inválido o usuario no identificado" }`.
- `403`: autenticado pero sin cumplir la política `TenantMember` (membresía u otra regla de autorización), según el pipeline de ASP.NET.
- `404`: medio no existe para ese tenant. Cuerpo típico: `{ "message": "Medio no encontrado." }`.

---

## 6. Reglas de negocio / invariantes

- No expone medios de otro tenant: la búsqueda es siempre `id` acotado por `tenantId` del request.
- `isInUse` es derivado (no es un flag persistido arbitrario del cliente).
- `usageCount` combina persistencia y conteo real de planes del tenant para no quedar por debajo del uso observable.
- **`folderId` / `folderName`:** alineados con el listado; no implican validación extra de movimiento de carpeta en este GET (solo lectura).
- **`hasThumbnail` / `hasPreview`:** misma semántica que en `GET /api/media` (derivado real verificado por path y desigualdad respecto al original); ver tabla en [Contrato de salida](#4-contrato-de-salida-200).
- **Clave interna de almacenamiento** (`StorageKey` en entidad): **no** se serializa en `MediaDetailDto`; el cliente debe basarse en `publicUrl` / `thumbnailUrl` / `previewUrl` (y `mediaId` para referencias), lo que reduce acoplamiento a rutas físicas y facilita cambiar de proveedor de storage.

---

## 7. Referencias en código

- `DataColor.Api/Controllers/MediaController.cs` (`GetById`, normalización `ToAbsoluteUrl`)
- `DataColor.Core/Services/MediaService.cs` (`GetByIdAsync`)
- `DataColor.Core/DTOs/MediaDtos.cs` (`MediaDetailDto`)
- `DataColor.Core/CustomEntities/MediaProcessingStatuses.cs`
- `DataColor.Infrastructure/Repositories/MediaRepository.cs` (`GetByIdAndTenantAsync`, `GetInUseAndPlanUsageCountAsync`, `IsInUseAsync`, `GetUsageCountAsync`)
