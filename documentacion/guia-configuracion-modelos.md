# Guía de Configuración de Modelos mediante Variables de Entorno

## Ubicación del Archivo .env

Las variables de entorno se configuran en el archivo `.env` del **backend**:

```
/home/ubuntu/open-swe/apps/open-swe/.env
```

Este archivo es el que usa LangGraph según la configuración en `langgraph.json`:
```json
{
  "env": "./apps/open-swe/.env"
}
```

## Variables de Entorno Disponibles

### 1. Modelos Principales (DEFAULT_*_MODEL)

Estos modelos se usan cuando el usuario **NO ha seleccionado** un modelo específico en la interfaz web.

**Formato**: `DEFAULT_{TASK}_MODEL="{provider}:{model-name}"`

**Tareas disponibles**:
- `PLANNER` - Planificación de tareas
- `PROGRAMMER` - Programación y ejecución
- `REVIEWER` - Revisión de código
- `ROUTER` - Enrutamiento de mensajes
- `SUMMARIZER` - Resumen de conversaciones

**Ejemplo de configuración**:

```bash
# Usar Claude como modelos principales (valores por defecto)
DEFAULT_PLANNER_MODEL="anthropic:claude-sonnet-4-5-20250929"
DEFAULT_PROGRAMMER_MODEL="anthropic:claude-sonnet-4-5-20250929"
DEFAULT_REVIEWER_MODEL="anthropic:claude-sonnet-4-5-20250929"
DEFAULT_ROUTER_MODEL="anthropic:claude-haiku-4-5"
DEFAULT_SUMMARIZER_MODEL="anthropic:claude-haiku-4-5"

# O usar Gemini como modelos principales
DEFAULT_PLANNER_MODEL="google-genai:gemini-2.5-pro"
DEFAULT_PROGRAMMER_MODEL="google-genai:gemini-2.5-pro"
DEFAULT_REVIEWER_MODEL="google-genai:gemini-2.5-flash"
DEFAULT_ROUTER_MODEL="google-genai:gemini-2.5-flash"
DEFAULT_SUMMARIZER_MODEL="google-genai:gemini-2.5-pro"

# O usar OpenAI
DEFAULT_PLANNER_MODEL="openai:gpt-5-codex"
DEFAULT_PROGRAMMER_MODEL="openai:gpt-5-codex"
DEFAULT_REVIEWER_MODEL="openai:gpt-5-codex"
DEFAULT_ROUTER_MODEL="openai:gpt-5-nano"
DEFAULT_SUMMARIZER_MODEL="openai:gpt-5-mini"
```

**Ejemplo 3: Configuración completa con OpenAI como modelo principal**:

```bash
# Modelos principales - OpenAI
DEFAULT_PLANNER_MODEL="openai:gpt-5-codex"
DEFAULT_PROGRAMMER_MODEL="openai:gpt-5-codex"
DEFAULT_REVIEWER_MODEL="openai:gpt-5-codex"
DEFAULT_ROUTER_MODEL="openai:gpt-5-nano"
DEFAULT_SUMMARIZER_MODEL="openai:gpt-5-mini"

# Fallbacks - OpenAI
FALLBACK_OPENAI_PLANNER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_PROGRAMMER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_REVIEWER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_ROUTER_MODEL="gpt-5-nano"
FALLBACK_OPENAI_SUMMARIZER_MODEL="gpt-5-mini"
```

### 2. Modelos de Fallback (FALLBACK_*_*_MODEL)

Estos modelos se usan cuando el modelo principal **falla** y el sistema necesita usar un modelo alternativo del mismo proveedor.

**Formato**: `FALLBACK_{PROVIDER}_{TASK}_MODEL="{model-name}"`

**Proveedores disponibles**:
- `ANTHROPIC` - Para modelos Claude
- `OPENAI` - Para modelos GPT
- `GOOGLE_GENAI` - Para modelos Gemini

**Ejemplo de configuración**:

```bash
# Fallbacks para Anthropic
FALLBACK_ANTHROPIC_PLANNER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_PROGRAMMER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_REVIEWER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_ROUTER_MODEL="claude-3-5-haiku-20241022"
FALLBACK_ANTHROPIC_SUMMARIZER_MODEL="claude-sonnet-4-5-20250929"

# Fallbacks para OpenAI
FALLBACK_OPENAI_PLANNER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_PROGRAMMER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_REVIEWER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_ROUTER_MODEL="gpt-5-nano"
FALLBACK_OPENAI_SUMMARIZER_MODEL="gpt-5-mini"

# Fallbacks para Google GenAI
FALLBACK_GOOGLE_GENAI_PLANNER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_PROGRAMMER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_REVIEWER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_ROUTER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_SUMMARIZER_MODEL="gemini-2.5-pro"
```

## Cómo Configurar

### Paso 1: Editar el archivo .env

```bash
cd /home/ubuntu/open-swe/apps/open-swe
nano .env
# o
vim .env
```

### Paso 2: Agregar las variables deseadas

Puedes copiar y pegar cualquiera de los ejemplos anteriores. Por ejemplo, para usar Gemini como modelo principal:

```bash
# Modelos principales - Gemini
DEFAULT_PLANNER_MODEL="google-genai:gemini-2.5-pro"
DEFAULT_PROGRAMMER_MODEL="google-genai:gemini-2.5-pro"
DEFAULT_REVIEWER_MODEL="google-genai:gemini-2.5-flash"
DEFAULT_ROUTER_MODEL="google-genai:gemini-2.5-flash"
DEFAULT_SUMMARIZER_MODEL="google-genai:gemini-2.5-pro"

# Fallbacks - Mantener valores por defecto o personalizar
FALLBACK_GOOGLE_GENAI_PLANNER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_PROGRAMMER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_REVIEWER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_ROUTER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_SUMMARIZER_MODEL="gemini-2.5-pro"
```

### Paso 3: Reiniciar el servidor LangGraph

Después de modificar el `.env`, **debes reiniciar** el servidor LangGraph para que los cambios surtan efecto:

```bash
# Detener el servidor actual (Ctrl+C)
# Luego reiniciar
cd /home/ubuntu/open-swe/apps/open-swe
yarn langgraph dev
```

## Prioridad de Configuración

El sistema usa los modelos en el siguiente orden de prioridad:

1. **Modelo seleccionado por el usuario en la UI** (si existe)
2. **Variable de entorno `DEFAULT_{TASK}_MODEL`** (si está configurada)
3. **Valor hardcodeado por defecto** (del código)

Para los fallbacks:

1. **Variable de entorno `FALLBACK_{PROVIDER}_{TASK}_MODEL`** (si está configurada)
2. **Valor hardcodeado por defecto** (del código)

## Ejemplo Completo: Configuración con Gemini

```bash
# ==========================================
# MODELOS PRINCIPALES - Usar Gemini
# ==========================================
DEFAULT_PLANNER_MODEL="google-genai:gemini-2.5-pro"
DEFAULT_PROGRAMMER_MODEL="google-genai:gemini-2.5-pro"
DEFAULT_REVIEWER_MODEL="google-genai:gemini-2.5-flash"
DEFAULT_ROUTER_MODEL="google-genai:gemini-2.5-flash"
DEFAULT_SUMMARIZER_MODEL="google-genai:gemini-2.5-pro"

# ==========================================
# FALLBACKS - Configurar todos los proveedores
# ==========================================
# Google GenAI fallbacks
FALLBACK_GOOGLE_GENAI_PLANNER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_PROGRAMMER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_REVIEWER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_ROUTER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_SUMMARIZER_MODEL="gemini-2.5-pro"

# Anthropic fallbacks (por si acaso)
FALLBACK_ANTHROPIC_PLANNER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_PROGRAMMER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_REVIEWER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_ROUTER_MODEL="claude-3-5-haiku-20241022"
FALLBACK_ANTHROPIC_SUMMARIZER_MODEL="claude-sonnet-4-5-20250929"

# OpenAI fallbacks (por si acaso)
FALLBACK_OPENAI_PLANNER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_PROGRAMMER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_REVIEWER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_ROUTER_MODEL="gpt-5-nano"
FALLBACK_OPENAI_SUMMARIZER_MODEL="gpt-5-mini"
```

## Ejemplo Completo: Configuración con OpenAI

```bash
# ==========================================
# MODELOS PRINCIPALES - Usar OpenAI
# ==========================================
DEFAULT_PLANNER_MODEL="openai:gpt-5-codex"
DEFAULT_PROGRAMMER_MODEL="openai:gpt-5-codex"
DEFAULT_REVIEWER_MODEL="openai:gpt-5-codex"
DEFAULT_ROUTER_MODEL="openai:gpt-5-nano"
DEFAULT_SUMMARIZER_MODEL="openai:gpt-5-mini"

# ==========================================
# FALLBACKS - Configurar todos los proveedores
# ==========================================
# OpenAI fallbacks
FALLBACK_OPENAI_PLANNER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_PROGRAMMER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_REVIEWER_MODEL="gpt-5-codex"
FALLBACK_OPENAI_ROUTER_MODEL="gpt-5-nano"
FALLBACK_OPENAI_SUMMARIZER_MODEL="gpt-5-mini"

# Anthropic fallbacks (por si acaso)
FALLBACK_ANTHROPIC_PLANNER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_PROGRAMMER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_REVIEWER_MODEL="claude-sonnet-4-5-20250929"
FALLBACK_ANTHROPIC_ROUTER_MODEL="claude-3-5-haiku-20241022"
FALLBACK_ANTHROPIC_SUMMARIZER_MODEL="claude-sonnet-4-5-20250929"

# Google GenAI fallbacks (por si acaso)
FALLBACK_GOOGLE_GENAI_PLANNER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_PROGRAMMER_MODEL="gemini-2.5-pro"
FALLBACK_GOOGLE_GENAI_REVIEWER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_ROUTER_MODEL="gemini-2.5-flash"
FALLBACK_GOOGLE_GENAI_SUMMARIZER_MODEL="gemini-2.5-pro"
```

## Verificación

Para verificar que la configuración está funcionando:

1. **Revisar logs del servidor**: Cuando inicies el servidor, deberías ver mensajes de debug indicando qué modelos se están usando.

2. **Probar en la aplicación**: 
   - Crea una nueva tarea en la interfaz web
   - Si no seleccionas un modelo manualmente, debería usar los modelos configurados en `DEFAULT_*_MODEL`

3. **Forzar un fallback**: Si un modelo falla, el sistema debería usar los modelos configurados en `FALLBACK_*_*_MODEL`

## Notas Importantes

- ⚠️ **Debes reiniciar el servidor LangGraph** después de modificar el `.env`
- ⚠️ Los modelos deben estar en el formato correcto: `{provider}:{model-name}`
- ⚠️ Asegúrate de tener las API keys configuradas para los proveedores que uses:
  - `ANTHROPIC_API_KEY` para Claude
  - `OPENAI_API_KEY` para GPT
  - `GOOGLE_API_KEY` para Gemini
- ⚠️ Si omites una variable, se usará el valor por defecto hardcodeado en el código

## Modelos Disponibles

### Anthropic (Claude)
- `anthropic:claude-sonnet-4-5-20250929`
- `anthropic:claude-sonnet-4-5-20250929`
- `anthropic:claude-sonnet-4-5`
- `anthropic:claude-sonnet-4-0`
- `anthropic:claude-3-5-haiku-20241022`
- `anthropic:claude-3-7-sonnet-latest`
- `anthropic:claude-3-5-sonnet-latest`

### OpenAI (GPT)
- `openai:gpt-5-codex`
- `openai:gpt-5`
- `openai:gpt-5-mini`
- `openai:gpt-5-nano`
- `openai:gpt-4o`
- `openai:gpt-4o-mini`
- `openai:o4`
- `openai:o4-mini`
- `openai:o3`
- `openai:o3-mini`

### Google GenAI (Gemini)
- `google-genai:gemini-2.5-pro`
- `google-genai:gemini-2.5-flash`

