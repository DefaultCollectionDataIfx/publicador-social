# POST `/api/media/{mediaId}/edit-image` — Construcción técnica

Crea un **nuevo** activo en la biblioteca a partir de una imagen existente: recorte en coordenadas normalizadas, redimensionado a `output` y codificación **webp** o **jpeg**. El original del medio fuente no se modifica.

---

## 1. Resumen

| Aspecto | Detalle |
|--------|---------|
| Método y ruta | `POST /api/media/{mediaId}/edit-image` |
| Controlador | `MediaController.EditImage` |
| Servicio | `IMediaService.EditImageSaveAsCopyAsync` |
| Auth | JWT requerido |
| Autorización | `TenantMember` |
| Header opcional | `Idempotency-Key`: UUID (formato estándar con guiones). Misma clave + tenant + usuario + `mediaId` origen devuelve el mismo `MediaDetailDto` sin duplicar activo. |
| Body | `MediaEditImageRequestDto` (JSON estricto: propiedades no reconocidas → `400`) |
| Respuesta | `200` con `ApiResponse<MediaDetailDto>` |

---

## 2. Flujo de capas

1. Valida tenant, usuario y opcionalmente `Idempotency-Key` (UUID).
2. Si hay idempotencia y ya existe resultado, devuelve detalle del `mediaId` creado previamente.
3. Carga medio origen: tenant, `active`, MIME `image/*`, `processingStatus = completed`; si no → `404` / `400` / `409`.
4. `MediaEditImageRequestValidator` valida modo (`save_as_copy`), formato (`webp`/`jpeg`/`jpg`), calidad 1–100 (sin clamp), dimensiones de salida (100–5000 px, máx. 25M píxeles), crop normalizado (máx. 6 decimales fraccionarios, reglas geométricas), `outputName`/extensión.
5. `ComposerImageEditService`: decodifica imagen, `AutoOrient` (EXIF), crop en píxeles (floor en x/y, round half-away-from-zero en width/height, clamp), resize stretch, encode a temporal (WebP o JPEG sobre fondo blanco).
6. Valida tamaño del archivo temporal y cuota de almacenamiento.
7. Crea `ComposerMedia` (`source = image_editor`, campos de edición, tags/carpeta), guarda original en storage del **nuevo** id, persiste `EditRecipeJson`, genera derivados (thumb/preview) como en upload.
8. Ante fallo tras crear fila/archivos: rollback (borra carpeta física del nuevo id y fila).
9. Registra fila de idempotencia si aplica.

---

## 3. Contrato de entrada (v1)

```json
{
  "mode": "save_as_copy",
  "preset": "instagram-square",
  "outputName": "campaña-cuadrado.webp",
  "output": {
    "width": 1080,
    "height": 1080,
    "format": "webp",
    "quality": 85
  },
  "crop": {
    "x": 0.1,
    "y": 0.1,
    "width": 0.8,
    "height": 0.8
  },
  "folderId": 45,
  "tags": ["editado", "instagram"]
}
```

- **`crop`:** fracciones en `[0,1]` respecto a la imagen **ya orientada** por EXIF; `x + width ≤ 1`, `y + height ≤ 1`; cada valor con como máximo **6** dígitos decimales en la parte fraccionaria.
- **`output.format`:** `webp`, `jpeg` o `jpg` (internamente jpeg se trata como JPEG; nombre de archivo canónico `.jpg` si generáis nombre).
- **`outputName`:** opcional; si incluye extensión debe coincidir con el formato (p. ej. no `.jpg` si `format` es `webp`). Sin extensión, el servidor añade la canónica.
- **`preset`:** obligatorio en el contrato; si vacío se usa `edit` en nombres generados.
- **`folderId`** / **`tags`:** opcionales; mismas reglas que en otros flujos de media.

No soportado en v1 (debe **no** enviarse en el JSON o el deserializador rechazará propiedades extra): `transform`, `filters`, `watermark`, `replace_original`, etc.

---

## 4. Contrato de salida (`200`)

Mismo shape que `GET /api/media/{id}`: `ApiResponse<MediaDetailDto>` con URLs absolutas en la respuesta HTTP del API.

El nuevo medio tiene `source = image_editor` y metadatos de edición persistidos en base de datos (`EditedFromMediaId`, `EditPreset`, `EditRecipeJson`, `IsEditedVersion`, `EditOutputWidth`, `EditOutputHeight`, `EditOutputFormat`).

---

## 5. Códigos HTTP y `MediaErrorCodes`

| HTTP | Código (ejemplos) | Situación |
|------|-------------------|-----------|
| 200 | — | Éxito |
| 400 | `MEDIA_IMAGE_EDIT_OPERATION_NOT_SUPPORTED` | `mode` distinto de `save_as_copy`, formato no permitido, etc. |
| 400 | `MEDIA_IMAGE_OUTPUT_INVALID` | `quality` fuera de 1–100, dimensiones/píxeles inválidos, `Idempotency-Key` no UUID |
| 400 | `MEDIA_IMAGE_OUTPUT_NAME_INVALID` | extensión de `outputName` incompatible con `output.format` |
| 400 | `MEDIA_INVALID_CROP` | crop fuera de rango, demasiada precisión decimal, recorte menor a 50 px tras conversión |
| 400 | `MEDIA_IMAGE_DECODE_FAILED` | imagen corrupta o no decodificable |
| 400 | `MEDIA_NOT_IMAGE` | origen no es imagen |
| 403 | `MEDIA_QUOTA_EXCEEDED` | cuota de almacenamiento |
| 404 | `MEDIA_NOT_FOUND` | origen no existe en el tenant |
| 409 | `MEDIA_PROCESSING_NOT_READY` | `processingStatus` del origen distinto de `completed` |
| 413 | `MEDIA_TOO_LARGE` | resultado editado supera el máximo configurado |

---

## 6. Referencias en código

- `DataColor.Api/Controllers/MediaController.cs` — `EditImage`
- `DataColor.Core/Services/MediaService.cs` — `EditImageSaveAsCopyAsync`
- `DataColor.Core/Services/MediaEditImageRequestValidator.cs`
- `DataColor.Core/Services/ComposerImageEditService.cs`
- `DataColor.Core/DTOs/MediaDtos.cs` — DTOs de request y `MediaEditPreparedRecipe`
- Migración `20260507235236_AddComposerMediaImageEdit`

---

