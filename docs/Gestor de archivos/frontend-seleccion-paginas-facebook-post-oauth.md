# Guía frontend: Selección de páginas Facebook post-OAuth

Documento para el equipo frontend con el flujo **autorizar cuenta Meta → selector de páginas → conectar al workspace**, implementado sobre Multi-OAuth Fase 1.

**Referencia backend:** [`docs/Documentos requerimientos/plan-seleccion-paginas-facebook-post-oauth.md`](Documentos%20requerimientos/plan-seleccion-paginas-facebook-post-oauth.md)  
**Multi-OAuth previo:** [`docs/frontend-multi-oauth-facebook-por-tenant.md`](frontend-multi-oauth-facebook-por-tenant.md)

---

## 1. Objetivo funcional

Tras OAuth Facebook, Meta devuelve todas las páginas accesibles, pero **DataColor ya no las activa automáticamente** (salvo flag legacy `AutoActivatePagesOnSync=true` en servidor).

El usuario debe:

1. Autorizar su cuenta Meta (OAuth).
2. Ser redirigido al **selector** de páginas.
3. Elegir qué páginas **conectar al workspace** (respetando límite de plan).
4. Publicar solo con páginas **conectadas** (`forPublishing=true`).

---

## 2. Qué cambió respecto al comportamiento anterior

| Antes | Ahora (piloto `facebook_login`) |
|-------|----------------------------------|
| OAuth importaba y **activaba** todas las páginas | OAuth importa en estado `Discovered` (inactivas) |
| Callback devolvía JSON 200 | Callback **302** al selector (salvo `responseMode=json`) |
| `PATCH /accounts/{id}/status` activaba páginas FB | **400** `SOCIAL_ACCOUNT_STATUS_PATCH_DEPRECATED` para `facebook` + `page` |
| Sin límite al activar | `limit.facebook.pages` al conectar |
| Solo `externalUserId` en conexión | `displayLabel` (nombre usuario Meta) |

**Instagram / LinkedIn:** sin cambios en esta entrega. Sigue `PATCH /status` temporalmente.

---

## 3. Rutas frontend sugeridas

| Ruta | Propósito |
|------|-----------|
| `/dashboard/cuentas-conectadas/facebook` | Lista conexiones Meta + páginas conectadas |
| `/dashboard/cuentas-conectadas/facebook/select?connectionId={id}` | Selector post-OAuth |

Query params del redirect de éxito:

| Param | Ejemplo | Uso UI |
|-------|---------|--------|
| `connectionId` | `12` | Scope del selector |
| `accountsImported` | `10` | Toast “10 páginas encontradas” |
| `warning` | `SYNC_NO_PAGES_RETURNED` | Empty state (OAuth OK, 0 páginas) |
| `fbError` | `SOCIAL_CONNECTION_LIMIT_REACHED` | Error post-OAuth |

---

## 4. Headers comunes

```http
Authorization: Bearer <jwt>
X-Tenant-Id: <tenantIdActivo>
```

Formato respuesta: `{ "data": { ... } }` en `camelCase`.

---

## 5. Flujo OAuth y callback

### 5.1 Iniciar OAuth (sin cambios)

```http
GET /api/social/connect/meta/facebook_login/start?mode=add
```

Para reauth: `?mode=reauth&connectionId=12`.

### 5.2 Callback

- **Navegador:** `302` → `{FrontendBaseUrl}/dashboard/cuentas-conectadas/facebook/select?connectionId=12&accountsImported=4`
- **SPA / tests:** `GET .../callback?responseMode=json` → JSON 200 con `connectionId`.

Ejemplo JSON:

```json
{
  "data": {
    "connectionId": 12,
    "accountsImported": 4,
    "errors": 0,
    "warningCode": null,
    "message": "Sincronización exitosa: 4 página(s)."
  }
}
```

También aplica header `Accept: application/json`.

---

## 6. Endpoints nuevos y modificados

### 6.1 Selector

```http
GET /api/social/connections/{connectionId}/accounts?status=available
```

Respuesta (extracto):

```json
{
  "data": {
    "connection": {
      "id": 12,
      "displayLabel": "Willy Avila Romero",
      "connectionType": "facebook_login",
      "externalUserId": "36508315058812132"
    },
    "remainingSlots": 7,
    "maxSlots": 10,
    "activeSlotsUsed": 3,
    "accounts": [
      {
        "id": 101,
        "provider": "facebook",
        "accountType": "page",
        "displayName": "Action Like",
        "workspaceStatus": "Discovered",
        "status": "Available",
        "isActive": false,
        "canConnect": true,
        "canConnectReason": null,
        "connectionBindingsCount": 1,
        "capabilities": { "canPublishImage": true }
      }
    ]
  }
}
```

### 6.2 Conectar una página

```http
POST /api/social/accounts/{accountId}/connect
Content-Type: application/json

{ "socialConnectionId": 12 }
```

`socialConnectionId` obligatorio si hay múltiples bindings (página compartida).

Errores: `409` + `SOCIAL_ACCOUNT_LIMIT_REACHED` | `SOCIAL_ACCOUNT_ALREADY_CONNECTED` | `SOCIAL_ACCOUNT_CONNECT_NOT_ELIGIBLE`.

### 6.3 Conectar en lote

```http
POST /api/social/accounts/connect

{
  "managedSocialAccountIds": [101, 102, 103],
  "socialConnectionId": 12
}
```

Procesamiento **determinístico por orden de IDs**. Con 2 slots libres y 5 IDs, conecta las 2 primeras elegibles; el resto `SOCIAL_ACCOUNT_LIMIT_REACHED`.

### 6.4 Desconectar del workspace

```http
POST /api/social/accounts/{accountId}/disconnect
{ "socialConnectionId": 12 }
```

`workspaceStatus` → `Disabled` (no `Discovered`). Reconectar con `POST /connect`.

Distinto de `POST /connections/{id}/disconnect` (revoca OAuth Meta).

### 6.5 Otros cambios

- `GET /connections/{id}`: `displayLabel`, `lastSyncError`, `availableAccountCount`.
- `GET /accounts?connectionId=&status=available|connected|disabled|all`.

---

## 7. Estados: `workspaceStatus` vs `status`

| Campo | Origen | Valores |
|-------|--------|---------|
| `workspaceStatus` | BD | `Discovered`, `Connected`, `Disabled`, `Revoked` |
| `status` | Runtime UI | + `Available`, `LimitBlocked` |

`LimitBlocked` nunca se persiste. Si el plan libera slots, la página vuelve a `Available` sin cambios en BD.

---

## 8. Deprecación PATCH status (Facebook Pages)

`PATCH /api/social/accounts/{id}/status` sobre páginas FB → **400** `SOCIAL_ACCOUNT_STATUS_PATCH_DEPRECATED`.

Usar solo `POST /connect` y `POST /disconnect`.

---

## 9. Checklist UI

- [x] Leer `connectionId` del redirect post-OAuth.
- [x] Selector: `GET /connections/{connectionId}/accounts`.
- [x] Mostrar slots: `activeSlotsUsed / maxSlots`.
- [x] Conectar: `POST /accounts/{id}/connect` (+ `socialConnectionId` si aplica).
- [x] Bulk: `POST /accounts/connect` en orden UX.
- [x] Respetar `canConnect` / `canConnectReason`.
- [x] Badge `LimitBlocked` cuando corresponda.
- [x] Publicación: `GET /accounts?forPublishing=true`.
- [x] No usar `PATCH /status` en páginas Facebook.

---

## 10. Entitlements

`GET /api/tenants/{tenantId}/entitlements` → `limits["limit.facebook.pages"]`.

El selector también devuelve `remainingSlots` y `maxSlots`.
