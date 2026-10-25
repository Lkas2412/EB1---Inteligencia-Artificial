# DataCheck — validador de calidad de archivos CSV

**Proyecto académico:** Examen Final | Inteligencia Artificial — Desarrollo de una aplicación con GitHub Copilot.


## 1. Contexto y problemática

En áreas administrativas o de análisis de datos es habitual recibir reportes CSV para análisis y carga de información. Si contienen celdas vacías o registros duplicados, los indicadores y los procesos posteriores pueden ser incorrectos. Identificar estos problemas manualmente en hojas de cálculo consume tiempo y expone a errores humanos.

## 2. Usuario objetivo

Analistas de datos, estudiantes y personal administrativo que necesita revisar archivos CSV antes de utilizarlos.

## 3. Objetivo y solución propuesta

**DataCheck** permite revisar la calidad básica de un archivo CSV desde una interfaz web. El procesamiento ocurre íntegramente en el navegador, sin enviar el archivo a un servidor.

## 4. Funcionalidades principales

1. Importar o arrastrar un archivo CSV de hasta **5 MB**.
2. Cargar un archivo de ejemplo para una demostración rápida.
3. Detectar delimitadores `,`, `;` o tabulación.
4. Contar registros, columnas, celdas vacías y filas duplicadas.
5. Visualizar completitud por columna, con porcentaje y barra.
6. Filtrar una vista previa de registros: todos, con vacíos y duplicados.
7. Descargar un informe CSV con indicadores y estadísticas por columna.
8. Restablecer el análisis para procesar otro archivo.
9. Mostrar un error claro y limpiar los resultados anteriores si una nueva carga no es válida.

**Regla de duplicidad:** se considera duplicada una fila cuyos valores, después de quitar espacios al inicio y final, son idénticos a los de una fila previa, respetando mayúsculas/minúsculas. El primer registro no se marca como duplicado. Las filas enteramente en blanco se omiten.

## 5. Tecnologías y estructura

- HTML5 y CSS3 para la interfaz responsiva.
- JavaScript (módulos ES) para importar, procesar y visualizar CSV.
- Node.js **solo opcional** para ejecutar pruebas automáticas.
- Git y GitHub para control de versiones y publicación.
- GitHub Copilot como asistente de programación, sujeto a evidencia real.

```text
Datacheck/
├── index.html                 Interfaz principal
├── styles.css                 Estilos responsivos
├── src/
│   ├── app.js                 Eventos, tablas y presentación
│   └── csv.js                 Análisis, validación y exportación
├── tests/
│   ├── app.test.js            Pruebas de la carga y presentación de resultados
│   └── csv.test.js            Pruebas de validación, análisis y exportación
├── datos_ejemplo.csv          Datos simulados para probar
├── docs/
│   ├── uso_copilot.md         Registro de uso real de GitHub Copilot
│   ├── pasos_entrega.md       Guía de publicación y checklist
│   └── guion_video.md         Guion de 1 minuto
├── evidencias/                Capturas reales de Copilot (añadir)
├── .nojekyll
└── README.md
```

## 6. Cómo ejecutar la aplicación

Este sitio es estático y **no requiere base de datos, claves API ni backend**.

**Opción A, VS Code:** abre esta carpeta y ejecuta la extensión *Live Server* sobre `index.html`.

**Opción B, Python instalado:** en la carpeta del proyecto ejecuta:

```bash
python -m http.server 5500
```

Luego abre `http://localhost:5500` en tu navegador. Se recomienda usar un servidor local en vez de abrir `index.html` con doble clic, porque los módulos JavaScript y la carga del ejemplo necesitan HTTP.

**Pruebas opcionales (Node.js 18+):**

```bash
npm test
```

## 7. Cómo usar

1. Presiona **Usar datos de ejemplo** o importa tu propio `.csv`.
2. Revisa las cuatro métricas del diagnóstico.
3. Identifica las columnas con menor completitud.
4. Selecciona **Con vacíos** o **Duplicados** para inspeccionar registros.
5. Presiona **Descargar informe CSV** para conservar los indicadores.

## 8. Uso de GitHub Copilot

El examen requiere demostrar el **uso real** de GitHub Copilot para apoyar el desarrollo, además de explicar las decisiones que tomaste. Consulta `docs/uso_copilot.md` para los prompts sugeridos, el registro por completar y las evidencias de pantalla.

**Registro de aportes efectivamente realizados con Copilot:** _Pendiente de completar con tu experiencia y las modificaciones realizadas_.

## 9. Enlaces de la entrega

- **Repositorio GitHub público:** _Pegar aquí el enlace creado_  
- **Aplicación GitHub Pages:** _Pegar aquí el enlace publicado_  
- **Video de demostración (máximo 1 min):** _Pegar aquí el enlace con permisos de visualización_  

## 10. Consideraciones y límites

- Admite archivos CSV de hasta 5 MB y 20 000 filas de datos, máximo 200 columnas.
- No modifica el archivo original; exporta un resumen de calidad, no una limpieza de registros.
- La vista previa enseña un máximo de 10 filas por filtro, pero las estadísticas incluyen todas las filas.
- No evalúa consistencia de formatos ni reglas específicas de negocio; únicamente datos vacíos y duplicados exactos.
- Los datos simulados del ejemplo no representan clientes reales.
- El navegador usa fuentes web de Google como recurso visual opcional; el **contenido del CSV no se transmite** a esa fuente.

## 11. Referencias de trabajo

- Workshop indicado por el docente: https://github-samples.github.io/copilot-workshops/first-steps/copilot-app/
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- GitHub Copilot en VS Code: https://code.visualstudio.com/docs/setup/copilot
