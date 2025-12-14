# Registro de Errores y Soluciones: Integración de Modelos Anthropic (Sonnet 4.5)

Este documento detalla los problemas críticos encontrados durante la integración de los modelos Claude Sonnet 4.5 y Claude 3.5 Haiku, así como las soluciones técnicas implementadas.

## 1. Error: `top_p` no puede ser -1

**Síntoma:**
La API de Anthropic devolvía el error: `400 invalid_request_error: top_p cannot be set to -1`.

**Causa Raíz:**
Cuando se configura `temperature: 0` en LangChain (o valores muy bajos), el SDK de Anthropic o la capa de integración de LangChain asignan internamente `top_p: -1` para indicar "usar el valor por defecto del servidor". Sin embargo, los modelos más recientes de Anthropic (Sonnet 4.5) validan estrictamente este parámetro y rechazan valores negativos.

**Solución Fallida:**
Intentar enviar `temperature: 0` y forzar `top_p: 1` al mismo tiempo provocó el siguiente error (ver punto 2).

**Solución Exitosa:**
1.  **Eliminar totalmente** la propiedad `temperature` de la configuración enviada a Anthropic.
2.  **Forzar** `top_p: 1` explícitamente.
3.  En `model-manager.ts`, se elimina la propiedad `temperature` de la instancia de `ChatAnthropic` justo después de crearla.
4.  En `runtime-fallback.ts`, se intercepta la llamada `invoke` para asegurar que `temperature` se elimine de las opciones y se inyecte `top_p: 1`.

---

## 2. Error: Conflicto entre `temperature` y `top_p`

**Síntoma:**
La API devolvía: `400 invalid_request_error: temperature and top_p cannot both be specified for this model`.

**Causa Raíz:**
Los nuevos modelos de Anthropic prohíben especificar ambos parámetros simultáneamente para garantizar un comportamiento determinista o controlado. Solo se debe enviar uno de los dos.

**Solución Exitosa:**
Se modificó la lógica en `ModelManager` y `ModelRunner` (anteriormente FallbackRunnable) para dar prioridad a `top_p`. Si el proveedor es Anthropic, se elimina sistemáticamente cualquier referencia a `temperature` antes de realizar la petición.

---

## 3. Error: Versión de Herramienta Obsoleta (`text_editor`)

**Síntoma:**
La API devolvía: `400 invalid_request_error: 'claude-sonnet-4-5-20250929' does not support tool types: text_editor_20250429`.

**Causa Raíz:**
El código utilizaba una definición antigua de la herramienta de edición de texto (`text_editor_20250429`). El modelo Sonnet 4.5 requiere la versión más reciente (`text_editor_20250728`) o posteriores.

**Solución Exitosa:**
Se actualizó la definición de la herramienta en `apps/open-swe/src/graphs/programmer/nodes/generate-message/index.ts` a la versión `text_editor_20250728`.

---

## 4. Error: ID de Modelo Incorrecto

**Síntoma:**
Error `404 model not found` al intentar usar `claude-sonnet-4-5-20251101`.

**Causa Raíz:**
El ID del modelo se había configurado incorrectamente basándose en información preliminar. El ID correcto para Sonnet 4.5 es `claude-sonnet-4-5-20250929`.

**Solución Exitosa:**
*   Se actualizaron todas las constantes y configuraciones en `packages/shared/src/open-swe/models.ts` y otros archivos.
*   Se implementó un "Hotfix" en `model-manager.ts` que detecta el ID incorrecto y lo sustituye automáticamente por el correcto antes de instanciar el modelo.

---

## 5. Problema con Fallbacks Automáticos

**Síntoma:**
El sistema intentaba cambiar de modelo automáticamente ante errores de configuración (como los de arriba), ocultando la causa real del problema y dificultando la depuración (ej. fallaba Anthropic y saltaba a OpenAI, que fallaba por falta de API Key).

**Solución Exitosa:**
*   Se simplificó la lógica en `ModelManager` para cargar directamente el modelo configurado sin intentar construir cadenas de fallback complejas que pudieran enmascarar errores de configuración.
*   Se modificó `runtime-fallback.ts` para reportar errores de configuración y autenticación inmediatamente, en lugar de intentar otros modelos.

---

## Archivos Clave Modificados

1.  **`apps/open-swe/src/utils/llms/model-manager.ts`**:
    *   Lógica central de instanciación.
    *   Eliminación de `temperature` y forzado de `top_p`.
    *   Hotfix de ID de modelo.
    *   Uso directo de `new ChatAnthropic()` en lugar de `initChatModel`.

2.  **`apps/open-swe/src/utils/runtime-fallback.ts`**:
    *   Interceptor de `invoke` para limpiar parámetros en tiempo de ejecución.
    *   Mejora en el manejo y reporte de errores (logs detallados).

3.  **`apps/open-swe/src/graphs/programmer/nodes/generate-message/index.ts`**:
    *   Actualización de la versión de la herramienta `text_editor`.

4.  **`packages/shared/src/open-swe/models.ts`**:
    *   Actualización de los IDs de los modelos disponibles en la UI.

