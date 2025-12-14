informacion de la actualizacion del proyecto
MODIFICACIONES
-Se comentarios los fallbacks de esta version, ya que se tuvo problemas para ejecutar la api de anthropic.
-Se implementó redis para sustituir el uso de la memoria RAM del servidor como almacén principal de la información crítica del agente.
-Se agrago un combo box al chat para elegir que modelo ejecutar

CONCLUSIONES
Se comento el uso de los fallbacks esto por el motivo de que se queria usar el modelo de anthropic pero al fallar este se iba a usar otro modelo como el de geminis, ademas para facilitar el cambio entre geminis,anthopic y open ai se agrego un combo box en el chat.
Aparte se implemento redis para no usar la memoria ram del servidor.

PROBLEMAS AUN SIN RESOLVER
-No se puede usar la api de open ai todavia hay un problema con la key de esta api
-Aun no se implementa postgres para ya no usar los discos duros del servidor si no la base de datos.
