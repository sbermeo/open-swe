# Redis Configuration

Open SWE utiliza Redis para almacenar datos en memoria que anteriormente se guardaban en estructuras de datos en RAM. Esto permite una mejor escalabilidad y persistencia de datos.

## Instalación

### Usando Docker Compose (Recomendado)

Redis está configurado para ejecutarse con Docker Compose. Para iniciar Redis:

```bash
docker-compose up -d redis
```

Esto iniciará Redis en el puerto 6379 con persistencia habilitada.

### Configuración

Redis se conecta usando la variable de entorno `REDIS_URL`. Si no se especifica, se usa la URL por defecto:

```
REDIS_URL=redis://localhost:6379
```

Puedes configurar esta variable en tu archivo `.env`:

```env
REDIS_URL=redis://localhost:6379
```

## Datos Almacenados en Redis

### Circuit Breakers (ModelManager)

El sistema de circuit breakers para los modelos LLM ahora se almacena en Redis en lugar de memoria RAM. Esto permite:

- **Persistencia**: Los estados de circuit breakers persisten entre reinicios del servidor
- **Escalabilidad**: Múltiples instancias del servidor pueden compartir el mismo estado
- **Trazabilidad**: Los estados se pueden inspeccionar y monitorear

Los circuit breakers se almacenan con la clave:
```
circuit_breaker:{modelKey}
```

Donde `{modelKey}` es el identificador del modelo (ej: `anthropic:claude-sonnet-4-5-20250929`).

## Verificación

Para verificar que Redis está funcionando correctamente:

```bash
# Verificar que el contenedor está corriendo
docker ps | grep redis

# Conectarse a Redis CLI
docker exec -it open-swe-redis redis-cli

# Dentro de Redis CLI, puedes verificar las claves:
KEYS circuit_breaker:*
```

## Troubleshooting

### Redis no se conecta

1. Verifica que Redis esté corriendo: `docker ps | grep redis`
2. Verifica la URL de conexión en `REDIS_URL`
3. Revisa los logs: `docker logs open-swe-redis`

### Errores de conexión

Si ves errores de conexión, asegúrate de que:
- Redis esté corriendo en el puerto correcto (6379 por defecto)
- No haya un firewall bloqueando la conexión
- La URL de conexión sea correcta

