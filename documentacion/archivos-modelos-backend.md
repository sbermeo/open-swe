# Archivos donde se especifican los modelos en el Backend

## Archivos Principales

### 1. **Modelos por Defecto para cada Tarea**
📁 `packages/shared/src/open-swe/llm-task.ts`

**Líneas 30-51**: Define los modelos por defecto que se usan cuando el usuario NO selecciona un modelo específico.

```typescript
export const TASK_TO_CONFIG_DEFAULTS_MAP = {
  [LLMTask.PLANNER]: {
    modelName: "anthropic:claude-sonnet-4-5-20250929",  // ← Modelo por defecto
    temperature: 0,
  },
  [LLMTask.PROGRAMMER]: {
    modelName: "anthropic:claude-sonnet-4-5-20250929",  // ← Modelo por defecto
    temperature: 0,
  },
  // ... más tareas
};
```

**Puede ser sobrescrito por**: Variables de entorno `DEFAULT_{TASK}_MODEL`

---

### 2. **Modelos de Fallback por Proveedor**
📁 `apps/open-swe/src/utils/llms/model-manager.ts`

**Líneas 430-451**: Define los modelos de fallback que se usan cuando el modelo principal falla.

```typescript
private getDefaultModelForProvider(provider: Provider, task: LLMTask) {
  const defaultModels: Record<Provider, Record<LLMTask, string>> = {
    anthropic: {
      [LLMTask.PLANNER]: "claude-sonnet-4-5-20250929",  // ← Fallback Anthropic
      // ...
    },
    "google-genai": {
      [LLMTask.PLANNER]: "gemini-2.5-pro",   // ← Fallback Gemini
      // ...
    },
    openai: {
      [LLMTask.PLANNER]: "gpt-5-codex",      // ← Fallback OpenAI
      // ...
    },
  };
}
```

**Puede ser sobrescrito por**: Variables de entorno `FALLBACK_{PROVIDER}_{TASK}_MODEL`

**Métodos clave en este archivo**:
- `getDefaultModelForTask()` (línea ~300): Obtiene modelo principal desde env vars o defaults
- `getModelFromEnv()` (línea ~397): Lee variables de entorno para fallbacks
- `getBaseConfigForTask()` (línea ~302): Configura base para cada tarea
- `getDefaultModelForProvider()` (línea ~425): Obtiene modelos de fallback

---

### 3. **Lista de Modelos Disponibles en la UI**
📁 `packages/shared/src/open-swe/models.ts`

**Líneas 1-95**: Define todos los modelos que aparecen en el selector de la interfaz web.

```typescript
export const MODEL_OPTIONS = [
  {
    label: "Claude Sonnet 4.5",
    value: "anthropic:claude-sonnet-4-5",  // ← Opción en UI
  },
  {
    label: "Gemini 2.5 Pro",
    value: "google-genai:gemini-2.5-pro",  // ← Opción en UI
  },
  // ... más modelos
];
```

**Uso**: Este archivo define qué modelos pueden seleccionarse desde la interfaz web.

---

## Archivos Secundarios (Uso de Modelos)

### 4. **Carga de Modelos**
📁 `apps/open-swe/src/utils/llms/load-model.ts`

**Propósito**: Función que carga un modelo específico usando el ModelManager.

**Líneas clave**:
- `loadModel()`: Carga el modelo principal
- `supportsParallelToolCallsParam()`: Verifica si el modelo soporta llamadas paralelas

---

### 5. **Sistema de Fallback**
📁 `apps/open-swe/src/utils/runtime-fallback.ts`

**Propósito**: Implementa el sistema de fallback automático cuando un modelo falla.

**Líneas clave**:
- `FallbackRunnable`: Clase que maneja el fallback entre modelos
- Intenta modelos en orden hasta que uno funciona

---

### 6. **Uso de Modelos en Nodos Específicos**

Estos archivos usan los modelos pero no los definen:

- `apps/open-swe/src/graphs/planner/nodes/generate-plan/index.ts`
- `apps/open-swe/src/graphs/planner/nodes/generate-message/index.ts`
- `apps/open-swe/src/graphs/programmer/nodes/generate-message/index.ts`
- `apps/open-swe/src/graphs/reviewer/nodes/generate-review-actions/index.ts`
- `apps/open-swe/src/graphs/programmer/nodes/summarize-history.ts`
- Y otros nodos de los grafos...

**Ejemplo de uso**:
```typescript
const model = await loadModel(config, LLMTask.PLANNER);
```

---

## Archivo de Configuración

### 7. **Variables de Entorno**
📁 `apps/open-swe/.env` (o `.env.example`)

**Variables para modelos principales**:
```bash
DEFAULT_PLANNER_MODEL="anthropic:claude-sonnet-4-5-20250929"
DEFAULT_PROGRAMMER_MODEL="anthropic:claude-sonnet-4-5-20250929"
DEFAULT_REVIEWER_MODEL="anthropic:claude-sonnet-4-5-20250929"
DEFAULT_ROUTER_MODEL="anthropic:claude-haiku-4-5"
DEFAULT_SUMMARIZER_MODEL="anthropic:claude-haiku-4-5"
```

**Variables para modelos de fallback**:
```bash
FALLBACK_ANTHROPIC_PLANNER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_OPENAI_PLANNER_MODEL="gpt-5-codex"
FALLBACK_GOOGLE_GENAI_PLANNER_MODEL="gemini-2.5-pro"
# ... etc
```

---

## Flujo de Configuración de Modelos

```
1. Usuario selecciona modelo en UI
   ↓ (si no hay selección)
2. Variable de entorno DEFAULT_{TASK}_MODEL
   ↓ (si no está configurada)
3. TASK_TO_CONFIG_DEFAULTS_MAP (llm-task.ts)
   ↓ (si el modelo falla)
4. Variable de entorno FALLBACK_{PROVIDER}_{TASK}_MODEL
   ↓ (si no está configurada)
5. defaultModels en model-manager.ts (getDefaultModelForProvider)
```

---

## Resumen de Archivos a Modificar

### Para cambiar modelos por defecto:

1. **Usar variables de entorno** (recomendado):
   - Editar: `apps/open-swe/.env`
   - Agregar: `DEFAULT_{TASK}_MODEL="provider:model-name"`

2. **Modificar código** (si no usas env vars):
   - Archivo: `packages/shared/src/open-swe/llm-task.ts`
   - Líneas: 30-51
   - Cambiar: Valores en `TASK_TO_CONFIG_DEFAULTS_MAP`

### Para cambiar modelos de fallback:

1. **Usar variables de entorno** (recomendado):
   - Editar: `apps/open-swe/.env`
   - Agregar: `FALLBACK_{PROVIDER}_{TASK}_MODEL="model-name"`

2. **Modificar código** (si no usas env vars):
   - Archivo: `apps/open-swe/src/utils/llms/model-manager.ts`
   - Líneas: 430-451
   - Cambiar: Valores en `defaultModels` dentro de `getDefaultModelForProvider()`

### Para agregar nuevos modelos a la UI:

1. **Modificar código**:
   - Archivo: `packages/shared/src/open-swe/models.ts`
   - Líneas: 1-95
   - Agregar: Nuevo objeto en el array `MODEL_OPTIONS`

---

## Ubicación Completa de Archivos

```
open-swe/
├── apps/
│   └── open-swe/
│       ├── .env                          # ← Variables de entorno (configuración)
│       └── src/
│           └── utils/
│               └── llms/
│                   ├── model-manager.ts  # ← Modelos de fallback (líneas 430-451)
│                   ├── load-model.ts     # ← Carga de modelos
│                   └── index.ts
│
└── packages/
    └── shared/
        └── src/
            └── open-swe/
                ├── llm-task.ts           # ← Modelos por defecto (líneas 30-51)
                └── models.ts             # ← Lista de modelos para UI (líneas 1-95)
```

---

## Nota Importante

⚠️ **Recomendación**: Usa variables de entorno (`.env`) en lugar de modificar el código directamente. Esto te permite:
- Cambiar modelos sin modificar código
- Tener diferentes configuraciones para desarrollo/producción
- No perder cambios al actualizar el repositorio

Los valores hardcodeados en el código solo se usan como **fallback** si no hay variables de entorno configuradas.

