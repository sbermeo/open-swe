# Error: Redirección de GitHub App a localhost/0.0.0.0 en lugar de IP pública

## Descripción del Error

Al intentar conectarse a la GitHub App desde un servidor remoto usando la IP pública `54.87.140.172:3000`, la aplicación redirigía incorrectamente a `localhost:3000` o `0.0.0.0:3000`, causando que la instalación/autorización de GitHub App fallara porque estas direcciones no son accesibles desde el navegador del usuario remoto.

### Error Específico Observado

- **Primera manifestación**: Redirección a `localhost:3000`
- **Segunda manifestación**: Después de configurar el servidor para escuchar en `0.0.0.0`, redirección a `0.0.0.0:3000`
- **Error en navegador**: `ERR_ADDRESS_INVALID` cuando se intenta acceder a `0.0.0.0:3000`

## Causa del Problema

El error se originó por dos problemas principales:

### 1. Uso de `request.nextUrl.origin` y `request.url` en lugar de variable de entorno

El código en varios archivos utilizaba `request.nextUrl.origin` o `request.url` para construir URLs de redirección:

**En `src/app/api/github/installation/route.ts`**:
```typescript
const baseCallbackUrl = `${request.nextUrl.origin}/api/github/installation-callback`;
```

**En `src/middleware.ts`**:
```typescript
const url = request.nextUrl.clone();
url.pathname = "/chat";
return NextResponse.redirect(url);
```

**En `src/app/api/auth/github/callback/route.ts`**:
```typescript
return NextResponse.redirect(new URL("/chat", request.url));
```

**Problema**: 
- `request.nextUrl.origin` detecta el origen basándose en los headers de la solicitud HTTP
- Cuando el servidor está corriendo y escuchando en `0.0.0.0`, `request.nextUrl.origin` puede retornar `http://0.0.0.0:3000` 
- `0.0.0.0` es una dirección especial que significa "todas las interfaces" en el servidor, pero NO es una dirección válida para acceder desde un navegador
- Esto ocurre especialmente cuando:
  - El servidor Next.js está configurado para escuchar en `0.0.0.0` (todas las interfaces)
  - No hay proxies reversos que reescribieran los headers `Host` o `X-Forwarded-Host`
  - El cliente accede directamente por IP pública

### 2. Variables de entorno con valores de localhost

El archivo `.env` tenía configuraciones hardcodeadas para localhost:

```env
NEXT_PUBLIC_API_URL="http://localhost:3000/api"
GITHUB_APP_REDIRECT_URI="http://localhost:3000/api/auth/github/callback"
```

**Problema**: Estas variables se usan en múltiples lugares del código para construir URLs, y al tener valores de localhost, todas las redirecciones y callbacks apuntaban incorrectamente.

### 3. Servidor Next.js escuchando solo en localhost

El script de desarrollo en `package.json` ejecutaba:

```json
"dev": "next dev"
```

**Problema**: Por defecto, `next dev` escucha solo en `127.0.0.1` (localhost), lo que impide que sea accesible desde redes externas, incluso si las URLs estaban correctas.

## Archivos Involucrados

### Archivos Modificados para la Solución

1. **`/home/ubuntu/open-swe/apps/web/.env`**
   - **Líneas afectadas**: Variables `NEXT_PUBLIC_API_URL` y `GITHUB_APP_REDIRECT_URI`
   - **Propósito**: Almacena la configuración de URLs base de la aplicación

2. **`/home/ubuntu/open-swe/apps/web/src/lib/url.ts`** ⭐ **NUEVO**
   - **Propósito**: Helper functions para obtener la base URL correcta desde variables de entorno
   - **Funciones**: `getBaseUrl()` y `createAppUrl(path)`

3. **`/home/ubuntu/open-swe/apps/web/src/app/api/github/installation/route.ts`**
   - **Líneas afectadas**: Líneas 47-49, 72-76
   - **Propósito**: Endpoint que inicia el flujo de instalación de GitHub App y construye la URL de callback

4. **`/home/ubuntu/open-swe/apps/web/src/app/api/github/installation-callback/route.ts`**
   - **Líneas afectadas**: Líneas 19-20, 36, 67-69
   - **Propósito**: Maneja el callback de GitHub después de la instalación

5. **`/home/ubuntu/open-swe/apps/web/src/app/api/auth/github/callback/route.ts`**
   - **Líneas afectadas**: Múltiples líneas con `NextResponse.redirect`
   - **Propósito**: Maneja el callback de autenticación OAuth de GitHub

6. **`/home/ubuntu/open-swe/apps/web/src/middleware.ts`**
   - **Líneas afectadas**: Líneas 17-19, 25-27
   - **Propósito**: Middleware que redirige usuarios autenticados/no autenticados

7. **`/home/ubuntu/open-swe/apps/web/package.json`**
   - **Líneas afectadas**: Script `"dev"` (línea 13)
   - **Propósito**: Script de desarrollo que inicia el servidor Next.js

### Archivos de Referencia (no modificados)

- **`/home/ubuntu/open-swe/apps/web/src/utils/github.ts`**: Usa `NEXT_PUBLIC_API_URL` para construir URLs de API
- **`/home/ubuntu/open-swe/apps/web/src/app/api/github/installation-callback/route.ts`**: Recibe el callback de GitHub después de la instalación
- **`/home/ubuntu/open-swe/apps/web/.env.example`**: Template de configuración con valores por defecto

## Solución Implementada

### 1. Actualización de Variables de Entorno

Se modificó el archivo `.env` para usar la IP pública:

```diff
- NEXT_PUBLIC_API_URL="http://localhost:3000/api"
+ NEXT_PUBLIC_API_URL="http://54.87.140.172:3000/api"

- GITHUB_APP_REDIRECT_URI="http://localhost:3000/api/auth/github/callback"
+ GITHUB_APP_REDIRECT_URI="http://54.87.140.172:3000/api/auth/github/callback"
```

**Comando ejecutado**:
```bash
cd /home/ubuntu/open-swe/apps/web
sed -i 's|http://localhost:3000|http://54.87.140.172:3000|g' .env
```

### 2. Creación de Helper Functions para URLs ⭐ **NUEVO**

Se creó el archivo `src/lib/url.ts` con funciones helper:

```typescript
/**
 * Gets the base URL of the application
 * Uses NEXT_PUBLIC_API_URL if available, otherwise falls back to localhost
 * This ensures consistent URLs even when the server is listening on 0.0.0.0
 */
export function getBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  
  if (apiUrl) {
    // Extract base URL from NEXT_PUBLIC_API_URL (remove /api suffix if present)
    return apiUrl.replace(/\/api\/?$/, "");
  }
  
  // Fallback to localhost for development
  return "http://localhost:3000";
}

/**
 * Creates a URL with the correct base URL
 */
export function createAppUrl(path: string): string {
  const baseUrl = getBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
```

**Ventajas**:
- Centraliza la lógica de construcción de URLs
- Siempre usa `NEXT_PUBLIC_API_URL` en lugar de confiar en `request.nextUrl.origin`
- Previene el problema de `0.0.0.0` al construir URLs

### 3. Actualización de Todos los Archivos que Construyen URLs

Se actualizaron múltiples archivos para usar las funciones helper:

**`installation/route.ts`**:
```typescript
// ANTES
const baseCallbackUrl = `${request.nextUrl.origin}/api/github/installation-callback`;

// DESPUÉS
const baseUrl = getBaseUrl();
const baseCallbackUrl = `${baseUrl}/api/github/installation-callback`;
```

**`middleware.ts`**:
```typescript
// ANTES
const url = request.nextUrl.clone();
url.pathname = "/chat";
return NextResponse.redirect(url);

// DESPUÉS
return NextResponse.redirect(createAppUrl("/chat"));
```

**`callback/route.ts`**:
```typescript
// ANTES
return NextResponse.redirect(new URL("/chat", request.url));

// DESPUÉS
return NextResponse.redirect(createAppUrl("/chat"));
```

**`installation-callback/route.ts`**:
```typescript
// ANTES
const returnTo = request.cookies.get(...)?.value || "/";
return NextResponse.redirect(returnTo);

// DESPUÉS
const returnToPath = request.cookies.get(...)?.value || "/";
const returnTo = returnToPath.startsWith("http")
  ? returnToPath.replace(/^https?:\/\/[^\/]+/, createAppUrl(""))
  : createAppUrl(returnToPath);
return NextResponse.redirect(returnTo);
```

### 3. Configuración de Next.js para Escuchar en Todas las Interfaces

Se modificó el script de desarrollo en `package.json`:

```diff
- "dev": "next dev",
+ "dev": "next dev -H 0.0.0.0",
```

**Efecto**: El flag `-H 0.0.0.0` hace que Next.js escuche en todas las interfaces de red (0.0.0.0), permitiendo conexiones desde cualquier IP externa, no solo localhost.

## Pasos Adicionales Requeridos

### 1. Actualizar Configuración de GitHub App

Después de aplicar los cambios, es necesario actualizar la configuración de la GitHub App en GitHub:

1. Ir a: https://github.com/settings/apps
2. Seleccionar la aplicación (ej: "open-swe-dev")
3. En la sección "Callback URL" o "Setup URL", actualizar a:
   ```
   http://54.87.140.172:3000/api/github/installation-callback
   ```
4. Guardar los cambios

### 2. Configurar Firewall (si es necesario)

Asegurar que el puerto 3000 esté abierto:

```bash
sudo ufw allow 3000/tcp
```

### 3. Reiniciar el Servidor

Reiniciar el servidor de desarrollo para aplicar los cambios:

```bash
cd /home/ubuntu/open-swe/apps/web
yarn dev
```

## Prevención Futura

Para evitar este error en el futuro:

1. **Usar variables de entorno para URLs**: Siempre usar `NEXT_PUBLIC_API_URL` o variables similares en lugar de depender de `request.nextUrl.origin` cuando se necesita una URL específica.

2. **Documentar variables de entorno**: Mantener `.env.example` actualizado con comentarios sobre qué valores usar en producción vs desarrollo.

3. **Scripts de desarrollo separados**: Considerar tener scripts separados:
   ```json
   "dev": "next dev",
   "dev:public": "next dev -H 0.0.0.0"
   ```

4. **Validación de configuración**: Agregar validación al inicio de la aplicación que verifique que las URLs configuradas sean accesibles.

5. **Variables por ambiente**: Usar diferentes archivos `.env` o sistemas de gestión de configuración (como Docker secrets, Kubernetes ConfigMaps) para diferentes ambientes.

## Notas Técnicas

- **`NEXT_PUBLIC_*`**: En Next.js, las variables que comienzan con `NEXT_PUBLIC_` están disponibles tanto en el servidor como en el cliente (navegador), lo cual es necesario para construir URLs del lado del cliente.

- **Origen de la solicitud**: `request.nextUrl.origin` puede no ser confiable cuando hay proxies, load balancers, o cuando el servidor está detrás de un túnel/reverse proxy que no reescribe correctamente los headers.

- **Seguridad**: Al hacer el servidor accesible públicamente, asegurarse de tener las medidas de seguridad adecuadas (HTTPS en producción, rate limiting, autenticación, etc.).

## Fecha de Resolución

**Fecha**: 13 de diciembre de 2024
**Entorno**: Ubuntu 22.04, Node.js v24.12.0, Next.js 15.4.8, Yarn 3.5.1

