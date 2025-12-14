# Manejo de Contexto y Resumen en Open SWE

Este documento explica cómo el sistema gestiona la "memoria" a corto plazo (contexto) y cuándo decide comprimirla para evitar desbordamientos de tokens, manteniendo la información más relevante disponible para el modelo.

## 1. ¿Cómo funciona el Contexto?

El sistema mantiene una lista de mensajes (`messages` y `internalMessages`) que representa el historial de la conversación y las acciones ejecutadas.

*   **Internal Messages:** Contiene todo el historial detallado, incluyendo llamadas a herramientas, salidas de consola, y pensamientos internos del modelo.
*   **Windowing:** El sistema no envía *todo* el historial infinito al modelo. Mantiene una ventana deslizante de mensajes relevantes.

## 2. Estrategia de Resumen (Summarization)

Para evitar que el contexto crezca indefinidamente y supere la ventana de contexto del modelo (o incremente excesivamente los costos y latencia), el sistema implementa un mecanismo de **resumen automático**.

### El Proceso de Resumen

Cuando el sistema detecta que se ha alcanzado un límite crítico de tokens, se activa el nodo `summarize-history`. Este proceso funciona de la siguiente manera:

1.  **Identificación:** Se seleccionan todos los mensajes ocurridos desde el último resumen (excluyendo los últimos 20 mensajes para mantener el contexto inmediato intacto).
2.  **Extracción:** Se invoca a un modelo especializado (`Summarizer`) con un prompt específico (`taskSummarySysPrompt`).
3.  **Prompt de Resumen:** El prompt instruye al modelo a actuar como un "Asistente de Extracción de Contexto". No se le pide simplemente "resumir", sino extraer:
    *   Rutas completas de archivos relevantes.
    *   Snippets o resúmenes de archivos leídos.
    *   Insights y aprendizajes sobre el codebase.
    *   Evitar duplicar información ya conocida.
4.  **Reemplazo:** Los mensajes originales seleccionados se eliminan de la memoria (`RemoveMessage`) y se sustituyen por un par de mensajes sintéticos:
    *   Un mensaje `AIMessage` indicando que se va a resumir por falta de espacio.
    *   Un mensaje `ToolMessage` conteniendo el resumen generado.

## 3. Umbral de Tokens (La Respuesta a tu Pregunta)

Aunque modelos como Claude 3.5 Sonnet soportan ventanas de contexto de hasta **200,000 tokens**, el sistema está configurado para ser más conservador y eficiente.

**El límite configurado actual es de 80,000 tokens.**

Este valor está definido en la constante `MAX_INTERNAL_TOKENS`:

```typescript:open-swe/apps/open-swe/src/utils/tokens.ts
// After 80k tokens, summarize the conversation history.
export const MAX_INTERNAL_TOKENS = 80_000;
```

### ¿Por qué 80k y no 200k?
1.  **Rendimiento y Latencia:** Procesar 200k tokens en cada llamada es significativamente más lento.
2.  **Costos:** Reducir el contexto antes ahorra costos de input tokens.
3.  **Espacio para Output:** Se necesita reservar espacio para la respuesta del modelo y la generación de nuevas herramientas.
4.  **Degradación:** Algunos modelos empiezan a perder precisión ("lost in the middle") cuando el contexto se acerca al máximo teórico.

## 4. Ubicación del Código Relevante

*   **Definición del Límite:** `apps/open-swe/src/utils/tokens.ts` (Constante `MAX_INTERNAL_TOKENS`).
*   **Decisión de Resumir:** `apps/open-swe/src/graphs/programmer/nodes/handle-completed-task.ts` (Función `handleCompletedTask` comprueba `totalInternalTokenCount >= MAX_INTERNAL_TOKENS`).
*   **Lógica de Resumen:** `apps/open-swe/src/graphs/programmer/nodes/summarize-history.ts` (Prompt y ejecución del modelo Summarizer).

## 5. Comparación con Gemini (Contexto Masivo)

Tu compañero tiene razón: **Gemini (Google) tiene una capacidad de contexto muy superior a la mayoría de los modelos actuales.**

### Diferencias de Capacidad

*   **Anthropic Claude 3.5 Sonnet:** ~200,000 tokens.
*   **OpenAI GPT-4o:** ~128,000 tokens.
*   **Google Gemini 1.5 Pro:** **2,000,000 tokens** (2 Millones).
*   **Google Gemini 1.5 Flash:** **1,000,000 tokens** (1 Millón).

### ¿Qué significa esto para Open SWE?

Actualmente, el límite de **80,000 tokens** (`MAX_INTERNAL_TOKENS`) es una restricción de software impuesta por nuestro código (`utils/tokens.ts`), **no una limitación del modelo**.

1.  **Si usas Gemini 1.5 Pro hoy en este proyecto:** El sistema **seguirá resumiendo a los 80k tokens**, desaprovechando el 96% de la capacidad de memoria del modelo.
2.  **Para aprovechar Gemini:** Habría que modificar la constante `MAX_INTERNAL_TOKENS` a un valor mucho más alto (ej. 1,000,000).

### Ventajas y Desventajas de usar Contexto Masivo (Gemini)

| Ventaja | Desventaja |
| :--- | :--- |
| **"Memoria Perfecta":** Podrías cargar repositorios enteros o libros completos en el chat sin necesidad de resumir nunca. | **Latencia:** Enviar 1 millón de tokens en cada petición puede hacer que cada respuesta tarde mucho más en comenzar (time-to-first-token), aunque Gemini es bastante rápido gracias a su arquitectura MoE/Ring Attention. |
| **Menos Alucinaciones por Resumen:** Al no resumir, no se pierde ningún detalle técnico o línea de código original. | **Costo:** Aunque el precio por token de Gemini es bajo, multiplicar el volumen por 10x o 20x en cada llamada puede incrementar la factura final considerablemente si el chat es largo. |
| **Búsqueda Global:** El modelo puede correlacionar información de archivos muy distantes que un resumen podría haber omitido. | **Dependencia:** Si el código se acostumbra a contextos de 1M, será difícil volver a usar modelos con ventanas menores (como GPT-4 o Claude) sin que falle. |
