# Guía frontend: Selección de cuentas LinkedIn post-OAuth

Documento para el equipo frontend con el flujo **autorizar miembro LinkedIn → selector (perfil + orgs) → conectar al workspace**, paridad con Facebook post-OAuth.

**Referencia backend:** plan selector post-OAuth LinkedIn (paridad Facebook)  
**Multi-OAuth previo:** [`docs/frontend-multi-oauth-linkedin-por-tenant.md`](frontend-multi-oauth-linkedin-por-tenant.md)  
**Paridad Facebook:** [`docs/frontend-seleccion-paginas-facebook-post-oauth.md`](frontend-seleccion-paginas-facebook-post-oauth.md)

---

## 1. Objetivo funcional

Tras OAuth LinkedIn, la API importa **perfil personal** y **organizaciones** administradas, pero **no las activa automáticamente** (salvo flag legacy `AutoActivateOrganizationsOnSync=true` en servidor).

El usuario debe:

1. Autorizar su cuenta LinkedIn (OAuth).
2. Ser redirigido al **selector** de cuentas.
3. Elegir qué **perfil y/o organizaciones** conectar al workspace (respetando límite de orgs del plan).
4. Publicar solo con cuentas **conectadas** (`forPublishing=true`).

**Fase actual (sin CM API):** el selector muestra solo el **perfil** (`accountType=profile`). Al conectarlo queda publicable. Cuando LinkedIn apruebe CM API y se añadan scopes org, las organizaciones aparecerán en la misma pantalla sin cambios de frontend.

---

## 2. Qué cambió respecto al comportamiento anterior

| Antes | Ahora (piloto `linkedin_oauth`) |
|-------|----------------------------------|
| OAuth importaba y **activaba** perfil + orgs | OAuth importa en estado `Discovered` (inactivas) |
| Callback → `/linkedin?connectionId=` | Callback **302** → `/linkedin/select?connectionId=` |
| `PATCH /accounts/{id}/status` activaba orgs/perfil | **400** `SOCIAL_ACCOUNT_STATUS_PATCH_DEPRECATED` para `linkedin` + `profile`/`organization` |
| Límite orgs en sync | `limit.linkedin.organizations` **solo al conectar** |
| `activeAccountCount` > 0 tras OAuth | Tras OAuth suele ser **0** (discovered); usar selector |

---

## 3. Rutas frontend sugeridas

| Ruta | Propósito |
|------|-----------|
| `/dashboard/cuentas-conectadas/linkedin` | Lista conexiones + cuentas conectadas |
| `/dashboard/cuentas-conectadas/linkedin/select?connectionId={id}` | Selector post-OAuth |

Query params del redirect de éxito:

| Param | Ejemplo | Uso UI |
|-------|---------|--------|
| `connectionId` | `12` | Scope del selector |
| `accountsImported` | `4` | Toast “4 cuentas disponibles para conectar” |
| `warning` | `LINKEDIN_NO_ADMIN_ORGANIZATIONS` | Perfil OK, sin orgs (fase actual) |
| `liError` | `SOCIAL_CONNECTION_LIMIT_REACHED` | Error post-OAuth |

---

## 4. Headers comunes

```http
Authorization: Bearer <jwt>
X-Tenant-Id: <tenantIdActivo>
```

Formato respuesta: `{ "data": { ... } }` en `camelCase`.

---

## 5. Flujo OAuth y callback

### 5.1 Iniciar OAuth

```http
GET /api/social/connect/linkedin/linkedin_oauth/start?mode=add
```

Reauth: `?mode=reauth&connectionId=12`.

### 5.2 Callback

- **Navegador:** `302` → `{FrontendBaseUrl}/dashboard/cuentas-conectadas/linkedin/select?connectionId=12&accountsImported=2`
- **SPA / tests:** `GET .../callback?responseMode=json` → JSON 200 con `connectionId`.

Config backend:

```json
"linkedin_oauth": {
  "AutoActivateOrganizationsOnSync": false,
  "FrontendOAuthSuccessRedirectPath": "/dashboard/cuentas-conectadas/linkedin/select?connectionId={connectionId}"
}
```

---

## 6. Selector — listar cuentas disponibles

```http
GET /api/social/connections/{connectionId}/accounts?status=available
```

Respuesta (`data`):

| Campo | Uso |
|-------|-----|
| `connection` | Miembro OAuth (`displayLabel`, `externalUserId`) |
| `remainingSlots` | Cupo restante de **organizaciones** (null = ilimitado) |
| `maxSlots` | Límite plan orgs |
| `activeSlotsUsed` | Orgs ya conectadas al workspace |
| `accounts[]` | Perfil + orgs importadas |

Cada item en `accounts`:

| Campo | Uso |
|-------|-----|
| `accountType` | `profile` o `organization` |
| `workspaceStatus` | `Discovered` / `Disabled` antes de conectar |
| `canConnect` | Si el checkbox debe estar habilitado |
| `canConnectReason` | Motivo si no conectable (p. ej. límite orgs) |
| `capabilities` | Tipos de post admitidos (§8) |

**Perfil personal:** no consume slot de org (`canConnect` no depende de `remainingSlots` para orgs).

Mostrar perfil y orgs en **la misma lista** con checkbox.

---

## 7. Conectar / desconectar

### 7.1 Conectar una cuenta

```http
POST /api/social/accounts/{accountId}/connect
Content-Type: application/json

{ "socialConnectionId": 12 }
```

### 7.2 Conectar varias (bulk)

```http
POST /api/social/accounts/connect
Content-Type: application/json

{
  "socialConnectionId": 12,
  "managedSocialAccountIds": [101, 102, 103]
}
```

- Respeta `limit.linkedin.organizations` para orgs nuevas.
- El **perfil** no consume slot de org.
- Si el bulk excede el límite: items en exceso → `ok: false`, `errorCode: SOCIAL_ACCOUNT_LIMIT_REACHED`; el resto OK.

### 7.3 Desconectar del workspace

```http
POST /api/social/accounts/{accountId}/disconnect
Content-Type: application/json

{ "socialConnectionId": 12 }
```

Estado resultante: `workspaceStatus: Disabled`, no aparece en `forPublishing=true`.

**Org compartida:** desconectar una conexión OAuth no desactiva la org si otro miembro mantiene un binding activo.

---

## 8. Publicación y listados

### Cuentas publicables (composer / calendario)

```http
GET /api/social/accounts?providerGroup=linkedin&forPublishing=true
```

Solo cuentas con `workspaceStatus=Connected` y `canPublish=true`.

### Capacidades por tipo

| Tipo | PDF / multi-imagen |
|------|-------------------|
| `profile` | No |
| `organization` | Sí (cuando CM API activa) |

---

## 9. Stats en listado de conexiones

```http
GET /api/social/connections?connectionType=linkedin_oauth
```

Tras OAuth con selector:

| Campo | Valor típico | Significado |
|-------|--------------|-------------|
| `activeAccountCount` | `0` | Conectadas al workspace |
| `discoveredAccountCount` | `≥ 1` | Importadas, pendientes de selector |
| `totalAccountCount` | perfil + orgs | Bindings de esa conexión |

Mostrar botón **“Seleccionar cuentas”** cuando `discoveredAccountCount > 0` o tras redirect al selector.

---

## 10. PATCH status deprecado

```http
PATCH /api/social/accounts/{id}/status
```

Para `provider=linkedin` y `accountType` en (`profile`, `organization`) → **400** `SOCIAL_ACCOUNT_STATUS_PATCH_DEPRECATED`.

Usar `/connect` y `/disconnect` en su lugar.

---

## 11. Mensajes UX sugeridos

| Situación | Toast |
|-----------|-------|
| OAuth OK, solo perfil | “Perfil disponible. Selecciona qué cuentas conectar.” + aviso CM API pendiente para orgs |
| OAuth OK, perfil + orgs | “{N} cuenta(s) disponibles para conectar” |
| Conexión exitosa | “Cuenta conectada al workspace” |
| Límite orgs | “Has alcanzado el límite de páginas de empresa LinkedIn” |
| Selector vacío de orgs (fase actual) | “Cuando LinkedIn apruebe la app, las páginas de empresa aparecerán aquí” |

---

## 12. Checklist frontend

- [x] Ruta `/dashboard/cuentas-conectadas/linkedin/select?connectionId=`
- [x] Tras OAuth redirect, abrir selector automáticamente (callback backend → `/linkedin/select`)
- [x] `GET /connections/{id}/accounts?status=available` — perfil + orgs con checkbox
- [x] Bulk connect con `POST /accounts/connect`
- [x] `forPublishing=true` solo tras conectar
- [x] `activeAccountCount=0` tras OAuth es normal
- [x] No usar `PATCH /status` para LinkedIn profile/org
- [x] Badge `profile` vs `organization` en la lista
- [x] Manejar `remainingSlots` solo para orgs (no bloquear perfil)

---

## 13. Activación cuando LinkedIn apruebe CM API

Sin cambios de frontend:

1. Backend añade scopes `w_organization_social rw_organization_admin`
2. Usuario reconecta (reauth) para tokens con permisos org
3. Sync / OAuth de nuevo → orgs en selector automáticamente
