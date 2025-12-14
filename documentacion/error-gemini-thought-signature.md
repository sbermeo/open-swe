# Error: Gemini 3 Pro Preview - Function call missing thought_signature

## Descripción del Error

Al intentar usar el modelo `gemini-3-pro-preview` como modelo de fallback para el task planner, se produjo el siguiente error:

```
All fallback models exhausted for task planner.
Last error: [GoogleGenerativeAI Error]: Error fetching from `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:streamGenerateContent?alt=sse:`
[400 Bad Request] Function call is missing a thought_signature in functionCall parts.
This is required for tools to work correctly, and missing thought_signature may lead to degraded model performance.
Additional data, function call 'default_api:shell', position 2.
Please refer to `https://ai.google.dev/gemini-api/docs/thought-signatures` for more details.
```

## Causa del Problema

### Requisito Nuevo de Gemini 3 Pro Preview

El modelo `gemini-3-pro-preview` de Google requiere un campo `thought_signature` en las llamadas a funciones (function calls / tool calls). Este es un requisito nuevo de la API de Gemini que mejora el rendimiento y la confiabilidad de las llamadas a herramientas.

**Problema técnico**:
- LangChain (versión actual: `@langchain/core@^0.3.65`) no incluye automáticamente el campo `thought_signature` cuando se realizan llamadas a herramientas con `gemini-3-pro-preview`
- El código estaba usando `gemini-3-pro-preview` como modelo de fallback por defecto para varias tareas (PLANNER, PROGRAMMER, SUMMARIZER)
- Cuando el modelo principal fallaba y se intentaba usar el fallback, la llamada fallaba con error 400

### Ubicación del Problema

El error se originaba en `/home/ubuntu/open-swe/apps/open-swe/src/utils/llms/model-manager.ts`, específicamente en la configuración de modelos de fallback:

```typescript
"google-genai": {
  [LLMTask.PLANNER]: "gemini-3-pro-preview",      // ❌ Requiere thought_signature
  [LLMTask.PROGRAMMER]: "gemini-3-pro-preview",   // ❌ Requiere thought_signature
  [LLMTask.REVIEWER]: "gemini-flash-latest",
  [LLMTask.ROUTER]: "gemini-flash-latest",
  [LLMTask.SUMMARIZER]: "gemini-3-pro-preview",   // ❌ Requiere thought_signature
}
```

## Archivos Involucrados

### Archivos Modificados

1. **`/home/ubuntu/open-swe/apps/open-swe/src/utils/llms/model-manager.ts`**
   - **Líneas afectadas**: 388-393 (configuración de modelos de fallback para `google-genai`)
   - **Propósito**: Define qué modelos usar cuando el modelo principal falla

### Archivos de Referencia

- **`/home/ubuntu/open-swe/packages/shared/src/open-swe/models.ts`**: Lista de modelos disponibles en la UI
- **`/home/ubuntu/open-swe/packages/shared/src/open-swe/llm-task.ts`**: Definición de tareas LLM
- **`/home/ubuntu/open-swe/apps/open-swe/src/utils/runtime-fallback.ts`**: Lógica de fallback entre modelos

## Solución Implementada

### Cambio de Modelos de Fallback

Se reemplazaron los modelos `gemini-3-pro-preview` por `gemini-2.5-pro` y `gemini-flash-latest` por `gemini-2.5-flash`:

```typescript
// ANTES
"google-genai": {
  [LLMTask.PLANNER]: "gemini-3-pro-preview",      // ❌
  [LLMTask.PROGRAMMER]: "gemini-3-pro-preview",   // ❌
  [LLMTask.REVIEWER]: "gemini-flash-latest",      // ⚠️ Versión antigua
  [LLMTask.ROUTER]: "gemini-flash-latest",        // ⚠️ Versión antigua
  [LLMTask.SUMMARIZER]: "gemini-3-pro-preview",   // ❌
}

// DESPUÉS
"google-genai": {
  [LLMTask.PLANNER]: "gemini-2.5-pro",            // ✅ No requiere thought_signature
  [LLMTask.PROGRAMMER]: "gemini-2.5-pro",         // ✅ No requiere thought_signature
  [LLMTask.REVIEWER]: "gemini-2.5-flash",         // ✅ Versión actualizada
  [LLMTask.ROUTER]: "gemini-2.5-flash",           // ✅ Versión actualizada
  [LLMTask.SUMMARIZER]: "gemini-2.5-pro",         // ✅ No requiere thought_signature
}
```

**Razón del cambio**:
- `gemini-2.5-pro` es un modelo estable y robusto que no requiere `thought_signature`
- `gemini-2.5-flash` es más rápido y eficiente para tareas de revisión y routing
- Ambos modelos están completamente soportados por LangChain sin requerimientos especiales

## Alternativas Consideradas

### Opción 1: Actualizar LangChain (No Implementada)

**Ventajas**:
- Podría soportar `gemini-3-pro-preview` en el futuro
- Acceso a modelos más nuevos

**Desventajas**:
- Requiere esperar actualización de LangChain
- Podría introducir breaking changes
- Solución temporal no disponible

### Opción 2: Implementar thought_signature Manualmente (No Implementada)

**Ventajas**:
- Permite usar `gemini-3-pro-preview`
- Control total sobre la implementación

**Desventajas**:
- Requiere modificar código de bajo nivel de LangChain
- Alto riesgo de introducir bugs
- Mantenimiento complejo
- No es compatible con la arquitectura actual

### Opción 3: Cambiar a Gemini 2.5 (Implementada) ✅

**Ventajas**:
- Solución inmediata y estable
- Modelos completamente soportados
- Sin cambios en la arquitectura
- Gemini 2.5 Pro es un modelo excelente para las tareas requeridas

**Desventajas**:
- No se usa el modelo más reciente (3 Pro Preview)
- Diferencia de rendimiento potencialmente menor (mínima en la práctica)

## Verificación

Para verificar que el problema está resuelto:

1. **Reiniciar el servidor LangGraph**:
   ```bash
   cd /home/ubuntu/open-swe/apps/open-swe
   yarn langgraph dev
   ```

2. **Probar una tarea que active el planner**:
   - Crear una nueva tarea en la interfaz web
   - El sistema debería poder usar los modelos de fallback sin errores

3. **Verificar logs**:
   - Si hay un fallback, los logs deberían mostrar `gemini-2.5-pro` en lugar de `gemini-3-pro-preview`
   - No deberían aparecer errores sobre `thought_signature`

## Prevención Futura

Para evitar problemas similares en el futuro:

1. **Monitorear actualizaciones de LangChain**: Verificar si futuras versiones soportan `thought_signature` para `gemini-3-pro-preview`

2. **Documentar modelos experimentales**: Marcar claramente qué modelos son "preview" o "experimental" y requieren soporte especial

3. **Testing de fallbacks**: Implementar tests automatizados que verifiquen que los modelos de fallback funcionan correctamente

4. **Validación de configuración**: Agregar validación que verifique que los modelos configurados son compatibles con la versión actual de LangChain

5. **Actualización gradual**: Cuando LangChain soporte `thought_signature`, actualizar gradualmente:
   ```typescript
   // Paso 1: Agregar como opción experimental
   [LLMTask.PLANNER]: process.env.USE_GEMINI_3_PREVIEW 
     ? "gemini-3-pro-preview" 
     : "gemini-2.5-pro",
   
   // Paso 2: Después de testing, cambiar por defecto
   [LLMTask.PLANNER]: "gemini-3-pro-preview",
   ```

## Referencias

- [Google AI - Thought Signatures Documentation](https://ai.google.dev/gemini-api/docs/thought-signatures)
- [LangChain Google GenAI Integration](https://js.langchain.com/docs/integrations/chat/google_generative_ai)
- [Gemini 2.5 Pro Documentation](https://ai.google.dev/models/gemini)

## Notas Técnicas

- **Versión de LangChain**: `@langchain/core@^0.3.65`, `@langchain/google-genai@^0.2.9`
- **Modelos afectados**: Solo `gemini-3-pro-preview` requiere `thought_signature`
- **Impacto**: El error solo ocurre cuando se activa el sistema de fallback y se intenta usar `gemini-3-pro-preview`
- **Compatibilidad**: `gemini-2.5-pro` y `gemini-2.5-flash` son completamente compatibles con la versión actual de LangChain

## Fecha de Resolución

**Fecha**: 13 de diciembre de 2024  
**Versión afectada**: LangChain Core 0.3.65  
**Modelos corregidos**: PLANNER, PROGRAMMER, REVIEWER, ROUTER, SUMMARIZER fallbacks para Google GenAI

